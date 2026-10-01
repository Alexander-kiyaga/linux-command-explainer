import { classifyCommand } from "./simulation/compatibility.js";
import { createTaskBuilderStorage, validateSavedPlan } from "./task-builder-storage.js";

const form = document.getElementById("task-builder-form");
const input = document.getElementById("task-input");
const button = document.getElementById("task-submit");
const count = document.getElementById("task-count");
const status = document.getElementById("task-status");
const result = document.getElementById("task-result");
const original = document.getElementById("task-original");
const summary = document.getElementById("task-summary");
const assumptions = document.getElementById("task-assumptions");
const overallWarning = document.getElementById("task-overall-warning");
const question = document.getElementById("task-question");
const steps = document.getElementById("task-steps");
let storage = null;
let busy = false;
try { storage = createTaskBuilderStorage(window.sessionStorage); }
catch { status.textContent = "Session storage is unavailable; plans will not be restored after leaving this page."; }

function textElement(tag, value, className = "") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}
function updateCount() { count.textContent = `${input.value.length} / 500`; }
function showPlan(task, plan) {
  original.textContent = task;
  summary.textContent = plan.summary;
  assumptions.replaceChildren(...plan.assumptions.map(item => textElement("li", item)));
  document.getElementById("task-assumptions-wrap").classList.toggle("hidden", !plan.assumptions.length);
  overallWarning.textContent = plan.overall_warning || "";
  overallWarning.classList.toggle("hidden", !plan.overall_warning);
  question.textContent = plan.clarifying_question || "";
  question.classList.toggle("hidden", !plan.clarifying_question);
  steps.replaceChildren();
  plan.steps.forEach((step, index) => {
    const compatibility = classifyCommand(step.command);
    const card = document.createElement("article");
    card.className = "task-step";
    card.append(textElement("h4", `Step ${index + 1}: ${step.purpose}`));
    card.append(textElement("code", step.command, "task-command"));
    card.append(textElement("p", step.explanation));
    card.append(textElement("p", `Expected result: ${step.expected_result}`, "task-expected"));
    card.append(textElement("p", `Playground: ${compatibility.status} — ${compatibility.reason}`, `task-compatibility task-${compatibility.status}`));
    if (compatibility.warning) card.append(textElement("p", compatibility.warning, "task-warning"));
    if (step.warning) card.append(textElement("p", `Real-world caution: ${step.warning}`, "task-warning"));
    if (compatibility.canTry) {
      const tryButton = textElement("button", "Try in Playground", "terminal-reset task-try");
      tryButton.type = "button";
      tryButton.addEventListener("click", () => {
        const current = classifyCommand(step.command);
        if (!current.canTry) { status.textContent = "This command is no longer supported by Playground."; return; }
        try {
          if (!storage) throw new Error("storage unavailable");
          storage.offerDraft(step.command);
          window.location.assign("/playground");
        } catch { status.textContent = "Could not transfer this command. You can copy it for study instead."; }
      });
      card.append(tryButton);
    }
    steps.appendChild(card);
  });
  result.classList.remove("hidden");
}

input.addEventListener("input", updateCount);
document.getElementById("task-clear").addEventListener("click", () => {
  if (busy) return;
  input.value = "";
  updateCount();
  result.classList.add("hidden");
  status.textContent = "Plan cleared from this browser tab.";
  try { storage?.clearPlan(); } catch { storage = null; }
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  const task = input.value.trim();
  if (!task || task.length > 500) { status.textContent = "Enter a task of up to 500 characters."; return; }
  busy = true;
  button.disabled = true;
  button.textContent = "Building plan…";
  status.textContent = "Asking Gemini to propose an educational plan. No command is being run.";
  try {
    const response = await fetch("/api/task-builder/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || "Task planning is unavailable.");
    const data = payload.data;
    if (!data || typeof data.task !== "string" || !data.plan) throw new Error("The plan response was invalid.");
    validateSavedPlan({ version: 1, task: data.task, plan: data.plan });
    showPlan(data.task, data.plan);
    status.textContent = "Plan ready. Commands are suggestions; nothing has been executed.";
    try { storage?.savePlan(data.task, data.plan); }
    catch { status.textContent += " This plan could not be saved in this browser tab."; }
  } catch (error) {
    status.textContent = error.message || "Task planning is unavailable.";
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = "Build plan";
  }
});

updateCount();
try {
  const saved = storage?.loadPlan();
  if (saved) {
    input.value = saved.task;
    updateCount();
    showPlan(saved.task, saved.plan);
    status.textContent = "Last plan restored from this browser tab. No new Gemini request was made.";
  }
} catch {
  try { storage?.clearPlan(); } catch { storage = null; }
  status.textContent = "Saved plan was invalid or outdated and was removed.";
}
