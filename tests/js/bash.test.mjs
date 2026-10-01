import { BASH_LIMITS } from "../../app/static/js/bash/limits.js";
import { lexScript, plainValue } from "../../app/static/js/bash/lexer.js";
import { parseScript } from "../../app/static/js/bash/parser.js";
import { runScript } from "../../app/static/js/bash/interpreter.js";
import { expandWord } from "../../app/static/js/bash/expand.js";
import { DEBUG_EXERCISES } from "../../app/static/js/bash/debug-catalog.js";
import { checkDebugResult } from "../../app/static/js/bash/debug-checker.js";
import { BASH_KEY, DEBUG_KEY, createBashStorage, createDebugStorage } from "../../app/static/js/bash/storage.js";
import { createStarterSession, restoreSession, snapshotSession } from "../../app/static/js/simulation/model.js";
import { executeLine } from "../../app/static/js/simulation/engine.js";
import { createPlaygroundStorage, STORAGE_KEY } from "../../app/static/js/playground-storage.js";
import { createMissionStorage, ACTIVE_KEY } from "../../app/static/js/missions/storage.js";
import { createAttempt } from "../../app/static/js/missions/session.js";
import { MISSIONS_BY_ID } from "../../app/static/js/missions/catalog.js";
import { createTaskBuilderStorage, PLAN_KEY } from "../../app/static/js/task-builder-storage.js";

