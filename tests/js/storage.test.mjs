import { createPlaygroundStorage, STORAGE_KEY } from "../../app/static/js/playground-storage.js";
import { createStarterSession, snapshotSession } from "../../app/static/js/simulation/model.js";
import { executeLine } from "../../app/static/js/simulation/engine.js";

let checks = 0;
function assert(condition, label) { checks++; if (!condition) throw new Error(label); }
const values = new Map();
const fakeStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, value); },
  removeItem(key) { values.delete(key); },
};
const storage = createPlaygroundStorage(fakeStorage);
assert(storage.load().session.cwd === "/home/learner", "starter state loads");
let session = executeLine(createStarterSession(), "mkdir saved").session;
storage.save(session, ["mkdir saved"]);
let loaded = storage.load();
assert(loaded.session.nodes.has("/home/learner/saved"), "filesystem restored");
assert(loaded.history[0] === "mkdir saved", "history restored");
assert(JSON.stringify(snapshotSession(loaded.session)) === JSON.stringify(snapshotSession(session)), "roundtrip state");
values.set(STORAGE_KEY, "{broken");
let rejected = false;
try { storage.load(); } catch { rejected = true; }
assert(rejected, "corrupt JSON rejected");
values.set(STORAGE_KEY, JSON.stringify({ session: snapshotSession(session), history: [42] }));
rejected = false;
try { storage.load(); } catch { rejected = true; }
assert(rejected, "corrupt history rejected");
storage.reset();
assert(storage.load().session.nodes.has("/home/learner/saved") === false, "reset restores starter");
(globalThis.print || console.log)(`playground storage: ${checks} assertions passed`);
