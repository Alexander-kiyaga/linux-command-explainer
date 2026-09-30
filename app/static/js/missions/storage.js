import { restoreSession, snapshotSession } from "../simulation/model.js";
import { evaluateMission } from "./checker.js";
import { MISSIONS_BY_ID } from "./catalog.js";

export const ACTIVE_KEY = "linuxlab.missions.active.v1";
export const COMPLETIONS_KEY = "linuxlab.missions.completions.v1";
const STORAGE_VERSION = 1;
const MAX_ACTIVE_CHARS = 1500000;
const MAX_COMPLETIONS_CHARS = 20000;

export function createMissionStorage(storage, catalog = MISSIONS_BY_ID) {
  return {
    loadActive() {
      const raw = storage.getItem(ACTIVE_KEY);
      if (raw === null) return null;
      if (raw.length > MAX_ACTIVE_CHARS) throw new Error("saved mission is too large");
      const data = JSON.parse(raw);
      const mission = catalog.get(data?.missionId);
      if (data?.storageVersion !== STORAGE_VERSION || !mission || data.missionVersion !== mission.version ||
          !Array.isArray(data.history) || data.history.length > 100 ||
          data.history.some(item => typeof item !== "string" || item.length > 2048) ||
          !Number.isInteger(data.hintsShown) || data.hintsShown < 0 || data.hintsShown > mission.hints.length ||
          typeof data.completed !== "boolean") throw new Error("saved mission is invalid or outdated");
      const session = restoreSession(data.session);
      if (data.completed !== evaluateMission(mission, session).complete) throw new Error("saved mission completion is inconsistent");
      return {
        missionId: mission.id, missionVersion: mission.version, session,
        history: [...data.history], hintsShown: data.hintsShown, completed: data.completed,
      };
    },
    saveActive(attempt) {
      const mission = catalog.get(attempt.missionId);
      if (!mission || mission.version !== attempt.missionVersion ||
          attempt.completed !== evaluateMission(mission, attempt.session).complete) throw new Error("invalid mission attempt");
      const data = JSON.stringify({
        storageVersion: STORAGE_VERSION, missionId: attempt.missionId, missionVersion: attempt.missionVersion,
        session: snapshotSession(attempt.session), history: attempt.history.slice(-100),
        hintsShown: attempt.hintsShown, completed: attempt.completed,
      });
      if (data.length > MAX_ACTIVE_CHARS) throw new Error("saved mission is too large");
      storage.setItem(ACTIVE_KEY, data);
    },
    loadCompletions() {
      const raw = storage.getItem(COMPLETIONS_KEY);
      if (raw === null) return {};
      if (raw.length > MAX_COMPLETIONS_CHARS) throw new Error("saved completions are too large");
      const data = JSON.parse(raw);
      if (data?.storageVersion !== STORAGE_VERSION || !data.completed || Array.isArray(data.completed) ||
          typeof data.completed !== "object") throw new Error("saved completions are invalid");
      const completed = {};
      for (const [id, version] of Object.entries(data.completed)) {
        if (!catalog.has(id) || !Number.isInteger(version)) throw new Error("saved completion is invalid");
        if (catalog.get(id).version === version) completed[id] = version;
      }
      return completed;
    },
    saveCompletions(completed) {
      for (const [id, version] of Object.entries(completed)) {
        if (catalog.get(id)?.version !== version) throw new Error("invalid mission completion");
      }
      const data = JSON.stringify({ storageVersion: STORAGE_VERSION, completed });
      if (data.length > MAX_COMPLETIONS_CHARS) throw new Error("saved completions are too large");
      storage.setItem(COMPLETIONS_KEY, data);
    },
    clearActive() { storage.removeItem(ACTIVE_KEY); },
    clearAll() { storage.removeItem(ACTIVE_KEY); storage.removeItem(COMPLETIONS_KEY); },
  };
}
