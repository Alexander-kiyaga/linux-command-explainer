import { fail } from "./errors.js";
import { LIMITS, tick, utf8Length } from "./model.js";
import { baseName, compareText, isWithin, parentPath } from "./paths.js";

const PERMISSION = { read: 4, write: 2, execute: 1 };

export function allowed(session, node, permission) {
  const bits = node.owner === session.user ? (node.mode >> 6) & 7
    : node.group === session.group ? (node.mode >> 3) & 7 : node.mode & 7;
  return (bits & PERMISSION[permission]) !== 0;
}

export function traverseParents(session, path) {
  const parents = [];
  for (let parent = parentPath(path); parent !== null; parent = parentPath(parent)) parents.push(parent);
  for (const parent of parents.reverse()) {
    const node = session.nodes.get(parent);
    if (!node || node.type !== "directory") fail(`${parent}: not a directory`);
    if (!allowed(session, node, "execute")) fail(`${parent}: permission denied`);
  }
}

export function stat(session, path) {
  traverseParents(session, path);
  const node = session.nodes.get(path);
  if (!node) fail(`${path}: no such file or directory`);
  return node;
}

export function directory(session, path, permission = "execute") {
  const node = stat(session, path);
  if (node.type !== "directory") fail(`${path}: not a directory`);
  if (!allowed(session, node, permission)) fail(`${path}: permission denied`);
  return node;
}

export function writableParent(session, path) {
  if (path === "/") fail("cannot modify the virtual root");
  const parent = parentPath(path);
  const node = directory(session, parent, "write");
  if (!allowed(session, node, "execute")) fail(`${parent}: permission denied`);
  return node;
}

export function readFile(session, path) {
  const node = stat(session, path);
  if (node.type !== "file") fail(`${path}: is a directory`);
  if (!allowed(session, node, "read")) fail(`${path}: permission denied`);
  return node.content;
}

export function listChildren(session, path) {
  const node = directory(session, path, "read");
  if (!allowed(session, node, "execute")) fail(`${path}: permission denied`);
  return [...session.nodes.keys()]
    .filter(candidate => candidate !== path && parentPath(candidate) === path)
    .sort(compareText);
}

export function subtreePaths(session, path) {
  return [...session.nodes.keys()].filter(candidate => isWithin(candidate, path)).sort(compareText);
}

export function createDirectory(session, path) {
  if (session.nodes.has(path)) fail(`${path}: file exists`);
  writableParent(session, path);
  const time = tick(session);
  session.nodes.set(path, {
    type: "directory", owner: session.user, group: session.group, mode: 0o755, mtime: time,
  });
  session.nodes.get(parentPath(path)).mtime = time;
}

export function touchFile(session, path) {
  const existing = session.nodes.get(path);
  if (existing) {
    stat(session, path);
    if (existing.type !== "file") fail(`${path}: is a directory`);
    if (!allowed(session, existing, "write")) fail(`${path}: permission denied`);
    existing.mtime = tick(session);
    return;
  }
  writableParent(session, path);
  const time = tick(session);
  session.nodes.set(path, {
    type: "file", owner: session.user, group: session.group, mode: 0o644, mtime: time, content: "",
  });
  session.nodes.get(parentPath(path)).mtime = time;
}

export function writeFile(session, path, content, append = false) {
  const existing = session.nodes.get(path);
  if (existing) {
    stat(session, path);
    if (existing.type !== "file") fail(`${path}: is a directory`);
    if (!allowed(session, existing, "write")) fail(`${path}: permission denied`);
    const next = append ? existing.content + content : content;
    if (utf8Length(next) > LIMITS.fileBytes) fail(`${path}: virtual file size limit exceeded`);
    existing.content = next;
    existing.mtime = tick(session);
    return;
  }
  if (utf8Length(content) > LIMITS.fileBytes) fail(`${path}: virtual file size limit exceeded`);
  writableParent(session, path);
  const time = tick(session);
  session.nodes.set(path, {
    type: "file", owner: session.user, group: session.group, mode: 0o644, mtime: time, content,
  });
  session.nodes.get(parentPath(path)).mtime = time;
}

export function removeNode(session, path, recursive = false) {
  const node = stat(session, path);
  if (path === "/") fail("cannot remove the virtual root");
  if (node.type === "directory" && !recursive) fail(`${path}: is a directory (use -r)`);
  if (isWithin(session.cwd, path)) fail(`${path}: cannot remove the current working directory or its parent`);
  writableParent(session, path);
  const paths = subtreePaths(session, path);
  if (node.type === "directory" && paths.length > 1) {
    for (const candidate of paths) {
      const child = stat(session, candidate);
      if (child.type === "directory" && (!allowed(session, child, "read") ||
          !allowed(session, child, "write") || !allowed(session, child, "execute"))) {
        fail(`${candidate}: permission denied`);
      }
    }
  }
  for (const candidate of paths) session.nodes.delete(candidate);
  session.nodes.get(parentPath(path)).mtime = tick(session);
}

export function formatMode(node) {
  const type = node.type === "directory" ? "d" : "-";
  let value = type;
  for (const shift of [6, 3, 0]) {
    const bits = (node.mode >> shift) & 7;
    value += (bits & 4 ? "r" : "-") + (bits & 2 ? "w" : "-") + (bits & 1 ? "x" : "-");
  }
  return value;
}

export function longEntry(path, node, displayName = baseName(path)) {
  const size = node.type === "file" ? utf8Length(node.content) : 0;
  const stamp = new Date(node.mtime * 1000).toISOString().slice(0, 16).replace("T", " ");
  return `${formatMode(node)} ${node.owner} ${node.group} ${size} ${stamp} ${displayName}`;
}
