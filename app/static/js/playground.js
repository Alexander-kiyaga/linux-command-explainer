import { executeLine } from "./simulation/engine.js";
import { createStarterSession } from "./simulation/model.js";
import { displayPath } from "./simulation/paths.js";
import { createPlaygroundStorage } from "./playground-storage.js";

const form = document.getElementById("terminal-form");
const input = document.getElementById("terminal-input");
const output = document.getElementById("terminal-output");
const prompt = document.getElementById("terminal-prompt");
const status = document.getElementById("playground-status");
const resetButton = document.getElementById("reset-session");
const resetConfirm = document.getElementById("reset-confirm");
const confirmResetButton = document.getElementById("confirm-reset");
const cancelResetButton = document.getElementById("cancel-reset");

let session = createStarterSession();
let history = [];
let historyIndex = 0;
let draft = "";
let storage = null;
try {
  storage = createPlaygroundStorage(window.localStorage);
  const saved = storage.load();
  session = saved.session;
  history = saved.history;
  if (history.length) status.textContent = "Virtual session restored from this browser.";
} catch {
  storage = null;
  status.textContent = "Saved practice could not be restored. This session is in memory; use Reset to start a fresh saved session.";
}

function promptText() {
  return `learner@linuxlab:${displayPath(session)}$`;
}
function updatePrompt() {
  prompt.textContent = promptText();
}
function appendLine(text, className) {
  if (!text) return;
  const line = document.createElement("div");
  line.className = `terminal-line ${className}`;
  line.textContent = text;
  output.appendChild(line);
  while (output.children.length > 300) output.firstElementChild.remove();
  output.scrollTop = output.scrollHeight;
}
function save() {
  if (!storage) return;
  try {
    storage.save(session, history);
  } catch {
    storage = null;
    status.textContent = "Browser storage is unavailable or full. Practice continues in memory until this page closes.";
  }
}

appendLine("LinuxLab Playground V1 — learning simulation only. No commands run on your computer or server.\nType help for supported commands.", "terminal-welcome");
updatePrompt();

form.addEventListener("submit", event => {
  event.preventDefault();
  const command = input.value;
  if (!command.trim()) return;
  appendLine(`${promptText()} ${command}`, "terminal-command");
  history.push(command);
  if (history.length > 100) history.shift();
  historyIndex = history.length;
  draft = "";
  input.value = "";
  try {
    const result = executeLine(session, command);
    session = result.session;
    if (result.effect === "clear") output.replaceChildren();
    appendLine(result.stdout, "terminal-stdout");
    appendLine(result.stderr, "terminal-stderr");
    updatePrompt();
    save();
  } catch {
    appendLine("Simulation error. Your virtual session was not changed. Reset if the issue continues.\n", "terminal-stderr");
  }
  input.focus();
});

input.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    output.replaceChildren();
    return;
  }
  if (event.key === "ArrowUp" && history.length) {
    event.preventDefault();
    if (historyIndex === history.length) draft = input.value;
    historyIndex = Math.max(0, historyIndex - 1);
    input.value = history[historyIndex];
  } else if (event.key === "ArrowDown" && history.length) {
    event.preventDefault();
    historyIndex = Math.min(history.length, historyIndex + 1);
    input.value = historyIndex === history.length ? draft : history[historyIndex];
  }
});

resetButton.addEventListener("click", () => {
  resetConfirm.classList.remove("hidden");
  confirmResetButton.focus();
});
cancelResetButton.addEventListener("click", () => {
  resetConfirm.classList.add("hidden");
  input.focus();
});
confirmResetButton.addEventListener("click", () => {
  resetConfirm.classList.add("hidden");
  session = createStarterSession();
  history = [];
  historyIndex = 0;
  draft = "";
  output.replaceChildren();
  appendLine("Virtual filesystem reset to the starter snapshot. Type help to begin.\n", "terminal-welcome");
  updatePrompt();
  input.value = "";
  try {
    storage = createPlaygroundStorage(window.localStorage);
    storage.reset();
    storage.save(session, history);
    status.textContent = "Virtual filesystem and command history reset.";
  } catch {
    storage = null;
    status.textContent = "Virtual filesystem reset. Browser storage is unavailable; this session is in memory.";
  }
  input.focus();
});

document.querySelectorAll(".playground-examples [data-command]").forEach(button => {
  button.addEventListener("click", () => {
    input.value = button.dataset.command || "";
    input.focus();
  });
});
