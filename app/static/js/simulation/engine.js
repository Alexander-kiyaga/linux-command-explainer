import { SimError, fail } from "./errors.js";
import { writeFile } from "./filesystem.js";
import { assertLimits, cloneSession, LIMITS, utf8Length } from "./model.js";
import { parseLine } from "./parser.js";
import { pathArg } from "./commands/options.js";
import { pwd, whoami, cd, ls, clear, help } from "./commands/basic.js";
import { mkdir, touch, cat, echo, cp, mv, rm, chmod } from "./commands/files.js";
import { head, tail, grep, find } from "./commands/text.js";

export const COMMANDS = Object.freeze([
  "pwd", "ls", "cd", "mkdir", "touch", "cat", "echo", "cp", "mv", "rm",
  "head", "tail", "grep", "find", "chmod", "whoami", "clear", "help",
]);
const handlers = new Map(Object.entries({
  pwd, ls, cd, mkdir, touch, cat, echo, cp, mv, rm,
  head, tail, grep, find, chmod, whoami, clear, help,
}));

function rejected(session, error) {
  if (!(error instanceof SimError)) throw error;
  return { session, stdout: "", stderr: error.message + "\n", exitCode: error.exitCode, effect: null };
}

// A future Bash parser can pass its own simple-command AST here, using the same
// registry and virtual filesystem. It must not evaluate arbitrary JavaScript.
export function executeParsedCommand(session, parsed) {
  // This module has no DOM, storage, network, shell, or host filesystem capability.
  try {
    assertLimits(session);
    if (!parsed) return { session, stdout: "", stderr: "", exitCode: 0, effect: null };
    if (typeof parsed.command !== "string" || !Array.isArray(parsed.args)) fail("invalid simulated command", 2);
    const handler = handlers.get(parsed.command);
    if (!handler) return {
      session, stdout: "", stderr: `${parsed.command}: unsupported command; type help for V1 commands\n`,
      exitCode: 127, effect: null,
    };
    const next = cloneSession(session);
    const result = handler(next, parsed.args);
    const exitCode = result.exitCode ?? 0;
    let stdout = result.stdout || "";
    if (typeof stdout !== "string" || utf8Length(stdout) > LIMITS.outputBytes) {
      fail("terminal output exceeds simulation limit");
    }
    if (parsed.redirect) {
      if (result.effect) fail("clear cannot be redirected", 2);
      if (exitCode === 0) {
        writeFile(next, pathArg(next, parsed.redirect.target), stdout, parsed.redirect.append);
        stdout = "";
      }
    }
    assertLimits(next);
    return {
      session: next, stdout, stderr: result.stderr || "", exitCode,
      effect: result.effect || null,
    };
  } catch (error) {
    return rejected(session, error);
  }
}

export function executeLine(session, input) {
  try {
    return executeParsedCommand(session, parseLine(input));
  } catch (error) {
    return rejected(session, error);
  }
}
