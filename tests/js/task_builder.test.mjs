import { classifyCommand } from "../../app/static/js/simulation/compatibility.js";
import { COMMANDS, executeLine } from "../../app/static/js/simulation/engine.js";
import { createStarterSession, snapshotSession } from "../../app/static/js/simulation/model.js";
import { createTaskBuilderStorage, DRAFT_KEY, PLAN_KEY } from "../../app/static/js/task-builder-storage.js";
import { createPlaygroundStorage, STORAGE_KEY } from "../../app/static/js/playground-storage.js";
import { createMissionStorage, ACTIVE_KEY } from "../../app/static/js/missions/storage.js";
import { createAttempt } from "../../app/static/js/missions/session.js";
import { MISSIONS_BY_ID } from "../../app/static/js/missions/catalog.js";

let checks = 0;
function assert(value, label) { checks++; if (!value) throw new Error(label); }
function equal(actual, expected, label) { assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
function status(command, expected, session = null) {
  const before = session && JSON.stringify(snapshotSession(session));
  const result = classifyCommand(command, session);
  equal(result.status, expected, `${command} compatibility`);
  equal(result.canTry, expected === "supported", `${command} handoff eligibility`);
  if (session) equal(JSON.stringify(snapshotSession(session)), before, `${command} classification is read-only`);
  return result;
}

const session = createStarterSession();
equal(COMMANDS.length, 18, "registry remains unchanged");
for (const command of [
  "pwd", "ls -la", "cd projects", "mkdir -p website", "touch file.txt", "cat README.txt", "echo 'Hello World' > website/index.html",
  "cp -r projects backup", "mv file.txt other.txt", "rm -rf tmp", "head -n 2 README.txt", "tail -n 1 README.txt",
  "grep -in ERROR /var/log/demo.log", "find . -name '*.txt' -type f", "chmod 600 file.txt", "whoami", "clear", "help",
]) status(command, "supported", session);
for (const command of ["ls -lah", "cp -a a b", "head -n nope README.txt", "grep 'a.*' README.txt", "find . -size +1M", "chmod u+x file", "echo *.txt", "cat", "clear > out.txt"]) status(command, "partial", session);
for (const command of ["sudo mkdir website", "curl example.com", "echo hi | cat", "echo hi && pwd", "echo hi; pwd", "echo $HOME", "", "echo x\necho y"]) status(command, "unsupported", session);
for (const command of ["rm -rf /", "cp / backup", "mv / backup"]) status(command, "blocked", session);
assert(status("echo hi > file", "supported").warning.includes("overwrites"), "redirect caution supplied deterministically");
assert(status("rm -r tmp", "supported").warning.includes("data loss"), "delete caution supplied deterministically");
const source = JSON.stringify(snapshotSession(session));
status("mkdir website", "supported", session);
equal(JSON.stringify(snapshotSession(session)), source, "classification does not make a virtual directory");
const run = executeLine(session, "mkdir website");
assert(run.session.nodes.has("/home/learner/website"), "only explicit engine execution changes virtual state");
equal(JSON.stringify(snapshotSession(session)), source, "engine preserves input session");

const values = new Map();
const fakeStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, value); },
  removeItem(key) { values.delete(key); },
};
const taskStorage = createTaskBuilderStorage(fakeStorage);
const playgroundStorage = createPlaygroundStorage(fakeStorage);
const missionStorage = createMissionStorage(fakeStorage);
const mission = MISSIONS_BY_ID.get("find-workspace");
missionStorage.saveActive(createAttempt(mission));
playgroundStorage.save(run.session, ["mkdir website"]);
const plan = {
  status: "ready", summary: "Create a website file.", assumptions: [], clarifying_question: null, overall_warning: null,
  steps: [
    { command: "mkdir website", purpose: "Create directory", explanation: "Makes a directory.", expected_result: "Directory exists.", impact: "modify", warning: null },
    { command: "echo 'Hello World' > website/index.html", purpose: "Write file", explanation: "Writes text.", expected_result: "File exists.", impact: "modify", warning: null },
  ],
};
taskStorage.savePlan("Create a website file", plan);
equal(taskStorage.loadPlan().plan.steps.length, 2, "plan restores without network request");
let rejectedSavedPlan = false;
try { taskStorage.savePlan("Create a website file", { ...plan, steps: [{ ...plan.steps[0], playground_compatible: true }] }); }
catch { rejectedSavedPlan = true; }
assert(rejectedSavedPlan, "compatibility claims are not accepted in saved plans");
taskStorage.offerDraft("echo 'Hello World' > website/index.html");
assert(values.has(DRAFT_KEY) && values.has(PLAN_KEY) && values.has(STORAGE_KEY) && values.has(ACTIVE_KEY), "all modes have separate keys");
const beforeHandoff = JSON.stringify(snapshotSession(playgroundStorage.load().session));
const draft = taskStorage.consumeDraft(playgroundStorage.load().session);
assert(draft.command.includes("Hello World"), "one draft is consumed");
assert(!values.has(DRAFT_KEY), "draft is one-time");
assert(taskStorage.consumeDraft(playgroundStorage.load().session) === null, "second consume has no draft");
equal(JSON.stringify(snapshotSession(playgroundStorage.load().session)), beforeHandoff, "handoff never executes or mutates Playground");
let rejected = false;
try { taskStorage.offerDraft("sudo rm -rf /"); } catch { rejected = true; }
assert(rejected && !values.has(DRAFT_KEY), "unsupported command cannot be handed off");
try { taskStorage.offerDraft("ls -lah"); } catch { rejected = true; }
assert(!values.has(DRAFT_KEY), "partially supported command cannot be handed off");
values.set(DRAFT_KEY, JSON.stringify({ version: 1, command: "rm -rf /" }));
rejected = false;
try { taskStorage.consumeDraft(playgroundStorage.load().session); } catch { rejected = true; }
assert(rejected && !values.has(DRAFT_KEY), "tampered blocked draft rejected on consumption");
values.set(PLAN_KEY, "{broken");
rejected = false;
try { taskStorage.loadPlan(); } catch { rejected = true; }
assert(rejected, "corrupt plan rejected");
taskStorage.clearPlan();
assert(!values.has(PLAN_KEY), "plan cleared");
assert(values.has(STORAGE_KEY) && values.has(ACTIVE_KEY), "clearing plan preserves Playground and Missions");
assert(playgroundStorage.load().session.nodes.has("/home/learner/website"), "Playground virtual state preserved");
assert(missionStorage.loadActive().missionId === mission.id, "Mission state preserved");

// No network or host capability is needed for the pure compatibility and handoff modules.
globalThis.fetch = () => { throw new Error("network call during compatibility check"); };
status("mkdir website", "supported", session);
(globalThis.print || console.log)(`task builder and compatibility: ${checks} assertions passed`);
