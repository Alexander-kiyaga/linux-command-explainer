import { createStarterSession, restoreSession, snapshotSession } from "./simulation/model.js";

export const STORAGE_KEY = "linuxlab.playground.v1";
const MAX_SAVED_CHARS = 1500000;
const MAX_HISTORY = 100;

export function createPlaygroundStorage(storage) {
  return {
    load() {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return { session: createStarterSession(), history: [] };
      if (raw.length > MAX_SAVED_CHARS) throw new Error("saved session exceeds the browser storage limit");
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.history) || data.history.length > MAX_HISTORY ||
          data.history.some(item => typeof item !== "string" || item.length > 2048)) {
        throw new Error("saved command history is invalid");
      }
      return { session: restoreSession(data.session), history: [...data.history] };
    },
    save(session, history) {
      const data = JSON.stringify({ session: snapshotSession(session), history: history.slice(-MAX_HISTORY) });
      if (data.length > MAX_SAVED_CHARS) throw new Error("session exceeds the browser storage limit");
      storage.setItem(STORAGE_KEY, data);
    },
    reset() { storage.removeItem(STORAGE_KEY); },
  };
}
