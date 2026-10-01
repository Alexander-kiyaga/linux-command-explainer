import { SimError } from "./errors.js";
import { parseLine } from "./parser.js";
import { COMMANDS } from "./registry.js";
import { validateCommandSyntax } from "./syntax.js";
import { parseFlags } from "./commands/options.js";
import { resolvePath } from "./paths.js";

const KNOWN = new Set(COMMANDS);
const FALLBACK_CONTEXT = Object.freeze({ cwd: "/", home: "/home/learner" });

function rootSourceOrTarget(parsed, session) {
  if (!["rm", "cp", "mv"].includes(parsed.command)) return false;
  const { operands } = parseFlags(parsed.command, parsed.args, parsed.command === "rm" ? "rf" : parsed.command === "cp" ? "r" : "");
  const candidates = parsed.command === "rm" ? operands : operands.slice(0, 1);
  return candidates.some(token => {
    if (!session && !token.value.startsWith("/")) return false;
    return resolvePath(session || FALLBACK_CONTEXT, token.value, token.homeExpansion) === "/";
  });
}

function warningFor(parsed) {
  if (parsed.command === "rm") return "Deletes virtual data here; a similar real command can cause irreversible data loss.";
  if (parsed.command === "chmod") return "Changes virtual permissions here; check the impact before using chmod on a real system.";
  if (parsed.redirect && !parsed.redirect.append) return "The > redirect overwrites the target virtual file if it exists.";
  if (["cp", "mv"].includes(parsed.command)) return "Copying or moving can replace virtual files; review paths before real-world use.";
  return null;
}

export function classifyCommand(command, session = null) {
  if (typeof command !== "string" || !command.trim()) {
    return { status: "unsupported", canTry: false, reason: "Enter one command to check.", warning: null };
  }
  let parsed;
  try { parsed = parseLine(command); }
  catch (error) {
    if (!(error instanceof SimError)) throw error;
    const head = command.trim().split(/\s+/)[0];
    const partial = KNOWN.has(head) && /wildcard|unclosed quote|trailing escape/.test(error.message);
    return { status: partial ? "partial" : "unsupported", canTry: false, reason: error.message, warning: null };
  }
  if (!parsed || !KNOWN.has(parsed.command)) {
    return { status: "unsupported", canTry: false, reason: `${parsed?.command || "Command"} is not in Playground V1.`, warning: null };
  }
  try {
    validateCommandSyntax(parsed);
    if (rootSourceOrTarget(parsed, session)) {
      return { status: "blocked", canTry: false, reason: "The simulator blocks operations on the virtual root.", warning: warningFor(parsed) };
    }
  } catch (error) {
    if (!(error instanceof SimError)) throw error;
    return { status: "partial", canTry: false, reason: error.message, warning: warningFor(parsed) };
  }
  return {
    status: "supported", canTry: true,
    reason: "This syntax is supported by Playground V1. Success still depends on the current virtual files, paths and permissions.",
    warning: warningFor(parsed),
  };
}
