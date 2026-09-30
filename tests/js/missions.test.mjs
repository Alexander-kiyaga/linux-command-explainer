import { MISSIONS, MISSIONS_BY_ID, validateMission } from "../../app/static/js/missions/catalog.js";
import { evaluateMission } from "../../app/static/js/missions/checker.js";
import { createAttempt, recordCommand, revealHint, retryAttempt } from "../../app/static/js/missions/session.js";
import { createMissionStorage, ACTIVE_KEY, COMPLETIONS_KEY } from "../../app/static/js/missions/storage.js";
import { createPlaygroundStorage, STORAGE_KEY } from "../../app/static/js/playground-storage.js";
import { createStarterSession, restoreSession, snapshotSession } from "../../app/static/js/simulation/model.js";
import { executeLine } from "../../app/static/js/simulation/engine.js";

let checks = 0;
function assert(value, label) { checks++; if (!value) throw new Error(label); }
function equal(actual, expected, label) { assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
function sequence(mission, commands) {
  let session = restoreSession(mission.startingSnapshot);
  for (const command of commands) {
    const result = executeLine(session, command);
    equal(result.exitCode, 0, `${mission.id}: ${command}`);
    session = result.session;
  }
  return session;
}
function complete(id, commands) {
  const mission = MISSIONS_BY_ID.get(id);
  assert(evaluateMission(mission, sequence(mission, commands)).complete, `${id} reference solution completes`);
}

// Authored catalog is valid, deterministic, and no mission is solved at start.
equal(MISSIONS.length, 9, "nine missions");
equal(MISSIONS_BY_ID.size, 9, "unique mission IDs");
for (const mission of MISSIONS) {
  assert(validateMission(mission), `${mission.id} validates`);
  assert(!evaluateMission(mission, restoreSession(mission.startingSnapshot)).complete, `${mission.id} starts incomplete`);
  assert(mission.hints.length > 0 && mission.hints.length <= 3, `${mission.id} hints bounded`);
  equal(JSON.stringify(snapshotSession(restoreSession(mission.startingSnapshot))), JSON.stringify(mission.startingSnapshot), `${mission.id} snapshot roundtrip`);
}

complete("find-workspace", ["cd projects"]);
complete("prepare-project", ["mkdir projects/notes", "touch projects/notes/todo.txt"]);
complete("handoff-note", ["echo 'Shift complete' > projects/handoff.txt"]);
complete("hidden-config", ["cp projects/site/.env.sample projects/site/.env"]);
complete("file-report", ["mkdir projects/reports", "mv inbox/report.txt projects/reports/"]);
complete("extract-error", ["grep ERROR /var/log/demo.log > projects/error-report.txt"]);
complete("backup-tree", ["cp -r projects/site projects/site-backup"]);
complete("protect-note", ["chmod 600 projects/private.txt"]);
complete("incident-tidy", ["mkdir projects/archive", "cp projects/incident.txt projects/archive/", "rm -r projects/scratch"]);

// Different supported command sequences can produce equally valid virtual outcomes.
complete("find-workspace", ["cd /home/learner/projects"]);
complete("handoff-note", ["touch projects/handoff.txt", "echo 'Shift complete' > projects/handoff.txt"]);
complete("file-report", ["mkdir -p projects/reports", "cp inbox/report.txt projects/reports/report.txt", "rm inbox/report.txt"]);
complete("backup-tree", ["mkdir projects/site-backup", "mkdir projects/site-backup/config", "cp projects/site/index.txt projects/site-backup/index.txt", "cp projects/site/config/app.txt projects/site-backup/config/app.txt"]);
complete("incident-tidy", ["mkdir projects/archive", "cp projects/incident.txt projects/archive/incident.txt", "rm projects/scratch/draft.txt", "rm -r projects/scratch"]);

const handoff = MISSIONS_BY_ID.get("handoff-note");
const initial = restoreSession(handoff.startingSnapshot);
const before = JSON.stringify(snapshotSession(initial));
const firstGrade = evaluateMission(handoff, initial);
assert(!firstGrade.complete && !firstGrade.objectives[0].passed, "missing content fails");
equal(JSON.stringify(snapshotSession(initial)), before, "checker does not mutate state");
const wrong = sequence(handoff, ["echo wrong > projects/handoff.txt"]);
assert(!evaluateMission(handoff, wrong).complete, "wrong content fails");
const correct = sequence(handoff, ["echo 'Shift complete' > projects/handoff.txt"]);
assert(evaluateMission(handoff, correct).complete, "exact content passes");
const synthetic = { objectives: [
  { id: "file", label: "file", type: "file_exists", path: "/home/learner/projects/handoff.txt" },
  { id: "includes", label: "contains", type: "file_content_includes", path: "/home/learner/projects/handoff.txt", content: "Shift" },
  { id: "either", label: "either", anyOf: [
    { type: "cwd_equals", path: "/home/learner/projects" },
    { type: "directory_exists", path: "/home/learner/projects" },
  ] },
  { id: "mode", label: "mode", type: "mode_equals", path: "/home/learner/projects/handoff.txt", nodeType: "file", mode: 0o644 },
] };
assert(evaluateMission(synthetic, correct).complete, "all objective types and alternatives pass");
assert(!evaluateMission({ objectives: [{ id: "absent", label: "absent", type: "path_absent", path: "/home/learner/projects/handoff.txt" }] }, correct).complete, "path absence fails when file exists");

// Attempts and hints remain independent from the authored snapshot.
let attempt = createAttempt(handoff);
let other = createAttempt(handoff);
let hinted = revealHint(handoff, attempt);
equal(hinted.hintsShown, 1, "first hint revealed");
equal(attempt.hintsShown, 0, "hint reveal is immutable");
for (let i = 0; i < 10; i++) hinted = revealHint(handoff, hinted);
equal(hinted.hintsShown, handoff.hints.length, "hint reveal bounded");
const failed = executeLine(attempt.session, "fake-command");
assert(failed.exitCode !== 0, "unsupported command rejected");
attempt = recordCommand(handoff, attempt, failed, "fake-command", ["fake-command"]);
assert(!attempt.completed, "invalid command does not complete mission");
equal(JSON.stringify(snapshotSession(attempt.session)), before, "invalid command leaves mission state unchanged");
const cleared = executeLine(attempt.session, "clear");
equal(cleared.effect, "clear", "mission clear returns terminal effect");
equal(JSON.stringify(snapshotSession(cleared.session)), JSON.stringify(snapshotSession(attempt.session)), "mission clear preserves virtual state");
assert(!evaluateMission(handoff, cleared.session).complete, "clear does not complete mission");
const success = executeLine(attempt.session, "echo 'Shift complete' > projects/handoff.txt");
attempt = recordCommand(handoff, attempt, success, "echo 'Shift complete' > projects/handoff.txt", ["fake-command", "echo 'Shift complete' > projects/handoff.txt"]);
assert(attempt.completed, "state completes attempt");
assert(!evaluateMission(handoff, other.session).complete, "other attempt stays isolated");
const retried = retryAttempt(handoff);
assert(!retried.completed && retried.history.length === 0 && retried.hintsShown === 0, "retry resets attempt and hints");
assert(!evaluateMission(handoff, retried.session).complete, "retry restores starting snapshot");

// Browser storage is versioned, bounded, and uses keys distinct from Playground.
const values = new Map();
const fakeStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, value); },
  removeItem(key) { values.delete(key); },
};
const missionsStorage = createMissionStorage(fakeStorage);
const playgroundStorage = createPlaygroundStorage(fakeStorage);
let playground = executeLine(createStarterSession(), "touch playground-only.txt").session;
playgroundStorage.save(playground, ["touch playground-only.txt"]);
missionsStorage.saveActive(attempt);
missionsStorage.saveCompletions({ [handoff.id]: handoff.version });
const restored = missionsStorage.loadActive();
assert(restored.completed && restored.history.length === 2, "active mission and history resume");
equal(JSON.stringify(snapshotSession(restored.session)), JSON.stringify(snapshotSession(attempt.session)), "mission snapshot restores");
equal(missionsStorage.loadCompletions()[handoff.id], handoff.version, "completion persists");
assert(values.has(STORAGE_KEY) && values.has(ACTIVE_KEY) && values.has(COMPLETIONS_KEY), "separate storage keys");
missionsStorage.clearAll();
assert(values.has(STORAGE_KEY), "clearing missions preserves Playground key");
assert(playgroundStorage.load().session.nodes.has("/home/learner/playground-only.txt"), "Playground state unchanged");
assert(missionsStorage.loadActive() === null, "clearing missions removes active attempt");
values.set(ACTIVE_KEY, "{broken");
let rejected = false;
try { missionsStorage.loadActive(); } catch { rejected = true; }
assert(rejected, "corrupt mission data rejected");
values.set(ACTIVE_KEY, JSON.stringify({ storageVersion: 999, missionId: handoff.id }));
rejected = false;
try { missionsStorage.loadActive(); } catch { rejected = true; }
assert(rejected, "outdated mission storage rejected");
const stale = { ...handoff, version: handoff.version + 1 };
const invalidCatalog = new Map([[handoff.id, stale]]);
const staleStorage = createMissionStorage(fakeStorage, invalidCatalog);
missionsStorage.saveActive(attempt);
rejected = false;
try { staleStorage.loadActive(); } catch { rejected = true; }
assert(rejected, "outdated mission definition rejects attempt");
assert(values.has(STORAGE_KEY), "mission corruption never alters Playground key");

// No mission execution or grading API is needed by the engine.
globalThis.fetch = () => { throw new Error("network access from mission engine"); };
assert(evaluateMission(handoff, sequence(handoff, ["echo 'Shift complete' > projects/handoff.txt"])).complete, "offline mission completion");
(globalThis.print || console.log)(`missions: ${checks} assertions passed`);
