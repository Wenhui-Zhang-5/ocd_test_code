import React, { useEffect, useState } from "react";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";
import WorkspaceSidebar from "./WorkspaceSidebar.jsx";
import WorkspaceTopbar from "./WorkspaceTopbar.jsx";
import { MOCK_STATE_UPDATED_EVENT } from "../data/mockApi.js";

const isWorkspacePath = (path) => path.startsWith("/ocd/workspace/");
const isPlatformPath = (path) => path.startsWith("/ocd");

const getWorkspaceId = (path) => {
  const parts = path.split("/").filter(Boolean);
  return parts[2] || null;
};

export default function PageShell({ children, currentPath }) {
  const isWorkspace = isWorkspacePath(currentPath);
  const workspaceId = isWorkspace ? getWorkspaceId(currentPath) : null;
  const isPlatform = isPlatformPath(currentPath);
  const [stateVersion, setStateVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onStateUpdated = () => setStateVersion((prev) => prev + 1);
    window.addEventListener(MOCK_STATE_UPDATED_EVENT, onStateUpdated);
    return () => {
      window.removeEventListener(MOCK_STATE_UPDATED_EVENT, onStateUpdated);
    };
  }, []);

  if (!isPlatform) {
    return <div className="content">{children}</div>;
  }

  return (
    <div className="app-shell" data-state-version={stateVersion}>
      {isWorkspace ? (
        <WorkspaceSidebar
          currentPath={currentPath}
          workspaceId={workspaceId}
        />
      ) : (
        <Sidebar currentPath={currentPath} />
      )}
      <div className="main-shell">
        {isWorkspace ? (
          <WorkspaceTopbar currentPath={currentPath} workspaceId={workspaceId} />
        ) : (
          <Topbar currentPath={currentPath} />
        )}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
