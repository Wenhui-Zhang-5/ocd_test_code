import React from "react";

export default function Results({ workspaceId }) {

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>Results Summary</h2>
          <p className="subtle">Final report for model {workspaceId}.</p>
        </div>
        <button className="primary-button">Save as Template</button>
      </header>

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h3>Best Result</h3>
            <button className="ghost-button">Export</button>
          </div>
          <div className="table">
            <div className="table-row table-head">
              <span>Seed</span>
              <span>GOF</span>
              <span>KPI</span>
              <span>Status</span>
            </div>
            <div className="table-row">
              <span>S2</span>
              <span>0.982</span>
              <span>0.95</span>
              <span className="chip">Best</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <h3>KPI Pass/Fail</h3>
            <button className="ghost-button">View Details</button>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <p>CD01 Bias</p>
              <h3>Pass</h3>
            </div>
            <div className="metric-card">
              <p>CD02 Bias</p>
              <h3>Pass</h3>
            </div>
            <div className="metric-card">
              <p>Overall R2</p>
              <h3>Pass</h3>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Summary</h3>
          <button className="ghost-button">Download</button>
        </div>
        <div className="summary-grid">
          <div>
            <p className="summary-label">CD Classification</p>
            <p className="summary-value">Master Float: CD01, CD02 - Maybe: CD03</p>
          </div>
          <div>
            <p className="summary-label">Constraint Scheme</p>
            <p className="summary-value">Scheme A</p>
          </div>
          <div>
            <p className="summary-label">Material Sequence</p>
            <p className="summary-value">SiO2 → SiN → ARC</p>
          </div>
          <div>
            <p className="summary-label">Runtime Stats</p>
            <p className="summary-value">2h 06m - 18 requests - 1 reverse back</p>
          </div>
        </div>
      </section>
    </div>
  );
}
