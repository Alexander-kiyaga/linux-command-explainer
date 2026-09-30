import { fail } from "./errors.js";
import { compareText, parentPath, resolvePath } from "./paths.js";

export const LIMITS = Object.freeze({
  inputLength: 2048,
  arguments: 64,
  nodes: 1000,
  fileBytes: 65536,
  totalBytes: 1048576,
  outputBytes: 65536,
  depth: 32,
});
export const SCHEMA_VERSION = 1;
const START_TIME = 1609459200; // Fixed virtual time: 2021-01-01 UTC.
const MAX_TIME = 4102444800; // Keep virtual dates renderable and bounded.

export function utf8Length(value) {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function file(content, owner = "learner", group = "learners", mode = 0o644) {
  return { type: "file", owner, group, mode, mtime: START_TIME, content };
}
function dir(owner = "learner", group = "learners", mode = 0o755) {
  return { type: "directory", owner, group, mode, mtime: START_TIME };
}

export function createStarterSession() {
  return {
    schemaVersion: SCHEMA_VERSION,
    cwd: "/home/learner",
    home: "/home/learner",
    user: "learner",
    group: "learners",
    clock: START_TIME,
    nodes: new Map([
      ["/", dir("root", "root")],
      ["/home", dir("root", "root")],
      ["/home/learner", dir()],
      ["/home/learner/README.txt", file("Welcome to LinuxLab AI.\nThis is a learning simulation.\nTry ls, cat, grep, or find.\n")],
      ["/home/learner/.profile", file("# Virtual profile for learner\n")],
      ["/home/learner/projects", dir()],
      ["/tmp", dir("root", "root", 0o777)],
      ["/etc", dir("root", "root")],
      ["/etc/motd", file("Welcome to the virtual LinuxLab terminal.\n", "root", "root")],
      ["/var", dir("root", "root")],
      ["/var/log", dir("root", "root")],
      ["/var/log/demo.log", file("INFO server started\nWARN disk nearing capacity\nERROR backup failed\nINFO retry scheduled\n", "root", "root")],
    ]),
  };
}

export function cloneSession(session) {
  return {
    schemaVersion: session.schemaVersion,
    cwd: session.cwd,
    home: session.home,
    user: session.user,
    group: session.group,
    clock: session.clock,
    nodes: new Map([...session.nodes].map(([path, node]) => [path, { ...node }])),
  };
}

export function snapshotSession(session) {
  return {
    schemaVersion: session.schemaVersion,
    cwd: session.cwd,
    home: session.home,
    user: session.user,
    group: session.group,
    clock: session.clock,
    nodes: [...session.nodes].sort(([a], [b]) => compareText(a, b)).map(([path, node]) => [path, { ...node }]),
  };
}

export function restoreSession(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== SCHEMA_VERSION ||
      snapshot.user !== "learner" || snapshot.group !== "learners" || snapshot.home !== "/home/learner" ||
      Object.keys(snapshot).some(key => !["schemaVersion", "cwd", "home", "user", "group", "clock", "nodes"].includes(key)) ||
      !Number.isSafeInteger(snapshot.clock) || snapshot.clock < START_TIME || snapshot.clock > MAX_TIME || !Array.isArray(snapshot.nodes) ||
      snapshot.nodes.length > LIMITS.nodes) fail("saved simulation is invalid or incompatible", 2);
  const nodes = new Map();
  let totalBytes = 0;
  for (const entry of snapshot.nodes) {
    if (!Array.isArray(entry) || entry.length !== 2) fail("invalid saved node", 2);
    const [path, node] = entry;
    if (typeof path !== "string" || !path.startsWith("/") || path.length > 512 ||
        resolvePath({ cwd: "/", home: snapshot.home }, path, false) !== path || nodes.has(path)) {
      fail("invalid saved path", 2);
    }
    if (!node || typeof node !== "object" || !["file", "directory"].includes(node.type) ||
        Object.keys(node).some(key => !["type", "owner", "group", "mode", "mtime", "content"].includes(key)) ||
        !["root", "learner"].includes(node.owner) || !["root", "learners"].includes(node.group) ||
        !Number.isInteger(node.mode) || node.mode < 0 || node.mode > 0o777 ||
        !Number.isSafeInteger(node.mtime) || node.mtime < START_TIME || node.mtime > snapshot.clock) {
      fail("invalid saved metadata", 2);
    }
    if (node.type === "file") {
      if (typeof node.content !== "string") fail("invalid saved file", 2);
      const size = utf8Length(node.content);
      if (size > LIMITS.fileBytes) fail("saved file exceeds simulation limit", 2);
      totalBytes += size;
    } else if (node.content !== undefined) fail("invalid saved directory", 2);
    nodes.set(path, { ...node });
  }
  if (totalBytes > LIMITS.totalBytes || nodes.get("/")?.type !== "directory") fail("invalid saved filesystem", 2);
  for (const path of nodes.keys()) {
    if (path !== "/" && nodes.get(parentPath(path))?.type !== "directory") fail("saved path has no directory parent", 2);
    if (path.split("/").length - 1 > LIMITS.depth) fail("saved path exceeds depth limit", 2);
  }
  if (typeof snapshot.cwd !== "string" || nodes.get(snapshot.cwd)?.type !== "directory" ||
      nodes.get(snapshot.home)?.type !== "directory") fail("invalid saved working directory", 2);
  return {
    schemaVersion: SCHEMA_VERSION, cwd: snapshot.cwd, home: snapshot.home,
    user: "learner", group: "learners", clock: snapshot.clock, nodes,
  };
}

export function assertLimits(session) {
  // Validation also prevents a command from committing a partial or oversized state.
  restoreSession(snapshotSession(session));
}

export function tick(session) {
  session.clock += 60;
  return session.clock;
}
