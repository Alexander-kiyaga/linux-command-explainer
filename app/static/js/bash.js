import { createStarterSession, restoreSession, snapshotSession, utf8Length } from "./simulation/model.js";
import { BASH_LIMITS } from "./bash/limits.js";
import { DEBUG_EXERCISES, DEBUG_BY_ID } from "./bash/debug-catalog.js";
import { checkDebugResult } from "./bash/debug-checker.js";
import { createBashStorage, createDebugStorage } from "./bash/storage.js";

const editor = document.getElementById("bash-editor");
const count = document.getElementById("bash-count");
const status = document.getElementById("bash-status");
const output = document.getElementById("bash-output");
const exitStatus = document.getElementById("bash-exit-status");
const runButton = document.getElementById("bash-run");
const explainButton = document.getElementById("bash-explain");
const debugSelect = document.getElementById("bash-debug-select");
const debugDescription = document.getElementById("bash-debug-description");
const debugObjectives = document.getElementById("bash-debug-objectives");
const debugStatus = document.getElementById("bash-debug-status");
const hintButton = document.getElementById("bash-hint");
const retryButton = document.getElementById("bash-retry");
const hints = document.getElementById("bash-hints");
const explanation = document.getElementById("bash-explanation");

const defaultScript = '# LinuxLab Bash V1 learning simulation\nname="LinuxLab"\necho "Hello, $name"';
let bashSession = createStarterSession();
let practiceDraft = defaultScript;
let bashStorage = null;
let debugStorage = null;
let debugState = { active: null, completed: {} };
let busy = false;
let requestId = 0;
let worker = null;

try {
  bashStorage = createBashStorage(window.localStorage);
  const saved = bashStorage.load();
  bashSession = saved.session;
  practiceDraft = saved.script || defaultScript;
} catch { status.textContent = "Saved Bash practice could not be restored. Work continues in memory."; bashStorage = null; }
try {
  debugStorage = createDebugStorage(window.localStorage);
  debugState = debugStorage.load();
} catch { debugStorage = null; debugStatus.textContent = "Saved debug progress could not be restored."; }

function savePractice() {
  try { bashStorage?.save(bashSession, practiceDraft); }
  catch { bashStorage = null; status.textContent = "Browser storage is unavailable or full; this Bash session is in memory."; }
}
function saveDebug() {
  try { debugStorage?.save(debugState.active, debugState.completed); }
  catch { debugStorage = null; debugStatus.textContent = "Debug progress could not be saved in this browser."; }
}
function currentExercise() { return DEBUG_BY_ID.get(debugSelect.value) || null; }
function refreshCount() {
  count.textContent = `${utf8Length(editor.value)} / ${BASH_LIMITS.scriptBytes} bytes`;
}
function refreshFiles() {
  document.getElementById("bash-cwd").textContent = `Working directory: ${bashSession.cwd}`;
  const list = document.getElementById("bash-files");
  list.replaceChildren();
  const paths = [...bashSession.nodes.keys()].sort().slice(0, 40);
  for (const path of paths) {
    const item = document.createElement("li");
    item.textContent = `${bashSession.nodes.get(path).type === "directory" ? "📁" : "📄"} ${path}`;
    list.appendChild(item);
  }
  if (bashSession.nodes.size > 40) {
    const item = document.createElement("li");
    item.textContent = `… ${bashSession.nodes.size - 40} more virtual paths`;
    list.appendChild(item);
  }
}
function refreshDebug() {
  const exercise = currentExercise();
  explainButton.disabled = busy || Boolean(exercise);
  hintButton.classList.toggle("hidden", !exercise);
  retryButton.classList.toggle("hidden", !exercise);
  debugDescription.textContent = exercise ? exercise.description : "Free practice uses a separate, persistent Bash virtual session.";
  debugObjectives.replaceChildren();
  hints.replaceChildren();
  if (!exercise) return;
  for (const objective of exercise.objectives) {
    const item = document.createElement("li");
    item.textContent = objective.label;
    debugObjectives.appendChild(item);
  }
  const shown = debugState.active?.id === exercise.id ? debugState.active.hintsShown : 0;
  for (const hint of exercise.hints.slice(0, shown)) {
    const item = document.createElement("li");
    item.textContent = hint;
    hints.appendChild(item);
  }
  hintButton.disabled = shown >= exercise.hints.length;
  const completed = debugState.completed[exercise.id] === exercise.version;
  debugStatus.textContent = completed ? "Completed in this browser. You can keep practicing or reset the draft." : "Edit the broken script and run it. Debug runs start from a fresh exercise snapshot.";
}
function setBusy(value) {
  busy = value;
  runButton.disabled = value;
  explainButton.disabled = value || Boolean(currentExercise());
  debugSelect.disabled = value;
  editor.disabled = value;
  document.getElementById("bash-clear-script").disabled = value;
  hintButton.disabled = value || (currentExercise() ? debugState.active?.hintsShown >= currentExercise().hints.length : true);
  retryButton.disabled = value;
  document.getElementById("bash-reset").disabled = value;
  runButton.textContent = value ? "Running…" : "Run in simulation";
}
function createWorker() {
  worker = new Worker(new URL("./bash/worker.js", import.meta.url), { type: "module" });
}
function runInWorker(snapshot, source) {
  return new Promise((resolve, reject) => {
    if (!worker) createWorker();
    const id = ++requestId;
    const timeout = setTimeout(() => {
      worker.terminate();
      worker = null;
      reject(new Error("The script exceeded the browser time limit; virtual changes were discarded."));
    }, 5000);
    worker.onmessage = event => {
      if (event.data?.id !== id) return;
      clearTimeout(timeout);
      resolve(event.data);
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      worker = null;
      reject(new Error("The simulation worker stopped; virtual changes were discarded."));
    };
    worker.postMessage({ id, snapshot, source });
  });
}
function showOutput(result) {
  output.replaceChildren();
  for (const event of result.events || []) {
    const item = document.createElement("div");
    item.className = event.kind === "stderr" ? "stderr" : "stdout";
    item.textContent = event.text;
    output.appendChild(item);
  }
  if (!result.committed) {
    const item = document.createElement("div");
    item.className = "diagnostic";
    item.textContent = result.stderr || "Run aborted; virtual changes were discarded.";
    output.appendChild(item);
  }
  exitStatus.textContent = `Exit status ${result.exitCode}`;
}

