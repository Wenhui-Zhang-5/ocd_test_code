import React from "react";
import { getWorkspace, listModelHub } from "../../data/mockApi.js";
import { buildHashHref } from "../../router.js";

export default function Overview({ workspaceId }) {
  const workspace = getWorkspace(workspaceId) || {};
  const hubList = listModelHub();
  const isTemp = workspace.type === "temporary" || workspace.status === "temp" || workspace.id === "temp";
  const workspaceIndex = hubList.findIndex((row) => row.id === workspace.id);
  const workspaceNo = workspaceIndex >= 0 ? workspaceIndex + 1 : null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>Overview</h2>
          <p className="subtle">Track workspace status and jump into modules.</p>
        </div>
      </header>

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h3>Workspace Info</h3>
            <span className="chip">{workspace.type || "temporary"}</span>
          </div>
          <div className="summary-grid">
            <div>
              <p className="summary-label">No.</p>
              <p className="summary-value">
                {workspaceNo || "-"}
              </p>
            </div>
            <div>
              <p className="summary-label">Workspace ID</p>
              <p className="summary-value">
                {isTemp ? "-" : workspace.id || workspaceId || "-"}
              </p>
            </div>
            <div>
              <p className="summary-label">Model ID</p>
              <p className="summary-value">{workspace.modelID || "TEMP"}</p>
            </div>
            <div>
              <p className="summary-label">Recipe</p>
              <p className="summary-value">{workspace.recipeName || "-"}</p>
            </div>
            <div>
              <p className="summary-label">Owner</p>
              <p className="summary-value">{workspace.owner || "-"}</p>
            </div>
            <div>
              <p className="summary-label">Status</p>
              <p className="summary-value">{workspace.status || "temp"}</p>
            </div>
          </div>
        </div>
        <div className="panel">
        <div className="panel-header">
          <h3>Quick Actions</h3>
          <div />
        </div>
          <div className="list">
            <a className="list-row" href={buildHashHref(`/ocd/workspace/${workspaceId}/spectrum-analysis/spectrum`)}>
              <span>Go to Spectrum Analysis</span>
              <span className="chip">Start</span>
            </a>
            <a className="list-row" href={buildHashHref(`/ocd/workspace/${workspaceId}/pre-recipe/recipe-setup`)}>
              <span>Pre-Recipe Setup</span>
              <span className="chip">Draft</span>
            </a>
            <a className="list-row" href={buildHashHref(`/ocd/workspace/${workspaceId}/run-monitor/control`)}>
              <span>Run Monitor</span>
              <span className="chip">Live</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
