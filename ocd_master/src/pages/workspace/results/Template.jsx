import React from "react";

export default function ResultsTemplate({ workspaceId }) {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Results</p>
          <h2>Report</h2>
          <p className="subtle">Report placeholder for {workspaceId}.</p>
        </div>
        <div />
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Report</h3>
        </div>
        <div className="plot-placeholder">Report content will be added here.</div>
      </section>
    </div>
  );
}
