import { evaluateMission } from "../missions/checker.js";

export function checkDebugResult(exercise, result) {
  const objectives = evaluateMission(exercise, result.session).objectives;
  return {
    complete: result.committed && result.exitCode === 0 && objectives.every(item => item.passed),
    objectives,
  };
}
