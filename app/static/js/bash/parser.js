import { COMMANDS } from "../simulation/registry.js";
import { bashError } from "./errors.js";
import { lexScript, plainValue } from "./lexer.js";
import { BASH_LIMITS } from "./limits.js";

const SCRIPT_COMMANDS = new Set(COMMANDS.filter(name => !["clear", "help"].includes(name)));
const UNARY_TESTS = new Set(["-e", "-f", "-d"]);
const BINARY_TESTS = new Set(["=", "!=", "-eq", "-ne", "-lt", "-le", "-gt", "-ge"]);

function rejectGlob(word, context = "ordinary commands") {
  if (word.parts.some(part => part.kind === "text" && part.quote === null && /[\*?\[\]]/.test(part.value))) {
    bashError("unsupported", `unquoted globs are supported only in for lists, not ${context}`, word);
  }
}

function testExpression(words, position) {
  if (words.length === 2 && UNARY_TESTS.has(plainValue(words[0]))) {
    rejectGlob(words[1], "tests");
    return { type: "file", operator: plainValue(words[0]), operand: words[1] };
  }
  if (words.length === 3 && BINARY_TESTS.has(plainValue(words[1]))) {
    rejectGlob(words[0], "tests");
    rejectGlob(words[2], "tests");
    return { type: "compare", operator: plainValue(words[1]), left: words[0], right: words[2] };
  }
  bashError("unsupported", "test supports -e/-f/-d, =/!=, and basic numeric comparisons", words[0] || position);
}

