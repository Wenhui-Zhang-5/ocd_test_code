import React, { useEffect, useMemo, useState } from "react";
import { isOptimizationApiEnabled, listOptimizationRuns, subscribeOptimizationEvents } from "../../data/optimizationApi.js";
import { buildHashHref } from "../../router.js";

const tabs = ["all", "running", "queued", "completed"];

export default function GlobalRunMonitor() {
  const [activeTab, setActiveTab] = useState("all");
  const [apiRuns, setApiRuns] = useState([]);
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(false);
  const optimizationApiEnabled = isOptimizationApiEnabled();

  const loadApiRuns = async () => {
    if (!optimizationApiEnabled) return;
    setLoading(true);
    try {
      const payload = await listOptimizationRuns({ page: 1, pageSize: 500 });
      const mapped = Array.isArray(payload?.items)
        ? payload.items.map((item) => ({
            workspaceId: item.workspace_id || "-",
            modelID: item.model_id || "-",
            recipeName: "-",
            owner: item.submitted_by || "-",
            project: "-",
            productId: "-",
            version: item.version || "-",
            status: String(item.status || "").toLowerCase() || "queued",
            currentStage: item.current_stage || "-",
            bestKPI: item.best_kpi === null || item.best_kpi === undefined ? "-" : String(item.best_kpi)
          }))
        : [];
      setApiRuns(mapped);
      setApiError("");
    } catch (error) {
      setApiError(error?.message || "Failed to load optimization runs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!optimizationApiEnabled) return undefined;
    let active = true;
    void loadApiRuns();
    const unsubscribe = subscribeOptimizationEvents({
      onEvent: () => {
        if (!active) return;
        void loadApiRuns();
      },
      onError: () => {
        if (!active) return;
        void loadApiRuns();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [optimizationApiEnabled]);

  const allRuns = apiRuns;
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
        {optimizationApiEnabled && apiError ? <div className="panel-note">{apiError}</div> : null}
        {!optimizationApiEnabled ? (
          <div className="panel-note">Optimization API is disabled by env. Enable `VITE_ENABLE_OPTIMIZATION_API=1`.</div>
        ) : null}
        {loading ? <div className="panel-note">Loading runs...</div> : null}
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
          {!runs.length && !loading ? (
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
