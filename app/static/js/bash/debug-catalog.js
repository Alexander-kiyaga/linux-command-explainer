import { createStarterSession, restoreSession, snapshotSession } from "../simulation/model.js";
import { evaluateMission } from "../missions/checker.js";
import { validateMission } from "../missions/catalog.js";
import { DEBUG_DEFINITIONS } from "./debug-definitions.js";

function build(definition) {
  const session = createStarterSession();
  for (const item of definition.starting.nodes) {
    if (session.nodes.has(item.path)) throw new Error(`Duplicate debug fixture path: ${item.path}`);
    session.nodes.set(item.path, {
      type: item.type, owner: "learner", group: "learners", mode: item.mode ?? (item.type === "file" ? 0o644 : 0o755),
      mtime: session.clock, ...(item.type === "file" ? { content: item.content } : {}),
    });
  }
  const exercise = { ...definition, startingSnapshot: snapshotSession(restoreSession(snapshotSession(session))) };
  delete exercise.starting;
  validateMission(exercise);
  if (evaluateMission(exercise, session).complete) throw new Error(`Debug exercise starts complete: ${exercise.id}`);
  if (!exercise.brokenScript) throw new Error(`Missing debug script: ${exercise.id}`);
  return Object.freeze(exercise);
}

export const DEBUG_EXERCISES = Object.freeze(DEBUG_DEFINITIONS.map(build));
export const DEBUG_BY_ID = new Map(DEBUG_EXERCISES.map(exercise => [exercise.id, exercise]));
if (DEBUG_BY_ID.size !== DEBUG_EXERCISES.length) throw new Error("Duplicate debug exercise IDs");
