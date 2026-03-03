import { getWorkspace } from "./mockApi.js";

export const isWorkspaceReadOnly = (workspaceId) => {
  if (!workspaceId) return false;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return false;
  return ["completed"].includes(workspace.status);
};
