import { restoreSession, snapshotSession } from "../simulation/model.js";
import { runScript } from "./interpreter.js";

self.onmessage = event => {
  const { id, source, snapshot } = event.data || {};
  try {
    const session = restoreSession(snapshot);
    const result = runScript(session, source);
    self.postMessage({ id, ...result, session: snapshotSession(result.session) });
  } catch {
    self.postMessage({ id, session: snapshot, committed: false, exitCode: 2, stdout: "",
      stderr: "Interpreter fault; virtual changes were discarded.\n", events: [],
      error: { kind: "fault", message: "interpreter fault", line: 1, column: 1 } });
  }
};
