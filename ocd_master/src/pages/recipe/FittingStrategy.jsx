import React, { useEffect, useMemo, useState } from "react";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import { fetchNkMaterialOrder, loadRecipeSchema, saveRecipeSchema } from "../../data/mockApi.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";

const hoColumns = ["Amp", "En", "Eg", "Phi", "Nu"];
const cauchyColumns = ["A", "B", "C", "E", "F", "G"];
const normalizeMaterial = (name) => (name ? name.split("_")[0] : "");

const buildStepPreview = (mode, rows, columns) => {
  if (!columns.length) return [];
  if (mode === "column") {
    return columns.map((col, index) => ({ step: `Step ${index + 1}`, summary: `Column: ${col}` }));
  }
  if (mode === "row") {
    return Array.from({ length: rows }).map((_, index) => ({
      step: `Step ${index + 1}`,
      summary: `Row: ${rows > 1 ? `Osc ${index + 1}` : "Params"}`
    }));
  }
  return [
    { step: "Step 1", summary: "Custom cells" }
  ];
};

const toTarget = (materialName, modelName, paramName) => ({
  material: materialName,
  model: modelName,
  name: paramName
});

const buildOscillatorExecutionSteps = ({ material, mode, customSteps, useCustomSteps }) => {
  if (!material) return [];
  if (material.type === "Cauchy") {
    const params = Object.keys(material.cauchy || {});
    if (useCustomSteps) {
      return (customSteps || []).map((step, index) => {
        const targets = (step.cells || [])
          .map((cell) => {
            const [rowPart, paramName] = String(cell).split("-");
            const rowIndex = Number(rowPart);
            if (Number.isNaN(rowIndex) || rowIndex !== 0) return null;
            if (!params.includes(paramName)) return null;
            return toTarget(material.name, "Cauchy", paramName);
          })
          .filter(Boolean);
        return {
          name: step.name || `Step ${index + 1}`,
          targets
        };
      });
    }
    return [
      {
        name: "Step 1",
        targets: params.map((paramName) => toTarget(material.name, "Cauchy", paramName))
      }
    ];
  }
  const oscillatorNames = Array.from({ length: material.oscillators || 1 }).map((_, index) => {
    const key = index + 1;
    return material.oscillatorNames?.[key] || `HarmonicsOSC-${key}`;
  });
  if (mode === "column") {
    return hoColumns.map((column, index) => ({
      name: `Step ${index + 1}`,
      targets: oscillatorNames
        .map((modelName, rowIndex) => {
          const rowData = material.ho?.[rowIndex + 1] || {};
          if (!(column in rowData)) return null;
          return toTarget(material.name, modelName, column);
        })
        .filter(Boolean)
    }));
  }
  if (mode === "row") {
    return oscillatorNames.map((oscillator, index) => ({
      name: `Step ${index + 1}`,
      targets: Object.keys(material.ho?.[index + 1] || {}).map((paramName) =>
        toTarget(material.name, oscillator, paramName)
      )
    }));
  }
  if (!useCustomSteps) {
    return oscillatorNames.map((oscillator, index) => ({
      name: `Step ${index + 1}`,
      targets: Object.keys(material.ho?.[index + 1] || {}).map((paramName) =>
        toTarget(material.name, oscillator, paramName)
      )
    }));
  }
  return (customSteps || []).map((step, index) => {
    const targets = (step.cells || [])
      .map((cell) => {
        const [rowPart, paramName] = String(cell).split("-");
        const rowIndex = Number(rowPart);
        if (Number.isNaN(rowIndex)) return null;
        const modelName = oscillatorNames[rowIndex];
        if (!modelName) return null;
        const rowData = material.ho?.[rowIndex + 1] || {};
        if (!(paramName in rowData)) return null;
        return toTarget(material.name, modelName, paramName);
      })
      .filter(Boolean);
    return {
      name: step.name || `Step ${index + 1}`,
      targets
    };
  });
};

