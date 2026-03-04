import React, { useEffect, useMemo, useRef, useState } from "react";
import MultiSelectDropdown from "../../components/MultiSelectDropdown.jsx";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import { buildHashHref } from "../../router.js";
import {
  addRecipeHubMetaOption,
  createModelWorkspace,
  fetchModelExists,
  fetchRecipeHubMetaOptions,
  getPrecisionSelection,
  getSpectrumSelection,
  loadRecipeSchema,
  saveRecipeSchema
} from "../../data/mockApi.js";
import { SPECTRUM_API_BASE } from "../../config/env.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";

export default function RecipeSetup({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const [form, setForm] = useState({
    modelID: "",
    owner: "You",
    project: "",
    productID: "",
    loop: "",
    recipeName: "New Recipe",
    layout: "Default",
    state: "draft",
    version: "v1",
    templateEnabled: false,
    templateId: ""
  });
  const [projectOptions, setProjectOptions] = useState([]);
  const [productOptions, setProductOptions] = useState([]);
  const [loopOptions, setLoopOptions] = useState([]);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddLoop, setShowAddLoop] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [newLoop, setNewLoop] = useState("");
  const [metaNotice, setMetaNotice] = useState("");
  const [confirmAdd, setConfirmAdd] = useState(null);
  const [fittingWaferConfirmDone, setFittingWaferConfirmDone] = useState(false);
  const [precisionWaferConfirmDone, setPrecisionWaferConfirmDone] = useState(false);
  const [specTypeConfirmDone, setSpecTypeConfirmDone] = useState(false);
  const [specType, setSpecType] = useState("SE");
  const [copyStatus, setCopyStatus] = useState("");
  const [copyError, setCopyError] = useState("");
  const [copying, setCopying] = useState(false);
  const [copyProgress, setCopyProgress] = useState(0);
  const [modelIdValidated, setModelIdValidated] = useState(false);
  const [validatingModelId, setValidatingModelId] = useState(false);
  const [modelIdMessage, setModelIdMessage] = useState("");
  const restoringRef = useRef(false);
  const spectrumSelection = getSpectrumSelection(workspaceId);
  const availableWafers = useMemo(
    () => (spectrumSelection?.waferIds?.length ? spectrumSelection.waferIds : []),
    [spectrumSelection]
  );
  const [selectedWafers, setSelectedWafers] = useState(availableWafers);
  const precisionSelection = getPrecisionSelection(workspaceId) || {};
  const schemaPrecisionInputWaferIds = useMemo(() => {
    const schema = workspaceId ? loadRecipeSchema(workspaceId) : null;
    return Array.isArray(schema?.precision?.inputWaferIds) ? schema.precision.inputWaferIds : [];
  }, [workspaceId]);
  const precisionAvailableWafers = useMemo(
    () => {
      if (schemaPrecisionInputWaferIds.length) {
        return schemaPrecisionInputWaferIds;
      }
      return Array.isArray(precisionSelection?.inputWaferIds)
        ? precisionSelection.inputWaferIds
        : [];
    },
    [schemaPrecisionInputWaferIds, precisionSelection]
  );
  const [selectedPrecisionWafers, setSelectedPrecisionWafers] = useState(precisionAvailableWafers);
  const [baselineWafer, setBaselineWafer] = useState("");
  const [baselineSpectrum, setBaselineSpectrum] = useState("");
  const removedOutliers = useMemo(
    () => spectrumSelection?.removedSpectra || [],
    [spectrumSelection]
  );
  const pickExistingOrFallback = (values, available) => {
    const list = Array.isArray(values) ? values : [];
    const filtered = list.filter((item) => available.includes(item));
    return filtered.length ? filtered : available;
  };

  const activeBaselineWafer = useMemo(() => {
    if (baselineWafer && selectedWafers.includes(baselineWafer)) {
      return baselineWafer;
    }
    return selectedWafers[0] || "";
  }, [baselineWafer, selectedWafers]);

  const baselineOptions = useMemo(() => {
    const rows = spectrumSelection?.selectedSpectra || [];
    const ids = rows
      .filter((item) => item.waferId === activeBaselineWafer)
      .map((item) => {
        if (specType === "SR") {
          return item.srFilename || item.sr_filename || item.spectrumId || "";
        }
        if (specType === "Combine") {
          return (
            item.combineFilename ||
            item.combine_filename ||
            item.seFilename ||
            item.srFilename ||
            item.spectrumId ||
            ""
          );
        }
        return item.seFilename || item.se_filename || item.spectrumId || "";
      })
      .filter(Boolean);
    return Array.from(new Set(ids));
  }, [activeBaselineWafer, spectrumSelection, specType]);

  useEffect(() => {
    setSelectedWafers(availableWafers);
  }, [availableWafers]);

  useEffect(() => {
    setSelectedPrecisionWafers(precisionAvailableWafers);
  }, [precisionAvailableWafers]);

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId);
    if (schema) {
      restoringRef.current = true;
      const schemaModelId = String(schema.modelID || "").trim();
      const savedValidation = schema?.preRecipe?.recipeSetupModelValidation;
      const restoredValidated = Boolean(
        savedValidation?.validated && savedValidation?.modelID === schemaModelId
      );
      setForm((prev) => ({
        ...prev,
        modelID: schemaModelId,
        owner: schema.owner || prev.owner,
        project: schema.project || prev.project,
        productID: schema.productID || prev.productID,
        loop: schema.loop || prev.loop,
        recipeName: schema.recipeName || prev.recipeName,
        layout: schema.layout || prev.layout,
        state: schema.state || prev.state,
        version: schema.version || prev.version
      }));
      setModelIdValidated(restoredValidated);
      setModelIdMessage(restoredValidated ? "Model ID validated." : "");
      if (schema.waferIds) {
        setSelectedWafers(pickExistingOrFallback(schema.waferIds, availableWafers));
      }
      if (schema.baselineWafer) {
        setBaselineWafer(schema.baselineWafer);
      }
      if (schema.baselineSpectrum) {
        const normalized =
          schema.baselineWafer && schema.baselineSpectrum.startsWith(`${schema.baselineWafer}-`)
            ? schema.baselineSpectrum.slice(schema.baselineWafer.length + 1)
            : schema.baselineSpectrum;
        setBaselineSpectrum(normalized);
      }
      const confirmState = schema?.preRecipe?.recipeSetupConfirm;
      if (confirmState) {
        setFittingWaferConfirmDone(Boolean(confirmState.fittingWaferConfirmed || confirmState.waferConfirmed));
        setPrecisionWaferConfirmDone(Boolean(confirmState.precisionWaferConfirmed));
        setSpecTypeConfirmDone(Boolean(confirmState.specTypeConfirmed));
        if (confirmState.specType) {
          setSpecType(confirmState.specType);
        }
        if (Array.isArray(confirmState.fittingWaferIds) && confirmState.fittingWaferIds.length) {
          setSelectedWafers(pickExistingOrFallback(confirmState.fittingWaferIds, availableWafers));
        }
        if (Array.isArray(confirmState.precisionWaferIds) && confirmState.precisionWaferIds.length) {
          setSelectedPrecisionWafers(
            pickExistingOrFallback(confirmState.precisionWaferIds, precisionAvailableWafers)
          );
        }
      }
      const transfer = schema?.spectrumAnalysis?.spectrumTransfer;
      if (transfer?.targetFolder) {
        if (transfer.specType) {
          setSpecType(transfer.specType);
        }
      }
      setTimeout(() => {
        restoringRef.current = false;
      }, 0);
    } else {
      setModelIdValidated(false);
      setModelIdMessage("");
    }
  }, [workspaceId, availableWafers, precisionAvailableWafers]);

  useEffect(() => {
    if (restoringRef.current) return;
    if (!selectedWafers.includes(baselineWafer)) {
      const next = selectedWafers[0] || "";
      setBaselineWafer(next);
      setBaselineSpectrum("");
    }
  }, [selectedWafers, baselineWafer]);

  useEffect(() => {
    if (restoringRef.current) return;
    if (!baselineWafer && activeBaselineWafer) {
      setBaselineWafer(activeBaselineWafer);
    }
  }, [baselineWafer, activeBaselineWafer]);

  useEffect(() => {
    if (!activeBaselineWafer) return;
    if (!baselineOptions.length) {
      if (baselineSpectrum) {
        setBaselineSpectrum("");
      }
      return;
    }
    if (!baselineSpectrum || !baselineOptions.includes(baselineSpectrum)) {
      setBaselineSpectrum(baselineOptions[0]);
    }
  }, [activeBaselineWafer, baselineOptions, baselineSpectrum, specType]);

  useEffect(() => {
    if (restoringRef.current) return;
    setFittingWaferConfirmDone(false);
    setCopyStatus("");
    setCopyError("");
    setCopyProgress(0);
  }, [selectedWafers]);

  useEffect(() => {
    if (restoringRef.current) return;
    setPrecisionWaferConfirmDone(false);
    setCopyStatus("");
    setCopyError("");
    setCopyProgress(0);
  }, [selectedPrecisionWafers]);

  useEffect(() => {
    if (restoringRef.current) return;
    setSpecTypeConfirmDone(false);
    setCopyStatus("");
    setCopyError("");
    setCopyProgress(0);
    setBaselineSpectrum("");
  }, [specType]);

  const refreshMetaOptions = async (projectValue, productValue) => {
    const options = await fetchRecipeHubMetaOptions({
      project: projectValue || "",
      product: productValue || ""
    });
    setProjectOptions(Array.isArray(options.projects) ? options.projects : []);
    setProductOptions(Array.isArray(options.products) ? options.products : []);
    setLoopOptions(Array.isArray(options.loops) ? options.loops : []);
  };

  useEffect(() => {
    let cancelled = false;
    const fetchMetaOptions = async () => {
      const options = await fetchRecipeHubMetaOptions({ project: form.project, product: form.productID });
      if (cancelled) return;
      setProjectOptions(Array.isArray(options.projects) ? options.projects : []);
      setProductOptions(Array.isArray(options.products) ? options.products : []);
      setLoopOptions(Array.isArray(options.loops) ? options.loops : []);
    };
    fetchMetaOptions();
    return () => {
      cancelled = true;
    };
  }, [form.project, form.productID]);

  useEffect(() => {
    if (!form.project && projectOptions.length) {
      setForm((prev) => ({ ...prev, project: projectOptions[0] }));
    }
  }, [projectOptions, form.project]);

  useEffect(() => {
    if (!form.project) {
      setForm((prev) => ({ ...prev, productID: "", loop: "" }));
      return;
    }
    if (productOptions.length && !productOptions.includes(form.productID)) {
      setForm((prev) => ({ ...prev, productID: productOptions[0], loop: "" }));
    }
  }, [form.project, productOptions, form.productID]);

  useEffect(() => {
    if (!form.productID) {
      setForm((prev) => ({ ...prev, loop: "" }));
      return;
    }
    if (loopOptions.length && !loopOptions.includes(form.loop)) {
      setForm((prev) => ({ ...prev, loop: loopOptions[0] }));
    }
  }, [form.productID, loopOptions, form.loop]);

  const handleChange = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleModelIdChange = (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, modelID: value }));
    if (!restoringRef.current) {
      setModelIdValidated(false);
      setModelIdMessage("");
    }
  };

  const validateModelId = async () => {
    const modelID = String(form.modelID || "").trim();
    if (!modelID) {
      setModelIdValidated(false);
      setModelIdMessage("Model ID is required.");
      return false;
    }
    setValidatingModelId(true);
    setModelIdMessage("");
    try {
      const result = await fetchModelExists(modelID);
      if (!result?.exists) {
        setModelIdValidated(false);
        setModelIdMessage(`Model ID "${modelID}" does not exist.`);
        return false;
      }
      setModelIdValidated(true);
      setModelIdMessage("Model ID validated.");
      saveRecipeSchema(workspaceId, {
        modelID,
        preRecipe: {
          recipeSetupModelValidation: {
            modelID,
            validated: true,
            validatedAt: new Date().toISOString()
          }
        }
      });
      return true;
    } catch (_error) {
      setModelIdValidated(false);
      setModelIdMessage("Failed to validate Model ID.");
      return false;
    } finally {
      setValidatingModelId(false);
    }
  };

  const normalizeText = (value) => (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizeExact = (value) => (value || "").toLowerCase().trim();

  const editDistance = (a, b) => {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i += 1) dp[i][0] = i;
    for (let j = 0; j <= n; j += 1) dp[0][j] = j;
    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  };

  const checkSimilarity = (value, existing) => {
    const normalized = normalizeText(value);
    const exact = normalizeExact(value);
    const matches = existing
      .map((item) => ({
        raw: item,
        norm: normalizeText(item),
        exact: normalizeExact(item)
      }))
      .filter((item) => item.norm);
    const duplicate = matches.find((item) => item.exact === exact);
    if (duplicate) {
      return { type: "duplicate", match: duplicate.raw };
    }
    const similar = matches.find((item) => {
      if (item.norm.includes(normalized) || normalized.includes(item.norm)) return true;
      return editDistance(item.norm, normalized) <= 2;
    });
    if (similar) {
      return { type: "similar", match: similar.raw };
    }
    return { type: "ok" };
  };

  const applyAdd = async (payload) => {
    if (!payload) return;
    if (payload.type === "project") {
      const ok = await addRecipeHubMetaOption({
        valueType: "project",
        value: payload.value
      });
      if (!ok) {
        setMetaNotice("Failed to add project.");
        return;
      }
      setForm((prev) => ({ ...prev, project: payload.value }));
      await refreshMetaOptions(payload.value, "");
      setNewProject("");
      setShowAddProject(false);
    }
    if (payload.type === "product") {
      if (!form.project) return;
      const ok = await addRecipeHubMetaOption({
        valueType: "product",
        value: payload.value,
        project: form.project
      });
      if (!ok) {
        setMetaNotice("Failed to add product.");
        return;
      }
      setForm((prev) => ({ ...prev, productID: payload.value }));
      await refreshMetaOptions(form.project, payload.value);
      setNewProduct("");
      setShowAddProduct(false);
    }
    if (payload.type === "loop") {
      if (!form.productID) return;
      const ok = await addRecipeHubMetaOption({
        valueType: "loop",
        value: payload.value,
        product: form.productID
      });
      if (!ok) {
        setMetaNotice("Failed to add loop.");
        return;
      }
      setForm((prev) => ({ ...prev, loop: payload.value }));
      setLoopOptions((prev) =>
        prev.includes(payload.value) ? prev : [...prev, payload.value].sort((a, b) => a.localeCompare(b))
      );
      await refreshMetaOptions(form.project, form.productID);
      setNewLoop("");
      setShowAddLoop(false);
    }
    setMetaNotice("");
  };

  const requestAdd = async (type, value, existing) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const check = checkSimilarity(trimmed, existing);
    if (check.type === "duplicate") {
      setMetaNotice(`"${trimmed}" already exists as "${check.match}".`);
      return;
    }
    if (check.type === "similar") {
      setConfirmAdd({ type, value: trimmed, match: check.match });
      return;
    }
    await applyAdd({ type, value: trimmed });
  };

  const persistRecipeSetup = () => {
    const payload = {
      ...form,
      waferIds: selectedWafers,
      baselineWafer: activeBaselineWafer,
      baselineSpectrum,
      preRecipe: {
        recipeSetupModelValidation: {
          modelID: String(form.modelID || "").trim(),
          validated: modelIdValidated,
          validatedAt: modelIdValidated ? new Date().toISOString() : null
        },
        recipeSetupConfirm: {
          fittingWaferConfirmed: fittingWaferConfirmDone,
          precisionWaferConfirmed: precisionWaferConfirmDone,
          specTypeConfirmed: specTypeConfirmDone,
          specType,
          fittingWaferIds: selectedWafers,
          precisionWaferIds: selectedPrecisionWafers
        }
      }
    };
    if (workspaceId && workspaceId !== "temp") {
      const existing = loadRecipeSchema(workspaceId) || {};
      saveRecipeSchema(workspaceId, { ...existing, ...payload });
      return workspaceId;
    }
    const tempSchema = loadRecipeSchema(workspaceId) || {};
    const workspace = createModelWorkspace(payload);
    const existing = loadRecipeSchema(workspace.id) || {};
    saveRecipeSchema(workspace.id, {
      ...tempSchema,
      ...existing,
      ...payload,
      modelID: workspace.modelID
    });
    return workspace.id;
  };

  const executeCopyTo58 = async () => {
    if (!workspaceId) return false;
    if (copying) return false;
    const schema = loadRecipeSchema(workspaceId) || {};
    const selectedSpectra = (spectrumSelection?.selectedSpectra || []).filter((item) =>
      selectedWafers.includes(item.waferId)
    );
    if (!selectedSpectra.length || !(spectrumSelection?.objectRows || []).length) {
      setCopyError("No imported spectra found. Please finish Spectrum import first.");
      return false;
    }
    const modelID = (form.modelID || "").trim();
    if (!modelID) {
      setCopyError("Model ID is required before copying spectra to server 58.");
      return false;
    }
    if (!modelIdValidated) {
      setCopyError("Please validate Model ID before Copy to 58.");
      return false;
    }
    const fittingMeasurePos = spectrumSelection?.measurePosition || "T1";
    const precisionMeasurePos = precisionSelection?.measurePosition || "T1";
    const waferInfoList = (spectrumSelection?.objectRows || [])
      .filter((row) => selectedWafers.includes(row.waferId))
      .map((row) => ({
        tool: row.tool,
        recipe: row.recipeName,
        lot: row.lotId || "",
        wafer: row.waferId,
        file_path: row.spectrumFolder,
        record_id: row.id
      }));
    const precisionWaferInfoList = (precisionSelection?.objectRows || [])
      .filter((row) => selectedPrecisionWafers.includes(row.waferId))
      .map((row) => ({
        tool: row.tool,
        recipe: row.recipeName,
        lot: row.lotId || "",
        wafer: row.waferId,
        file_path: row.spectrumFolder,
        record_id: row.id
      }));
    setCopyError("");
    setCopyStatus("");
    setCopyProgress(0);
    setCopying(true);
    try {
      setCopyProgress(10);
      const requestPayload = {
        model_id: modelID,
        version: form.version || "v0",
        spec_type: specType,
        fitting_measure_pos: fittingMeasurePos,
        fitting_wafer_ids: selectedWafers,
        fitting_wafer_info_list: waferInfoList,
        precision_measure_pos: precisionMeasurePos,
        precision_wafer_ids: selectedPrecisionWafers,
        precision_wafer_info_list: precisionWaferInfoList
      };
      const response = await fetch(`${SPECTRUM_API_BASE}/move-to-58`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.detail || payload?.error || "Copy to 58 API failed";
        throw new Error(typeof detail === "string" ? detail : "Copy to 58 API failed");
      }
      setCopyProgress(100);
      setCopyStatus("Copy to 58 success");
      saveRecipeSchema(workspaceId, {
        spectrumAnalysis: {
          spectrumSelection: {
            timeRange: spectrumSelection?.timeRange || null,
            toolId: spectrumSelection?.machineId || "",
            recipeName: spectrumSelection?.recipeName || "",
            waferIds: selectedWafers,
            measurePosition: fittingMeasurePos,
            specType,
            removedSpectra: removedOutliers
          },
          spectrumTransfer: {
            transferId: payload.transfer_id || payload.transferId || `XFER-${Date.now()}`,
            sourceServer: payload.source_server || payload.sourceServer || "242",
            targetServer: payload.target_server || payload.targetServer || "58",
            targetRoot: payload.target_root || payload.targetRoot || "",
            targetFolder: payload.target_folder || payload.targetFolder || "",
            precisionFolder: payload.precision_folder || payload.precisionFolder || "",
            copyMode: payload.copy_mode || payload.copyMode || "full-wafer",
            copiedWafers: payload.copied_wafers || payload.copiedWafers || selectedWafers,
            copiedPrecisionWafers:
              payload.copied_precision_wafers || payload.copiedPrecisionWafers || selectedPrecisionWafers,
            fittingMeasurePos: payload.fitting_measure_pos || fittingMeasurePos,
            precisionMeasurePos: payload.precision_measure_pos || precisionMeasurePos,
            specType: payload.spec_type || payload.specType || specType,
            requestPayload: payload.request_payload || requestPayload,
            status: payload.status || "succeeded",
            copiedAt: payload.copied_at || payload.copiedAt || new Date().toISOString()
          }
        },
        precision: {
          worstPointId: schema?.precision?.worstPointId || null
        },
        preRecipe: {
          recipeSetupModelValidation: {
            modelID,
            validated: true,
            validatedAt: new Date().toISOString()
          },
          recipeSetupConfirm: {
            fittingWaferConfirmed: true,
            precisionWaferConfirmed: true,
            specTypeConfirmed: true,
            specType,
            fittingWaferIds: selectedWafers,
            precisionWaferIds: selectedPrecisionWafers
          }
        }
      });
      return true;
    } catch (error) {
      setCopyError(error?.message || "Copy to 58 failed.");
      return false;
    } finally {
      setCopying(false);
    }
  };

  const handleSaveSetup = () => {
    const nextId = persistRecipeSetup();
    if (workspaceId === "temp" && nextId && nextId !== "temp") {
      window.location.hash = buildHashHref(`/ocd/workspace/${nextId}/pre-recipe/recipe-setup`);
    }
  };

  const handleNextStep = () => {
    const nextId = persistRecipeSetup();
    if (nextId) {
      window.location.hash = buildHashHref(`/ocd/workspace/${nextId}/pre-recipe/model`);
    }
  };

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Pre-Recipe</p>
          <h2>Recipe Setup</h2>
          <p className="subtle">Confirm recipe inputs to start persistence.</p>
        </div>
        <div />
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Pre-Recipe Progress</h3>
        </div>
        <div className="chip-row">
          <span className="chip">Step 1: Recipe Setup</span>
          <span className="chip chip-muted">Step 2: Model</span>
          <span className="chip chip-muted">Step 3: TEM & KPI</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Recipe Meta</h3>
        </div>
        <div className="form-grid two-col">
          <div className="form-row">
            <label>Model ID</label>
            <div className="inline-actions">
              <input
                type="text"
                value={form.modelID}
                onChange={handleModelIdChange}
                disabled={readOnly || modelIdValidated}
              />
              <button
                className="ghost-button"
                type="button"
                disabled={readOnly || modelIdValidated || validatingModelId || !String(form.modelID || "").trim()}
                onClick={() => {
                  void validateModelId();
                }}
              >
                {validatingModelId ? "Validating..." : modelIdValidated ? "Validated" : "Validate"}
              </button>
            </div>
            {modelIdMessage ? <p className="panel-note">{modelIdMessage}</p> : null}
          </div>
          <div className="form-row">
            <label>Recipe Name</label>
            <input type="text" value={form.recipeName} onChange={handleChange("recipeName")} />
          </div>
          <div className="form-row">
            <label>Owner</label>
            <input type="text" value={form.owner} onChange={handleChange("owner")} />
          </div>
          <div className="form-row">
            <div className="label-row">
              <label>Project</label>
              <button className="icon-button" type="button" onClick={() => setShowAddProject((prev) => !prev)}>+</button>
            </div>
            <select value={form.project} onChange={handleChange("project")}>
              <option value="">Select project</option>
              {projectOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            {showAddProject ? (
              <div className="inline-actions">
                <input
                  type="text"
                  placeholder="New project"
                  value={newProject}
                  onChange={(event) => setNewProject(event.target.value)}
                />
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    void requestAdd("project", newProject, projectOptions);
                  }}
                >
                  Add
                </button>
              </div>
            ) : null}
          </div>
          <div className="form-row">
            <div className="label-row">
              <label>Product ID</label>
              <button className="icon-button" type="button" onClick={() => setShowAddProduct((prev) => !prev)}>+</button>
            </div>
            <select value={form.productID} onChange={handleChange("productID")}>
              <option value="">Select product</option>
              {productOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            {showAddProduct ? (
              <div className="inline-actions">
                <input
                  type="text"
                  placeholder="New product"
                  value={newProduct}
                  onChange={(event) => setNewProduct(event.target.value)}
                />
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!form.project}
                  onClick={() => {
                    void requestAdd("product", newProduct, productOptions);
                  }}
                >
                  Add
                </button>
              </div>
            ) : null}
          </div>
          <div className="form-row">
            <div className="label-row">
              <label>Loop</label>
              <button className="icon-button" type="button" onClick={() => setShowAddLoop((prev) => !prev)}>+</button>
            </div>
            <select value={form.loop} onChange={handleChange("loop")}>
              <option value="">Select loop</option>
              {loopOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            {showAddLoop ? (
              <div className="inline-actions">
                <input
                  type="text"
                  placeholder="New loop"
                  value={newLoop}
                  onChange={(event) => setNewLoop(event.target.value)}
                />
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!form.productID}
                  onClick={() => {
                    void requestAdd("loop", newLoop, loopOptions);
                  }}
                >
                  Add
                </button>
              </div>
            ) : null}
          </div>
          <div className="form-row">
            <label>Layout</label>
            <input type="text" value={form.layout} onChange={handleChange("layout")} />
          </div>
          <div className="form-row">
            <label>State</label>
            <input type="text" value={form.state} onChange={handleChange("state")} />
          </div>
          <div className="form-row">
            <label>Version</label>
            <input
              type="text"
              value={form.version}
              onChange={handleChange("version")}
              disabled={Boolean(workspaceId && workspaceId !== "temp") || readOnly}
            />
          </div>
        </div>
        {metaNotice ? <p className="panel-note">{metaNotice}</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Confirm Wafer ID</h3>
        </div>
        <div className="form-grid two-col">
          <div className="form-row">
            <label>Confirm fitting waferid</label>
            <MultiSelectDropdown
              label="Fitting WaferID"
              options={availableWafers.map((id) => ({ value: id, label: id }))}
              value={selectedWafers}
              onChange={setSelectedWafers}
              enableSelectAll
              selectAllLabel="Select All"
            />
          </div>
          <div className="form-row">
            <label>Confirm precision waferid</label>
            <MultiSelectDropdown
              label="Precision WaferID"
              options={precisionAvailableWafers.map((id) => ({ value: id, label: id }))}
              value={selectedPrecisionWafers}
              onChange={setSelectedPrecisionWafers}
              enableSelectAll
              selectAllLabel="Select All"
            />
          </div>
          <div className="form-row">
            <label>Confirm spec type (SE/SR/Combine)</label>
            <select value={specType} onChange={(event) => setSpecType(event.target.value)}>
              <option value="SE">SE</option>
              <option value="SR">SR</option>
              <option value="Combine">Combine</option>
            </select>
          </div>
        </div>
        <div className="inline-actions top-pad">
          <button
            className="primary-button"
            type="button"
            disabled={readOnly || copying || !selectedWafers.length || !selectedPrecisionWafers.length || !specType}
            onClick={async () => {
              setFittingWaferConfirmDone(true);
              setPrecisionWaferConfirmDone(true);
              setSpecTypeConfirmDone(true);
              setCopyError("");
              await executeCopyTo58();
            }}
          >
            {copying ? "Copying..." : "Confirm"}
          </button>
        </div>
        {copyError ? <p className="panel-note">{copyError}</p> : null}
        {copying ? (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${copyProgress}%` }} />
          </div>
        ) : null}
        {copyStatus ? <p className="panel-note">{copyStatus}</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Confirm Baseline Spectrum</h3>
        </div>
        <div className="form-grid two-col">
          <div className="form-row">
            <label>WaferID</label>
            <select
              value={activeBaselineWafer}
              onChange={(event) => {
                setBaselineWafer(event.target.value);
                setBaselineSpectrum("");
              }}
            >
              {selectedWafers.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Spectrum ID</label>
            <select
              value={baselineSpectrum}
              onChange={(event) => setBaselineSpectrum(event.target.value)}
            >
              <option value="">Select spectrum</option>
              {baselineOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <WorkflowFooter
        workspaceId={workspaceId}
        onSave={handleSaveSetup}
        onNext={handleNextStep}
        readOnly={readOnly}
      />
      {confirmAdd ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Similar Entry Detected</h3>
            <p className="summary-label">
              "{confirmAdd.value}" is similar to "{confirmAdd.match}". Add anyway?
            </p>
            <div className="inline-actions">
              <button className="ghost-button" onClick={() => setConfirmAdd(null)}>Cancel</button>
              <button
                className="primary-button"
                onClick={() => {
                  void applyAdd(confirmAdd);
                  setConfirmAdd(null);
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
