import { fail } from "./errors.js";
import { LIMITS } from "./model.js";

const UNSUPPORTED = new Set(["|", "&", ";", "<", "(", ")"]);

export function tokenize(input) {
  if (typeof input !== "string" || input.length > LIMITS.inputLength) fail("command line exceeds simulation limit", 2);
  if (input.includes("\n") || input.includes("\r") || input.includes("\0")) fail("enter one command line at a time", 2);
  const tokens = [];
  let value = "";
  let started = false;
  let quote = null;
  let homeExpansion = false;
  const flush = () => {
    if (started) tokens.push({ kind: "word", value, homeExpansion });
    value = "";
    started = false;
    homeExpansion = false;
  };
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else value += ch;
      continue;
    }
    if (ch === "\\") {
      if (index + 1 >= input.length) fail("trailing escape is unsupported", 2);
      value += input[++index];
      started = true;
      continue;
    }
    if (ch === '"') {
      quote = quote === '"' ? null : '"';
      started = true;
      continue;
    }
    if (ch === "'" && quote === null) {
      quote = "'";
      started = true;
      continue;
    }
    if (ch === "$" || ch === "`") fail("variables and command substitution are not supported", 2);
    if (quote === null && /\s/.test(ch)) { flush(); continue; }
    if (quote === null && ch === ">") {
      flush();
      const operator = input[index + 1] === ">" ? ">>" : ">";
      if (operator === ">>") index += 1;
      tokens.push({ kind: "operator", value: operator });
      continue;
    }
    if (quote === null && UNSUPPORTED.has(ch)) fail(`syntax '${ch}' is not supported in Playground V1`, 2);
    if (quote === null && (ch === "*" || ch === "?" || ch === "[" || ch === "]")) {
      fail("shell wildcard expansion is not supported; quote patterns for find -name", 2);
    }
    if (!started && ch === "~" && quote === null) homeExpansion = true;
    value += ch;
    started = true;
  }
  if (quote !== null) fail("unclosed quote", 2);
  flush();
  if (tokens.length > LIMITS.arguments + 3) fail("too many arguments", 2);
  return tokens;
}

export function parseLine(input) {
  const tokens = tokenize(input);
  if (!tokens.length) return null;
  if (tokens[0].kind !== "word") fail("expected a command name", 2);
  const redirectIndex = tokens.findIndex(token => token.kind === "operator");
  if (redirectIndex === -1) {
    return { command: tokens[0].value, args: tokens.slice(1), redirect: null };
  }
  if (redirectIndex !== tokens.length - 2 || tokens[redirectIndex + 1].kind !== "word" ||
      tokens.slice(redirectIndex + 1).some((token, index) => index > 0 && token.kind === "operator")) {
    fail("use a single > or >> followed by one virtual file path", 2);
  }
  return {
    command: tokens[0].value,
    args: tokens.slice(1, redirectIndex),
    redirect: { append: tokens[redirectIndex].value === ">>", target: tokens[redirectIndex + 1] },
  };
}
