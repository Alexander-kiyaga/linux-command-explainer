import { fail } from "../errors.js";
import { listChildren, readFile, stat } from "../filesystem.js";
import { baseName } from "../paths.js";
import { pathArg } from "./options.js";
import { parseCountAndFile, parseFind, parseGrep } from "../syntax.js";

function linesOf(content) {
  if (!content) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function lineChunks(content) {
  return content.match(/[^\n]*\n|[^\n]+$/g) || [];
}

export function head(session, args) {
  const { count, file } = parseCountAndFile("head", args);
  const chunks = lineChunks(readFile(session, pathArg(session, file))).slice(0, count);
  return { stdout: chunks.join("") };
}

export function tail(session, args) {
  const { count, file } = parseCountAndFile("tail", args);
  const chunks = count === 0 ? [] : lineChunks(readFile(session, pathArg(session, file))).slice(-count);
  return { stdout: chunks.join("") };
}

export function grep(session, args) {
  const { flags, operands, pattern } = parseGrep(args);
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
  const { startToken, namePattern, typeFilter } = parseFind(args);
  const start = startToken ? pathArg(session, startToken) : session.cwd;
  const displayStart = startToken ? (startToken.homeExpansion ? start : startToken.value.replace(/\/$/, "") || "/") : ".";
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
