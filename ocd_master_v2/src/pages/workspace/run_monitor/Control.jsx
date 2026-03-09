import React, { useEffect, useMemo, useState } from "react";
import { getRunDetail, updateWorkspaceStatus } from "../../../data/mockApi.js";
import {
  cancelOptimizationRun,
  isOptimizationApiEnabled,
  listOptimizationRuns,
  pauseOptimizationRun,
  resumeOptimizationRun,
  subscribeOptimizationEvents
} from "../../../data/optimizationApi.js";

export default function MonitorControl({ workspaceId }) {
  const optimizationApiEnabled = isOptimizationApiEnabled();
  const [confirmStop, setConfirmStop] = useState(false);
  const [run, setRun] = useState(null);
  const [apiError, setApiError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadWorkspaceRun = async () => {
    try {
      const payload = await listOptimizationRuns({ workspaceId, page: 1, pageSize: 100 });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      if (!items.length) {
        setRun(null);
        setApiError("");
        return;
      }
      const preferred = items.find((item) => ["running", "pausing", "paused", "queued"].includes(String(item.status || "").toLowerCase())) || items[0];
      setRun(preferred || null);
      setApiError("");
    } catch (error) {
      setApiError(error?.message || "Failed to load run detail");
    }
  };

  useEffect(() => {
    if (!optimizationApiEnabled) return undefined;
    let active = true;
    void loadWorkspaceRun();
    const unsubscribe = subscribeOptimizationEvents({
      onEvent: () => {
        if (!active) return;
        void loadWorkspaceRun();
      },
      onError: () => {
        if (!active) return;
        void loadWorkspaceRun();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [optimizationApiEnabled, workspaceId]);

  const mockDetail = getRunDetail(workspaceId);
  const useMockFallback = !optimizationApiEnabled || (!!apiError && !run);
  const detail = useMemo(() => {
    if (useMockFallback) return mockDetail;
    if (!run) {
      return {
        status: "-",
        iteration: "-",
        currentStage: "-",
        eta: "-",
        progress: 0,
        runId: ""
      };
    }
    return {
      status: String(run.status || "-").toLowerCase(),
      iteration: `${Math.round(Number(run.progress || 0))}%`,
      currentStage: run.current_stage || "-",
      eta: "-",
      progress: Number(run.progress || 0),
      runId: run.run_id || ""
    };
  }, [useMockFallback, mockDetail, run]);

  const handleStop = async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }

    if (useMockFallback) {
      updateWorkspaceStatus(workspaceId, "completed");
      setConfirmStop(false);
      return;
    }

    if (!detail.runId) {
      setActionError("No active run found for this workspace");
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      await cancelOptimizationRun(detail.runId);
      await loadWorkspaceRun();
      setConfirmStop(false);
    } catch (error) {
      setActionError(error?.message || "Cancel run failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePauseOrResume = async () => {
    if (useMockFallback || !detail.runId) return;
    setBusy(true);
    setActionError("");
    try {
      if (detail.status === "running" || detail.status === "pausing") {
        await pauseOptimizationRun(detail.runId, "paused from control page");
      } else if (detail.status === "paused") {
        await resumeOptimizationRun(detail.runId);
      }
      await loadWorkspaceRun();
    } catch (error) {
      setActionError(error?.message || "Pause/Resume failed");
    } finally {
      setBusy(false);
    }
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
          <p className="summary-label">Progress</p>
          <p className="summary-value">{detail.iteration}</p>
        </div>
        <div>
          <p className="summary-label">Current Stage</p>
          <p className="summary-value">{detail.currentStage}</p>
        </div>
        <div>
          <p className="summary-label">ETA</p>
          <p className="summary-value">{detail.eta}</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Control Center</h3>
          <span className="chip">Double confirmation required</span>
        </div>
        {optimizationApiEnabled && apiError ? <div className="panel-note">{apiError}</div> : null}
        {actionError ? <div className="panel-note">{actionError}</div> : null}
        <div className="control-grid">
          <div className="control-card">
            <p className="summary-label">Stop Run</p>
            <p className="summary-value">Immediately stop and mark run canceled.</p>
            <div className="inline-actions">
              <button className="danger-button" onClick={handleStop} disabled={busy}>
                {confirmStop ? "Confirm Stop" : "Stop"}
              </button>
              {confirmStop && (
                <button className="ghost-button" onClick={() => setConfirmStop(false)} disabled={busy}>
                  Cancel
                </button>
              )}
            </div>
          </div>
          {optimizationApiEnabled && !useMockFallback ? (
            <div className="control-card">
              <p className="summary-label">Pause / Resume</p>
              <p className="summary-value">Collaborative pause at safe point, then resume to queue.</p>
              <div className="inline-actions">
                <button
                  className="ghost-button"
                  onClick={handlePauseOrResume}
                  disabled={busy || !detail.runId || !["running", "pausing", "paused"].includes(detail.status)}
                >
                  {detail.status === "paused" ? "Resume" : "Pause"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
