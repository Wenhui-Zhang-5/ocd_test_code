import React, { useState } from "react";
import { getRunDetail, updateWorkspaceStatus } from "../../../data/mockApi.js";

export default function MonitorControl({ workspaceId }) {
  const detail = getRunDetail(workspaceId);
  const [confirmStop, setConfirmStop] = useState(false);

  const handleStop = () => {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    updateWorkspaceStatus(workspaceId, "completed");
    setConfirmStop(false);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Monitor</p>
          <h2>Control</h2>
          <p className="subtle">Stop run or stop with checkpoint.</p>
        </div>
      </header>

      <section className="panel status-panel">
        <div>
          <p className="summary-label">Run Status</p>
          <h3 className={`status-pill status-${detail.status}`}>{detail.status}</h3>
        </div>
        <div>
          <p className="summary-label">Iteration</p>
          <p className="summary-value">{detail.iteration}</p>
        </div>
        <div>
          <p className="summary-label">Current Seed</p>
          <p className="summary-value">S2</p>
        </div>
        <div>
          <p className="summary-label">ETA</p>
          <p className="summary-value">38 min</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Control Center</h3>
          <span className="chip">Double confirmation required</span>
        </div>
        <div className="control-grid">
          <div className="control-card">
            <p className="summary-label">Stop Run</p>
            <p className="summary-value">Immediately stop and mark run completed.</p>
            <div className="inline-actions">
              <button className="danger-button" onClick={handleStop}>
                {confirmStop ? "Confirm Stop" : "Stop"}
              </button>
              {confirmStop && (
                <button className="ghost-button" onClick={() => setConfirmStop(false)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
