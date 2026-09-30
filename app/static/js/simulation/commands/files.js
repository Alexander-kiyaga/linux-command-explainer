import { fail } from "../errors.js";
import {
  allowed, createDirectory, listChildren, readFile, removeNode, stat, subtreePaths,
  touchFile, writableParent,
} from "../filesystem.js";
import { tick } from "../model.js";
import { baseName, isWithin, joinPath, parentPath } from "../paths.js";
import { expectCount, parseFlags, pathArg } from "./options.js";

export function mkdir(session, args) {
  const { flags, operands } = parseFlags("mkdir", args, "p");
  if (!operands.length) fail("mkdir: expected at least one path", 2);
  for (const operand of operands) {
    const target = pathArg(session, operand);
    if (target === "/") {
      if (!flags.has("p")) fail("mkdir: /: file exists");
      continue;
    }
    if (!flags.has("p")) { createDirectory(session, target); continue; }
    let current = "";
    for (const part of target.split("/").filter(Boolean)) {
      current = joinPath(current || "/", part);
      const existing = session.nodes.get(current);
      if (existing) {
        if (stat(session, current).type !== "directory") fail(`mkdir: ${current}: not a directory`);
      } else createDirectory(session, current);
    }
  }
  return { stdout: "" };
}

export function touch(session, args) {
  const { operands } = parseFlags("touch", args, "");
  if (!operands.length) fail("touch: expected at least one path", 2);
  for (const operand of operands) touchFile(session, pathArg(session, operand));
  return { stdout: "" };
}

export function cat(session, args) {
  const { operands } = parseFlags("cat", args, "");
  if (!operands.length) fail("cat: expected at least one virtual file", 2);
  return { stdout: operands.map(operand => readFile(session, pathArg(session, operand))).join("") };
}

export function echo(session, args) {
  const { flags, operands } = parseFlags("echo", args, "n");
  return { stdout: operands.map(item => item.value).join(" ") + (flags.has("n") ? "" : "\n") };
}

function targetFor(session, source, operand) {
  const requested = pathArg(session, operand);
  const existing = session.nodes.get(requested);
  return existing?.type === "directory" ? joinPath(requested, baseName(source)) : requested;
}

function checkReadableTree(session, source) {
  const node = stat(session, source);
  if (node.type === "file") { readFile(session, source); return; }
  for (const path of subtreePaths(session, source)) {
    const child = stat(session, path);
    if (child.type === "directory") listChildren(session, path);
    else readFile(session, path);
  }
}

export function cp(session, args) {
  const { flags, operands } = parseFlags("cp", args, "r");
  expectCount("cp", operands, 2);
  const source = pathArg(session, operands[0]);
  const sourceNode = stat(session, source);
  if (source === "/") fail("cp: cannot copy the virtual root");
  if (sourceNode.type === "directory" && !flags.has("r")) fail("cp: directory requires -r");
  const target = targetFor(session, source, operands[1]);
  if (source === target || (sourceNode.type === "directory" && isWithin(target, source))) {
    fail("cp: cannot copy a path onto or inside itself");
  }
  checkReadableTree(session, source);
  writableParent(session, target);
  const existing = session.nodes.get(target);
  if (sourceNode.type === "file") {
    if (existing) {
      const targetNode = stat(session, target);
      if (targetNode.type !== "file") fail(`cp: ${target}: is a directory`);
      if (!allowed(session, targetNode, "write")) fail(`cp: ${target}: permission denied`);
      targetNode.content = sourceNode.content;
      targetNode.mtime = tick(session);
    } else {
      const time = tick(session);
      session.nodes.set(target, { ...sourceNode, owner: session.user, group: session.group, mtime: time });
      session.nodes.get(parentPath(target)).mtime = time;
    }
    return { stdout: "" };
  }
  if (existing) fail(`cp: ${target}: destination already exists (directory merging is not supported)`);
  const sourcePaths = subtreePaths(session, source);
  for (const path of sourcePaths) {
    const newPath = target + path.slice(source.length);
    const original = session.nodes.get(path);
    session.nodes.set(newPath, { ...original, owner: session.user, group: session.group, mtime: tick(session) });
  }
  session.nodes.get(parentPath(target)).mtime = tick(session);
  return { stdout: "" };
}

export function mv(session, args) {
  const { operands } = parseFlags("mv", args, "");
  expectCount("mv", operands, 2);
  const source = pathArg(session, operands[0]);
  const sourceNode = stat(session, source);
  if (source === "/" || isWithin(session.cwd, source)) fail("mv: cannot move the virtual root or current working directory");
  const target = targetFor(session, source, operands[1]);
  if (source === target || isWithin(target, source)) fail("mv: cannot move a path onto or inside itself");
  writableParent(session, source);
  writableParent(session, target);
  const existing = session.nodes.get(target);
  if (existing) {
    stat(session, target);
    if (sourceNode.type !== "file" || existing.type !== "file") fail(`mv: ${target}: destination already exists`);
    session.nodes.delete(target);
  }
  const paths = subtreePaths(session, source);
  const moved = paths.map(path => [target + path.slice(source.length), { ...session.nodes.get(path) }]);
  for (const path of paths) session.nodes.delete(path);
  for (const [path, node] of moved) session.nodes.set(path, node);
  const time = tick(session);
  session.nodes.get(parentPath(source)).mtime = time;
  session.nodes.get(parentPath(target)).mtime = time;
  return { stdout: "" };
}

export function rm(session, args) {
  const { flags, operands } = parseFlags("rm", args, "rf");
  if (!operands.length) fail("rm: expected at least one path", 2);
  for (const operand of operands) {
    const target = pathArg(session, operand);
    if (!session.nodes.has(target) && flags.has("f")) continue;
    removeNode(session, target, flags.has("r"));
  }
  return { stdout: "" };
}

export function chmod(session, args) {
  const { operands } = parseFlags("chmod", args, "");
  if (operands.length < 2 || !/^[0-7]{3}$/.test(operands[0].value)) {
    fail("chmod: use a three-digit octal mode followed by one or more paths", 2);
  }
  const mode = Number.parseInt(operands[0].value, 8);
  for (const operand of operands.slice(1)) {
    const path = pathArg(session, operand);
    const node = stat(session, path);
    if (node.owner !== session.user) fail(`chmod: ${path}: not the virtual owner`);
    node.mode = mode;
    node.mtime = tick(session);
  }
  return { stdout: "" };
}
