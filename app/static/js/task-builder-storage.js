import { classifyCommand } from "./simulation/compatibility.js";

export const PLAN_KEY = "linuxlab.task-builder.plan.v1";
export const DRAFT_KEY = "linuxlab.task-builder.handoff.v1";
const VERSION = 1;
const MAX_PLAN_CHARS = 40000;

function validText(value, limit, allowNull = false) {
  return (allowNull && value === null) || (typeof value === "string" && value.trim().length > 0 && value.length <= limit);
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

export function validateSavedPlan(value) {
  if (!exactKeys(value, ["version", "task", "plan"]) || value.version !== VERSION || !validText(value.task, 500)) throw new Error("invalid saved task");
  const plan = value.plan;
  if (!exactKeys(plan, ["status", "summary", "assumptions", "clarifying_question", "overall_warning", "steps"]) ||
      !["ready", "needs_clarification"].includes(plan.status) || !validText(plan.summary, 240) ||
      !Array.isArray(plan.assumptions) || plan.assumptions.length > 3 || plan.assumptions.some(item => !validText(item, 180)) ||
      !validText(plan.clarifying_question, 250, true) || !validText(plan.overall_warning, 400, true) ||
      !Array.isArray(plan.steps) || plan.steps.length > 8) throw new Error("invalid saved plan");
  if (plan.status === "ready" && (!plan.steps.length || plan.clarifying_question !== null)) throw new Error("invalid saved plan status");
  if (plan.status === "needs_clarification" && (plan.steps.length || !plan.clarifying_question)) throw new Error("invalid saved clarification");
  for (const step of plan.steps) {
    if (!exactKeys(step, ["command", "purpose", "explanation", "expected_result", "impact", "warning"]) ||
        !validText(step.command, 2048) || /[\r\n\0]/.test(step.command) ||
        !validText(step.purpose, 160) || !validText(step.explanation, 500) || !validText(step.expected_result, 300) ||
        !["read", "modify", "delete", "unknown"].includes(step.impact) || !validText(step.warning, 400, true)) {
      throw new Error("invalid saved step");
    }
  }
  return value;
}

export function createTaskBuilderStorage(storage) {
  return {
    loadPlan() {
      const raw = storage.getItem(PLAN_KEY);
      if (raw === null) return null;
      if (raw.length > MAX_PLAN_CHARS) throw new Error("saved plan too large");
      return validateSavedPlan(JSON.parse(raw));
    },
    savePlan(task, plan) {
      const data = JSON.stringify(validateSavedPlan({ version: VERSION, task, plan }));
      if (data.length > MAX_PLAN_CHARS) throw new Error("plan too large");
      storage.setItem(PLAN_KEY, data);
    },
    clearPlan() { storage.removeItem(PLAN_KEY); },
    offerDraft(command) {
      const classification = classifyCommand(command);
      if (!classification.canTry) throw new Error("only supported commands can be transferred");
      storage.setItem(DRAFT_KEY, JSON.stringify({ version: VERSION, command }));
    },
    consumeDraft(session) {
      const raw = storage.getItem(DRAFT_KEY);
      if (raw === null) return null;
      storage.removeItem(DRAFT_KEY);
      if (raw.length > 4096) throw new Error("draft too large");
      const draft = JSON.parse(raw);
      if (draft?.version !== VERSION || !validText(draft.command, 2048) || !draft.command.trim()) throw new Error("invalid draft");
      const classification = classifyCommand(draft.command, session);
      if (!classification.canTry) throw new Error("draft is unsupported in this virtual session");
      return { command: draft.command, classification };
    },
  };
}