for (const exercise of DEBUG_EXERCISES) {
  const option = document.createElement("option");
  option.value = exercise.id;
  option.textContent = `${exercise.title} · ${exercise.difficulty}`;
  debugSelect.appendChild(option);
}
if (debugState.active && DEBUG_BY_ID.has(debugState.active.id)) {
  debugSelect.value = debugState.active.id;
  editor.value = debugState.active.draft;
} else editor.value = practiceDraft;
refreshCount();
refreshFiles();
refreshDebug();
try { createWorker(); } catch { status.textContent = "Simulation worker unavailable in this browser."; }

editor.addEventListener("input", () => {
  refreshCount();
  explanation.classList.add("hidden");
  const exercise = currentExercise();
  if (exercise) {
    debugState.active = { id: exercise.id, version: exercise.version, draft: editor.value,
      hintsShown: debugState.active?.id === exercise.id ? debugState.active.hintsShown : 0 };
    saveDebug();
  } else { practiceDraft = editor.value; savePractice(); }
});
runButton.addEventListener("click", async () => {
  if (busy) return;
  if (utf8Length(editor.value) > BASH_LIMITS.scriptBytes) { status.textContent = "Script exceeds the 8 KiB V1 limit."; return; }
  const exercise = currentExercise();
  const starting = exercise ? restoreSession(exercise.startingSnapshot) : bashSession;
  setBusy(true);
  status.textContent = "Running only in the virtual Bash simulation…";
  try {
    const result = await runInWorker(snapshotSession(starting), editor.value);
    showOutput(result);
    if (!result.committed) {
      status.textContent = "Run stopped; virtual changes were discarded.";
    } else {
      const checkedSession = restoreSession(result.session);
      if (exercise) {
        const checked = checkDebugResult(exercise, { ...result, session: checkedSession });
        if (checked.complete) {
          debugState.completed[exercise.id] = exercise.version;
          debugStatus.textContent = "Exercise complete. Completion was checked from virtual state.";
        } else debugStatus.textContent = `Not complete yet: ${checked.objectives.filter(item => !item.passed).map(item => item.label).join("; ") || "the script exited with a nonzero status"}.`;
        saveDebug();
        status.textContent = `Debug run finished with status ${result.exitCode}. Your free-practice files were unchanged.`;
      } else {
        bashSession = checkedSession;
        savePractice();
        refreshFiles();
        status.textContent = `Simulation finished with status ${result.exitCode}. Virtual changes saved.`;
      }
    }
  } catch (error) {
    output.textContent = error.message || "Simulation stopped; virtual changes were discarded.";
    exitStatus.textContent = "Run aborted";
    status.textContent = "Run aborted; virtual changes were discarded.";
  } finally { setBusy(false); }
});

