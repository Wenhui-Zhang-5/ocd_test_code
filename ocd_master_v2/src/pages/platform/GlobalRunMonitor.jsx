import React, { useMemo, useState } from "react";
import { listGlobalRuns } from "../../data/mockApi.js";
import { buildHashHref } from "../../router.js";

const tabs = ["all", "running", "queued", "completed"];

export default function GlobalRunMonitor() {
  const [activeTab, setActiveTab] = useState("all");
  const allRuns = listGlobalRuns();
  const runs = allRuns.filter((run) => (activeTab === "all" ? true : run.status === activeTab));
  const counts = useMemo(() => {
    const byStatus = { running: 0, queued: 0, completed: 0 };
    allRuns.forEach((row) => {
      const key = String(row.status || "").toLowerCase();
      if (key === "running" || key === "queued" || key === "completed") {
        byStatus[key] += 1;
      }
    });
    return byStatus;
  }, [allRuns]);

  const targetHref = (run) => {
    const id = run.workspaceId || run.modelID;
    if (!id) return buildHashHref("/ocd/recipe-hub");
    return buildHashHref(`/ocd/workspace/${id}/run-monitor/control`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Platform</p>
          <h2>Run Monitor</h2>
          <p className="subtle">Running, queued, and completed cases with stage and KPI details.</p>
        </div>
      </header>

      <section className="panel">
        <div className="signal-grid">
          <div className="signal-card">
            <h3>Running</h3>
            <p>{counts.running}</p>
          </div>
          <div className="signal-card">
            <h3>Queued</h3>
            <p>{counts.queued}</p>
          </div>
          <div className="signal-card">
            <h3>Completed</h3>
            <p>{counts.completed}</p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Run Details</h3>
          <div className="inline-actions">
            {tabs.map((tab) => (
              <button
                key={tab}
                className={tab === activeTab ? "primary-button" : "ghost-button"}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>Workspace</span>
            <span>Model ID</span>
            <span>Recipe</span>
            <span>Owner</span>
            <span>Project</span>
            <span>Product</span>
            <span>Version</span>
            <span>Status</span>
            <span>Current Stage</span>
            <span>Best KPI</span>
          </div>
          {runs.map((run, idx) => (
            <a
              key={`${run.modelID || run.workspaceId || "run"}-${idx}`}
              className="table-row link-row"
              href={targetHref(run)}
            >
              <span>{run.workspaceId || "-"}</span>
              <span>{run.modelID}</span>
              <span>{run.recipeName}</span>
              <span>{run.owner}</span>
              <span>{run.project || "-"}</span>
              <span>{run.productId || "-"}</span>
              <span>{run.version || "-"}</span>
              <span className={`status-pill status-${run.status}`}>{run.status}</span>
              <span>{run.currentStage}</span>
              <span>{run.bestKPI}</span>
            </a>
          ))}
          {!runs.length ? (
            <div className="table-row">
              <span>-</span>
              <span>-</span>
              <span>No runs</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
