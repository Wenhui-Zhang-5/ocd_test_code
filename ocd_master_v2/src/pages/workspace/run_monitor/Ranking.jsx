import React, { useEffect, useState } from "react";
import { getRunDetail, startRunTicker } from "../../../data/mockApi.js";

export default function MonitorRanking({ workspaceId }) {
  const [detail, setDetail] = useState(() => getRunDetail(workspaceId));
  const [expandedRow, setExpandedRow] = useState(null);

  useEffect(() => {
    startRunTicker();
    const interval = window.setInterval(() => {
      setDetail({ ...getRunDetail(workspaceId) });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [workspaceId]);

  const toggleRow = (rowKey) => {
    setExpandedRow((prev) => (prev === rowKey ? null : rowKey));
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Monitor</p>
          <h2>Ranking</h2>
          <p className="subtle">Live KPI ranking for active seeds.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Live Ranking</h3>
          <span className="chip">Sorted by KPI</span>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>Rank</span>
            <span>Scheme</span>
            <span>Seed</span>
            <span>Iteration</span>
            <span>R2</span>
            <span>Slope</span>
            <span>Side-by-side (nm)</span>
            <span>Precision</span>
            <span>Status</span>
            <span></span>
          </div>
          {detail.ranking.map((row) => (
            <React.Fragment key={`${row.seedId}-${row.rank}`}>
              <div className="table-row">
                <span>{row.rank}</span>
                <span>{row.couplingScheme || "-"}</span>
                <span>{row.seedId}</span>
                <span>{row.iteration ?? "-"}</span>
                <span>{row.r2 ?? "-"}</span>
                <span>{row.slope ?? "-"}</span>
                <span>{row.sideBySideNm ?? "-"}</span>
                <span>{row.precision ?? "-"}</span>
                <span className="chip">{row.status}</span>
                <button
                  className="ghost-button"
                  onClick={() => toggleRow(`${row.couplingScheme}-${row.seedId}`)}
                >
                  {expandedRow === `${row.couplingScheme}-${row.seedId}` ? "Hide Detail" : "Check Detail"}
                </button>
              </div>
              {expandedRow === `${row.couplingScheme}-${row.seedId}` && (
                <div className="table-row detail-row">
                  <div className="ranking-detail">
                    <div className="detail-header">
                      <span>Detail: {row.couplingScheme} / {row.seedId}</span>
                      <span className="chip chip-muted">Iteration {row.iteration}</span>
                    </div>
                    <div className="table kpi-table">
                      <div className="table-row table-head">
                        <span>KPI</span>
                        <span>R2</span>
                        <span>Slope</span>
                        <span>SBS</span>
                        <span>Precision</span>
                      </div>
                      <div className="table-row">
                        <span>KPI1</span>
                        <span>{row.r2 ?? "-"}</span>
                        <span>{row.slope ?? "-"}</span>
                        <span>{row.sideBySideNm ?? "-"}</span>
                        <span>{row.precision ?? "-"}</span>
                      </div>
                    </div>
                    <div className="detail-section">
                      <div className="detail-section-header">Linear Plots</div>
                      <div className="detail-scroll">
                        {Array.from({ length: 4 }).map((_, index) => (
                          <div className="plot-placeholder" key={`linear-${index}`}>
                            Linear Plot {row.artifacts?.linearPlotId || "-"}-{index + 1}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="detail-section">
                      <div className="detail-section-header">NK Curves</div>
                      <div className="detail-scroll nk-scroll">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div className="plot-placeholder" key={`nk-${index}`}>
                            NK Curve {row.artifacts?.nkPlotId || "-"}-{index + 1}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="detail-section">
                      <div className="detail-section-header">Spectrum Fitting</div>
                      <div className="plot-placeholder">
                        Spectrum Fitting {row.artifacts?.fittingPlotId || "-"}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>
    </div>
  );
}
