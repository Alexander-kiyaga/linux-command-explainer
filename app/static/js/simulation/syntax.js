import { fail } from "./errors.js";
import { expectCount, parseFlags } from "./commands/options.js";

export function parseCountAndFile(command, args) {
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

export function parseGrep(args) {
  const { flags, operands } = parseFlags("grep", args, "inF");
  if (operands.length < 2) fail("grep: expected a pattern and at least one virtual file", 2);
  const pattern = operands[0].value;
  if (!flags.has("F") && /[.*+?^${}()|[\]\\]/.test(pattern)) {
    fail("grep: regex is not supported; use -F to search for those characters literally", 2);
  }
  return { flags, operands, pattern };
}

export function parseFind(args) {
  let index = 0;
  let startToken = null;
  if (args[0] && !args[0].value.startsWith("-")) {
    startToken = args[0];
    index = 1;
  }
  let namePattern = null;
  let typeFilter = null;
  while (index < args.length) {
    const option = args[index++].value;
    const value = args[index++]?.value;
    if (value === undefined) fail(`find: ${option} requires a value`, 2);
    if (option === "-name" && namePattern === null) {
      if (value.length > 256) fail("find: name pattern is too long", 2);
      namePattern = value;
    } else if (option === "-type" && typeFilter === null && ["f", "d"].includes(value)) typeFilter = value;
    else fail(`find: unsupported or repeated option ${option}`, 2);
  }
  return { startToken, namePattern, typeFilter };
}

export function validateCommandSyntax(parsed) {
  const { command, args, redirect } = parsed;
  switch (command) {
    case "pwd": case "whoami": case "help": case "clear": expectCount(command, args, 0); break;
    case "cd": expectCount(command, args, 0, 1); break;
    case "ls": {
      const { operands } = parseFlags(command, args, "al");
      expectCount(command, operands, 0, 1);
      break;
    }
    case "mkdir": case "touch": case "cat": case "rm": {
      const flags = { mkdir: "p", touch: "", cat: "", rm: "rf" }[command];
      const { operands } = parseFlags(command, args, flags);
      if (!operands.length) fail(command === "cat" ? "cat: expected at least one virtual file" : `${command}: expected at least one path`, 2);
      break;
    }
    case "echo": parseFlags(command, args, "n"); break;
    case "cp": case "mv": {
      const { operands } = parseFlags(command, args, command === "cp" ? "r" : "");
      expectCount(command, operands, 2);
      break;
    }
    case "chmod": {
      const { operands } = parseFlags(command, args, "");
      if (operands.length < 2 || !/^[0-7]{3}$/.test(operands[0].value)) {
        fail("chmod: use a three-digit octal mode followed by one or more paths", 2);
      }
      break;
    }
    case "head": case "tail": parseCountAndFile(command, args); break;
    case "grep": parseGrep(args); break;
    case "find": parseFind(args); break;
    default: fail(`${command}: unsupported command`, 127);
  }
  if (redirect && command === "clear") fail("clear cannot be redirected", 2);
  return true;
}
