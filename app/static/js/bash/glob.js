import { listChildren } from "../simulation/filesystem.js";
import { baseName, resolvePath } from "../simulation/paths.js";
import { bashError } from "./errors.js";
import { BASH_LIMITS } from "./limits.js";

export function isForGlob(word) {
  return word.parts.some(part => part.kind === "text" && part.quote === null && /[\*?]/.test(part.value));
}

export function expandForGlob(session, pattern, position) {
  const slash = pattern.lastIndexOf("/");
  const prefix = slash < 0 ? "" : pattern.slice(0, slash + 1);
  const basenamePattern = slash < 0 ? pattern : pattern.slice(slash + 1);
  if (!basenamePattern || !/[\*?]/.test(basenamePattern) || /[\*?]/.test(prefix)) {
    bashError("unsupported", "for globs must use * or ? in the final path component", position);
  }
  const parentInput = slash < 0 ? "." : prefix.slice(0, -1) || "/";
  const parent = resolvePath(session, parentInput, true);
  const escaped = basenamePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp("^" + escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".") + "$", "u");
  const matches = listChildren(session, parent)
    .map(baseName)
    .filter(name => (basenamePattern.startsWith(".") || !name.startsWith(".")) && expression.test(name))
    .map(name => prefix.startsWith("~") ? (parent === "/" ? "/" : parent + "/") + name : prefix + name);
  if (matches.length > BASH_LIMITS.loopItems) bashError("budget", "for glob matches too many virtual paths", position);
  return matches;
}
