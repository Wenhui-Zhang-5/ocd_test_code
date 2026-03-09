import React, { useEffect, useMemo, useState } from "react";
import {
  getRunResultJson,
  isOptimizationApiEnabled,
  listRunResultFiles,
  subscribeOptimizationEvents
} from "../../../data/optimizationApi.js";
import { loadWorkspacePreferredRun } from "../../../data/optimizationView.js";
import { NkChart, RegressionChart, SpectrumChart } from "../../../components/OptimizationCharts.jsx";

const TRACE_TABS = [
  { key: "seed_search", label: "seed_search" },
  { key: "fitting", label: "fitting" },
  { key: "precision", label: "precision" },
  { key: "sensitivity", label: "sensitivity" },
  { key: "final_regression", label: "final_regression" }
];

const stageOfPath = (relativePath) => {
  const text = String(relativePath || "").replaceAll("\\", "/");
  if (text.startsWith("seed_search/")) return "seed_search";
  if (text.startsWith("fitting/")) return "fitting";
  if (text.startsWith("precision/")) return "precision";
  if (text.startsWith("sensitivity/")) return "sensitivity";
  if (text.startsWith("final_regression/")) return "final_regression";
  return "other";
};

const pathBaseName = (relativePath) => {
  const text = String(relativePath || "").replaceAll("\\", "/");
  const parts = text.split("/");
  return (parts[parts.length - 1] || "").toLowerCase();
};

const isSnapshotCandidate = (stage, relativePath) => {
  const base = pathBaseName(relativePath);
  if (!base.endsWith(".json")) return false;
  if (stage === "seed_search") {
    if (base === "latest.json" || base === "top_seeds.json") return true;
    return /^seed_\d+\.json$/.test(base);
  }
  if (stage === "fitting") return base.endsWith(".latest.json") || base.endsWith(".summary.json");
  if (stage === "precision") return base.endsWith(".summary.json");
  if (stage === "sensitivity") return base.endsWith(".latest.json") || /^seed_\d+\.json$/.test(base);
  return false;
};

const toNumber = (value, fallback = null) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const pickPayload = (data) => {
  if (!data || typeof data !== "object") return {};
  if (data.event && typeof data.event === "object") return data.event;
  return data;
};

const extractCoupling = (relativePath, rawData) => {
  const fromData = toNumber(rawData?.coupling_index, null);
  if (fromData !== null) return fromData;
  const match = String(relativePath || "").match(/coupling_(\d+)/i);
  return match ? Number(match[1]) : null;
};

const extractSeedId = (relativePath, rawData) => {
  const fromData = String(rawData?.seed_id || rawData?.seedId || "").trim();
  if (fromData) return fromData;
  const text = String(relativePath || "");
  let match = text.match(/\/(seed_[^\/.]+)\//i);
  if (match?.[1]) return match[1];
  match = text.match(/(seed_[^\/.]+)\.(?:latest|summary)\.json$/i);
  if (match?.[1]) return match[1];
  return "";
};

const extractGridIndex = (relativePath, rawData) => {
  const fromData = toNumber(rawData?.grid_index, null);
  if (fromData !== null) return fromData;
  const match = String(relativePath || "").match(/grid_(\d+)/i);
  return match ? Number(match[1]) : null;
};

const rowSort = (stage, a, b) => {
  const ca = Number.isFinite(a.couplingIndex) ? a.couplingIndex : 9999;
  const cb = Number.isFinite(b.couplingIndex) ? b.couplingIndex : 9999;
  if (ca !== cb) return ca - cb;

  const sa = String(a.seedId || "");
  const sb = String(b.seedId || "");
  if (sa !== sb) return sa.localeCompare(sb);

  if (stage === "final_regression") {
    const ga = Number.isFinite(a.gridIndex) ? a.gridIndex : 9999;
    const gb = Number.isFinite(b.gridIndex) ? b.gridIndex : 9999;
    if (ga !== gb) return ga - gb;
  }

  return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
};

const buildNkSnapshotFromModel = (modelJson) => {
  if (!modelJson || typeof modelJson !== "object") return null;
  const content = modelJson.content;
  const rows = content && typeof content === "object" ? content.mat : [];
  if (!Array.isArray(rows) || !rows.length) return null;
  const materials = {};
  rows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const material = String(row.material || "").trim();
    const model = String(row.model || "").trim();
    const name = String(row.name || "").trim();
    const value = Number(row.valueNew ?? row.value);
    if (!material || !model || !name || !Number.isFinite(value)) return;
    if (!materials[material]) materials[material] = {};
    if (!materials[material][model]) materials[material][model] = {};
    materials[material][model][name] = value;
  });
  return Object.keys(materials).length ? { materials } : null;
};