let checks = 0;
function assert(value, message) { checks++; if (!value) throw new Error(message); }
function equal(actual, expected, message) { assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
function run(source, session = createStarterSession()) { return runScript(session, source); }
function withLogFiles(count) {
  const session = createStarterSession();
  for (let i = 0; i < count; i += 1) session.nodes.set(`/home/learner/item${String(i).padStart(3, "0")}.log`, {
    type: "file", content: "", mode: 0o644, owner: "learner", group: "learners", mtime: session.clock,
  });
  return session;
}
function fail(source, kind, message, session = createStarterSession()) {
  const before = JSON.stringify(snapshotSession(session));
  const result = run(source, session);
  assert(!result.committed, `${message}: run was committed`);
  equal(result.error?.kind, kind, `${message}: error kind`);
  equal(JSON.stringify(snapshotSession(result.session)), before, `${message}: rollback`);
  assert(result.error.line >= 1 && result.error.column >= 1, `${message}: line and column`);
  return result;
}

const words = lexScript("x='a $HOME'\necho \"$x\" # note")[1].tokens;
equal(plainValue(words[0]), "echo", "lexer identifies literal command");
equal(words[1].parts[0].kind, "variable", "double quoted variable lexed");
equal(words.length, 2, "trailing comment removed");
equal(parseScript("#!/bin/bash\n# comment\necho hi").body.length, 1, "shebang and comments ignored");
equal(parseScript("if [ -f x ]\nthen\necho yes\nfi").body[0].type, "if", "newline then supported");
equal(parseScript("for x in one two\ndo\necho $x\ndone").body[0].type, "for", "newline do supported");

const simple = run(`#!/usr/bin/env bash
name="Hello World"
mkdir website
echo "$name" > website/index.txt
echo more >> website/index.txt
cat website/index.txt`);
assert(simple.committed, "simple script committed");
equal(simple.stdout, "Hello World\nmore\n", "echo, redirects, cat use simulation handlers");
equal(simple.session.nodes.get("/home/learner/website/index.txt").content, "Hello World\nmore\n", "virtual file content");
equal(simple.exitCode, 0, "successful status");

let paritySession = createStarterSession();
for (const command of [
  "pwd", "whoami", "ls -a", "cat README.txt", "head -n 1 README.txt", "tail -n 1 README.txt",
  "grep -F LinuxLab README.txt", "find . -name '*.txt'", "mkdir lab", "touch lab/one.txt",
  "echo content > lab/one.txt", "cp lab/one.txt lab/two.txt", "mv lab/two.txt lab/three.txt",
  "chmod 600 lab/three.txt", "rm lab/one.txt", "ls -l lab",
]) {
  const bashResult = run(command, paritySession);
  const directResult = executeLine(paritySession, command);
  assert(bashResult.committed, `${command} Bash run completed`);
  equal(bashResult.stdout, directResult.stdout, `${command} stdout matches Playground engine`);
  equal(bashResult.stderr, directResult.stderr, `${command} stderr matches Playground engine`);
  equal(bashResult.exitCode, directResult.exitCode, `${command} exit code matches Playground engine`);
  equal(JSON.stringify(snapshotSession(bashResult.session)), JSON.stringify(snapshotSession(directResult.session)),
    `${command} virtual state matches Playground engine`);
  paritySession = bashResult.session;
}

const env = run(`echo "$HOME" > home.txt
cd projects
echo "${"$PWD"}" > path.txt
cat missing.txt
echo "$?" > status.txt`);
equal(env.session.nodes.get("/home/learner/home.txt").content, "/home/learner\n", "$HOME derived from virtual session");
equal(env.session.nodes.get("/home/learner/projects/path.txt").content, "/home/learner/projects\n", "$PWD tracks virtual cd");
equal(env.session.nodes.get("/home/learner/projects/status.txt").content, "1\n", "$? captures simulated command failure");
equal(env.exitCode, 0, "later successful command resets status");
assert(env.stderr.includes("no such file"), "command failure is reported and script continues");

const quotes = run(`value='; rm -rf / && $(curl example.org)'
echo "$value" > safe.txt
echo '$HOME' >> safe.txt
echo \\$HOME >> safe.txt`);
equal(quotes.session.nodes.get("/home/learner/safe.txt").content,
  "; rm -rf / && $(curl example.org)\n$HOME\n$HOME\n", "expanded shell-looking text stays data");
assert(quotes.session.nodes.has("/home/learner/README.txt"), "injected rm did not run");
assert(!quotes.session.nodes.has("/home/learner/example.org"), "injected network command did not run");

const conditions = run(`name="ready"
if [ "$name" = ready ]; then
 echo yes > result.txt
else
 echo no > result.txt
fi
if [ "$name" != wrong ]; then
 echo different >> result.txt
fi
if [ 3 -lt 4 ]; then
 echo lt >> result.txt
fi
if [ 3 -le 3 ]; then
 echo le >> result.txt
fi
if [ 4 -gt 3 ]; then
 echo gt >> result.txt
fi
if [ 4 -ge 4 ]; then
 echo ge >> result.txt
fi
if [ 4 -eq 4 ]; then
 echo eq >> result.txt
fi
if [ 4 -ne 3 ]; then
 echo ne >> result.txt
fi
if [ -e result.txt ]; then
 echo exists >> result.txt
fi
if [ -f result.txt ]; then
 echo file >> result.txt
fi
if [ -d projects ]; then
 echo directory >> result.txt
fi`);
equal(conditions.session.nodes.get("/home/learner/result.txt").content,
  "yes\ndifferent\nlt\nle\ngt\nge\neq\nne\nexists\nfile\ndirectory\n", "all documented test operators");

const nested = run(`for directory in alpha beta; do
 mkdir "$directory"
 for name in first second; do
  echo "$directory/$name" > "$directory/$name.txt"
 done
done
if [ -f alpha/first.txt ]; then
 echo done
fi`);
equal(nested.session.nodes.get("/home/learner/beta/second.txt").content, "beta/second\n", "nested for filesystem effects");
equal(nested.stdout, "done\n", "nested control flow output");
equal(nested.counts.iterations, 6, "nested iterations counted");

const globSession = createStarterSession();
for (const name of ["a.txt", "b.txt", ".hidden.txt", "c.log"]) {
  globSession.nodes.set(`/home/learner/${name}`, {
    type: "file", content: name, mode: 0o644, owner: "learner", group: "learners", mtime: globSession.clock,
  });
}
const glob = run(`for item in *.txt; do
 echo "$item"
done
for item in .*.txt; do
 echo "$item"
done
for item in missing*.txt; do
 echo never
done`, globSession);
equal(glob.stdout, "README.txt\na.txt\nb.txt\n.hidden.txt\n", "for globs sort names and follow dot rule");
equal(glob.counts.iterations, 4, "unmatched glob produces zero iterations");
const directoryGlob = run(`for item in projects/*.txt; do echo "$item"; done`, globSession);
assert(!directoryGlob.committed, "inline body after do rejected");
globSession.nodes.set("/home/learner/projects/nested.txt", {
  type: "file", content: "nested", mode: 0o644, owner: "learner", group: "learners", mtime: globSession.clock,
});
equal(run("for item in projects/*.txt; do\necho \"$item\"\ndone", globSession).stdout,
  "projects/nested.txt\n", "final-component glob in virtual subdirectory");
equal(run("for item in ~/*.txt; do\necho \"$item\"\ndone", globSession).stdout,
  "/home/learner/README.txt\n/home/learner/a.txt\n/home/learner/b.txt\n", "home-prefixed glob yields usable absolute paths");
equal(run("for item in ?.log; do\necho \"$item\"\ndone", globSession).stdout, "c.log\n", "question-mark glob matches one character");

const exit = run("touch before.txt\nexit 7\ntouch after.txt");
equal(exit.exitCode, 7, "explicit exit status");
assert(exit.session.nodes.has("/home/learner/before.txt"), "changes before exit committed");
assert(!exit.session.nodes.has("/home/learner/after.txt"), "exit stops execution");
equal(run("cat missing\nexit").exitCode, 1, "bare exit uses prior status");

for (const [source, kind, label] of [
  ["echo ok\nif [ -f x ]; then\necho x", "syntax", "missing fi"],
  ["for x in one; do\necho x", "syntax", "missing done"],
  ["if [ -f x; then\necho x\nfi", "syntax", "missing bracket"],
  ["echo \"unclosed", "syntax", "unclosed quote"],
  ["echo ok; rm file", "unsupported", "general semicolon"],
  ["echo ok && rm file", "unsupported", "and operator"],
  ["echo ok | cat", "unsupported", "pipe"],
  ["echo $(pwd)", "unsupported", "command substitution"],
  ["echo `pwd`", "unsupported", "backtick"],
  ["while [ -e file ]; do echo x; done", "unsupported", "while loop"],
  ["echo *.txt", "unsupported", "glob outside for"],
  ["for x in file[12].txt; do\necho x\ndone", "unsupported", "bracket glob"],
  ["for x in $pattern*.txt; do\necho x\ndone", "unsupported", "variable glob"],
  ["echo $1", "unsupported", "positional argument"],
  ["sudo touch file", "unsupported", "unknown command"],
  ["NAME=x echo hi", "syntax", "assignment with command"],
  ["HOME=/tmp", "unsupported", "readonly HOME"],
  ["clear", "unsupported", "terminal-only clear"],
]) fail(source, kind, label);

equal(fail("echo ok\necho $missing", "runtime", "undefined variable").error.line, 2, "runtime error identifies line");
fail("echo x\nif [ 1 -lt nope ]; then\necho yes\nfi", "runtime", "invalid numeric test");
fail("exit 126", "runtime", "invalid exit status");
fail("#!/bin/sh\necho x", "unsupported", "unsupported shebang");

fail("#" + "x".repeat(BASH_LIMITS.scriptBytes), "budget", "source bytes");
fail(Array.from({ length: BASH_LIMITS.lines + 1 }, () => "#x").join("\n"), "budget", "physical lines");
fail(Array.from({ length: BASH_LIMITS.astStatements + 1 }, () => "x=1").join("\n"), "budget", "AST statements");
fail("if [ 1 -eq 1 ]; then\n".repeat(BASH_LIMITS.nesting + 1) + "echo x\n" + "fi\n".repeat(BASH_LIMITS.nesting + 1), "budget", "nesting");
fail(Array.from({ length: BASH_LIMITS.variables + 1 }, (_, i) => `v${i}=x`).join("\n"), "budget", "variables");
fail(`big="${"x".repeat(BASH_LIMITS.variableBytes + 1)}"`, "budget", "variable bytes");
fail(`a="${"x".repeat(1024)}"\nb="${"y".repeat(1024)}"\necho "$a$b"`, "budget", "expanded command bytes");
fail("echo " + Array.from({ length: 65 }, () => "x").join(" "), "budget", "argument count");
const manyGlob = createStarterSession();
for (let i = 0; i < BASH_LIMITS.loopItems + 1; i += 1) {
  manyGlob.nodes.set(`/home/learner/item${String(i).padStart(3, "0")}.log`, {
    type: "file", content: "", mode: 0o644, owner: "learner", group: "learners", mtime: manyGlob.clock,
  });
}
fail("for item in *.log; do\necho $item\ndone", "budget", "for list", manyGlob);
const hundred = Array.from({ length: 100 }, (_, i) => String(i)).join(" ");
fail(`for x in one two; do\nfor y in ${hundred}; do\necho x\ndone\ndone`, "budget", "total loop iterations");
fail(`for x in ${hundred}; do\na=1\nb=2\nc=3\nd=4\ne=5\ndone`, "budget", "executed statements");
fail(`for x in ${hundred}; do\necho a\necho b\necho c\ndone`, "budget", "command executions");
const outputSession = createStarterSession();
for (let i = 0; i < 70; i += 1) {
  outputSession.nodes.set(`/home/learner/output${String(i).padStart(3, "0")}.log`, {
    type: "file", content: "", mode: 0o644, owner: "learner", group: "learners", mtime: outputSession.clock,
  });
}
fail(`big="${"x".repeat(1024)}"\nfor x in *.log; do\necho "$big"\ndone`, "budget", "combined output", outputSession);

equal(run("#" + "x".repeat(BASH_LIMITS.scriptBytes - 1)).exitCode, 0, "script byte limit accepts exact boundary");
equal(run(Array.from({ length: BASH_LIMITS.lines }, () => "#x").join("\n")).exitCode, 0, "line limit accepts exact boundary");
equal(run(Array.from({ length: BASH_LIMITS.astStatements }, () => "x=1").join("\n")).exitCode, 0, "AST statement limit accepts exact boundary");
equal(run(`value="${"x".repeat(BASH_LIMITS.variableBytes)}"`).exitCode, 0, "variable limit accepts exact boundary");
equal(run(Array.from({ length: BASH_LIMITS.variables }, (_, i) => `v${i}=x`).join("\n")).exitCode, 0, "variable count accepts exact boundary");
equal(run("for item in *.log; do\n# empty body\ndone", withLogFiles(BASH_LIMITS.loopItems)).counts.iterations,
  BASH_LIMITS.loopItems, "for list accepts 100 matching items");
equal(run("for x in one two; do\nfor y in *.log; do\n# empty body\ndone\ndone", withLogFiles(99)).counts.iterations,
  BASH_LIMITS.loopIterations, "global loop budget accepts exactly 200 iterations");
const exactStatements = run("a=1\nb=2\nc=3\nd=4\nfor x in *.log; do\na=1\nb=2\nc=3\nd=4\ne=5\ndone", withLogFiles(99));
equal(exactStatements.counts.statements, BASH_LIMITS.executedStatements, "statement budget accepts exactly 500 evaluations");
const exactCommands = run("echo start\nfor x in *.log; do\necho a\necho b\necho c\ndone", withLogFiles(83));
equal(exactCommands.counts.commands, BASH_LIMITS.commands, "command budget accepts exactly 250 dispatches");
const exactOutput = run(`big="${"x".repeat(1024)}"\nfor x in *.log; do\necho -n "$big"\ndone`, withLogFiles(64));
equal(exactOutput.stdout.length, BASH_LIMITS.outputBytes, "output budget accepts exactly 64 KiB");
equal(run("if [ 1 -eq 1 ]; then\n".repeat(BASH_LIMITS.nesting) + "echo nested\n" + "fi\n".repeat(BASH_LIMITS.nesting)).stdout,
  "nested\n", "nesting budget accepts six levels");
equal(run("echo " + Array.from({ length: 64 }, () => "x").join(" ")).exitCode, 0, "argument budget accepts 64 operands");
const expanded = { parts: [{ kind: "variable", value: "a", quote: "double" }, { kind: "variable", value: "b", quote: "double" }], line: 1, column: 1 };
equal(expandWord(expanded, new Map([["a", "x".repeat(1024)], ["b", "y".repeat(1024)]]), createStarterSession(), 0).value.length,
  BASH_LIMITS.expandedWordBytes, "expanded word accepts 2 KiB boundary");
let expandedRejected = false;
try { expandWord(expanded, new Map([["a", "x".repeat(1024)], ["b", "y".repeat(1025)]]), createStarterSession(), 0); }
catch { expandedRejected = true; }
assert(expandedRejected, "expanded word rejects 2 KiB plus one byte");
equal(fail("echo hi; pwd", "unsupported", "semicolon location").error.column, 8, "unsupported operator column is exact");

const debugSolutions = {
  "quote-assignment": [
    'message="Hello World"\necho "$message" > greeting.txt',
    "echo 'Hello World' > greeting.txt",
  ],
  "close-file-loop": [
    'mkdir backup\nfor file in *.txt; do\n cp "$file" "backup/$file"\ndone',
    "mkdir backup\ncp one.txt backup/one.txt\ncp two.txt backup/two.txt",
  ],
  "directory-test": [
    'if [ -d projects ]; then\n echo ready > check.txt\nelse\n echo missing > check.txt\nfi',
    "echo ready > check.txt",
  ],
};
equal(DEBUG_EXERCISES.length, 3, "three authored debug exercises");
for (const exercise of DEBUG_EXERCISES) {
  const initial = restoreSession(exercise.startingSnapshot);
  const session = runScript(initial, exercise.brokenScript);
  assert(!checkDebugResult(exercise, session).complete, `${exercise.id} broken script starts incomplete`);
  for (const solution of debugSolutions[exercise.id]) {
    const result = runScript(initial, solution);
    assert(checkDebugResult(exercise, result).complete, `${exercise.id} accepts a valid solution`);
  }
}

const values = new Map();
const fakeStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, value); },
  removeItem(key) { values.delete(key); },
};
const bashStorage = createBashStorage(fakeStorage);
const debugStorage = createDebugStorage(fakeStorage);
const playgroundStorage = createPlaygroundStorage(fakeStorage);
const missionStorage = createMissionStorage(fakeStorage);
const taskStorage = createTaskBuilderStorage(fakeStorage);
const savedBash = run("touch bash-only.txt");
bashStorage.save(savedBash.session, "touch bash-only.txt");
playgroundStorage.save(createStarterSession(), []);
missionStorage.saveActive(createAttempt(MISSIONS_BY_ID.get("find-workspace")));
const taskPlan = { status: "ready", summary: "Create a file.", assumptions: [], clarifying_question: null, overall_warning: null,
  steps: [{ command: "touch file.txt", purpose: "Create file", explanation: "Creates a file.", expected_result: "File exists.", impact: "modify", warning: null }] };
