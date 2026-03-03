import React, { useEffect, useState } from "react";
import { getRunDetail, saveCheckpoint, startRunTicker, updateWorkspaceStatus } from "../../data/mockApi.js";

export default function Monitor({ workspaceId }) {
  const [detail, setDetail] = useState(() => getRunDetail(workspaceId));
  const [selectedSeed, setSelectedSeed] = useState(null);

  useEffect(() => {
    startRunTicker();
    const interval = window.setInterval(() => {
      setDetail({ ...getRunDetail(workspaceId) });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [workspaceId]);

  const handleStop = () => {
    updateWorkspaceStatus(workspaceId, "completed");
  };

  const handleCheckpoint = () => {
    setDetail({ ...saveCheckpoint(workspaceId) });
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>Run Monitor</h2>
          <p className="subtle">Model-level monitoring for {workspaceId}.</p>
        </div>
        <button className="primary-button">Open Results</button>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Control Center</h3>
          <div className="inline-actions">
            <button className="danger-button" onClick={handleStop}>Stop</button>
            <button className="ghost-button" onClick={handleCheckpoint}>Stop + Checkpoint</button>
          </div>
        </div>
        <div className="panel-note">Controls trigger mock state transitions.</div>
      </section>

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h3>Trace</h3>
            <button className="ghost-button">Filter</button>
          </div>
          <div className="timeline">
            {detail.trace.map((event, index) => (
              <div className="timeline-row" key={`${event.time}-${index}`}>
                <span className="time">{event.time}</span>
                <div>
                  <p className="list-title">{event.action}</p>
                  <p className="list-subtitle">{event.note}</p>
                </div>
                <span className="chip">{event.action}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <h3>Live Ranking</h3>
            <div className="inline-actions">
              <button className="ghost-button">Refresh</button>
            </div>
          </div>
          <div className="table">
            <div className="table-row table-head">
              <span>Rank</span>
              <span>Seed</span>
              <span>Iteration</span>
              <span>KPI</span>
              <span>Status</span>
            </div>
            {detail.ranking.map((row) => (
              <button
                className="table-row"
                key={`${row.seedId}-${row.rank}`}
                onClick={() => setSelectedSeed(row.seedId)}
              >
                <span>{row.rank}</span>
                <span>{row.seedId}</span>
                <span>{row.iteration}</span>
                <span>{row.kpi}</span>
                <span className="chip">{row.status}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Detail View</h3>
          <span className="chip">Seed: {selectedSeed || "Select a row"}</span>
        </div>
        <div className="grid three-col">
          <div className="plot-placeholder">Linear Plot (TM vs OCD)</div>
          <div className="plot-placeholder">NK Curves</div>
          <div className="plot-placeholder">Spectrum Fitting</div>
        </div>
      </section>
    </div>
  );
}
