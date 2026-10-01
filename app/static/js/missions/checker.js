// Pure, read-only checks over the same virtual session used by Playground.
export const OBJECTIVE_TYPES = Object.freeze([
  "file_exists", "path_absent", "directory_exists", "file_content_equals",
  "file_content_includes", "mode_equals", "cwd_equals",
]);

function checkCondition(session, condition) {
  const node = session.nodes.get(condition.path);
  switch (condition.type) {
    case "file_exists": return node?.type === "file";
    case "path_absent": return !node;
    case "directory_exists": return node?.type === "directory";
    case "file_content_equals": return node?.type === "file" && node.content === condition.content;
    case "file_content_includes": return node?.type === "file" && node.content.includes(condition.content);
    case "mode_equals": return node?.type === condition.nodeType && node.mode === condition.mode;
    case "cwd_equals": return session.cwd === condition.path;
    default: throw new Error(`Unknown mission objective type: ${condition.type}`);
  }
}

export function evaluateMission(mission, session) {
  const objectives = mission.objectives.map(objective => ({
    id: objective.id,
    label: objective.label,
    passed: objective.anyOf
      ? objective.anyOf.some(condition => checkCondition(session, condition))
      : checkCondition(session, objective),
  }));
  return { complete: objectives.every(objective => objective.passed), objectives };
}
