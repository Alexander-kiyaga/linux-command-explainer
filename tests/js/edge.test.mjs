import { executeLine } from "../../app/static/js/simulation/engine.js";
import { createStarterSession, snapshotSession } from "../../app/static/js/simulation/model.js";

let checks = 0;
function assert(condition, label) { checks++; if (!condition) throw new Error(label); }
function expect(session, command, exitCode, stdoutPart = null, stderrPart = null) {
  const result = executeLine(session, command);
  assert(result.exitCode === exitCode, `${command}: expected exit ${exitCode}, got ${result.exitCode}: ${result.stderr}`);
  if (stdoutPart !== null) assert(result.stdout.includes(stdoutPart), `${command}: missing output ${stdoutPart}`);
  if (stderrPart !== null) assert(result.stderr.includes(stderrPart), `${command}: missing error ${stderrPart}`);
  return result.session;
}

let state = createStarterSession();
state = expect(state, "mkdir -p a/b/c", 0);
state = expect(state, "cd a/b/../b/c", 0);
assert(state.cwd === "/home/learner/a/b/c", "relative cwd");
state = expect(state, "cd /../../home/learner", 0);
assert(state.cwd === state.home, "root clamp");
state = expect(state, "mkdir '~'", 0);
assert(state.nodes.has("/home/learner/~"), "quoted tilde is literal");
state = expect(state, "touch -- -dash", 0);
assert(state.nodes.has("/home/learner/-dash"), "dash filename after --");
state = expect(state, "echo -x", 2, null, "unsupported option");
state = expect(state, "echo -n 'no newline' > -dash", 0);
assert(state.nodes.get("/home/learner/-dash").content === "no newline", "echo -n redirect");
assert(executeLine(state, "head -- -dash").stdout === "no newline", "head dash file");
state = expect(state, "echo 'one' > lines.txt", 0);
state = expect(state, "echo 'two' >> lines.txt", 0);
assert(executeLine(state, "tail -n 0 lines.txt").stdout === "", "tail zero lines");
assert(executeLine(state, "grep -F '.' lines.txt").exitCode === 1, "fixed literal grep");
assert(executeLine(state, "find . -name '*.txt'").stdout.includes("./lines.txt"), "relative find output");
assert(executeLine(state, "find / -name 'mot?.txt'").stdout === "", "bounded find glob");
state = expect(state, "chmod 000 lines.txt", 0);
state = expect(state, "cat lines.txt", 1, null, "permission denied");
state = expect(state, "echo fail > lines.txt", 1, null, "permission denied");
state = expect(state, "chmod 644 lines.txt", 0);
state = expect(state, "chmod 000 a", 0);
state = expect(state, "cd a", 1, null, "permission denied");
state = expect(state, "mkdir a/new", 1, null, "permission denied");
state = expect(state, "chmod 755 a", 0);
state = expect(state, "rm -r a", 0);
assert(!state.nodes.has("/home/learner/a"), "recursive rm removes descendants");
state = expect(state, "rm -rf /home/learner", 1, null, "current working directory");
state = expect(state, "cp -r / /tmp", 1, null, "virtual root");
state = expect(state, "sudo whoami", 127, null, "unsupported command");
state = expect(state, "bash script.sh", 127, null, "unsupported command");
state = expect(state, "curl example.com", 127, null, "unsupported command");
state = expect(state, "ssh host", 127, null, "unsupported command");
state = expect(state, "echo hi || pwd", 2, null, "not supported");
state = expect(state, "echo hi &", 2, null, "not supported");
state = expect(state, "echo $(pwd)", 2, null, "not supported");
state = expect(state, "echo hi > /tmp/a > /tmp/b", 2, null, "single > or >>");
state = expect(state, "head -n nope lines.txt", 2, null, "non-negative number");
state = expect(state, "chmod u+x lines.txt", 2, null, "three-digit octal");
state = expect(state, "echo x > /../../etc/blocked", 1, null, "permission denied");
state = expect(state, "echo x > /home/learner/'a b.txt'", 0);
assert(state.nodes.has("/home/learner/a b.txt"), "quoted filename");

const before = JSON.stringify(snapshotSession(state));
const oversized = "x".repeat(2049);
expect(state, oversized, 2, null, "exceeds simulation limit");
assert(JSON.stringify(snapshotSession(state)) === before, "oversized input leaves state unchanged");
let large = createStarterSession();
large.nodes.set("/home/learner/large.txt", {
  type: "file", owner: "learner", group: "learners", mode: 0o644,
  mtime: large.clock, content: "x".repeat(40000),
});
expect(large, "cat large.txt large.txt", 1, null, "output exceeds simulation limit");
assert(large.nodes.get("/home/learner/large.txt").content.length === 40000, "output cap leaves file intact");

(globalThis.print || console.log)(`simulation edge cases: ${checks} assertions passed`);
