import { MISSIONS, MISSIONS_BY_ID } from "./missions/catalog.js";
import { evaluateMission } from "./missions/checker.js";
import { createAttempt, recordCommand, revealHint, retryAttempt } from "./missions/session.js";
import { createMissionStorage } from "./missions/storage.js";
import { mountTerminal } from "./terminal-ui.js";

const catalogElement = document.getElementById("mission-catalog");
const panel = document.getElementById("mission-panel");
const empty = document.getElementById("mission-empty");
const title = document.getElementById("mission-title");
const difficulty = document.getElementById("mission-difficulty");
const description = document.getElementById("mission-description");
const learning = document.getElementById("mission-learning");
const objectives = document.getElementById("mission-objectives");
const hints = document.getElementById("mission-hints");
const hintButton = document.getElementById("mission-hint-button");
const result = document.getElementById("mission-result");
const status = document.getElementById("mission-status");
const retryButton = document.getElementById("mission-retry");
const input = document.getElementById("terminal-input");
let storage = null;
let attempt = null;
let completions = {};
try {
  storage = createMissionStorage(window.localStorage);
  try { completions = storage.loadCompletions(); }
  catch { status.textContent = "Saved completion records were invalid; starting with an empty mission record."; }
  try { attempt = storage.loadActive(); }
  catch {
    storage.clearActive();
    status.textContent = "Saved mission attempt was invalid or outdated. Choose a mission to start again.";
  }
} catch {
  status.textContent = "Browser storage is unavailable. Mission practice will last only until this page closes.";
}

const terminal = mountTerminal({
  form: document.getElementById("terminal-form"), input,
  output: document.getElementById("terminal-output"), prompt: document.getElementById("terminal-prompt"),
  session: attempt?.session || createAttempt(MISSIONS[0]).session,
  history: attempt?.history || [],
  welcome: "LinuxLab Missions V1 — browser-only learning simulation. No commands run on your computer or server.\nType help for supported commands.",
  onResult: ({ command, result: commandResult, history }) => {
    if (!attempt) return;
    const mission = MISSIONS_BY_ID.get(attempt.missionId);
    attempt = recordCommand(mission, attempt, commandResult, command, history);
    if (attempt.completed) {
      completions[mission.id] = mission.version;
      try { storage?.saveCompletions(completions); }
      catch { storage = null; status.textContent = "Browser storage is unavailable or full. This completion is in memory only."; }
    }
    saveActive();
    render();
  },
});

function saveActive() {
  if (!storage || !attempt) return;
  try { storage.saveActive(attempt); }
  catch { storage = null; status.textContent = "Browser storage is unavailable or full. This attempt continues in memory only."; }
}
function textItem(tag, text) {
  const item = document.createElement(tag);
  item.textContent = text;
  return item;
}
function renderCatalog() {
  catalogElement.replaceChildren();
  for (const mission of MISSIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mission-card";
    if (attempt?.missionId === mission.id) button.classList.add("mission-card-active");
    button.setAttribute("aria-label", `${mission.title}, ${mission.difficulty}${completions[mission.id] === mission.version ? ", completed" : ""}`);
    button.append(textItem("strong", mission.title), textItem("small", mission.difficulty));
    if (completions[mission.id] === mission.version) button.append(textItem("span", "✓ Completed"));
    button.addEventListener("click", () => activate(mission));
    catalogElement.appendChild(button);
  }
}
function render() {
  renderCatalog();
  panel.classList.toggle("hidden", !attempt);
  empty.classList.toggle("hidden", !!attempt);
  if (!attempt) return;
  const mission = MISSIONS_BY_ID.get(attempt.missionId);
  const grade = evaluateMission(mission, attempt.session);
  title.textContent = mission.title;
  difficulty.textContent = mission.difficulty;
  description.textContent = mission.description;
  learning.replaceChildren(...mission.learningObjectives.map(item => textItem("li", item)));
  objectives.replaceChildren(...grade.objectives.map(item => {
    const li = textItem("li", `${item.passed ? "✓" : "○"} ${item.label}`);
    li.className = item.passed ? "mission-objective-done" : "";
    return li;
  }));
  hints.replaceChildren(...mission.hints.slice(0, attempt.hintsShown).map((item, index) => textItem("li", `Hint ${index + 1}: ${item}`)));
  hintButton.disabled = attempt.completed || attempt.hintsShown >= mission.hints.length;
  hintButton.textContent = attempt.hintsShown >= mission.hints.length ? "All hints shown" : "Show next hint";
  result.textContent = attempt.completed ? "Mission complete. Your virtual state meets every objective." : `${grade.objectives.filter(item => item.passed).length} of ${grade.objectives.length} objectives complete`;
  result.classList.toggle("mission-success", attempt.completed);
  terminal.setLocked(attempt.completed);
}
function activate(mission) {
  if (attempt?.missionId === mission.id) { terminal.focus(); return; }
  if (attempt && !window.confirm("Start a different mission? The current attempt will be replaced. Completed missions remain saved.")) return;
  attempt = createAttempt(mission);
  terminal.reset(attempt.session, [], `Started ${mission.title}. This is a learning simulation. Type help for supported commands.\n`);
  saveActive();
  render();
  terminal.focus();
}

hintButton.addEventListener("click", () => {
  if (!attempt || attempt.completed) return;
  attempt = revealHint(MISSIONS_BY_ID.get(attempt.missionId), attempt);
  saveActive();
  render();
});
retryButton.addEventListener("click", () => {
  if (!attempt || !window.confirm("Retry this mission? Its virtual files, command history and revealed hints will reset.")) return;
  const mission = MISSIONS_BY_ID.get(attempt.missionId);
  attempt = retryAttempt(mission);
  terminal.reset(attempt.session, [], `Restarted ${mission.title}. Your completion badge remains saved.\n`);
  saveActive();
  render();
  terminal.focus();
});
document.getElementById("mission-clear-progress").addEventListener("click", () => {
  if (!window.confirm("Clear the active mission and all saved mission completions in this browser? Playground practice will not change.")) return;
  attempt = null;
  completions = {};
  try { storage?.clearAll(); }
  catch { storage = null; }
  terminal.setLocked(true);
  render();
  status.textContent = "Mission progress cleared. Playground practice is unchanged.";
});
render();
