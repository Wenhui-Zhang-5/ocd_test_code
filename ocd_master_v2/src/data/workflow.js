export const workflowSteps = [
  "/spectrum-analysis/spectrum",
  "/spectrum-analysis/sensitivity",
  "/spectrum-analysis/precision",
  "/pre-recipe/recipe-setup",
  "/pre-recipe/model",
  "/pre-recipe/tm-kpi",
  "/recipe/starting-point",
  "/recipe/cd-strategy",
  "/recipe/fitting-strategy",
  "/recipe/recipe-check"
];

export const getNextWorkflowPath = (currentPath, workspaceId) => {
  if (!workspaceId) return null;
  const prefix = `/ocd/workspace/${workspaceId}`;
  if (!currentPath.startsWith(prefix)) {
    return null;
  }
  const suffix = currentPath.slice(prefix.length) || "/";
  const index = workflowSteps.indexOf(suffix);
  if (index === -1 || index >= workflowSteps.length - 1) {
    return null;
  }
  const nextStep = workflowSteps[index + 1];
  if (workspaceId === "temp" && nextStep.startsWith("/pre-recipe")) {
    return null;
  }
  return `${prefix}${nextStep}`;
};
