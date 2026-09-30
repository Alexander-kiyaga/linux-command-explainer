import { executeParsedCommand } from "../simulation/engine.js";
import { stat } from "../simulation/filesystem.js";
import { cloneSession, LIMITS, utf8Length } from "../simulation/model.js";
import { resolvePath } from "../simulation/paths.js";
import { SimError } from "../simulation/errors.js";
import { bashError, BashError, describeError } from "./errors.js";
import { expandWord } from "./expand.js";
import { expandForGlob, isForGlob } from "./glob.js";
import { BASH_LIMITS } from "./limits.js";
import { parseScript } from "./parser.js";

function decimal(value, position) {
  if (!/^-?(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
    bashError("runtime", "numeric comparison requires a safe decimal integer", position);
  }
  return Number(value);
}

function evaluateTest(test, state, position) {
  if (test.type === "file") {
    const token = expandWord(test.operand, state.variables, state.session, state.lastStatus);
    const path = resolvePath(state.session, token.value, token.homeExpansion);
    if (!state.session.nodes.has(path)) return false;
    const node = stat(state.session, path);
    return test.operator === "-e" || (test.operator === "-f" ? node.type === "file" : node.type === "directory");
  }
  const left = expandWord(test.left, state.variables, state.session, state.lastStatus).value;
  const right = expandWord(test.right, state.variables, state.session, state.lastStatus).value;
  switch (test.operator) {
    case "=": return left === right;
    case "!=": return left !== right;
    default: {
      const a = decimal(left, test.left);
      const b = decimal(right, test.right);
      switch (test.operator) {
        case "-eq": return a === b;
        case "-ne": return a !== b;
        case "-lt": return a < b;
        case "-le": return a <= b;
        case "-gt": return a > b;
        case "-ge": return a >= b;
        default: bashError("unsupported", "unsupported comparison", position);
      }
    }
  }
}

function assign(state, name, value, position) {
  if (!state.variables.has(name) && state.variables.size >= BASH_LIMITS.variables) {
    bashError("budget", "too many script variables", position);
  }
  if (utf8Length(value) > BASH_LIMITS.variableBytes) bashError("budget", "variable value exceeds 1 KiB", position);
  state.variables.set(name, value);
}

function output(state, kind, text, position) {
  if (!text) return;
  state.outputBytes += utf8Length(text);
  if (state.outputBytes > BASH_LIMITS.outputBytes) bashError("budget", "script output exceeds 64 KiB", position);
  state.events.push({ kind, text, line: position.line });
}

function runNode(node, state) {
  state.executedStatements += 1;
  if (state.executedStatements > BASH_LIMITS.executedStatements) bashError("budget", "too many executed statements", node);
  state.position = node;
  if (node.type === "assignment") {
    const value = expandWord(node.value, state.variables, state.session, state.lastStatus).value;
    assign(state, node.name, value, node);
    state.lastStatus = 0;
    return false;
  }
  if (node.type === "command") {
    state.commands += 1;
    if (state.commands > BASH_LIMITS.commands) bashError("budget", "too many simulated commands", node);
    const args = node.args.map(word => expandWord(word, state.variables, state.session, state.lastStatus));
    if (args.length > LIMITS.arguments) bashError("budget", "too many command arguments", node);
    const redirect = node.redirect && {
      append: node.redirect.append,
      target: expandWord(node.redirect.target, state.variables, state.session, state.lastStatus),
    };
    const expandedBytes = utf8Length(node.command) + args.reduce((size, token) => size + utf8Length(token.value) + 1, 0) +
      (redirect ? utf8Length(redirect.target.value) + 3 : 0);
    if (expandedBytes > LIMITS.inputLength) bashError("budget", "expanded command exceeds 2 KiB", node);
    const result = executeParsedCommand(state.session, { command: node.command, args, redirect });
    state.session = result.session;
    state.lastStatus = result.exitCode;
    output(state, "stdout", result.stdout, node);
    output(state, "stderr", result.stderr, node);
    return false;
  }
  if (node.type === "if") {
    const passed = evaluateTest(node.condition, state, node);
    state.lastStatus = passed ? 0 : 1;
    const branch = passed ? node.consequent : node.alternate;
    if (!branch.length) state.lastStatus = 0;
    return runBlock(branch, state);
  }
  if (node.type === "for") {
    const items = [];
    for (const word of node.words) {
      if (isForGlob(word)) items.push(...expandForGlob(state.session, word.parts.map(part => part.value).join(""), word));
      else items.push(expandWord(word, state.variables, state.session, state.lastStatus).value);
      if (items.length > BASH_LIMITS.loopItems) bashError("budget", "for list exceeds 100 items", node);
    }
    if (!items.length) state.lastStatus = 0;
    for (const item of items) {
      state.loopIterations += 1;
      if (state.loopIterations > BASH_LIMITS.loopIterations) bashError("budget", "too many loop iterations", node);
      assign(state, node.name, item, node);
      state.lastStatus = 0;
      if (runBlock(node.body, state)) return true;
    }
    return false;
  }
  if (node.type === "exit") {
    if (node.value) {
      const value = expandWord(node.value, state.variables, state.session, state.lastStatus).value;
      if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) > 125) {
        bashError("runtime", "exit status must be an integer from 0 to 125", node);
      }
      state.lastStatus = Number(value);
    }
    return true;
  }
  bashError("fault", "unknown interpreter node", node);
}

function runBlock(nodes, state) {
  for (const node of nodes) if (runNode(node, state)) return true;
  return false;
}

export function runScript(initialSession, source) {
  let state = null;
  try {
    const ast = parseScript(source);
    state = {
      session: cloneSession(initialSession), variables: new Map(), lastStatus: 0,
      events: [], outputBytes: 0, executedStatements: 0, commands: 0, loopIterations: 0,
      position: { line: 1, column: 1 },
    };
    runBlock(ast.body, state);
    return {
      session: state.session, committed: true, exitCode: state.lastStatus,
      stdout: state.events.filter(item => item.kind === "stdout").map(item => item.text).join(""),
      stderr: state.events.filter(item => item.kind === "stderr").map(item => item.text).join(""),
      events: state.events, error: null,
      counts: { statements: state.executedStatements, commands: state.commands, iterations: state.loopIterations },
    };
  } catch (error) {
    const position = state?.position || { line: 1, column: 1 };
    const safe = error instanceof BashError ? error : error instanceof SimError
      ? new BashError("runtime", error.message, position.line, position.column)
      : new BashError("fault", "interpreter fault; virtual changes were discarded", position.line, position.column);
    return {
      session: initialSession, committed: false, exitCode: safe.kind === "budget" ? 124 : 2,
      stdout: "", stderr: describeError(safe) + "\n", events: [],
      error: { kind: safe.kind, message: safe.message, line: safe.line, column: safe.column },
      counts: { statements: state?.executedStatements || 0, commands: state?.commands || 0, iterations: state?.loopIterations || 0 },
    };
  }
}