document.getElementById("bash-clear-script").addEventListener("click", () => {
  if (busy) return;
  editor.value = "";
  editor.dispatchEvent(new Event("input"));
  status.textContent = "Script draft cleared. Virtual files were unchanged.";
});
document.getElementById("bash-reset").addEventListener("click", () => document.getElementById("bash-reset-confirm").classList.remove("hidden"));
document.getElementById("bash-cancel-reset").addEventListener("click", () => document.getElementById("bash-reset-confirm").classList.add("hidden"));
document.getElementById("bash-confirm-reset").addEventListener("click", () => {
  if (busy) return;
  bashSession = createStarterSession();
  savePractice();
  refreshFiles();
  output.replaceChildren();
  exitStatus.textContent = "No run yet";
  status.textContent = "Bash virtual files reset. Script draft retained.";
  document.getElementById("bash-reset-confirm").classList.add("hidden");
});
debugSelect.addEventListener("change", () => {
  if (busy) return;
  const exercise = currentExercise();
  if (exercise) {
    const active = debugState.active?.id === exercise.id ? debugState.active
      : { id: exercise.id, version: exercise.version, draft: exercise.brokenScript, hintsShown: 0 };
    debugState.active = active;
    editor.value = active.draft;
    saveDebug();
  } else { editor.value = practiceDraft; debugState.active = null; saveDebug(); }
  refreshCount();
  refreshDebug();
  output.replaceChildren();
  exitStatus.textContent = "No run yet";
  explanation.classList.add("hidden");
});
hintButton.addEventListener("click", () => {
  const exercise = currentExercise();
  if (!exercise || busy || !debugState.active) return;
  debugState.active.hintsShown = Math.min(exercise.hints.length, debugState.active.hintsShown + 1);
  saveDebug();
  refreshDebug();
});
retryButton.addEventListener("click", () => {
  const exercise = currentExercise();
  if (!exercise || busy) return;
  debugState.active = { id: exercise.id, version: exercise.version, draft: exercise.brokenScript, hintsShown: 0 };
  editor.value = exercise.brokenScript;
  saveDebug();
  refreshCount();
  refreshDebug();
  output.replaceChildren();
  exitStatus.textContent = "No run yet";
});

explainButton.addEventListener("click", async () => {
  if (busy || currentExercise()) return;
  const script = editor.value;
  if (!script.trim() || utf8Length(script) > 4096 || script.split("\n").length > 60) {
    status.textContent = "Explain Script needs 1–60 lines and at most 4 KiB of text.";
    return;
  }
  explainButton.disabled = true;
  status.textContent = "Asking Gemini to explain this text. The script is not running.";
  try {
    const response = await fetch("/api/bash/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script }) });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || "Script explanation is unavailable.");
    const data = payload.data;
    if (editor.value !== script) { status.textContent = "Script changed while the explanation was loading. Select Explain Script again."; return; }
    document.getElementById("bash-explanation-summary").textContent = data.summary;
    document.getElementById("bash-explanation-caution").textContent = data.caution || "Gemini explains text only; it does not run or grade scripts.";
    const lines = document.getElementById("bash-explanation-lines");
    lines.replaceChildren();
    for (const item of data.lines) {
      const row = document.createElement("li");
      row.append(document.createTextNode(`Line ${item.line}: ${item.explanation}`));
      const source = document.createElement("code");
      source.className = "bash-code-line";
      source.textContent = script.split("\n")[item.line - 1];
      row.append(source);
      if (item.concepts.length) {
        const concepts = document.createElement("span");
        concepts.textContent = `Concepts: ${item.concepts.join(", ")}`;
        row.append(concepts);
      }
      lines.appendChild(row);
    }
    const unsupported = document.getElementById("bash-explanation-unsupported");
    unsupported.replaceChildren();
    for (const item of data.unsupported_features) {
      const row = document.createElement("li");
      row.textContent = item;
      unsupported.appendChild(row);
    }
    document.getElementById("bash-explanation-unsupported-wrap").classList.toggle("hidden", !data.unsupported_features.length);
    explanation.classList.remove("hidden");
    status.textContent = "Explanation ready. Gemini did not execute or grade the script.";
  } catch (error) { status.textContent = error.message || "Script explanation is unavailable."; }
  finally { explainButton.disabled = busy || Boolean(currentExercise()); }
});
