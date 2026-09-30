import { COMMANDS, executeLine, executeParsedCommand } from "../../app/static/js/simulation/engine.js";
import { createStarterSession, restoreSession, snapshotSession } from "../../app/static/js/simulation/model.js";
import { parseLine } from "../../app/static/js/simulation/parser.js";
import { resolvePath } from "../../app/static/js/simulation/paths.js";

let checks = 0;
function equal(actual, expected, label) {
  checks += 1;
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function trueValue(value, label) { equal(Boolean(value), true, label); }
function contains(actual, expected, label) { trueValue(actual.includes(expected), label); }
function fails(session, command, fragment, code = null) {
  const before = JSON.stringify(snapshotSession(session));
  const result = executeLine(session, command);
  trueValue(result.exitCode !== 0, `${command} should fail`);
  contains(result.stderr, fragment, `${command} error`);
  if (code !== null) equal(result.exitCode, code, `${command} exit code`);
  equal(JSON.stringify(snapshotSession(session)), before, `${command} original state unchanged`);
  equal(JSON.stringify(snapshotSession(result.session)), before, `${command} failed state unchanged`);
  return result;
}
function run(session, command, output = null) {
  const before = JSON.stringify(snapshotSession(session));
  const result = executeLine(session, command);
  equal(result.exitCode, 0, `${command} exit code`);
  if (output !== null) equal(result.stdout, output, `${command} output`);
  equal(JSON.stringify(snapshotSession(session)), before, `${command} input state unchanged`);
  return result.session;
}

let session = createStarterSession();
equal(COMMANDS.length, 18, "registered V1 commands plus help");
equal(executeLine(session, "pwd").stdout, "/home/learner\n", "pwd");
equal(executeLine(session, "whoami").stdout, "learner\n", "whoami");
equal(executeParsedCommand(session, parseLine("pwd")).stdout, "/home/learner\n", "AST command dispatch for future Bash");
contains(executeLine(session, "help").stdout, "learning simulation", "help states simulation");
contains(executeLine(session, "ls -a").stdout, ".profile", "hidden file listed with -a");
trueValue(!executeLine(session, "ls").stdout.includes(".profile"), "hidden file omitted");
contains(executeLine(session, "ls -la").stdout, "-rw-r--r--", "long permissions");

equal(resolvePath(session, "../learner/./projects//"), "/home/learner/projects", "relative path normalization");
equal(resolvePath(session, "/../../tmp"), "/tmp", "root cannot escape");
equal(resolvePath(session, "~/README.txt"), "/home/learner/README.txt", "home path");
equal(parseLine("echo 'a|b' > 'a b.txt'").args[0].value, "a|b", "quoted operator is text");

session = run(session, "mkdir -p work/docs");
session = run(session, "cd work/docs");
equal(executeLine(session, "pwd").stdout, "/home/learner/work/docs\n", "cd relative");
session = run(session, "cd ~");
session = run(session, "touch work/docs/empty.txt");
session = run(session, "echo 'alpha beta' > work/docs/notes.txt");
session = run(session, "echo gamma >> work/docs/notes.txt");
equal(executeLine(session, "cat work/docs/notes.txt").stdout, "alpha beta\ngamma\n", "virtual write and append");
equal(executeLine(session, "head -n 1 work/docs/notes.txt").stdout, "alpha beta\n", "head");
equal(executeLine(session, "tail -n 1 work/docs/notes.txt").stdout, "gamma\n", "tail");
equal(executeLine(session, "grep -in ALPHA work/docs/notes.txt").stdout, "1:alpha beta\n", "literal grep options");
equal(executeLine(session, "grep missing work/docs/notes.txt").exitCode, 1, "grep no match");
contains(executeLine(session, "find work -name '*.txt' -type f").stdout, "work/docs/notes.txt", "find name glob");

session = run(session, "cp work/docs/notes.txt work/docs/copy.txt");
equal(executeLine(session, "cat work/docs/copy.txt").stdout, "alpha beta\ngamma\n", "copy content");
session = run(session, "mv work/docs/copy.txt work/moved.txt");
trueValue(!session.nodes.has("/home/learner/work/docs/copy.txt"), "source moved");
trueValue(session.nodes.has("/home/learner/work/moved.txt"), "destination moved");
session = run(session, "cp -r work/docs work/backup");
trueValue(session.nodes.has("/home/learner/work/backup/notes.txt"), "recursive copy");
session = run(session, "chmod 600 work/moved.txt");
equal(session.nodes.get("/home/learner/work/moved.txt").mode, 0o600, "chmod octal");
session = run(session, "chmod 000 work/moved.txt");
fails(session, "cat work/moved.txt", "permission denied");
session = run(session, "chmod 600 work/moved.txt");
session = run(session, "rm -rf work/backup");
trueValue(!session.nodes.has("/home/learner/work/backup"), "recursive virtual removal");
session = run(session, "rm -f missing.txt");

fails(session, "rm -rf /", "virtual root");
fails(session, "mkdir /etc/new", "permission denied");
fails(session, "chmod 777 /etc/motd", "not the virtual owner");
fails(session, "fake-command", "unsupported command", 127);
fails(session, "ls -z", "unsupported option", 2);
fails(session, "echo hi | cat", "not supported", 2);
fails(session, "echo hi && pwd", "not supported", 2);
fails(session, "echo hi; pwd", "not supported", 2);
fails(session, "echo $HOME", "not supported", 2);
fails(session, "echo `pwd`", "not supported", 2);
fails(session, "echo *.txt", "not supported", 2);
fails(session, "echo hi < file", "not supported", 2);
fails(session, "echo 'unfinished", "unclosed quote", 2);
fails(session, "grep 'a.*' work/docs/notes.txt", "regex is not supported", 2);
equal(executeLine(session, "grep -F 'a.*' work/docs/notes.txt").exitCode, 1, "fixed literal grep");
fails(session, "cp -r work work/sub", "inside itself");
fails(session, "mv work work/sub", "inside itself");
fails(session, "echo hi > /etc/nope", "permission denied");
fails(session, "echo hi > file > other", "single > or >>", 2);
fails(session, "clear > file", "cannot be redirected", 2);

const cleared = executeLine(session, "clear");
equal(cleared.effect, "clear", "clear effect");
equal(JSON.stringify(snapshotSession(cleared.session)), JSON.stringify(snapshotSession(session)), "clear leaves filesystem intact");
const restored = restoreSession(snapshotSession(session));
equal(JSON.stringify(snapshotSession(restored)), JSON.stringify(snapshotSession(session)), "snapshot roundtrip");
const invalid = snapshotSession(session);
invalid.nodes.push(["/../../outside", { type: "file", owner: "learner", group: "learners", mode: 0o644, mtime: invalid.clock, content: "x" }]);
let rejected = false;
try { restoreSession(invalid); } catch { rejected = true; }
trueValue(rejected, "invalid saved path rejected");

const sequence = ["mkdir demo", "echo hello > demo/message.txt", "cd demo", "cat message.txt"];
function replay() {
  let state = createStarterSession();
  const outputs = [];
  for (const command of sequence) {
    const result = executeLine(state, command);
    outputs.push([result.stdout, result.stderr, result.exitCode]);
    state = result.session;
  }
  return JSON.stringify({ state: snapshotSession(state), outputs });
}
equal(replay(), replay(), "deterministic replay");

// The engine is exercised with no browser network capability.
globalThis.fetch = () => { throw new Error("network call from engine"); };
run(createStarterSession(), "echo local > only-virtual.txt");
(globalThis.print || console.log)(`simulation engine: ${checks} assertions passed`);