export function parseScript(source) {
  const lines = lexScript(source);
  let cursor = 0;
  let statements = 0;
  const at = () => lines[cursor];
  const first = () => plainValue(at()?.tokens[0]);
  const mark = node => {
    statements += 1;
    if (statements > BASH_LIMITS.astStatements) bashError("budget", "script has too many statements", node);
    return node;
  };
  const skipEmpty = () => { while (at() && !at().tokens.length) cursor += 1; };
  const consumeMarker = (word, position) => {
    skipEmpty();
    if (first() !== word || at().tokens.length !== 1) bashError("syntax", `expected ${word} on its own line`, at()?.tokens[0] || position);
    cursor += 1;
  };

  function parseBlock(stops, depth) {
    if (depth > BASH_LIMITS.nesting) bashError("budget", "blocks are nested too deeply", at()?.tokens[0]);
    const nodes = [];
    while (cursor < lines.length) {
      skipEmpty();
      if (cursor >= lines.length) break;
      const keyword = first();
      if (stops.has(keyword)) {
        if (at().tokens.length !== 1) bashError("syntax", `${keyword} must be on its own line`, at().tokens[0]);
        break;
      }
      if (["then", "else", "fi", "do", "done"].includes(keyword)) {
        bashError("syntax", `unexpected ${keyword}`, at().tokens[0]);
      }
      if (keyword === "if") nodes.push(parseIf(depth));
      else if (keyword === "for") nodes.push(parseFor(depth));
      else nodes.push(parseSimple());
    }
    return nodes;
  }

  function parseIf(depth) {
    const line = at();
    const tokens = line.tokens;
    if (plainValue(tokens[1]) !== "[") bashError("syntax", "if requires a [ test ] condition", tokens[1] || tokens[0]);
    const closing = tokens.findIndex((token, index) => index > 1 && plainValue(token) === "]");
    if (closing < 0) bashError("syntax", "missing ] in if test", tokens[0]);
    const condition = testExpression(tokens.slice(2, closing), tokens[0]);
    const suffix = tokens.slice(closing + 1);
    if (suffix.length) {
      if (suffix.length !== 2 || suffix[0].kind !== "operator" || suffix[0].value !== ";" || plainValue(suffix[1]) !== "then") {
        bashError("syntax", "expected ; then after the if test", suffix[0]);
      }
      cursor += 1;
    } else { cursor += 1; consumeMarker("then", tokens[0]); }
    const consequent = parseBlock(new Set(["else", "fi"]), depth + 1);
    let alternate = [];
    if (first() === "else") {
      cursor += 1;
      alternate = parseBlock(new Set(["fi"]), depth + 1);
    }
    consumeMarker("fi", tokens[0]);
    return mark({ type: "if", condition, consequent, alternate, line: tokens[0].line, column: tokens[0].column });
  }

  function parseFor(depth) {
    const line = at();
    const tokens = line.tokens;
    const name = plainValue(tokens[1]);
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ["HOME", "PWD"].includes(name)) {
      bashError("syntax", "for requires a writable variable name", tokens[1] || tokens[0]);
    }
    if (plainValue(tokens[2]) !== "in") bashError("syntax", "for requires an in word list", tokens[2] || tokens[0]);
    const semicolon = tokens.findIndex(token => token.kind === "operator" && token.value === ";");
    let words;
    if (semicolon >= 0) {
      if (semicolon !== tokens.length - 2 || plainValue(tokens[semicolon + 1]) !== "do") {
        bashError("syntax", "expected ; do after the for list", tokens[semicolon]);
      }
      words = tokens.slice(3, semicolon);
      cursor += 1;
    } else { words = tokens.slice(3); cursor += 1; consumeMarker("do", tokens[0]); }
    if (!words.length || words.some(word => word.kind !== "word")) bashError("syntax", "for requires one or more list words", tokens[0]);
    for (const word of words) {
      const unquoted = word.parts.filter(part => part.kind === "text" && part.quote === null);
      if (unquoted.some(part => /[\[\]]/.test(part.value))) bashError("unsupported", "bracket globs are unsupported", word);
      if (unquoted.some(part => /[\*?]/.test(part.value)) &&
          (word.parts.some(part => part.kind !== "text" || part.quote !== null))) {
        bashError("unsupported", "for globs must be one unquoted literal path pattern", word);
      }
    }
    const body = parseBlock(new Set(["done"]), depth + 1);
    consumeMarker("done", tokens[0]);
    return mark({ type: "for", name, words, body, line: tokens[0].line, column: tokens[0].column });
  }

  function parseSimple() {
    const tokens = at().tokens;
    const position = tokens[0];
    cursor += 1;
    if (tokens.some(token => token.kind === "operator" && token.value === ";")) {
      bashError("unsupported", "general semicolon command chaining is unsupported", tokens.find(token => token.value === ";"));
    }
    const firstPart = position.parts?.[0];
    const assignment = firstPart?.kind === "text" && firstPart.quote === null &&
      /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(firstPart.value);
    if (assignment) {
      if (tokens.length !== 1) bashError("syntax", "assignment must occupy one line", tokens[1]);
      const name = assignment[1];
      if (["HOME", "PWD"].includes(name)) bashError("unsupported", `${name} is read-only in Bash V1`, position);
      const word = { ...position, parts: [
        { ...firstPart, value: firstPart.value.slice(name.length + 1) }, ...position.parts.slice(1),
      ] };
      rejectGlob(word, "assignments");
      return mark({ type: "assignment", name, value: word, line: position.line, column: position.column });
    }
    const command = plainValue(position);
    if (command === "exit") {
      if (tokens.length > 2 || tokens[1]?.kind === "operator") bashError("syntax", "exit accepts at most one status", position);
      if (tokens[1]) rejectGlob(tokens[1], "exit");
      return mark({ type: "exit", value: tokens[1] || null, line: position.line, column: position.column });
    }
    if (!command || !SCRIPT_COMMANDS.has(command)) bashError("unsupported", `${command || "dynamic command names"} are unsupported in Bash V1`, position);
    const redirectIndex = tokens.findIndex(token => token.kind === "operator");
    let args = tokens.slice(1);
    let redirect = null;
    if (redirectIndex >= 0) {
      const operator = tokens[redirectIndex];
      if (![">", ">>"].includes(operator.value) || redirectIndex !== tokens.length - 2 || tokens[redirectIndex + 1].kind !== "word") {
        bashError("syntax", "use one > or >> followed by a virtual file path", operator);
      }
      args = tokens.slice(1, redirectIndex);
      redirect = { append: operator.value === ">>", target: tokens[redirectIndex + 1] };
      rejectGlob(redirect.target, "redirects");
    }
    for (const word of args) {
      if (word.kind !== "word") bashError("syntax", "unexpected operator in command", word);
      rejectGlob(word);
    }
    return mark({ type: "command", command, args, redirect, line: position.line, column: position.column });
  }

  const body = parseBlock(new Set(), 0);
  return { type: "script", body, sourceLines: lines.length };
}
