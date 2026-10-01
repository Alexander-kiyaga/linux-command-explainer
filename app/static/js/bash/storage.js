import { createStarterSession, restoreSession, snapshotSession, utf8Length } from "../simulation/model.js";
import { BASH_LIMITS } from "./limits.js";
import { DEBUG_BY_ID } from "./debug-catalog.js";

export const BASH_KEY = "linuxlab.bash.practice.v1";
export const DEBUG_KEY = "linuxlab.bash.debug.v1";
const VERSION = 1;
const MAX_PRACTICE_CHARS = 1500000;
const MAX_DEBUG_CHARS = 30000;

function validScript(value) {
  return typeof value === "string" && utf8Length(value) <= BASH_LIMITS.scriptBytes;
}

export function createBashStorage(storage) {
  return {
    load() {
      const raw = storage.getItem(BASH_KEY);
      if (raw === null) return { session: createStarterSession(), script: "" };
      if (raw.length > MAX_PRACTICE_CHARS) throw new Error("saved Bash practice is too large");
      const data = JSON.parse(raw);
      if (data?.version !== VERSION || !validScript(data.script)) throw new Error("saved Bash practice is invalid");
      return { session: restoreSession(data.session), script: data.script };
    },
    save(session, script) {
      if (!validScript(script)) throw new Error("Bash script exceeds the draft limit");
      const raw = JSON.stringify({ version: VERSION, session: snapshotSession(session), script });
      if (raw.length > MAX_PRACTICE_CHARS) throw new Error("saved Bash practice is too large");
      storage.setItem(BASH_KEY, raw);
    },
    clear() { storage.removeItem(BASH_KEY); },
  };
}

export function createDebugStorage(storage) {
  return {
    load() {
      const raw = storage.getItem(DEBUG_KEY);
      if (raw === null) return { active: null, completed: {} };
      if (raw.length > MAX_DEBUG_CHARS) throw new Error("saved debug work is too large");
      const data = JSON.parse(raw);
      if (data?.version !== VERSION || !data.completed || Array.isArray(data.completed) || typeof data.completed !== "object") {
        throw new Error("saved debug work is invalid");
      }
      const completed = {};
      for (const [id, version] of Object.entries(data.completed)) {
        if (!DEBUG_BY_ID.has(id) || !Number.isInteger(version)) throw new Error("saved debug completion is invalid");
        if (DEBUG_BY_ID.get(id).version === version) completed[id] = version;
      }
      const active = data.active;
      if (active !== null) {
        const exercise = DEBUG_BY_ID.get(active?.id);
        if (!exercise || active.version !== exercise.version || !validScript(active.draft) ||
            !Number.isInteger(active.hintsShown) || active.hintsShown < 0 || active.hintsShown > exercise.hints.length) {
          throw new Error("saved debug draft is invalid");
        }
      }
      return { active, completed };
    },
    save(active, completed) {
      if (active !== null) {
        const exercise = DEBUG_BY_ID.get(active?.id);
        if (!exercise || active.version !== exercise.version || !validScript(active.draft) ||
            !Number.isInteger(active.hintsShown) || active.hintsShown < 0 || active.hintsShown > exercise.hints.length) {
          throw new Error("invalid debug draft");
        }
      }
      for (const [id, version] of Object.entries(completed)) {
        if (DEBUG_BY_ID.get(id)?.version !== version) throw new Error("invalid debug completion");
      }
      const raw = JSON.stringify({ version: VERSION, active, completed });
      if (raw.length > MAX_DEBUG_CHARS) throw new Error("saved debug work is too large");
      storage.setItem(DEBUG_KEY, raw);
    },
    clear() { storage.removeItem(DEBUG_KEY); },
  };
}
