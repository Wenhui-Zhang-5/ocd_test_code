import React from "react";
import { workspaceNavSections } from "../data/routes.js";
import { buildHashHref } from "../router.js";
import { getWorkspace } from "../data/mockApi.js";

const buildWorkspacePath = (workspaceId, path) => `/ocd/workspace/${workspaceId}${path}`;

const isSectionActive = (path, currentPath) => currentPath.includes(path);

export default function WorkspaceSidebar({ currentPath, workspaceId }) {
  const isActive = (path) => currentPath === path;
  const workspace = getWorkspace(workspaceId) || {};
  const isTemp = workspace.type === "temporary";
  const isRunning = workspace.status === "running";
  const isCompleted = workspace.status === "completed";

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">OCD</span>
        <div>
          <p className="brand-title">Workspace</p>
          <p className="brand-subtitle">
            {isTemp ? "Temporary Session" : `ID: ${workspaceId || "-"}`}
          </p>
        </div>
      </div>
      <div className="workspace-status">
        <a className="nav-link" href={buildHashHref("/ocd/home")}>Back to Platform</a>
      </div>
      <div className="workspace-status">
        <span className="chip">Status: {workspace.status || "-"}</span>
      </div>
      <nav className="nav">
        {workspaceNavSections.map((section) => (
          <div className={`nav-section nav-${section.theme}`} key={section.title}>
            <p className="nav-title">{section.title}</p>
            <div className="nav-links">
              {section.items.map((item) => {
                const fullPath = buildWorkspacePath(workspaceId, item.path);
                return (
                  <a
                    key={item.path}
                    href={buildHashHref(fullPath)}
                    className={isActive(fullPath) ? "nav-link nav-link-active" : "nav-link"}
                  >
                    {item.label}
                  </a>
                );
              })}
            </div>

            <div className="nav-subsections">
              {section.children
                .filter((group) => (isTemp ? group.label === "Spectrum Analysis" : true))
                .map((group) => {
                const groupPath = buildWorkspacePath(workspaceId, group.path);
                const isGroupActive = isSectionActive(groupPath, currentPath);
                const isLocked = isTemp && (group.label === "Recipe Build" || group.label === "Run Monitor" || group.label === "Results");
                const isReadOnly = (isRunning && group.label === "Recipe Build") || (isCompleted && group.label === "Run Monitor");
                const lockTitle = isLocked ? "Available after Recipe Setup" : isReadOnly ? "Read-only in current status" : "";

                if (isLocked) {
                  return (
                    <div className="nav-group nav-group-locked" key={group.label} title={lockTitle}>
                      <p className="nav-group-title">{group.label}</p>
                      <div className="nav-group-links">
                        {group.items.map((item) => (
                          <span className="nav-link nav-link-locked" key={item.path}>
                            {item.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    className={`nav-group ${isGroupActive ? "nav-group-active" : ""}`}
                    key={group.label}
                    title={lockTitle}
                  >
                    <p className="nav-group-title">{group.label}</p>
                    <div className="nav-group-links">
                      {group.items.map((item) => {
                        const fullPath = buildWorkspacePath(workspaceId, item.path);
                        const isPreRecipeLocked =
                          isTemp && group.label === "Pre-Recipe" && item.label !== "Recipe Setup";
                        const itemTitle = isPreRecipeLocked ? "Available after Recipe Setup" : lockTitle;
                        return (
                          <a
                            key={item.path}
                            href={isPreRecipeLocked ? undefined : buildHashHref(fullPath)}
                            title={itemTitle}
                            className={
                              isPreRecipeLocked
                                ? "nav-link nav-link-locked"
                                : isActive(fullPath)
                                ? "nav-link nav-link-active"
                                : isReadOnly
                                ? "nav-link nav-link-readonly"
                                : "nav-link"
                            }
                          >
                            {item.label}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="chip">API: Mock Mode</div>
        <div className="chip">Workspace: Active</div>
      </div>
    </aside>
  );
}
