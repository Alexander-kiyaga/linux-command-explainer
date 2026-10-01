import { fail } from "./errors.js";

export const MAX_PATH_LENGTH = 512;

export function resolvePath(session, input, expandHome = true) {
  if (typeof input !== "string" || !input || /[\x00-\x1f\x7f]/.test(input)) {
    fail("invalid virtual path", 2);
  }
  let path = input;
  if (expandHome && path.startsWith("~")) {
    if (path !== "~" && !path.startsWith("~/")) fail("only ~ and ~/ paths are supported", 2);
    path = session.home + path.slice(1);
  }
  const components = path.startsWith("/") ? [] : session.cwd.split("/").filter(Boolean);
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") components.pop();
    else components.push(part);
  }
  const result = "/" + components.join("/");
  if (result.length > MAX_PATH_LENGTH) fail("virtual path is too long", 2);
  return result;
}

export function parentPath(path) {
  if (path === "/") return null;
  const index = path.lastIndexOf("/");
  return index === 0 ? "/" : path.slice(0, index);
}

export function baseName(path) {
  return path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
}

export function joinPath(parent, name) {
  return parent === "/" ? "/" + name : parent + "/" + name;
}

export function isWithin(path, directory) {
  return path === directory || path.startsWith(directory === "/" ? "/" : directory + "/");
}

export function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function displayPath(session, path = session.cwd) {
  return path === session.home ? "~" : path.startsWith(session.home + "/") ? "~" + path.slice(session.home.length) : path;
}
