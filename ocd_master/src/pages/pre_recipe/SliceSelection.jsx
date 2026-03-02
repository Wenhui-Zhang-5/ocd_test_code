import React, { useEffect, useMemo, useState } from "react";
import MultiSelectDropdown from "../../components/MultiSelectDropdown.jsx";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import {
  fetchTemPlanOutput,
  getSpectrumSelection,
  getTemSelection,
  loadRecipeSchema,
  saveRecipeSchema,
  setTemSelection
} from "../../data/mockApi.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";
import { waferIds } from "../../data/mock.js";

export default function SliceSelection({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState("Balanced");
  const [trimRadius, setTrimRadius] = useState(148);
  const [centerBoundary, setCenterBoundary] = useState(50);
  const [middleBoundary, setMiddleBoundary] = useState(100);
  const [edgeBoundary, setEdgeBoundary] = useState(148);
  const spectrumSelection = getSpectrumSelection(workspaceId);
  const availableWafers = useMemo(
    () => (spectrumSelection?.waferIds?.length ? spectrumSelection.waferIds : waferIds),
    [spectrumSelection]
  );
  const [quotaWafers, setQuotaWafers] = useState(availableWafers);
  const [centerQuotas, setCenterQuotas] = useState({});
  const [middleQuotas, setMiddleQuotas] = useState({});
  const [edgeQuotas, setEdgeQuotas] = useState({});
  const [planOutput, setPlanOutput] = useState([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");

  const buildTemSelectionPayload = (nextPlanOutput = planOutput) => ({
    algorithm: selectedAlgorithm,
    basicConfig: {
      trimRadius,
      centerBoundary,
      middleBoundary,
      edgeBoundary
    },
    quotas: quotaWafers.map((waferId) => ({
      waferId,
      center: centerQuotas[waferId] ?? 1,
      middle: middleQuotas[waferId] ?? 1,
      edge: edgeQuotas[waferId] ?? 1
    })),
    planOutput: nextPlanOutput
  });

  const updateQuota = (setter, waferId, value) => {
    setter((prev) => ({ ...prev, [waferId]: value }));
  };

  useEffect(() => {
    setQuotaWafers(availableWafers);
  }, [availableWafers]);

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId);
    const saved = schema?.temSelection || getTemSelection();
    if (!saved) return;
    if (saved.algorithm) setSelectedAlgorithm(saved.algorithm);
    if (saved.basicConfig) {
      setTrimRadius(saved.basicConfig.trimRadius ?? trimRadius);
      setCenterBoundary(saved.basicConfig.centerBoundary ?? centerBoundary);
      setMiddleBoundary(saved.basicConfig.middleBoundary ?? middleBoundary);
      setEdgeBoundary(saved.basicConfig.edgeBoundary ?? edgeBoundary);
    }
    if (Array.isArray(saved.quotas) && saved.quotas.length) {
      const wafers = saved.quotas.map((item) => item.waferId);
      setQuotaWafers(wafers);
      const center = {};
      const middle = {};
      const edge = {};
      saved.quotas.forEach((item) => {
        center[item.waferId] = item.center ?? 1;
        middle[item.waferId] = item.middle ?? 1;
        edge[item.waferId] = item.edge ?? 1;
      });
      setCenterQuotas(center);
      setMiddleQuotas(middle);
      setEdgeQuotas(edge);
    }
    if (Array.isArray(saved.planOutput) && saved.planOutput.length) {
      setPlanOutput(saved.planOutput);
    }
  }, [workspaceId]);

  const handleGeneratePlan = async () => {
    const quotasPayload = quotaWafers.map((waferId) => ({
      waferId,
      center: Number(centerQuotas[waferId] ?? 1),
      middle: Number(middleQuotas[waferId] ?? 1),
      edge: Number(edgeQuotas[waferId] ?? 1)
    }));
    setPlanLoading(true);
    setPlanError("");
    try {
      const result = await fetchTemPlanOutput({
        algorithm: selectedAlgorithm,
        quotas: quotasPayload,
        config: {
          trimRadius,
          centerBoundary,
          middleBoundary,
          edgeBoundary
        }
      });
      setPlanOutput(result);
      setTemSelection(buildTemSelectionPayload(result));
    } catch (error) {
      setPlanError("Failed to generate TEM plan.");
    } finally {
      setPlanLoading(false);
    }
  };

  const handleSaveStep = () => {
    const payload = buildTemSelectionPayload();
    setTemSelection(payload);
    if (!workspaceId) return true;
    saveRecipeSchema(workspaceId, {
      temSelection: payload
    });
    return true;
  };

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Pre-Recipe</p>
          <h2>TEM Selection Workbench</h2>
          <p className="subtle">
            Configure spatial constraints and pick TEM points with linked spectrum highlight.
          </p>
        </div>
        <div />
      </header>

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h3>Basic Configuration</h3>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Trim Radius (mm)</label>
              <input type="number" value={trimRadius} onChange={(event) => setTrimRadius(event.target.value)} />
            </div>
            <div className="form-row">
              <label>Center Boundary (mm)</label>
              <input type="number" value={centerBoundary} onChange={(event) => setCenterBoundary(event.target.value)} />
            </div>
            <div className="form-row">
              <label>Middle Boundary (mm)</label>
              <input type="number" value={middleBoundary} onChange={(event) => setMiddleBoundary(event.target.value)} />
            </div>
            <div className="form-row">
              <label>Edge Boundary (mm)</label>
              <input type="number" value={edgeBoundary} onChange={(event) => setEdgeBoundary(event.target.value)} />
            </div>
          </div>
          <div className="panel-note">
            Boundaries are formatted as Center (0 to value), Middle (center to value), Edge (middle to trim radius).
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <h3>Wafer Region Quotas</h3>
          </div>
          <div className="form-row">
            <label>WaferID (multi)</label>
            <MultiSelectDropdown
              label="WaferID"
              options={availableWafers.map((id) => ({ value: id, label: id }))}
              value={quotaWafers}
              onChange={setQuotaWafers}
              enableSelectAll
              selectAllLabel="Select All"
            />
          </div>
          <div className="table">
            <div className="table-row table-head">
              <span>Wafer</span>
              <span>Center</span>
              <span>Middle</span>
              <span>Edge</span>
            </div>
            {quotaWafers.map((waferId) => (
              <div className="table-row" key={waferId}>
                <span>{waferId}</span>
                <input
                  type="number"
                  value={centerQuotas[waferId] ?? 1}
                  onChange={(event) => updateQuota(setCenterQuotas, waferId, event.target.value)}
                />
                <input
                  type="number"
                  value={middleQuotas[waferId] ?? 1}
                  onChange={(event) => updateQuota(setMiddleQuotas, waferId, event.target.value)}
                />
                <input
                  type="number"
                  value={edgeQuotas[waferId] ?? 1}
                  onChange={(event) => updateQuota(setEdgeQuotas, waferId, event.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="panel-note">Each wafer maintains its own quota counts.</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Algorithm Selection</h3>
          <span className="chip">Choose method</span>
        </div>
        <div className="form-grid two-col">
          <div className="form-row">
            <label>Method</label>
            <select
              value={selectedAlgorithm}
              onChange={(event) => setSelectedAlgorithm(event.target.value)}
            >
              {["Balanced", "Center Focus", "Edge Focus", "Randomized"].map((algo) => (
                <option key={algo} value={algo}>{algo}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Apply</label>
            <button className="primary-button" onClick={handleGeneratePlan} disabled={planLoading}>
              {planLoading ? "Generating..." : "Apply"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h3>Spectrum View</h3>
            <div className="inline-actions">
              <button className="ghost-button">Highlight Plan</button>
              <button className="ghost-button">Single Point</button>
            </div>
          </div>
          <div className="plot-placeholder">Plotly Spectrum Container</div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <h3>Wafer Spatial View</h3>
            <div className="inline-actions">
              <button className="ghost-button">Show Rings</button>
              <button className="ghost-button">Highlight Point</button>
            </div>
          </div>
          <div className="plot-placeholder">2D Wafer Map Placeholder</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>TEM Plan Output</h3>
          <button className="ghost-button">Save Plan</button>
        </div>
        {planError ? <p className="panel-note">{planError}</p> : null}
        {planOutput.length ? (
          <div className="table">
            <div className="table-row table-head">
              <span>Wafer ID</span>
              <span>Spectrum ID</span>
              <span>Loc X</span>
              <span>Loc Y</span>
              <span>Distance to Middle</span>
            </div>
            {planOutput.map((row, index) => (
              <div className="table-row" key={`${row.waferId}-${row.spectrumId}-${index}`}>
                <span>{row.waferId}</span>
                <span>{row.spectrumId}</span>
                <span>{row.x}</span>
                <span>{row.y}</span>
                <span>{row.distance}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="plot-placeholder">Generate plan to view TEM output.</div>
        )}
      </section>
      <WorkflowFooter workspaceId={workspaceId} onSave={handleSaveStep} readOnly={readOnly} />
    </div>
  );
}
