import React from "react";
import { createTemporaryWorkspace, resetTemporaryWorkspaceSession } from "../../data/mockApi.js";
import { historyRows } from "../../data/mock.js";
import { buildHashHref } from "../../router.js";

export default function History() {
  const handleNewRun = () => {
    resetTemporaryWorkspaceSession();
    createTemporaryWorkspace();
    window.location.hash = buildHashHref("/ocd/workspace/temp/spectrum-analysis/spectrum");
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Center</p>
          <h2>Run History</h2>
          <p className="subtle">Review historical runs and clone strategies.</p>
        </div>
        <button className="primary-button" onClick={handleNewRun}>New Run</button>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>History List</h3>
          <button className="ghost-button">Filter</button>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>Run ID</span>
            <span>Model ID</span>
            <span>Owner</span>
            <span>Status</span>
            <span>Best KPI</span>
            <span>Time</span>
            <span>Actions</span>
          </div>
          {historyRows.map((row) => (
            <div className="table-row" key={row.runId}>
              <span>{row.runId}</span>
              <span>{row.modelId}</span>
              <span>{row.owner}</span>
              <span className={`status-pill status-${row.status}`}>{row.status}</span>
              <span>{row.bestKpi}</span>
              <span>{row.time}</span>
              <div className="row-actions">
                <button className="ghost-button">Monitor</button>
                <button className="ghost-button">Results</button>
                <button className="ghost-button">Clone</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
