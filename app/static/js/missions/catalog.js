import { MISSION_DEFINITIONS } from "./definitions.js";
import { OBJECTIVE_TYPES, evaluateMission } from "./checker.js";
import { createStarterSession, restoreSession, snapshotSession } from "../simulation/model.js";
import { resolvePath } from "../simulation/paths.js";

const VALID_DIFFICULTIES = new Set(["Beginner", "Intermediate", "Advanced"]);
const VALID_TYPES = new Set(OBJECTIVE_TYPES);

function isCanonicalPath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) return false;
  try { return resolvePath({ cwd: "/", home: "/home/learner" }, path, false) === path; }
  catch { return false; }
}

function validateCondition(condition) {
  if (!condition || !VALID_TYPES.has(condition.type) || !isCanonicalPath(condition.path)) throw new Error("Invalid mission objective");
  if (condition.type === "mode_equals" &&
      (!Number.isInteger(condition.mode) || condition.mode < 0 || condition.mode > 0o777 ||
       !["file", "directory"].includes(condition.nodeType))) throw new Error("Invalid mission mode objective");
  if (["file_content_equals", "file_content_includes"].includes(condition.type) &&
      (typeof condition.content !== "string" || condition.content.length > 65536)) throw new Error("Invalid mission content objective");
}

export function validateMission(mission) {
  if (!mission || !/^[a-z0-9-]+$/.test(mission.id) || !Number.isSafeInteger(mission.version) || mission.version < 1 ||
      !mission.title || !VALID_DIFFICULTIES.has(mission.difficulty) || !mission.description ||
      !Array.isArray(mission.learningObjectives) || !mission.learningObjectives.length ||
      mission.learningObjectives.some(item => typeof item !== "string" || !item) ||
      !Array.isArray(mission.objectives) || !mission.objectives.length ||
      !Array.isArray(mission.hints) || mission.hints.length > 3 ||
      mission.hints.some(item => typeof item !== "string" || !item)) throw new Error("Invalid mission definition");
  const ids = new Set();
  for (const objective of mission.objectives) {
    if (!objective.id || ids.has(objective.id) || typeof objective.label !== "string" || !objective.label) throw new Error("Invalid mission objective label");
    ids.add(objective.id);
    if (objective.anyOf) {
      if (!Array.isArray(objective.anyOf) || objective.anyOf.length < 2 || objective.anyOf.length > 4) throw new Error("Invalid alternatives");
      objective.anyOf.forEach(validateCondition);
    } else validateCondition(objective);
  }
  const initial = restoreSession(mission.startingSnapshot);
  if (evaluateMission(mission, initial).complete) throw new Error(`Mission ${mission.id} starts complete`);
  return true;
}

function buildMission(definition) {
  if (!definition.starting || !Array.isArray(definition.starting.nodes)) throw new Error("Invalid mission starting data");
  const session = createStarterSession();
  if (definition.starting.cwd !== undefined) session.cwd = definition.starting.cwd;
  for (const item of definition.starting.nodes) {
    if (!isCanonicalPath(item.path) || session.nodes.has(item.path) || !["file", "directory"].includes(item.type)) {
      throw new Error(`Invalid starting node in ${definition.id}`);
    }
    session.nodes.set(item.path, {
      type: item.type, owner: "learner", group: "learners", mode: item.mode ?? (item.type === "file" ? 0o644 : 0o755),
      mtime: session.clock, ...(item.type === "file" ? { content: item.content ?? "" } : {}),
    });
  }
  const mission = { ...definition, startingSnapshot: snapshotSession(restoreSession(snapshotSession(session))) };
  delete mission.starting;
  validateMission(mission);
  return mission;
}

export const MISSIONS = Object.freeze(MISSION_DEFINITIONS.map(buildMission));
export const MISSIONS_BY_ID = new Map(MISSIONS.map(mission => [mission.id, mission]));
if (MISSIONS_BY_ID.size !== MISSIONS.length) throw new Error("Duplicate mission IDs");
