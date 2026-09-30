import { directory, listChildren, longEntry, stat } from "../filesystem.js";
import { baseName, parentPath } from "../paths.js";
import { expectCount, parseFlags, pathArg } from "./options.js";

export function pwd(session, args) {
  expectCount("pwd", args, 0);
  return { stdout: session.cwd + "\n" };
}

export function whoami(session, args) {
  expectCount("whoami", args, 0);
  return { stdout: session.user + "\n" };
}

export function cd(session, args) {
  expectCount("cd", args, 0, 1);
  const target = args.length ? pathArg(session, args[0]) : session.home;
  directory(session, target);
  session.cwd = target;
  return { stdout: "" };
}

export function ls(session, args) {
  const { flags, operands } = parseFlags("ls", args, "al");
  expectCount("ls", operands, 0, 1);
  const path = operands.length ? pathArg(session, operands[0]) : session.cwd;
  const node = stat(session, path);
  let entries;
  if (node.type === "file") {
    entries = [{ path, name: baseName(path) }];
  } else {
    entries = [];
    if (flags.has("a")) {
      entries.push({ path, name: "." });
      entries.push({ path: parentPath(path) || "/", name: ".." });
    }
    for (const child of listChildren(session, path)) {
      const name = baseName(child);
      if (flags.has("a") || !name.startsWith(".")) entries.push({ path: child, name });
    }
  }
  const lines = entries.map(entry => flags.has("l")
    ? longEntry(entry.path, session.nodes.get(entry.path), entry.name) : entry.name);
  return { stdout: lines.length ? lines.join("\n") + "\n" : "" };
}

export function clear(session, args) {
  expectCount("clear", args, 0);
  return { stdout: "", effect: "clear" };
}

export function help(session, args) {
  expectCount("help", args, 0);
  return { stdout: [
    "LinuxLab Playground V1 — learning simulation, not a real Linux shell.",
    "Commands: pwd ls cd mkdir touch cat echo cp mv rm head tail grep find chmod whoami clear help",
    "Options: ls -a -l; mkdir -p; echo -n; cp -r; rm -r -f; head/tail -n N; grep -i -n -F; find -name PATTERN -type f|d; chmod 3-digit octal.",
    "Syntax: quotes, escaped characters, one command, and one virtual > or >> redirect.",
    "Unsupported: pipes, input redirects, multiple commands, shell globs, variables, command substitution, regex grep, networking, and real Bash.",
    "All paths and files are virtual. Use Reset to restore the starter filesystem.",
  ].join("\n") + "\n" };
}
