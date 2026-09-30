import { fail } from "../errors.js";
import { resolvePath } from "../paths.js";

export function pathArg(session, token) {
  return resolvePath(session, token.value, token.homeExpansion);
}

export function parseFlags(command, args, permitted) {
  const flags = new Set();
  let index = 0;
  for (; index < args.length; index += 1) {
    const value = args[index].value;
    if (value === "--") { index += 1; break; }
    if (!value.startsWith("-") || value === "-") break;
    if (value.startsWith("--")) fail(`${command}: unsupported option ${value}`, 2);
    for (const flag of value.slice(1)) {
      if (!permitted.includes(flag)) fail(`${command}: unsupported option -${flag}`, 2);
      flags.add(flag);
    }
  }
  return { flags, operands: args.slice(index) };
}

export function expectCount(command, operands, min, max = min) {
  if (operands.length < min || operands.length > max) fail(`${command}: expected ${min === max ? min : `${min}–${max}`} argument(s)`, 2);
}
