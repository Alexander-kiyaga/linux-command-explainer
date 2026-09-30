import { executeLine } from "./simulation/engine.js";
import { displayPath } from "./simulation/paths.js";

// Browser presentation only. Both modes execute through the same pure simulation engine.
export function mountTerminal({ form, input, output, prompt, session: initialSession, history: initialHistory = [], welcome, onResult, onError }) {
  let session = initialSession;
  let history = [...initialHistory];
  let historyIndex = history.length;
  let draft = "";
  let locked = false;

  const promptText = () => `learner@linuxlab:${displayPath(session)}$`;
  const updatePrompt = () => { prompt.textContent = promptText(); };
  function appendLine(value, className) {
    if (!value) return;
    const line = document.createElement("div");
    line.className = `terminal-line ${className}`;
    line.textContent = value;
    output.appendChild(line);
    while (output.children.length > 300) output.firstElementChild.remove();
    output.scrollTop = output.scrollHeight;
  }
  function clearOutput() { output.replaceChildren(); }
  function reset(nextSession, nextHistory = [], message = welcome) {
    session = nextSession;
    history = [...nextHistory];
    historyIndex = history.length;
    draft = "";
    input.value = "";
    locked = false;
    input.disabled = false;
    form.querySelector('button[type="submit"]').disabled = false;
    clearOutput();
    appendLine(message, "terminal-welcome");
    updatePrompt();
  }
  function setLocked(value) {
    locked = value;
    input.disabled = value;
    form.querySelector('button[type="submit"]').disabled = value;
  }
  reset(session, history);

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (locked) return;
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
      if (result.effect === "clear") clearOutput();
      appendLine(result.stdout, "terminal-stdout");
      appendLine(result.stderr, "terminal-stderr");
      updatePrompt();
      onResult?.({ command, result, session, history: [...history] });
    } catch (error) {
      appendLine("Simulation error. Your virtual session was not changed. Reset if the issue continues.\n", "terminal-stderr");
      onError?.(error);
    }
    if (!locked) input.focus();
  });

  input.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
      event.preventDefault();
      clearOutput();
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

  return { reset, setLocked, clearOutput, focus: () => input.focus(), getState: () => ({ session, history: [...history] }), appendLine };
}
