import { createStarterSession } from "./simulation/model.js";
import { createPlaygroundStorage } from "./playground-storage.js";
import { mountTerminal } from "./terminal-ui.js";

const status = document.getElementById("playground-status");
const resetConfirm = document.getElementById("reset-confirm");
const confirmResetButton = document.getElementById("confirm-reset");
const input = document.getElementById("terminal-input");
let session = createStarterSession();
let history = [];
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

function save(nextSession, nextHistory) {
  if (!storage) return;
  try { storage.save(nextSession, nextHistory); }
  catch {
    storage = null;
    status.textContent = "Browser storage is unavailable or full. Practice continues in memory until this page closes.";
  }
}

const terminal = mountTerminal({
  form: document.getElementById("terminal-form"), input,
  output: document.getElementById("terminal-output"), prompt: document.getElementById("terminal-prompt"),
  session, history,
  welcome: "LinuxLab Playground V1 — learning simulation only. No commands run on your computer or server.\nType help for supported commands.",
  onResult: ({ session: nextSession, history: nextHistory }) => save(nextSession, nextHistory),
});

document.getElementById("reset-session").addEventListener("click", () => {
  resetConfirm.classList.remove("hidden");
  confirmResetButton.focus();
});
document.getElementById("cancel-reset").addEventListener("click", () => {
  resetConfirm.classList.add("hidden");
  terminal.focus();
});
confirmResetButton.addEventListener("click", () => {
  resetConfirm.classList.add("hidden");
  session = createStarterSession();
  history = [];
  terminal.reset(session, history, "Virtual filesystem reset to the starter snapshot. Type help to begin.\n");
  try {
    storage = createPlaygroundStorage(window.localStorage);
    storage.reset();
    storage.save(session, history);
    status.textContent = "Virtual filesystem and command history reset.";
  } catch {
    storage = null;
    status.textContent = "Virtual filesystem reset. Browser storage is unavailable; this session is in memory.";
  }
  terminal.focus();
});

document.querySelectorAll(".playground-examples [data-command]").forEach(button => {
  button.addEventListener("click", () => {
    input.value = button.dataset.command || "";
    terminal.focus();
  });
});
