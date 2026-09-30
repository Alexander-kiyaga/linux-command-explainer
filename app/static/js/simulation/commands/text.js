import { fail } from "../errors.js";
import { listChildren, readFile, stat } from "../filesystem.js";
import { baseName } from "../paths.js";
import { expectCount, parseFlags, pathArg } from "./options.js";

function linesOf(content) {
  if (!content) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function lineChunks(content) {
  return content.match(/[^\n]*\n|[^\n]+$/g) || [];
}

function countAndFile(command, args) {
  let count = 10;
  let operands = args;
  if (args[0]?.value === "--") {
    operands = args.slice(1);
  } else if (args[0]?.value === "-n") {
    if (!args[1] || !/^[0-9]+$/.test(args[1].value)) fail(`${command}: -n needs a non-negative number`, 2);
    count = Number(args[1].value);
    if (!Number.isSafeInteger(count) || count > 10000) fail(`${command}: line count exceeds simulation limit`, 2);
    operands = args[2]?.value === "--" ? args.slice(3) : args.slice(2);
  } else if (args[0]?.value.startsWith("-")) {
    fail(`${command}: unsupported option ${args[0].value}`, 2);
  }
  expectCount(command, operands, 1);
  return { count, file: operands[0] };
}

export function head(session, args) {
  const { count, file } = countAndFile("head", args);
  const chunks = lineChunks(readFile(session, pathArg(session, file))).slice(0, count);
  return { stdout: chunks.join("") };
}

export function tail(session, args) {
  const { count, file } = countAndFile("tail", args);
  const chunks = count === 0 ? [] : lineChunks(readFile(session, pathArg(session, file))).slice(-count);
  return { stdout: chunks.join("") };
}

export function grep(session, args) {
  const { flags, operands } = parseFlags("grep", args, "inF");
  if (operands.length < 2) fail("grep: expected a pattern and at least one virtual file", 2);
  const pattern = operands[0].value;
  if (!flags.has("F") && /[.*+?^${}()|[\]\\]/.test(pattern)) {
    fail("grep: regex is not supported; use -F to search for those characters literally", 2);
  }
  const needle = flags.has("i") ? pattern.toLowerCase() : pattern;
  const matches = [];
  for (const operand of operands.slice(1)) {
    const path = pathArg(session, operand);
    const lines = linesOf(readFile(session, path));
    lines.forEach((line, index) => {
      const haystack = flags.has("i") ? line.toLowerCase() : line;
      if (haystack.includes(needle)) {
        let prefix = operands.length > 2 ? `${path}:` : "";
        if (flags.has("n")) prefix += `${index + 1}:`;
        matches.push(prefix + line);
      }
    });
  }
  return { stdout: matches.length ? matches.join("\n") + "\n" : "", exitCode: matches.length ? 0 : 1 };
}

function globMatch(pattern, name) {
  // Bounded dynamic programming: find -name patterns only, never shell expansion.
  if (pattern.length > 256) fail("find: name pattern is too long", 2);
  let previous = Array(name.length + 1).fill(false);
  previous[0] = true;
  for (const ch of pattern) {
    const current = Array(name.length + 1).fill(false);
    if (ch === "*") {
      current[0] = previous[0];
      for (let i = 1; i <= name.length; i += 1) current[i] = previous[i] || current[i - 1];
    } else {
      for (let i = 1; i <= name.length; i += 1) {
        current[i] = previous[i - 1] && (ch === "?" || ch === name[i - 1]);
      }
    }
    previous = current;
  }
  return previous[name.length];
}

export function find(session, args) {
  let index = 0;
  let start = session.cwd;
  let displayStart = ".";
  if (args[0] && !args[0].value.startsWith("-")) {
    start = pathArg(session, args[0]);
    displayStart = args[0].homeExpansion ? start : args[0].value.replace(/\/$/, "") || "/";
    index = 1;
  }
  let namePattern = null;
  let typeFilter = null;
  while (index < args.length) {
    const option = args[index++].value;
    const value = args[index++]?.value;
    if (value === undefined) fail(`find: ${option} requires a value`, 2);
    if (option === "-name" && namePattern === null) namePattern = value;
    else if (option === "-type" && typeFilter === null && ["f", "d"].includes(value)) typeFilter = value;
    else fail(`find: unsupported or repeated option ${option}`, 2);
  }
  stat(session, start);
  const found = [];
  function visit(path, depth) {
    if (depth > 32) fail("find: virtual traversal depth exceeded");
    const node = stat(session, path);
    if ((namePattern === null || globMatch(namePattern, baseName(path))) &&
        (typeFilter === null || (typeFilter === "f" ? node.type === "file" : node.type === "directory"))) {
      found.push(path === start ? displayStart : displayStart === "/"
        ? path : displayStart.replace(/\/$/, "") + path.slice(start.length));
    }
    if (node.type === "directory") {
      for (const child of listChildren(session, path)) visit(child, depth + 1);
    }
  }
  visit(start, 0);
  return { stdout: found.length ? found.join("\n") + "\n" : "" };
}
