import React, { useEffect, useMemo, useState } from "react";
import MultiSelectDropdown from "../../components/MultiSelectDropdown.jsx";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import {
  fetchNkCurve,
  fetchNkIndex,
  getWorkspace,
  listCheckpoints,
  listCheckpointVersions,
  loadRecipeSchema,
  resetMockState,
  saveRecipeSchema
} from "../../data/mockApi.js";
import { NK_API_BASE } from "../../config/env.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";

const normalizeMaterial = (material) => {
  if (!material) return "";
  const base = material.split("_")[0];
  return base.trim();
};

export default function StartingPoint({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const [mode, setMode] = useState("material");
  const [activeMaterial, setActiveMaterial] = useState("");
  const [selectedLibraries, setSelectedLibraries] = useState([]);
  const [selectedCandidates, setSelectedCandidates] = useState({});
  const [nkIndex, setNkIndex] = useState([]);
  const [nkError, setNkError] = useState("");
  const [nkCurves, setNkCurves] = useState({});
  const [materialMap, setMaterialMap] = useState({});
  const [materialFloatMap, setMaterialFloatMap] = useState({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [mappingError, setMappingError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectionSource, setSelectionSource] = useState("");
  const [selectionSummary, setSelectionSummary] = useState("");
  const [copyNkStatus, setCopyNkStatus] = useState("");
  const [copyNkError, setCopyNkError] = useState("");
  const workspace = getWorkspace(workspaceId) || {};
  const modelId = workspace.modelID || workspaceId || "";
  const [selectedRecipe, setSelectedRecipe] = useState(modelId);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [selectedCheckpoint, setSelectedCheckpoint] = useState("");
  const [finalSelections, setFinalSelections] = useState({});
  const [modelMaterials, setModelMaterials] = useState([]);

  const labelForSource = (sourceLabel) => {
    if (sourceLabel === "general") return "General NK Library";
    if (sourceLabel === "advanced") return "Advanced Selection";
    if (sourceLabel === "default") return "Default Selection";
    return sourceLabel || "Unknown Source";
  };

  const buildSourceSummary = (sourceLabel) => {
    return `Selection saved from: ${labelForSource(sourceLabel)}.`;
  };

  const versions = useMemo(() => listCheckpointVersions(selectedRecipe), [selectedRecipe]);

  const checkpoints = useMemo(
    () => listCheckpoints(selectedRecipe, selectedVersion) || [],
    [selectedRecipe, selectedVersion]
  );

  const selectedCheckpointData = useMemo(
    () => checkpoints.find((item) => item.id === selectedCheckpoint),
    [checkpoints, selectedCheckpoint]
  );

  useEffect(() => {
    let cancelled = false;
    fetchNkIndex()
      .then((index) => {
        if (cancelled) return;
        setNkIndex(index);
        setNkError("");
      })
      .catch(() => {
        if (cancelled) return;
        setNkIndex([]);
        setNkError("Failed to load NK library index.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId);
    const modelJson = schema?.model?.modelJson;
    const materials = Array.from(
      new Set((modelJson?.content?.mat || []).map((item) => item.material).filter(Boolean))
    );
    setModelMaterials(materials);
    setMaterialFloatMap((prev) => {
      const saved = schema?.startingPoint?.materialFloatMap || {};
      const next = {};
      materials.forEach((mat) => {
        if (saved[mat] !== undefined) {
          next[mat] = Boolean(saved[mat]);
        } else if (prev[mat] !== undefined) {
          next[mat] = Boolean(prev[mat]);
        } else {
          next[mat] = false;
        }
      });
      return next;
    });
    if (!activeMaterial && materials.length) {
      setActiveMaterial(materials[0]);
    }
    if (!schema?.startingPoint?.materialMap) {
      const next = {};
      materials.forEach((mat) => {
        const base = normalizeMaterial(mat);
        if (base) next[mat] = base;
      });
      setMaterialMap(next);
    }
    if (schema?.startingPoint?.materialSeeds) {
      setSelectedCandidates(schema.startingPoint.materialSeeds);
    }
    if (schema?.startingPoint?.selectedLibraries) {
      setSelectedLibraries(schema.startingPoint.selectedLibraries);
    }
    if (schema?.startingPoint?.materialMap) {
      setMaterialMap(schema.startingPoint.materialMap);
      setMappingConfirmed(Boolean(schema.startingPoint.mappingConfirmed));
    }
    if (schema?.startingPoint?.selectionSource) {
      setSelectionSource(schema.startingPoint.selectionSource);
      setSelectionSummary(buildSourceSummary(schema.startingPoint.selectionSource));
    } else if (schema?.startingPoint?.selectionSummary) {
      setSelectionSummary(schema.startingPoint.selectionSummary);
    }
  }, [workspaceId, activeMaterial]);

  useEffect(() => {
    setSelectedRecipe(modelId);
  }, [modelId]);

  useEffect(() => {
    if (!selectedVersion && versions.length) {
      setSelectedVersion(versions[0]);
    }
  }, [versions, selectedVersion]);

  const libraryOptions = useMemo(() => {
    const libs = Array.from(new Set(nkIndex.map((item) => item.library))).filter(Boolean);
    return libs.map((lib) => ({ value: lib, label: lib }));
  }, [nkIndex]);

  const nkMaterials = useMemo(() => {
    return Array.from(new Set(nkIndex.map((item) => item.material))).filter(Boolean);
  }, [nkIndex]);

  useEffect(() => {
    if (!selectedLibraries.length && libraryOptions.length) {
      const general = libraryOptions.find((item) => String(item.value || "").toLowerCase() === "general");
      setSelectedLibraries([general ? general.value : libraryOptions[0].value]);
    }
  }, [libraryOptions, selectedLibraries]);

  const autoMatchMap = useMemo(() => {
    const next = {};
    modelMaterials.forEach((mat) => {
      const base = normalizeMaterial(mat);
      if (base) next[mat] = base;
    });
    return next;
  }, [modelMaterials]);

  const isFloatingMaterial = (material) => Boolean(materialFloatMap[material]);

  const buildAllCandidates = (mapOverride) => {
    const selection = {};
    const mapSource = mapOverride || materialMap;
    const allowedLibraries = selectedLibraries.length ? selectedLibraries : libraryOptions.map((item) => item.value);
    modelMaterials.forEach((mat) => {
      if (!isFloatingMaterial(mat)) return;
      const mapped = mapSource[mat];
      if (!mapped) return;
      const paths = nkIndex
        .filter(
          (item) =>
            item.material === mapped &&
            (!allowedLibraries.length || allowedLibraries.includes(item.library))
        )
        .map((item) => item.path);
      selection[mat] = paths;
    });
    return selection;
  };

  const buildGeneralCandidates = (mapOverride) => {
    const selection = {};
    const mapSource = mapOverride || materialMap;
    modelMaterials.forEach((mat) => {
      if (!isFloatingMaterial(mat)) return;
      const mapped = mapSource[mat];
      if (!mapped) return;
      const paths = nkIndex
        .filter(
          (item) =>
            item.material === mapped &&
            String(item.library || "").toLowerCase() === "general"
        )
        .map((item) => item.path);
      selection[mat] = paths;
    });
    return selection;
  };

  const selectionsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  useEffect(() => {
    if (advancedOpen) return;
    if (!mappingConfirmed) return;
    if (!modelMaterials.length || !nkIndex.length) return;
    if (!Object.keys(materialMap).length) {
      setMaterialMap(autoMatchMap);
    }
    const allSelections = buildAllCandidates(Object.keys(materialMap).length ? materialMap : autoMatchMap);
    if (!selectionsEqual(selectedCandidates, allSelections)) {
      setSelectedCandidates(allSelections);
    }
  }, [advancedOpen, mappingConfirmed, modelMaterials, nkIndex, materialMap, materialFloatMap, autoMatchMap, selectedLibraries, libraryOptions]);

  const candidateOptions = useMemo(() => {
    if (!activeMaterial) return [];
    if (!mappingConfirmed) return [];
    if (!isFloatingMaterial(activeMaterial)) return [];
    const mapped = materialMap[activeMaterial];
    if (!mapped) return [];
    const allowedLibraries = selectedLibraries.length ? selectedLibraries : libraryOptions.map((item) => item.value);
    return nkIndex.filter(
      (item) =>
        item.material === mapped &&
        (!allowedLibraries.length || allowedLibraries.includes(item.library))
    );
  }, [activeMaterial, nkIndex, selectedLibraries, libraryOptions, mappingConfirmed, materialMap, materialFloatMap]);

  useEffect(() => {
    let cancelled = false;
    if (!candidateOptions.length) return undefined;
    candidateOptions.forEach((candidate) => {
      setNkCurves((prev) => {
        if (prev[candidate.path]) return prev;
        return { ...prev, [candidate.path]: { status: "loading", data: null, error: "" } };
      });
      fetchNkCurve({
        library: candidate.library,
        material: candidate.material,
        modelType: candidate.modelType,
        modelName: candidate.modelName
      })
        .then((data) => {
          if (cancelled) return;
          setNkCurves((prev) => ({
            ...prev,
            [candidate.path]: { status: "ready", data, error: "" }
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setNkCurves((prev) => ({
            ...prev,
            [candidate.path]: { status: "error", data: null, error: "Failed to load" }
          }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [candidateOptions]);

  const candidateLabel = (candidate) => {
    const name = candidate.modelName ? ` / ${candidate.modelName}` : "";
    return `${candidate.library} · ${candidate.material} · ${candidate.modelType}${name}`;
  };

  const renderNkThumb = (curve) => {
    if (!curve) return null;
    const wavelength = curve.wavelength || [];
    const nValues = curve.n || [];
    const kValues = curve.k || [];
    if (!wavelength.length || !nValues.length) return null;
    const sample = (arr, step) => arr.filter((_, idx) => idx % step === 0);
    const step = Math.max(1, Math.floor(wavelength.length / 60));
    const xs = sample(wavelength, step);
    const ns = sample(nValues, step);
    const ks = kValues.length ? sample(kValues, step) : [];
    const norm = (arr) => {
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      if (max - min === 0) return arr.map(() => 0.5);
      return arr.map((v) => (v - min) / (max - min));
    };
    const nx = norm(ns);
    const kx = ks.length ? norm(ks) : [];
    const toPoints = (values) =>
      values
        .map((v, idx) => {
          const x = 16 + (idx / (values.length - 1)) * 80;
          const y = 58 - v * 46;
          return `${x},${y}`;
        })
        .join(" ");
    const xMin = wavelength[0];
    const xMax = wavelength[wavelength.length - 1];
    const nMin = Math.min(...nValues);
    const nMax = Math.max(...nValues);
    return (
      <div className="nk-thumb-inner">
        <svg viewBox="0 0 100 70" className="nk-thumb" preserveAspectRatio="xMidYMid meet">
          <line x1="16" y1="10" x2="16" y2="58" stroke="rgba(140,150,170,0.6)" strokeWidth="1" />
          <line x1="16" y1="58" x2="96" y2="58" stroke="rgba(140,150,170,0.6)" strokeWidth="1" />
          <text x="2" y="13" fontSize="6" fill="var(--muted)">
            {nMax.toFixed(2)}
          </text>
          <text x="2" y="60" fontSize="6" fill="var(--muted)">
            {nMin.toFixed(2)}
          </text>
          <text x="16" y="68" fontSize="6" fill="var(--muted)">
            {Math.round(xMin)}
          </text>
          <text x="80" y="68" fontSize="6" fill="var(--muted)">
            {Math.round(xMax)}
          </text>
          <polyline points={toPoints(nx)} fill="none" stroke="#ff4d4d" strokeWidth="2" />
          {kx.length ? (
            <polyline points={toPoints(kx)} fill="none" stroke="#4aa3ff" strokeWidth="2" />
          ) : null}
        </svg>
        <div className="nk-thumb-legend">
          <span className="nk-dot n" />
          <span>N</span>
          {kValues.length ? (
            <>
              <span className="nk-dot k" />
              <span>K</span>
            </>
          ) : null}
        </div>
      </div>
    );
  };

  const toggleCandidate = (material, candidate) => {
    setSelectedCandidates((prev) => {
      const current = prev[material] || [];
      const next = current.includes(candidate.path)
        ? current.filter((item) => item !== candidate.path)
        : [...current, candidate.path];
      return { ...prev, [material]: next };
    });
  };

  const persistStartingPointPartial = (overrides = {}) => {
    if (!workspaceId) return;
    saveRecipeSchema(workspaceId, {
      startingPoint: {
        mode,
        activeMaterial,
        selectedLibraries,
        materialSeeds: selectedCandidates,
        materialMap,
        materialFloatMap,
        mappingConfirmed,
        selectionSummary,
        selectionSource,
        selectedRecipe,
        selectedVersion,
        selectedCheckpoint,
        finalSelections,
        ...overrides
      }
    });
  };

  const syncNkSeedsToCase = async (selections) => {
    if (!workspaceId) return true;
    const schema = loadRecipeSchema(workspaceId) || {};
    const modelIdForCopy = String(schema?.modelID || selectedRecipe || workspaceId || "").trim();
    const versionForCopy = String(schema?.version || "v0").trim();
    if (!modelIdForCopy || !versionForCopy) return false;
    const response = await fetch(`${NK_API_BASE}/copy-seeds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: modelIdForCopy,
        version: versionForCopy,
        material_seeds: selections
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.detail || payload?.error || "Failed to copy NK seeds";
      throw new Error(typeof detail === "string" ? detail : "Failed to copy NK seeds");
    }
    return payload;
  };

  const applySelectionAndCopy = async (selections, sourceLabel) => {
    const summary = buildSourceSummary(sourceLabel);
    setCopyNkStatus("");
    setCopyNkError("");
    setSelectionSource(sourceLabel);
    setSelectionSummary(summary);
    persistStartingPointPartial({
      materialSeeds: selections,
      selectionSummary: summary,
      selectionSource: sourceLabel
    });
    try {
      const payload = await syncNkSeedsToCase(selections);
      setCopyNkStatus(`Source applied: ${labelForSource(sourceLabel)}.`);
      persistStartingPointPartial({
        nkCopy: {
          status: "succeeded",
          source: sourceLabel,
          copiedCount: payload?.copied_count ?? 0,
          manifestPath: payload?.manifest_path || "",
          copiedAt: new Date().toISOString()
        }
      });
      return true;
    } catch (error) {
      setCopyNkError(error?.message || "Failed to copy NK seeds");
      persistStartingPointPartial({
        nkCopy: {
          status: "failed",
          source: sourceLabel,
          error: error?.message || "Failed to copy NK seeds",
          copiedAt: new Date().toISOString()
        }
      });
      return false;
    }
  };

  const handleSaveStep = () => {
    persistStartingPointPartial();
    return true;
  };

  const handleConfirmMapping = () => {
    const missing = modelMaterials
      .filter((mat) => isFloatingMaterial(mat))
      .filter((mat) => !materialMap[mat]);
    if (missing.length) {
      setMappingError("Please map every model material before confirming.");
      setMappingConfirmed(false);
      return;
    }
    setMappingError("");
    setMappingConfirmed(true);
    persistStartingPointPartial({ mappingConfirmed: true });
  };

  const handleConfirmCandidates = async () => {
    const selections = advancedOpen ? selectedCandidates : buildAllCandidates();
    await applySelectionAndCopy(selections, advancedOpen ? "advanced" : "default");
  };

  const handleUseGeneralNkLibrary = async () => {
    if (!mappingConfirmed) {
      setCopyNkError("Please confirm mapping first.");
      return;
    }
    const selections = buildGeneralCandidates(materialMap);
    setSelectedLibraries(["general"]);
    setSelectedCandidates(selections);
    await applySelectionAndCopy(selections, "general");
  };

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Recipe Build</p>
          <h2>Starting Point</h2>
          <p className="subtle">Choose material library or checkpoint as initial seed source.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Seed Source</h3>
          <div className="inline-actions">
            <button
              className={mode === "material" ? "primary-button" : "ghost-button"}
              onClick={() => setMode("material")}
            >
              From Material Library
            </button>
            <button
              className={mode === "checkpoint" ? "primary-button" : "ghost-button"}
              onClick={() => setMode("checkpoint")}
            >
              From Checkpoint
            </button>
          </div>
        </div>

        {mode === "material" ? (
          <div className="grid two-col">
            <div className="panel">
              <div className="panel-header">
                <h3>From Material Library</h3>
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label>Material Mapping (Model → NK Library)</label>
                    <div className="table mapping-table">
                      <div className="table-row table-head mapping-row">
                        <span>Model Material</span>
                        <span>Floating</span>
                        <span>NK Material</span>
                      </div>
                      {modelMaterials.map((material) => (
                        <div className="table-row mapping-row" key={material}>
                          <span>{material}</span>
                          <label className="mapping-float-cell">
                            <input
                              type="checkbox"
                              checked={isFloatingMaterial(material)}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                const nextFloatMap = { ...materialFloatMap, [material]: checked };
                                setMaterialFloatMap(nextFloatMap);
                                setMappingConfirmed(false);
                                setMappingError("");
                                persistStartingPointPartial({
                                  materialFloatMap: nextFloatMap,
                                  mappingConfirmed: false
                                });
                              }}
                              aria-label={`Set ${material} floating`}
                            />
                          </label>
                          {isFloatingMaterial(material) ? (
                            <select
                              value={materialMap[material] || ""}
                              onChange={(event) => {
                                const nextMap = { ...materialMap, [material]: event.target.value };
                                setMaterialMap(nextMap);
                                setMappingConfirmed(false);
                                setMappingError("");
                                persistStartingPointPartial({
                                  materialMap: nextMap,
                                  mappingConfirmed: false
                                });
                              }}
                            >
                              <option value="">Select material</option>
                              {nkMaterials.map((nkMat) => (
                                <option key={`${material}-${nkMat}`} value={nkMat}>
                                  {nkMat}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="chip chip-muted">No mapping required</span>
                          )}
                        </div>
                      ))}
                    </div>
                  <div className="inline-actions top-pad">
                    <button className="primary-button" onClick={handleConfirmMapping}>
                      Confirm Mapping
                    </button>
                  </div>
                  {mappingError ? <p className="panel-note">{mappingError}</p> : null}
                  {mappingConfirmed ? (
                    <p className="panel-note">Mapping confirmed. You can now select NK candidates.</p>
                  ) : (
                    <p className="panel-note">Confirm the mapping before selecting NK candidates.</p>
                  )}
                  <div className="starting-source-actions top-pad">
                    <p className="starting-source-title">Starting Point Source</p>
                    <div className="source-choice-grid">
                      <button
                        type="button"
                        className={`source-choice-card${advancedOpen ? "" : " source-choice-card-active"}`}
                        onClick={() => setAdvancedOpen(false)}
                      >
                        <span className="source-choice-name">Use General NK Library</span>
                        <span className="source-choice-desc">
                          Use `general/*` as default candidates.
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`source-choice-card${advancedOpen ? " source-choice-card-active" : ""}`}
                        onClick={() => setAdvancedOpen(true)}
                      >
                        <span className="source-choice-name">Use Advanced Selection</span>
                        <span className="source-choice-desc">
                          Manually choose libraries and NK candidates.
                        </span>
                      </button>
                    </div>
                    {!advancedOpen ? (
                      <div className="inline-actions top-pad">
                        <button className="primary-button" onClick={handleUseGeneralNkLibrary}>
                          Apply General NK Library
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                {advancedOpen ? (
                  <div className="panel inner-panel">
                    <div className="panel-header">
                      <h4>Advanced Selection</h4>
                    </div>
                    <>
                      <div className="form-row">
                        <label>Material</label>
                        <select value={activeMaterial} onChange={(event) => setActiveMaterial(event.target.value)}>
                          {modelMaterials.map((material) => (
                            <option key={material} value={material}>{material}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-row">
                        <label>Library Source</label>
                        <MultiSelectDropdown
                          label="Library"
                          options={libraryOptions}
                          value={selectedLibraries}
                          onChange={setSelectedLibraries}
                          enableSelectAll
                          selectAllLabel="All Libraries"
                        />
                      </div>
                      <div className="form-row">
                        <label>Candidate NK Curves</label>
                        <div className="grid three-col">
                          {candidateOptions.map((candidate) => (
                            <div key={candidate.path} className="panel nk-card">
                              <div className="panel-header">
                                <span>{candidateLabel(candidate)}</span>
                                <label className="checkbox-row">
                                  <input
                                    type="checkbox"
                                    checked={(selectedCandidates[activeMaterial] || []).includes(candidate.path)}
                                    onChange={() => toggleCandidate(activeMaterial, candidate)}
                                  />
                                  <span>Select</span>
                                </label>
                              </div>
                              <div className="plot-placeholder small nk-thumb-wrap">
                                {nkCurves[candidate.path]?.status === "loading" ? (
                                  <span>Loading NK...</span>
                                ) : nkCurves[candidate.path]?.status === "error" ? (
                                  <span>Failed to load</span>
                                ) : (
                                  renderNkThumb(nkCurves[candidate.path]?.data)
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      {nkError ? <p className="panel-note">{nkError}</p> : null}
                    </>
                    <div className="inline-actions top-pad">
                      <button className="primary-button" onClick={handleConfirmCandidates}>
                        Confirm Selected NK
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              {selectionSummary ? <p className="panel-note">{selectionSummary}</p> : null}
              {copyNkStatus ? <p className="panel-note">{copyNkStatus}</p> : null}
              {copyNkError ? <p className="panel-note">{copyNkError}</p> : null}
            </div>
          </div>
        ) : (
          <div className="grid two-col">
            <div className="panel">
              <div className="panel-header">
                <h3>From Checkpoint</h3>
                <button
                  className="ghost-button"
                  onClick={() => {
                    resetMockState();
                    window.location.reload();
                  }}
                >
                  Reset Mock Data
                </button>
              </div>
              <div className="form-grid two-col">
                <div className="form-row">
                  <label>Model ID</label>
                  <input type="text" value={selectedRecipe} readOnly />
                </div>
                <div className="form-row">
                  <label>Version</label>
                  <select
                    value={selectedVersion}
                    onChange={(event) => {
                      setSelectedVersion(event.target.value);
                      setSelectedCheckpoint("");
                    }}
                  >
                    <option value="">Select version</option>
                    {versions.map((version) => (
                      <option key={version} value={version}>{version}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <label>Checkpoint</label>
                <select value={selectedCheckpoint} onChange={(event) => setSelectedCheckpoint(event.target.value)}>
                  <option value="">Select checkpoint</option>
                  {checkpoints.map((checkpoint) => (
                    <option key={checkpoint.id} value={checkpoint.id}>
                      {checkpoint.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="panel-note">
                KPI summary and fitting snapshot will appear below.
              </div>
              <div className="summary-grid">
                <div className="panel">
                  <p className="summary-label">KPI Summary</p>
                  <p className="summary-value">
                    R2 {selectedCheckpointData?.kpi?.r2 || "-"} · slope {selectedCheckpointData?.kpi?.slope || "-"}
                  </p>
                  <p className="summary-value">
                    SBS {selectedCheckpointData?.kpi?.sideBySideNm || "-"} · precision {selectedCheckpointData?.kpi?.precision || "-"}
                  </p>
                </div>
                <div className="plot-placeholder">Fitting Snapshot Placeholder</div>
                <div className="plot-placeholder">NK Curves Placeholder</div>
              </div>
              <div className="form-grid two-col">
                <div className="form-row">
                  <label>Final Versions</label>
                  <div className="table">
                    <div className="table-row table-head">
                      <span>Version</span>
                      <span>Checkpoints (multi)</span>
                    </div>
                    {versions.map((version) => {
                      const options = listCheckpoints(selectedRecipe, version).map((item) => ({
                        value: item.name,
                        label: item.name
                      }));
                      return (
                        <div className="table-row" key={version}>
                          <span>{version}</span>
                          <MultiSelectDropdown
                            label="Checkpoint"
                            options={options}
                            value={finalSelections[version] || []}
                            onChange={(next) =>
                              setFinalSelections((prev) => ({ ...prev, [version]: next }))
                            }
                            enableSelectAll
                            selectAllLabel="All Checkpoints"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <WorkflowFooter workspaceId={workspaceId} onSave={handleSaveStep} readOnly={readOnly} />
    </div>
  );
}