const extractRegressionPerCd = (payload, rawData) => {
  if (payload?.result?.regression_per_cd && typeof payload.result.regression_per_cd === "object") {
    return payload.result.regression_per_cd;
  }
  if (payload?.regression_per_cd && typeof payload.regression_per_cd === "object") {
    return payload.regression_per_cd;
  }
  if (rawData?.regression_per_cd && typeof rawData.regression_per_cd === "object") {
    return rawData.regression_per_cd;
  }
  if (rawData?.final_stage?.result?.regression_per_cd && typeof rawData.final_stage.result.regression_per_cd === "object") {
    return rawData.final_stage.result.regression_per_cd;
  }
  return {};
};

const spectrumFromSensitivity = (rawData) => {
  if (!rawData || typeof rawData !== "object") return null;
  const baseline = rawData.baseline_spectrum;
  const perCd = rawData.per_cd_curves && typeof rawData.per_cd_curves === "object" ? rawData.per_cd_curves : {};
  const cdNames = Object.keys(perCd);
  if (!baseline || !cdNames.length) return null;
  const first = perCd[cdNames[0]];
  if (!first?.plus) return null;
  return {
    wavelength: baseline.wavelength || [],
    baseline: baseline.channels || {},
    simulated: first.plus.channels || {}
  };
};

const finalEventFromRow = (row, idx) => {
  const payload = row?.event && typeof row.event === "object" ? row.event : row || {};
  return {
    index: idx,
    kind: String(payload.kind || "event"),
    iteration: toNumber(payload.iteration, null),
    material: String(payload.material || "").trim(),
    step: String(payload.step || "").trim(),
    accepted:
      typeof payload.accepted === "boolean"
        ? payload.accepted
        : typeof payload.result?.passed === "boolean"
        ? payload.result.passed
        : null,
    baselineGof:
      toNumber(payload.baseline_gof_new, null) ??
      toNumber(payload.baseline_gof, null) ??
      toNumber(payload.result?.baseline_gof, null),
    updatedAt: String(row?.updated_at || row?.updatedAt || ""),
    payload
  };
};

