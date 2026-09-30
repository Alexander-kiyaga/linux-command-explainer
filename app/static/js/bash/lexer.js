import { bashError } from "./errors.js";
import { BASH_LIMITS } from "./limits.js";
import { utf8Length } from "../simulation/model.js";

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const UNSUPPORTED = new Set(["|", "&", "<", "(", ")", "`"]);

export function plainValue(token) {
  if (token?.kind !== "word" || token.parts.some(part => part.kind !== "text" || part.quote !== null)) return null;
  return token.parts.map(part => part.value).join("");
}

export function lexScript(source) {
  if (typeof source !== "string") bashError("syntax", "script must be text");
  if (source.includes("\0")) bashError("syntax", "NUL characters are unsupported");
  const normalized = source.replace(/\r\n/g, "\n");
  if (normalized.includes("\r")) bashError("syntax", "carriage returns are unsupported");
  if (utf8Length(normalized) > BASH_LIMITS.scriptBytes) bashError("budget", "script exceeds 8 KiB");
  const sourceLines = normalized.split("\n");
  if (sourceLines.length > BASH_LIMITS.lines) bashError("budget", "script exceeds 120 lines");
  const lines = [];
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = sourceLines[lineIndex];
    const lineNumber = lineIndex + 1;
    if (lineIndex === 0 && line.startsWith("#!")) {
      if (!["#!/bin/bash", "#!/usr/bin/env bash"].includes(line.trim())) {
        bashError("unsupported", "only Bash shebangs are supported", { line: 1, column: 1 });
      }
      lines.push({ line: lineNumber, tokens: [] });
      continue;
    }
    const tokens = [];
    let parts = [];
    let started = false;
    let startColumn = 1;
    let quote = null;
    const appendText = (value, positionQuote) => {
      const previous = parts[parts.length - 1];
      if (previous?.kind === "text" && previous.quote === positionQuote) previous.value += value;
      else parts.push({ kind: "text", value, quote: positionQuote });
    };
    const start = column => { if (!started) { started = true; startColumn = column; } };
    const flush = () => {
      if (started) tokens.push({ kind: "word", parts, line: lineNumber, column: startColumn });
      parts = [];
      started = false;
    };
    for (let index = 0; index < line.length; index += 1) {
      const ch = line[index];
      const position = { line: lineNumber, column: index + 1 };
      if (ch.charCodeAt(0) < 32 && ch !== "\t") bashError("syntax", "control characters are unsupported", position);
      if (quote === "single") {
        if (ch === "'") quote = null;
        else appendText(ch, "single");
        continue;
      }
      if (ch === "'" && quote === null) { start(index + 1); quote = "single"; continue; }
      if (ch === '"') {
        if (quote === "double") quote = null;
        else if (quote === null) { start(index + 1); quote = "double"; }
        continue;
      }
      if (ch === "\\") {
        if (index + 1 >= line.length) bashError("unsupported", "line continuation and trailing escapes are unsupported", position);
        start(index + 1);
        appendText(line[++index], quote === null ? "escaped" : quote);
        continue;
      }
      if (ch === "$" ) {
        start(index + 1);
        if (line[index + 1] === "?") {
          parts.push({ kind: "status", quote });
          index += 1;
        } else if (line[index + 1] === "{") {
          const end = line.indexOf("}", index + 2);
          if (end < 0) bashError("syntax", "unclosed ${variable}", position);
          const name = line.slice(index + 2, end);
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) bashError("unsupported", "only named variables are supported", position);
          parts.push({ kind: "variable", value: name, quote });
          index = end;
        } else if (IDENT_START.test(line[index + 1] || "")) {
          let end = index + 2;
          while (end < line.length && IDENT_PART.test(line[end])) end += 1;
          parts.push({ kind: "variable", value: line.slice(index + 1, end), quote });
          index = end - 1;
        } else bashError("unsupported", "only $NAME, ${NAME}, and $? are supported", position);
        continue;
      }
      if (ch === "`") bashError("unsupported", "command substitution is unsupported", position);
      if (quote === null) {
        if (/\s/.test(ch)) { flush(); continue; }
        if (ch === "#" && !started) break;
        if (UNSUPPORTED.has(ch)) bashError("unsupported", `syntax '${ch}' is unsupported`, position);
        if (ch === ">" || ch === ";") {
          flush();
          const value = ch === ">" && line[index + 1] === ">" ? ">>" : ch;
          if (value === ">>") index += 1;
          tokens.push({ kind: "operator", value, ...position });
          continue;
        }
      }
      start(index + 1);
      appendText(ch, quote);
    }
    if (quote) bashError("syntax", "unclosed quote", { line: lineNumber, column: startColumn });
    flush();
    if (tokens.length > 68) bashError("budget", "too many tokens on one line", { line: lineNumber, column: 1 });
    lines.push({ line: lineNumber, tokens });
  }
  return lines;
}
