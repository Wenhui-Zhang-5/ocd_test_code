import React, { useEffect, useMemo, useState } from "react";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import { loadRecipeSchema, saveRecipeSchema } from "../../data/mockApi.js";
import { SPECTRUM_API_BASE } from "../../config/env.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";

export default function RecipeCheck({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const [schemaText, setSchemaText] = useState("");
  const [validation, setValidation] = useState(null);
  const [running, setRunning] = useState(false);
  const [startStatus, setStartStatus] = useState("");
  const [startError, setStartError] = useState("");

  const validateSchema = (schema) => {
    const checks = [
      {
        key: "model.modelJson",
        ok: Boolean(schema?.model?.modelJson)
      },
      {
        key: "cdStrategy",
        ok: Boolean(schema?.cdStrategy)
      },
      {
        key: "startingPoint",
        ok: Boolean(schema?.startingPoint)
      },
      {
        key: "fittingStrategy",
        ok: Boolean(schema?.fittingStrategy)
      },
      {
        key: "tem.rows",
        ok: Array.isArray(schema?.tem?.rows) && schema.tem.rows.length > 0
      },
      {
        key: "kpi",
        ok: Array.isArray(schema?.kpi) && schema.kpi.length > 0
      }
    ];
    const missing = checks.filter((item) => !item.ok).map((item) => item.key);
    return {
      status: missing.length ? "failed" : "passed",
      missing,
      checks
    };
  };

  const runValidation = () => {
    if (!workspaceId) return null;
    setRunning(true);
    const schema = loadRecipeSchema(workspaceId) || {};
    const result = validateSchema(schema);
    const pretty = JSON.stringify(schema, null, 2);
    setSchemaText(pretty);
    setValidation(result);
    saveRecipeSchema(workspaceId, {
      recipeCheck: {
        validated: result.status === "passed",
        validatedAt: new Date().toISOString(),
        missing: result.missing
      }
    });
    setRunning(false);
    return result;
  };

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId) || {};
    if (schema && Object.keys(schema).length) {
      setSchemaText(JSON.stringify(schema, null, 2));
    }
    if (schema?.recipeCheck) {
      setValidation({
        status: schema.recipeCheck.validated ? "passed" : "failed",
        missing: schema.recipeCheck.missing || [],
        checks: []
      });
    }
  }, [workspaceId]);

  const validationSummary = useMemo(() => {
    if (!validation) return "Not validated yet.";
    if (validation.status === "passed") return "Validation passed.";
    if (validation.missing.length) return `Validation failed. Missing: ${validation.missing.join(", ")}`;
    return "Validation failed.";
  }, [validation]);

  const handleSaveStep = () => {
    if (!workspaceId) return true;
    const result = validation || runValidation();
    if (!result) return false;
    saveRecipeSchema(workspaceId, {
      recipeCheck: {
        validated: result.status === "passed",
        validatedAt: new Date().toISOString(),
        missing: result.missing
      }
    });
    return true;
  };

  const handleStartOptimization = async () => {
    if (!workspaceId) return;
    const result = validation || runValidation();
    if (!result || result.status !== "passed") {
      setStartError("Validation required before optimization.");
      setStartStatus("");
      return;
    }
    const schema = loadRecipeSchema(workspaceId) || {};
    const modelId = String(schema?.modelID || workspaceId || "").trim();
    const version = String(schema?.version || "v0").trim();
    setStartStatus("Starting...");
    setStartError("");
    try {
      const response = await fetch(`${SPECTRUM_API_BASE}/start-optimization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: modelId,
          version,
          recipe_schema: schema
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.detail || payload?.error || "Start optimization failed";
        throw new Error(typeof detail === "string" ? detail : "Start optimization failed");
      }
      setStartStatus(`Ready. Saved to ${payload.recipe_json_dir || "-"}`);
      setStartError("");
      saveRecipeSchema(workspaceId, {
        recipeCheck: {
          ...(schema.recipeCheck || {}),
          optimizationReady: true,
          optimizationReadyAt: new Date().toISOString(),
          optimizationPaths: {
            caseRoot: payload.case_root || "",
            recipeJsonDir: payload.recipe_json_dir || "",
            schemaPath: payload.schema_path || "",
            modelJsonPath: payload.model_json_path || ""
          }
        }
      });
    } catch (error) {
      setStartStatus("");
      setStartError(error?.message || "Start optimization failed");
    }
  };

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Recipe Build</p>
          <h2>Recipe Check</h2>
          <p className="subtle">
            Validate recipe JSON schema and start optimization for {workspaceId}.
          </p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Schema Validation</h3>
          <button className="ghost-button" onClick={runValidation} disabled={running}>
            {running ? "Running..." : "Run Validation"}
          </button>
        </div>
        <div className="panel-note">{validationSummary}</div>
        {validation?.checks?.length ? (
          <div className="table">
            <div className="table-row table-head">
              <span>Check Item</span>
              <span>Status</span>
            </div>
            {validation.checks.map((item) => (
              <div className="table-row" key={item.key}>
                <span className="mono">{item.key}</span>
                <span className={`status-pill status-${item.ok ? "completed" : "failed"}`}>
                  {item.ok ? "ok" : "missing"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="json-preview">
          <pre>
            <code>{schemaText || "{}"}</code>
          </pre>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Optimization</h3>
        </div>
        <div className="panel-note">
          {validation?.status === "passed"
            ? "All required fields validated. Ready to start optimization."
            : "Validation required before optimization."}
        </div>
        <div className="inline-actions">
          <button
            className="primary-button"
            disabled={validation?.status !== "passed"}
            onClick={handleStartOptimization}
          >
            Start Optimization
          </button>
        </div>
        {startStatus ? <div className="panel-note">{startStatus}</div> : null}
        {startError ? <div className="panel-note">{startError}</div> : null}
      </section>
      <WorkflowFooter workspaceId={workspaceId} onSave={handleSaveStep} readOnly={readOnly} />
    </div>
  );
}
