import React, { useEffect, useMemo, useState } from "react";
import { isOptimizationApiEnabled, subscribeOptimizationEvents } from "../../../data/optimizationApi.js";
import { buildRankingRowsFromFinalRegression, loadWorkspacePreferredRun } from "../../../data/optimizationView.js";
import { NkChart, RegressionChart, SpectrumChart } from "../../../components/OptimizationCharts.jsx";

export default function MonitorRanking({ workspaceId }) {
  const optimizationApiEnabled = isOptimizationApiEnabled();
  const [run, setRun] = useState(null);
  const [rows, setRows] = useState([]);
  const [expandedRow, setExpandedRow] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    if (!optimizationApiEnabled) return;
    setLoading(true);
    try {
      const preferredRun = await loadWorkspacePreferredRun(workspaceId);
      setRun(preferredRun || null);
      if (!preferredRun?.run_id) {
        setRows([]);
        setError("");
        return;
      }
      const rankingRows = await buildRankingRowsFromFinalRegression(preferredRun.run_id);
      setRows(rankingRows);
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load ranking data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!optimizationApiEnabled) return undefined;
    let active = true;
    void loadData();
    const unsubscribe = subscribeOptimizationEvents({
      onEvent: () => {
        if (!active) return;
        void loadData();
      },
      onError: () => {
        if (!active) return;
        void loadData();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [optimizationApiEnabled, workspaceId]);

  const displayRows = useMemo(() => rows, [rows]);

  const toggleRow = (rowKey) => {
    setExpandedRow((prev) => (prev === rowKey ? null : rowKey));
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Monitor</p>
          <h2>Ranking</h2>
          <p className="subtle">Real-time KPI ranking from final regression summaries.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Live Ranking</h3>
          <span className="chip">{run?.run_id ? `Run ${run.run_id}` : "No Run"}</span>
        </div>
        {!optimizationApiEnabled ? (
          <div className="panel-note">Optimization API is disabled by env. Enable `VITE_ENABLE_OPTIMIZATION_API=1`.</div>
        ) : null}
        {error ? <div className="panel-note">{error}</div> : null}
        {loading ? <div className="panel-note">Loading ranking...</div> : null}
        <div className="table">
          <div className="table-row table-head">
            <span>Rank</span>
            <span>Scheme</span>
            <span>Seed</span>
            <span>Grid</span>
            <span>R2</span>
            <span>Slope</span>
            <span>Side-by-side</span>
            <span>Precision</span>
            <span>LBH</span>
            <span></span>
          </div>
          {displayRows.map((row) => (
            <React.Fragment key={`${row.relativePath}-${row.rank}`}>
              <div className="table-row">
                <span>{row.rank}</span>
                <span>{row.couplingExpression || "-"}</span>
                <span>{row.seedId || "-"}</span>
                <span>{row.gridIndex ?? "-"}</span>
                <span>{row.r2 ?? "-"}</span>
                <span>{row.slope ?? "-"}</span>
                <span>{row.sideBySide ?? "-"}</span>
                <span>{row.precision ?? "-"}</span>
                <span>{row.lbh ?? "-"}</span>
                <button className="ghost-button" onClick={() => toggleRow(`${row.relativePath}-${row.rank}`)}>
                  {expandedRow === `${row.relativePath}-${row.rank}` ? "Hide Detail" : "Check Detail"}
                </button>
              </div>
              {expandedRow === `${row.relativePath}-${row.rank}` ? (
                <div className="table-row detail-row">
                  <div className="ranking-detail">
                    <div className="detail-header">
                      <span>{row.relativePath}</span>
                      <span className="chip chip-muted">{row.modifiedAt || "-"}</span>
                    </div>
                    <SpectrumChart spectrumFit={row.spectrumFit} />
                    <RegressionChart regressionPerCd={row.regressionPerCd} />
                    <NkChart nkSnapshot={row.nkSnapshot} />
                  </div>
                </div>
              ) : null}
            </React.Fragment>
          ))}
          {!displayRows.length && !loading ? (
            <div className="table-row">
              <span>-</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
              <span>No ranking data yet</span>
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
