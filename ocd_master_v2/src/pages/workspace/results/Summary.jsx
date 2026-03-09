import React, { useEffect, useMemo, useState } from "react";
import { isOptimizationApiEnabled, subscribeOptimizationEvents } from "../../../data/optimizationApi.js";
import { buildRankingRowsFromFinalRegression, loadWorkspacePreferredRun } from "../../../data/optimizationView.js";
import { NkChart, RegressionChart, SpectrumChart } from "../../../components/OptimizationCharts.jsx";

const downloadJson = (filename, payload) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export default function ResultsSummary({ workspaceId }) {
  const optimizationApiEnabled = isOptimizationApiEnabled();
  const [run, setRun] = useState(null);
  const [rows, setRows] = useState([]);
  const [expandedRow, setExpandedRow] = useState(null);
  const [selectedRank, setSelectedRank] = useState("1");
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
      if (rankingRows.length > 0) {
        setSelectedRank((prev) => {
          const valid = rankingRows.some((row) => String(row.rank) === String(prev));
          return valid ? prev : String(rankingRows[0].rank);
        });
      } else {
        setSelectedRank("1");
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load result summary");
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

  const passingRows = useMemo(
    () =>
      rows.filter((row) => {
        const precisionGate = row.precisionPassed !== false;
        const targetPassed = Object.values(row.targetPassed || {}).every(Boolean);
        return precisionGate && targetPassed;
      }),
    [rows]
  );
  const displayRows = passingRows.length ? passingRows : rows.slice(0, 10);
  const selectedRow = displayRows.find((row) => String(row.rank) === String(selectedRank)) || displayRows[0] || null;

  const toggleRow = (rowKey) => {
    setExpandedRow((prev) => (prev === rowKey ? null : rowKey));
  };

  const handleDownloadModelJson = () => {
    if (!selectedRow?.modelJson) return;
    const fileName = `${workspaceId || "workspace"}_rank_${selectedRow.rank}_model.json`;
    downloadJson(fileName, selectedRow.modelJson);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Results</p>
          <h2>Summary</h2>
          <p className="subtle">Real ranking and solution summary from final regression outputs.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Qualified Ranking</h3>
          <span className="chip">
            {run?.run_id ? `Run ${run.run_id}` : "No Run"}
          </span>
        </div>
        {!optimizationApiEnabled ? (
          <div className="panel-note">Optimization API is disabled by env. Enable `VITE_ENABLE_OPTIMIZATION_API=1`.</div>
        ) : null}
        {error ? <div className="panel-note">{error}</div> : null}
        {loading ? <div className="panel-note">Loading summary...</div> : null}
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
                <button
                  className="ghost-button"
                  onClick={() => toggleRow(`${row.relativePath}-${row.rank}`)}
                >
                  {expandedRow === `${row.relativePath}-${row.rank}` ? "Hide Detail" : "Check Detail"}
                </button>
              </div>
              {expandedRow === `${row.relativePath}-${row.rank}` ? (
                <div className="table-row detail-row">
                  <div className="ranking-detail">
                    <div className="panel-note">Grid: {JSON.stringify(row.grid || {})}</div>
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
              <span>No results yet</span>
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

      <section className="panel">
        <div className="panel-header">
          <h3>Final Selection</h3>
          <button className="ghost-button" onClick={handleDownloadModelJson} disabled={!selectedRow?.modelJson}>
            Download Model JSON
          </button>
        </div>
        <div className="form-row">
          <label>Ranking</label>
          <select value={selectedRank} onChange={(event) => setSelectedRank(event.target.value)} disabled={!displayRows.length}>
            {displayRows.map((row) => (
              <option key={`${row.relativePath}-${row.rank}`} value={String(row.rank)}>
                #{row.rank} · {row.couplingExpression} · {row.seedId}
              </option>
            ))}
          </select>
        </div>
        {selectedRow ? (
          <div className="panel-note">
            Selected: rank #{selectedRow.rank}, seed {selectedRow.seedId}, R2={selectedRow.r2 ?? "-"}, precision={selectedRow.precision ?? "-"}
          </div>
        ) : null}
        {selectedRow ? (
          <div className="detail-grid">
            <SpectrumChart spectrumFit={selectedRow.spectrumFit} title="Selected Spectrum Fit" />
            <RegressionChart regressionPerCd={selectedRow.regressionPerCd} title="Selected Linear Regression" />
            <NkChart nkSnapshot={selectedRow.nkSnapshot} title="Selected NK Parameters" />
          </div>
        ) : null}
      </section>
    </div>
  );
}