export default function FittingStrategy({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const [iterationNotice, setIterationNotice] = useState("");
  const [materials, setMaterials] = useState([]);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [materialData, setMaterialData] = useState({});
  const [mode, setMode] = useState("column");
  const [dragIndex, setDragIndex] = useState(null);
  const [customSteps, setCustomSteps] = useState([
    { name: "Step 1", cells: [] }
  ]);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [showGlobal, setShowGlobal] = useState(false);
  const [enableSensitivity, setEnableSensitivity] = useState(false);
  const [sensitivityMin, setSensitivityMin] = useState("0.5");
  const [sensitivityMax, setSensitivityMax] = useState("3");
  const [sensitivityWindow, setSensitivityWindow] = useState("10");
  const [topNSeed, setTopNSeed] = useState(5);
  const [earlyStopEnabled, setEarlyStopEnabled] = useState(false);
  const [earlyStopCount, setEarlyStopCount] = useState(1);
  const [fittingIteration, setFittingIteration] = useState(1);
  const [linearIteration, setLinearIteration] = useState(2);
  const [estimatedTime, setEstimatedTime] = useState("2h 10m");
  const selectedMeta = selectedMaterial ? materialData[selectedMaterial.name] : null;
  const tableColumns = selectedMeta?.type === "Cauchy" ? cauchyColumns : hoColumns;
  const rowCount = selectedMeta?.type === "Cauchy" ? 1 : selectedMeta?.oscillators || 1;
  const stepPreview = useMemo(
    () => buildStepPreview(mode, rowCount, tableColumns),
    [mode, rowCount, tableColumns]
  );

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId);
    const modelJson = schema?.model?.modelJson;
    const entries = modelJson?.content?.mat || [];
    if (!entries.length) return;

    const map = {};
    entries.forEach((item) => {
      const name = item.material;
      if (!name) return;
      if (!map[name]) {
        map[name] = { name, type: "HO", oscillators: 0, oscillatorNames: {}, ho: {}, cauchy: {} };
      }
      const modelName = String(item.model || "");
      if (/cauchy/i.test(modelName)) {
        map[name].type = "Cauchy";
        map[name].cauchy[item.name] = item.value ?? "";
        return;
      }
      const match = modelName.match(/OSC-(\d+)/i);
      const oscIndex = match ? Number(match[1]) : 1;
      if (!map[name].ho[oscIndex]) map[name].ho[oscIndex] = {};
      map[name].ho[oscIndex][item.name] = item.value ?? "";
      map[name].oscillatorNames[oscIndex] = modelName || `HarmonicsOSC-${oscIndex}`;
      if (oscIndex > map[name].oscillators) {
        map[name].oscillators = oscIndex;
      }
    });

    let list = Object.values(map);
    const saved = schema?.fittingStrategy?.materialOrder;
    if (saved && saved.length) {
      const savedMap = saved.reduce((acc, name, idx) => {
        acc[name] = idx;
        return acc;
      }, {});
      list = list.sort((a, b) => {
        const aIdx = savedMap[a.name];
        const bIdx = savedMap[b.name];
        if (aIdx === undefined && bIdx === undefined) return 0;
        if (aIdx === undefined) return 1;
        if (bIdx === undefined) return -1;
        return aIdx - bIdx;
      });
      setMaterials(list);
      if (!selectedMaterial && list.length) setSelectedMaterial(list[0]);
    } else {
      fetchNkMaterialOrder().then((order) => {
        const orderMap = order.reduce((acc, item, idx) => {
          acc[item] = idx;
          return acc;
        }, {});
        const sorted = [...list].sort((a, b) => {
          const aKey = normalizeMaterial(a.name);
          const bKey = normalizeMaterial(b.name);
          const aIdx = orderMap[aKey] ?? 999;
          const bIdx = orderMap[bKey] ?? 999;
          return aIdx - bIdx;
        });
        setMaterials(sorted);
        if (!selectedMaterial && sorted.length) setSelectedMaterial(sorted[0]);
      });
    }
    setMaterialData(map);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId);
    const saved = schema?.fittingStrategy;
    if (!saved) return;
    if (saved.mode) setMode(saved.mode);
    if (Array.isArray(saved.customSteps)) setCustomSteps(saved.customSteps);
    if (typeof saved.activeStepIndex === "number") setActiveStepIndex(saved.activeStepIndex);
    if (saved.globalSettings) {
      const settings = saved.globalSettings;
      if (settings.enableSensitivity !== undefined) setEnableSensitivity(settings.enableSensitivity);
      if (settings.sensitivityMin !== undefined) setSensitivityMin(String(settings.sensitivityMin));
      if (settings.sensitivityMax !== undefined) setSensitivityMax(String(settings.sensitivityMax));
      if (settings.sensitivityWindow !== undefined) setSensitivityWindow(String(settings.sensitivityWindow));
      if (settings.topNSeed !== undefined) setTopNSeed(Number(settings.topNSeed));
      if (settings.earlyStopEnabled !== undefined) setEarlyStopEnabled(settings.earlyStopEnabled);
      if (settings.earlyStopCount !== undefined) setEarlyStopCount(Number(settings.earlyStopCount));
      if (settings.fittingIteration !== undefined) setFittingIteration(Number(settings.fittingIteration));
      if (settings.linearIteration !== undefined) setLinearIteration(Number(settings.linearIteration));
      if (settings.estimatedTime !== undefined) setEstimatedTime(String(settings.estimatedTime));
    }
  }, [workspaceId]);

  const handleDrop = (targetIndex) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      return;
    }
    const next = [...materials];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    setMaterials(next);
    setDragIndex(null);
  };

  const addCustomStep = () => {
    setCustomSteps((prev) => {
      const next = [...prev, { name: `Step ${prev.length + 1}`, cells: [] }];
      setActiveStepIndex(next.length - 1);
      return next;
    });
  };

  const removeCustomStep = () => {
    setCustomSteps((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      const trimmed = prev.filter((_, idx) => idx !== activeStepIndex);
      const next = trimmed.map((step, idx) => ({ ...step, name: `Step ${idx + 1}` }));
      const nextIndex = Math.min(activeStepIndex, next.length - 1);
      setActiveStepIndex(nextIndex);
      return next;
    });
  };

  const toggleCell = (rowIndex, colKey) => {
    setCustomSteps((prev) =>
      prev.map((step, idx) => {
        if (idx !== activeStepIndex) return step;
        const key = `${rowIndex}-${colKey}`;
        const nextCells = step.cells.includes(key)
          ? step.cells.filter((item) => item !== key)
          : [...step.cells, key];
        return { ...step, cells: nextCells };
      })
    );
  };

  const handleSaveStep = () => {
    if (!workspaceId) return;
    const executionStepsByMaterial = materials.reduce((acc, material) => {
      const isSelectedMaterial = selectedMaterial?.name === material.name;
      acc[material.name] = buildOscillatorExecutionSteps({
        material,
        mode,
        customSteps,
        useCustomSteps: mode === "custom" && isSelectedMaterial
      });
      return acc;
    }, {});
    saveRecipeSchema(workspaceId, {
      fittingStrategy: {
        materialOrder: materials.map((item) => item.name),
        mode,
        customSteps,
        activeStepIndex,
        executionStepsByMaterial,
        globalSettings: {
          enableSensitivity,
          sensitivityMin,
          sensitivityMax,
          sensitivityWindow,
          topNSeed,
          earlyStopEnabled,
          earlyStopCount,
          fittingIteration,
          linearIteration,
          estimatedTime
        }
      }
    });
  };

  const handleConfirmIterationOrder = () => {
    handleSaveStep();
    setIterationNotice("Iteration order saved.");
  };

  useEffect(() => {
    setIterationNotice("");
  }, [mode, customSteps, activeStepIndex, selectedMaterial, materials]);

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Recipe</p>
          <h2>Fitting Strategy</h2>
          <p className="subtle">Define material order, per-material steps, and global settings.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Material Optimization Order</h3>
          <button className="ghost-button">Auto Sort</button>
        </div>
        <div className="drag-list">
          {materials.map((item, index) => (
            <button
              className={`drag-row drag-row-light ${selectedMaterial?.name === item.name ? "drag-row-active" : ""}`}
              key={item.name}
              onClick={() => setSelectedMaterial(item)}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(index)}
            >
              <span className="drag-handle">::</span>
              <span>{index + 1}. {item.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Select Iteration Order</h3>
          {selectedMaterial ? <span className="chip">{selectedMaterial.name}</span> : null}
        </div>
        <div className="inline-actions">
          <button className={mode === "column" ? "primary-button" : "ghost-button"} onClick={() => setMode("column")}>
            By Column
          </button>
          <button className={mode === "row" ? "primary-button" : "ghost-button"} onClick={() => setMode("row")}>
            By Row
          </button>
          <button className={mode === "custom" ? "primary-button" : "ghost-button"} onClick={() => setMode("custom")}>
            Customize
          </button>
        </div>

        <div className="table">
          <div className="table-row table-head">
            <span>{selectedMeta?.type === "Cauchy" ? "Model" : "Osc"}</span>
            {tableColumns.map((col) => (
              <span key={col}>{col}</span>
            ))}
          </div>
          {Array.from({ length: rowCount }).map((_, index) => (
            <div className="table-row" key={`osc-${index}`}>
              <span>{selectedMeta?.type === "Cauchy" ? "Cauchy" : `Osc ${index + 1}`}</span>
              {tableColumns.map((col) => {
                const value =
                  selectedMeta?.type === "Cauchy"
                    ? selectedMeta?.cauchy?.[col]
                    : selectedMeta?.ho?.[index + 1]?.[col];
                return <span key={`${col}-${index}`}>{value ?? "--"}</span>;
              })}
            </div>
          ))}
        </div>

        <div className="panel top-pad">
          <div className="panel-header">
            <h3>Step Preview</h3>
          </div>
          <div className="step-preview">
            {(mode === "custom" ? customSteps.map((step, index) => ({
              step: step.name,
              summary: `${step.cells.length} cells selected`
            })) : stepPreview).map((step) => (
              <div className="step-card" key={step.step}>
                <span className="step-title">{step.step}</span>
                <span className="step-summary">{step.summary}</span>
              </div>
            ))}
          </div>
        </div>
        {mode === "custom" ? (
          <div className="panel">
            <div className="panel-header">
              <h3>Customize Steps</h3>
              <div className="inline-actions">
                <button className="ghost-button" onClick={addCustomStep}>Add Step</button>
                <button
                  className="ghost-button"
                  onClick={removeCustomStep}
                  disabled={customSteps.length <= 1}
                >
                  Remove Step
                </button>
              </div>
            </div>
            <div className="chip-row">
              {customSteps.map((step, index) => (
                <button
                  key={step.name}
                  className={index === activeStepIndex ? "primary-button" : "ghost-button"}
                  onClick={() => setActiveStepIndex(index)}
                >
                  {step.name}
                </button>
              ))}
            </div>
            <div className="table">
              <div className="table-row table-head">
                <span>{selectedMeta?.type === "Cauchy" ? "Model" : "Osc"}</span>
                {tableColumns.map((col) => (
                  <span key={col}>{col}</span>
                ))}
              </div>
              {Array.from({ length: rowCount }).map((_, rowIndex) => (
                <div className="table-row" key={`custom-${rowIndex}`}>
                  <span>{selectedMeta?.type === "Cauchy" ? "Cauchy" : `Osc ${rowIndex + 1}`}</span>
                  {tableColumns.map((col) => {
                    const key = `${rowIndex}-${col}`;
                    const isSelected = customSteps[activeStepIndex]?.cells.includes(key);
                    return (
                      <label className="checkbox-row" key={key}>
                        <input
                          type="checkbox"
                          checked={isSelected || false}
                          onChange={() => toggleCell(rowIndex, col)}
                        />
                        <span />
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="inline-actions top-pad">
          <button
            className="primary-button"
            onClick={handleConfirmIterationOrder}
            disabled={readOnly || !materials.length}
          >
            Confirm
          </button>
        </div>
        {iterationNotice ? <p className="panel-note">{iterationNotice}</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Advanced Global Settings</h3>
          <button className="ghost-button" onClick={() => setShowGlobal((prev) => !prev)}>
            {showGlobal ? "Hide" : "Show"}
          </button>
        </div>
        {showGlobal ? (
          <div className="advanced-grid">
            <div className="panel-section">
              <div className="panel-section-title">Sensitivity</div>
              <div className="form-grid">
                <div className="form-row">
                  <label>Enable Sensitivity Auto Weights</label>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={enableSensitivity}
                      onChange={(event) => setEnableSensitivity(event.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              </div>
              {enableSensitivity ? (
                <div className="form-grid two-col panel-subgrid">
                  <div className="form-row">
                    <label>Sensitivity Min</label>
                    <input
                      type="text"
                      value={sensitivityMin}
                      onChange={(event) => setSensitivityMin(event.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <label>Sensitivity Max</label>
                    <input
                      type="text"
                      value={sensitivityMax}
                      onChange={(event) => setSensitivityMax(event.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <label>Sensitivity Window Length</label>
                    <input
                      type="number"
                      value={sensitivityWindow}
                      onChange={(event) => setSensitivityWindow(event.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="panel-section">
              <div className="panel-section-title">Seeds & Stop</div>
              <div className="form-grid two-col">
                <div className="form-row">
                  <label>Top N Seeds (Starting Point)</label>
                  <input
                    type="number"
                    min={1}
                    value={topNSeed}
                    onChange={(event) => setTopNSeed(Number(event.target.value))}
                  />
                </div>
                <div className="form-row">
                  <label>Early Stop on KPI Hit</label>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={earlyStopEnabled}
                      onChange={(event) => setEarlyStopEnabled(event.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
                {earlyStopEnabled ? (
                  <div className="form-row">
                    <label>Stop After KPI Hits (N)</label>
                    <input
                      type="number"
                      min={1}
                      value={earlyStopCount}
                      onChange={(event) => setEarlyStopCount(Number(event.target.value))}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="panel-section">
              <div className="panel-section-title">Iterations</div>
              <div className="form-grid two-col">
                <div className="form-row">
                  <label>Fitting Iteration</label>
                  <input
                    type="number"
                    value={fittingIteration}
                    onChange={(event) => setFittingIteration(Number(event.target.value))}
                  />
                </div>
                <div className="form-row">
                  <label>Linear Iteration</label>
                  <input
                    type="number"
                    value={linearIteration}
                    onChange={(event) => setLinearIteration(Number(event.target.value))}
                  />
                </div>
                <div className="form-row">
                  <label>Estimated Time</label>
                  <input
                    type="text"
                    value={estimatedTime}
                    onChange={(event) => setEstimatedTime(event.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <WorkflowFooter workspaceId={workspaceId} onSave={handleSaveStep} readOnly={readOnly} />
    </div>
  );
}
