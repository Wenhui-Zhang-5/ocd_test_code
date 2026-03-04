import React, { useEffect, useRef, useState } from "react";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import { fetchModelJson, loadRecipeSchema, saveRecipeSchema } from "../../data/mockApi.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";

export default function Model({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const [modelId, setModelId] = useState(workspaceId || "");
  const [modelIdLocked, setModelIdLocked] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modelJson, setModelJson] = useState(null);
  const [basisRows, setBasisRows] = useState([]);
  const [constraintRows, setConstraintRows] = useState([]);
  const [materialSummary, setMaterialSummary] = useState({
    materials: [],
    spectrumRange: "-",
    seSrRatio: "0.82"
  });
  const [spectrumRanges, setSpectrumRanges] = useState([]);
  const [seSrRatio, setSeSrRatio] = useState("0.82");
  const [spectrumError, setSpectrumError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const saveTimerRef = useRef(null);

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId);
    const validatedModel =
      schema?.preRecipe?.recipeSetupModelValidation?.validated &&
      String(schema?.preRecipe?.recipeSetupModelValidation?.modelID || "").trim()
        ? String(schema.preRecipe.recipeSetupModelValidation.modelID).trim()
        : "";
    setModelIdLocked(Boolean(validatedModel));
    if (schema?.modelID) {
      setModelId(schema.modelID);
    } else if (validatedModel) {
      setModelId(validatedModel);
    } else {
      setModelId(workspaceId);
    }
    if (schema?.model?.modelJson) {
      setModelJson(schema.model.modelJson);
      const content = schema.model.modelJson.content || {};
      setSpectrumRanges(content.proj_params?.SEwavelength || []);
      setSeSrRatio(String(content.proj_params?.SESRRatio ?? "0.82"));
    }
    if (schema?.model?.basisRows) setBasisRows(schema.model.basisRows);
    if (schema?.model?.constraintRows) setConstraintRows(schema.model.constraintRows);
    if (schema?.model?.materialSummary) setMaterialSummary(schema.model.materialSummary);
    if (
      schema?.model?.modelJson ||
      (schema?.model?.basisRows && schema.model.basisRows.length) ||
      (schema?.model?.constraintRows && schema.model.constraintRows.length)
    ) {
      setShowDetails(true);
    }
  }, [workspaceId]);

  const handleFetchModel = async () => {
    const targetModelId = String(modelId || "").trim();
    if (!targetModelId) {
      setError("Model ID is required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await fetchModelJson(targetModelId);
      const content = payload?.content || {};
      const basis = (content.basis || []).map((item) => {
        const nominal = item.nominal ?? "";
        const min = item.min ?? (nominal !== "" ? (Number(nominal) * 0.9).toFixed(2) : "");
        const max = item.max ?? (nominal !== "" ? (Number(nominal) * 1.1).toFixed(2) : "");
        return {
          name: item.name || item.alias || "",
          customName: item.custom_name || item.customName || item.name || "",
          nominal,
          min,
          max
        };
      });
      const constraints = (content.constraint || []).map((item) => {
        return {
          name: item.alias || item.name || "",
          customName: item.equation || item.custom_name || item.customName || ""
        };
      });
      const materials = Array.from(
        new Set((content.mat || []).map((item) => item.material).filter(Boolean))
      );
      const spectrumRange = Array.isArray(content.proj_params?.SEwavelength) &&
        content.proj_params.SEwavelength.length
        ? `${content.proj_params.SEwavelength[0][0]}-${content.proj_params.SEwavelength.slice(-1)[0][1]} nm`
        : "190-1000 nm";
      setBasisRows(basis);
      setConstraintRows(constraints);
      setMaterialSummary({
        materials,
        spectrumRange,
        seSrRatio: String(content.proj_params?.SESRRatio ?? "0.82")
      });
      setSpectrumRanges(content.proj_params?.SEwavelength || []);
      setSeSrRatio(String(content.proj_params?.SESRRatio ?? "0.82"));
      setModelJson(payload);
      setShowDetails(true);
    } catch (fetchError) {
      setError("Failed to fetch model.");
    } finally {
      setLoading(false);
    }
  };

  const handleBasisChange = (index, field, value) => {
    setBasisRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, [field]: value } : row)));
    setModelJson((prev) => {
      if (!prev?.content?.basis) return prev;
      const next = { ...prev, content: { ...prev.content } };
      next.content.basis = prev.content.basis.map((row, idx) => {
        if (idx !== index) return row;
        if (field === "nominal") {
          return { ...row, nominal: Number(value), nominalNew: Number(value) };
        }
        if (field === "min") {
          return { ...row, min: Number(value) };
        }
        if (field === "max") {
          return { ...row, max: Number(value) };
        }
        return row;
      });
      return next;
    });
  };

  const updateSpectrumRange = (index, field, value) => {
    setSpectrumRanges((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        const next = [...row];
        next[field] = value;
        return next;
      })
    );
    if (spectrumError) setSpectrumError("");
  };

  const addSpectrumRange = () => {
    setSpectrumRanges((prev) => [...prev, [190, 1000, 1, 1]]);
    if (spectrumError) setSpectrumError("");
  };

  const removeSpectrumRange = (index) => {
    setSpectrumRanges((prev) => {
      if (prev.length <= 1) {
        setSpectrumError("At least one segment is required.");
        return prev;
      }
      const next = prev.filter((_, idx) => idx !== index);
      return next.length ? next : prev;
    });
  };

  useEffect(() => {
    setModelJson((prev) => {
      if (!prev?.content) return prev;
      const next = { ...prev, content: { ...prev.content } };
      next.content.proj_params = {
        ...(prev.content.proj_params || {}),
        SEwavelength: spectrumRanges,
        SESRRatio: Number(seSrRatio)
      };
      return next;
    });
  }, [spectrumRanges, seSrRatio]);

  const handleSaveStep = () => {
    if (!workspaceId) return;
    const normalizedModelId = String(modelId || "").trim();
    saveRecipeSchema(workspaceId, {
      modelID: normalizedModelId || workspaceId,
      model: {
        modelID: normalizedModelId || workspaceId,
        modelJson,
        basisRows,
        constraintRows,
        materialSummary
      }
    });
    setSaveStatus("Changes saved");
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      setSaveStatus("");
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Pre-Recipe</p>
          <h2>Model</h2>
          <p className="subtle">Parsed basis and constraint CD tables from model.json.</p>
        </div>
      </header>

      <section className="panel narrow">
        <div className="panel-header">
          <h3>Model ID</h3>
          <span className="chip">API: POST /models/get</span>
        </div>
        <div className="form-row">
          <label>Model ID</label>
          <div className="inline-actions">
            <input
              type="text"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              disabled={readOnly || modelIdLocked}
            />
            <button className="ghost-button" onClick={handleFetchModel} disabled={loading}>
              {loading ? "Fetching..." : "Fetch Model"}
            </button>
          </div>
          {modelIdLocked ? <p className="panel-note">Model ID is locked by Recipe Setup validation.</p> : null}
          {error ? <p className="panel-note">{error}</p> : null}
        </div>
      </section>

      {showDetails ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <h3>Basis CD</h3>
            </div>
            <div className="table model-table model-table-y-scroll">
              <div className="table-row table-head">
                <span>Name</span>
                <span>Custom Name</span>
                <span>Nominal</span>
                <span>Min</span>
                <span>Max</span>
              </div>
              {basisRows.map((row, index) => (
                <div className="table-row" key={`basis-${index}`}>
                  <input value={row.name} disabled />
                  <input value={row.customName} disabled />
                  <input value={row.nominal} onChange={(event) => handleBasisChange(index, "nominal", event.target.value)} />
                  <input value={row.min} onChange={(event) => handleBasisChange(index, "min", event.target.value)} />
                  <input value={row.max} onChange={(event) => handleBasisChange(index, "max", event.target.value)} />
                </div>
              ))}
            </div>
            <div className="inline-actions top-pad">
              <button className="primary-button" onClick={handleSaveStep} disabled={readOnly}>
                Save Changes
              </button>
              {saveStatus ? <span className="save-status">{saveStatus}</span> : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Constraint CD</h3>
            </div>
            <div className="table model-table model-table-y-scroll">
              <div className="table-row table-head">
                <span>Name</span>
                <span>Custom Name</span>
              </div>
              {constraintRows.map((row, index) => (
                <div className="table-row" key={`constraint-${index}`}>
                  <input value={row.name} disabled />
                  <input value={row.customName} disabled />
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Material Summary</h3>
            </div>
            <div className="summary-grid">
              <div>
                <p className="summary-label">Materials</p>
                <p className="summary-value">{materialSummary.materials.join(", ") || "-"}</p>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Spectrum Range</h3>
            </div>
            <div className="table model-table">
              <div className="table-row table-head">
                <span>Min</span>
                <span>Max</span>
                <span>Step</span>
                <span>Weight</span>
                <span />
              </div>
              {spectrumRanges.map((row, index) => (
                <div className="table-row" key={`range-${index}`}>
                  <input
                    value={row[0]}
                    onChange={(event) => updateSpectrumRange(index, 0, Number(event.target.value))}
                  />
                  <input
                    value={row[1]}
                    onChange={(event) => updateSpectrumRange(index, 1, Number(event.target.value))}
                  />
                  <input
                    value={row[2]}
                    onChange={(event) => updateSpectrumRange(index, 2, Number(event.target.value))}
                  />
                  <input
                    value={row[3]}
                    onChange={(event) => updateSpectrumRange(index, 3, Number(event.target.value))}
                  />
                  <button
                    className="delete-chip"
                    type="button"
                    onClick={() => removeSpectrumRange(index)}
                    aria-label="Delete segment"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="inline-actions">
              <button className="ghost-button" onClick={addSpectrumRange}>Add Segment</button>
            </div>
            {spectrumError ? <p className="panel-note">{spectrumError}</p> : null}
            <div className="form-row">
              <label>SE / SR Ratio</label>
              <input value={seSrRatio} onChange={(event) => setSeSrRatio(event.target.value)} />
            </div>
            <div className="inline-actions top-pad">
              <button className="primary-button" onClick={handleSaveStep} disabled={readOnly}>
                Save Changes
              </button>
              {saveStatus ? <span className="save-status">{saveStatus}</span> : null}
            </div>
          </section>

        </>
      ) : (
        <section className="panel">
          <div className="plot-placeholder">Fetch model to load details</div>
        </section>
      )}
      <WorkflowFooter workspaceId={workspaceId} onSave={handleSaveStep} readOnly={readOnly} />
    </div>
  );
}
