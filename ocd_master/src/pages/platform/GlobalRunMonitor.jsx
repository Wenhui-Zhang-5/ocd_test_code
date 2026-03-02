import React, { useState } from "react";
import { listGlobalRuns } from "../../data/mockApi.js";
import { buildHashHref } from "../../router.js";

const tabs = ["all", "running", "queued", "completed"];

export default function GlobalRunMonitor() {
  const [activeTab, setActiveTab] = useState("all");
  const runs = listGlobalRuns().filter((run) => (activeTab === "all" ? true : run.status === activeTab));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Platform</p>
          <h2>Global Run Monitor</h2>
          <p className="subtle">Platform-level status across all model runs.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Status Tabs</h3>
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
          {runs.map((run) => (
            <a
              key={run.modelID}
              className="table-row link-row"
              href={buildHashHref(`/ocd/workspace/${run.modelID}/run-monitor/control`)}
            >
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
        </div>
      </section>
    </div>
  );
}