taskStorage.savePlan("Create a file", taskPlan);
debugStorage.save({ id: "quote-assignment", version: 1, draft: "echo test", hintsShown: 2 }, { "quote-assignment": 1 });
assert([BASH_KEY, DEBUG_KEY, STORAGE_KEY, ACTIVE_KEY, PLAN_KEY].every(key => values.has(key)), "all tools use distinct keys");
equal(bashStorage.load().script, "touch bash-only.txt", "Bash draft restored");
assert(bashStorage.load().session.nodes.has("/home/learner/bash-only.txt"), "Bash virtual state restored");
assert(!playgroundStorage.load().session.nodes.has("/home/learner/bash-only.txt"), "Playground session isolated");
equal(missionStorage.loadActive().missionId, "find-workspace", "Mission attempt isolated");
equal(taskStorage.loadPlan().plan.steps.length, 1, "Task Builder plan isolated");
equal(debugStorage.load().active.hintsShown, 2, "debug hint progress restored");
debugStorage.clear();
assert(!values.has(DEBUG_KEY) && values.has(BASH_KEY) && values.has(STORAGE_KEY) && values.has(ACTIVE_KEY) && values.has(PLAN_KEY),
  "clearing debug progress leaves all other modes unchanged");
bashStorage.clear();
assert(!values.has(BASH_KEY) && values.has(STORAGE_KEY) && values.has(ACTIVE_KEY) && values.has(PLAN_KEY),
  "clearing Bash practice leaves other modes unchanged");
values.set(BASH_KEY, "{broken");
let rejectedStorage = false;
try { bashStorage.load(); } catch { rejectedStorage = true; }
assert(rejectedStorage, "corrupt Bash storage rejected");

// No browser network or dynamic execution is needed by the pure interpreter.
globalThis.fetch = () => { throw new Error("unexpected network access"); };
globalThis.eval = () => { throw new Error("unexpected dynamic execution"); };
equal(run("echo safe").stdout, "safe\n", "core uses no network or dynamic execution");
(globalThis.print || console.log)(`bash lexer/parser/interpreter: ${checks} assertions passed`);
