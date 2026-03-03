import React from "react";
import { getWorkspace } from "../data/mockApi.js";
import { matchRoute } from "../router.js";
import { breadcrumbMap } from "../data/routes.js";
import ThemeToggle from "./ThemeToggle.jsx";

const getBreadcrumbs = (pathname) => {
  const patterns = Object.keys(breadcrumbMap);
  for (const pattern of patterns) {
    if (matchRoute(pattern, pathname)) {
      return breadcrumbMap[pattern];
    }
  }
  return ["Workspace"];
};

export default function WorkspaceTopbar({ currentPath, workspaceId }) {
  const workspace = getWorkspace(workspaceId) || {};
  const crumbs = getBreadcrumbs(currentPath);
  const isTemp = workspace.type === "temporary" || workspace.status === "temp" || workspace.id === "temp";
  const modelLabel = isTemp ? "TEMP" : (workspace.modelID || "-");

  return (
    <header className="topbar">
      <div>
        <div className="breadcrumbs">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`}>
              {crumb}
              {index < crumbs.length - 1 ? <span className="crumb-sep">/</span> : null}
            </span>
          ))}
        </div>
        <div className="workspace-meta">
          <span>Model: {modelLabel}</span>
          <span>Recipe: {workspace.recipeName || "-"}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <span className={`status-pill status-${workspace.status || "temp"}`}>
          {workspace.status || "temp"}
        </span>
        <ThemeToggle className="ghost-button" label="" />
      </div>
    </header>
  );
}
