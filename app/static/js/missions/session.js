import { restoreSession } from "../simulation/model.js";
import { evaluateMission } from "./checker.js";

export function createAttempt(mission) {
  return {
    missionId: mission.id, missionVersion: mission.version,
    session: restoreSession(mission.startingSnapshot), history: [], hintsShown: 0, completed: false,
  };
}

export function recordCommand(mission, attempt, result, command, history) {
  if (attempt.completed) throw new Error("This mission attempt is already complete");
  const next = { ...attempt, session: result.session, history: [...history].slice(-100) };
  next.completed = evaluateMission(mission, next.session).complete;
  return next;
}

export function revealHint(mission, attempt) {
  return { ...attempt, hintsShown: Math.min(mission.hints.length, attempt.hintsShown + 1) };
}

export function retryAttempt(mission) {
  return createAttempt(mission);
}