export default function MonitorTrace({ workspaceId }) {
  const optimizationApiEnabled = isOptimizationApiEnabled();
  const [run, setRun] = useState(null);
  const [activeTab, setActiveTab] = useState("final_regression");
  const [rows, setRows] = useState([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [finalEvents, setFinalEvents] = useState([]);
  const [selectedFinalEventIndex, setSelectedFinalEventIndex] = useState(null);
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

      if (activeTab === "final_regression") {
        const indexPayload = await listRunResultFiles(preferredRun.run_id, {
          contains: "final_regression",
          suffix: ".summary.json",
          limit: 3000
        });
        const files = Array.isArray(indexPayload?.items) ? indexPayload.items : [];
        const loaded = await Promise.all(
          files.map(async (file) => {
            try {
              const payload = await getRunResultJson(preferredRun.run_id, file.relative_path);
              const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
              return {
                relativePath: file.relative_path,
                updatedAt: String(data.updated_at || file.modified_at || ""),
                modifiedAt: file.modified_at || "",
                stage: "final_regression",
                kind: "grid_summary",
                couplingIndex: extractCoupling(file.relative_path, data),
                seedId: extractSeedId(file.relative_path, data),
                gridIndex: extractGridIndex(file.relative_path, data),
                payload: pickPayload(data),
                rawData: data
              };
            } catch (err) {
              return null;
            }
          })
        );
        const valid = loaded.filter(Boolean).sort((a, b) => rowSort("final_regression", a, b));
        setRows(valid);
      } else {
        const indexPayload = await listRunResultFiles(preferredRun.run_id, {
          suffix: ".json",
          limit: 5000
        });
        const files = Array.isArray(indexPayload?.items) ? indexPayload.items : [];
        const candidates = files.filter((file) => {
          const stage = stageOfPath(file.relative_path);
          if (stage !== activeTab) return false;
          return isSnapshotCandidate(stage, file.relative_path);
        });
        const loaded = await Promise.all(
          candidates.map(async (file) => {
            try {
              const payload = await getRunResultJson(preferredRun.run_id, file.relative_path);
              const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
              const eventPayload = pickPayload(data);
              return {
                relativePath: file.relative_path,
                updatedAt: String(data.updated_at || eventPayload.updated_at || file.modified_at || ""),
                modifiedAt: file.modified_at || "",
                stage: activeTab,
                kind: String(eventPayload.kind || data.kind || "snapshot"),
                couplingIndex: extractCoupling(file.relative_path, data),
                seedId: extractSeedId(file.relative_path, data),
                gridIndex: extractGridIndex(file.relative_path, data),
                payload: eventPayload,
                rawData: data
              };
            } catch (err) {
              return null;
            }
          })
        );
        const valid = loaded.filter(Boolean).sort((a, b) => rowSort(activeTab, a, b));
        setRows(valid);
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load trace data");
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
  }, [optimizationApiEnabled, workspaceId, activeTab]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedPath("");
      return;
    }
    const exists = rows.some((row) => row.relativePath === selectedPath);
    if (!exists) {
      setSelectedPath(rows[0].relativePath);
    }
  }, [rows, selectedPath]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.relativePath === selectedPath) || rows[0] || null,
    [rows, selectedPath]
  );

  useEffect(() => {
    if (!run?.run_id || activeTab !== "final_regression" || !selectedRow) {
      setFinalEvents([]);
      setSelectedFinalEventIndex(null);
      return;
    }
    const loadFinalEvents = async () => {
      try {
        const eventsPath = selectedRow.relativePath.replace(/\.summary\.json$/i, ".events.jsonl");
        const payload = await getRunResultJson(run.run_id, eventsPath, { tail: 3000 });
        const list = Array.isArray(payload?.data) ? payload.data : [];
        const parsed = list.map((item, idx) => finalEventFromRow(item, idx));
        setFinalEvents(parsed);
        if (parsed.length > 0) {
          setSelectedFinalEventIndex(parsed.length - 1);
        } else {
          setSelectedFinalEventIndex(null);
        }
      } catch (err) {
        setFinalEvents([]);
        setSelectedFinalEventIndex(null);
      }
    };
    void loadFinalEvents();
  }, [activeTab, run?.run_id, selectedRow]);

  const selectedFinalEvent = useMemo(() => {
    if (!finalEvents.length) return null;
    if (selectedFinalEventIndex === null) return finalEvents[finalEvents.length - 1];
    return finalEvents.find((evt) => evt.index === selectedFinalEventIndex) || finalEvents[finalEvents.length - 1];
  }, [finalEvents, selectedFinalEventIndex]);

  const selectedSpectrum = useMemo(() => {
    if (activeTab === "final_regression") {
      const payload = selectedFinalEvent?.payload;
      return payload?.spectrum_fit || null;
    }
    const fromRow = selectedRow?.payload?.spectrum_fit || selectedRow?.rawData?.spectrum_fit || selectedRow?.rawData?.fitting_spectrum || null;
    return fromRow;
  }, [activeTab, selectedFinalEvent, selectedRow]);

  const selectedPlotData = useMemo(() => {
    if (activeTab === "sensitivity") {
      return spectrumFromSensitivity(selectedRow?.rawData);
    }
    if (activeTab === "seed_search") {
      return selectedRow?.rawData?.plot_data || null;
    }
    return null;
  }, [activeTab, selectedRow]);

  const selectedNk = useMemo(() => {
    if (activeTab === "final_regression") {
      const payload = selectedFinalEvent?.payload;
      const fromEvent = payload?.nk_snapshot || null;
      if (fromEvent) return fromEvent;
      return buildNkSnapshotFromModel(payload?.model_json || payload?.result?.model_json || null);
    }
    const fromRow = selectedRow?.payload?.nk_snapshot || selectedRow?.rawData?.nk_snapshot || null;
    if (fromRow) return fromRow;
    return buildNkSnapshotFromModel(selectedRow?.payload?.model_json || selectedRow?.rawData?.model_json || null);
  }, [activeTab, selectedFinalEvent, selectedRow]);

  const selectedRegression = useMemo(() => {
    if (activeTab === "final_regression") {
      return extractRegressionPerCd(selectedFinalEvent?.payload || {}, selectedRow?.rawData || {});
    }
    return extractRegressionPerCd(selectedRow?.payload || {}, selectedRow?.rawData || {});
  }, [activeTab, selectedFinalEvent, selectedRow]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Monitor</p>
          <h2>Trace</h2>
          <p className="subtle">`final_regression` uses grid as the top item, then expands by iteration/material/step.</p>
        </div>
      </header>

      <section className="panel trace-layout">
        <div className="panel-header">
          <h3>Trace Viewer</h3>
          <span className="chip">{run?.run_id ? `Run ${run.run_id}` : "No Run"}</span>
        </div>
        <div className="inline-actions">
          {TRACE_TABS.map((tab) => (
            <button
              key={tab.key}
              className={activeTab === tab.key ? "primary-button" : "ghost-button"}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {!optimizationApiEnabled ? (
          <div className="panel-note">Optimization API is disabled by env. Enable `VITE_ENABLE_OPTIMIZATION_API=1`.</div>
        ) : null}
        {error ? <div className="panel-note">{error}</div> : null}
        {loading ? <div className="panel-note">Loading trace data...</div> : null}

        <div className="trace-layout-grid">
          <div className="trace-tree">
            <div className="table">
              <div className="table-row table-head">
                <span>Coupling</span>
                <span>Seed</span>
                <span>Grid</span>
                <span>Kind</span>
                <span>Updated</span>
                <span>Path</span>
              </div>
              {rows.map((row) => (
                <button
                  key={row.relativePath}
                  className={`table-row ${selectedRow?.relativePath === row.relativePath ? "trace-row-active" : ""}`}
                  onClick={() => setSelectedPath(row.relativePath)}
                >
                  <span>{Number.isFinite(row.couplingIndex) ? row.couplingIndex : "-"}</span>
                  <span>{row.seedId || "-"}</span>
                  <span>{Number.isFinite(row.gridIndex) ? row.gridIndex : "-"}</span>
                  <span>{row.kind}</span>
                  <span>{row.updatedAt || row.modifiedAt || "-"}</span>
                  <span>{row.relativePath}</span>
                </button>
              ))}
              {!rows.length && !loading ? (
                <div className="table-row">
                  <span>-</span>
                  <span>-</span>
                  <span>-</span>
                  <span>No data</span>
                  <span>-</span>
                  <span>-</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="trace-detail">
            <div className="detail-header">
              <span>Detail</span>
              {selectedRow ? (
                <span className="chip chip-muted">
                  coupling {Number.isFinite(selectedRow.couplingIndex) ? selectedRow.couplingIndex : "-"}
                  {selectedRow.seedId ? ` / ${selectedRow.seedId}` : ""}
                  {Number.isFinite(selectedRow.gridIndex) ? ` / grid ${selectedRow.gridIndex}` : ""}
                </span>
              ) : null}
            </div>
            {selectedRow ? (
              <>
                <div className="trace-detail-meta">
                  <h4>{selectedRow.relativePath}</h4>
                  <span className="status-pill status-running">{selectedRow.updatedAt || "-"}</span>
                </div>

                {activeTab === "final_regression" ? (
                  <div className="detail-section">
                    <div className="detail-section-header">Iteration / Material / Step</div>
                    <div className="table">
                      <div className="table-row table-head">
                        <span>#</span>
                        <span>Kind</span>
                        <span>Iteration</span>
                        <span>Material</span>
                        <span>Step</span>
                        <span>Accepted</span>
                        <span>Baseline GOF</span>
                      </div>
                      {finalEvents.map((evt) => (
                        <button
                          key={`${evt.index}-${evt.kind}`}
                          className={`table-row ${selectedFinalEvent?.index === evt.index ? "trace-row-active" : ""}`}
                          onClick={() => setSelectedFinalEventIndex(evt.index)}
                        >
                          <span>{evt.index + 1}</span>
                          <span>{evt.kind}</span>
                          <span>{evt.iteration ?? "-"}</span>
                          <span>{evt.material || "-"}</span>
                          <span>{evt.step || "-"}</span>
                          <span>{evt.accepted === null ? "-" : evt.accepted ? "yes" : "no"}</span>
                          <span>{evt.baselineGof ?? "-"}</span>
                        </button>
                      ))}
                      {!finalEvents.length ? (
                        <div className="table-row">
                          <span>-</span>
                          <span>No events</span>
                          <span>-</span>
                          <span>-</span>
                          <span>-</span>
                          <span>-</span>
                          <span>-</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <SpectrumChart spectrumFit={selectedSpectrum} plotData={selectedPlotData} />
                <RegressionChart regressionPerCd={selectedRegression} />
                <NkChart nkSnapshot={selectedNk} />
              </>
            ) : (
              <p className="summary-label">No item selected.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

