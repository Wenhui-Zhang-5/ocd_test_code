import React, { useEffect, useState } from "react";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import { loadRecipeSchema, saveRecipeSchema } from "../../data/mockApi.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";

const buildInitialSelections = (rows) =>
  rows.reduce((acc, row) => {
    acc[row.id] = { mustFloat: false, mustFix: false, maybe: false };
    return acc;
  }, {});

const buildSelectionsFromSchema = (rows, saved) => {
  if (!saved) return buildInitialSelections(rows);
  if (saved.selections) {
    return rows.reduce((acc, row) => {
      acc[row.id] = saved.selections[row.id] || { mustFloat: false, mustFix: false, maybe: false };
      return acc;
    }, {});
  }
  const selections = buildInitialSelections(rows);
  (saved.mustFloat || []).forEach((id) => {
    if (selections[id]) selections[id].mustFloat = true;
  });
  (saved.mustFix || []).forEach((id) => {
    if (selections[id]) selections[id].mustFix = true;
  });
  (saved.maybe || []).forEach((id) => {
    if (selections[id]) selections[id].maybe = true;
  });
  return selections;
};

const buildGridDefaults = (rows) =>
  rows.reduce((acc, row) => {
    const range = row.min !== "" && row.max !== "" ? `${row.min}-${row.max}` : row.range || "";
    acc[row.id] = { range, step: "0.1", customValues: "" };
    return acc;
  }, {});

export default function CdStrategy({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const [rows, setRows] = useState([]);
  const [selections, setSelections] = useState({});
  const [gridFixed, setGridFixed] = useState({});
  const [schemes, setSchemes] = useState([
    { id: "scheme-a", name: "Scheme A", expression: "CCD01 = CD01 - CD03; CCD02 = CD02 * 0.03" },
    { id: "scheme-b", name: "Scheme B", expression: "CCD01 = CD01 - CD02" }
  ]);

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId) || {};
    const basis = schema.model?.modelJson?.content?.basis || schema.model?.basisRows || [];
    const mappedRows = basis.map((row, index) => ({
      id: row.name || row.alias || `CD_${index + 1}`,
      name: row.name || row.alias || `CD_${index + 1}`,
      customName: row.custom_name || row.customName || row.name || row.alias || "",
      nominal: row.nominal ?? "",
      min: row.min ?? "",
      max: row.max ?? "",
      range: row.range || ""
    }));
    setRows(mappedRows);
    const savedStrategy = schema.cdStrategy || {};
    setSelections(buildSelectionsFromSchema(mappedRows, savedStrategy));
    if (savedStrategy.gridFixed) {
      setGridFixed(savedStrategy.gridFixed);
    } else {
      setGridFixed(buildGridDefaults(mappedRows));
    }
    if (savedStrategy.schemes) {
      setSchemes(savedStrategy.schemes);
    }
  }, [workspaceId]);

  const toggleSelection = (id, key) => {
    setSelections((prev) => ({
      ...prev,
      [id]: {
        mustFloat: key === "mustFloat",
        mustFix: key === "mustFix",
        maybe: key === "maybe"
      }
    }));
  };

  const updateGrid = (id, field, value) => {
    setGridFixed((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value }
    }));
  };

  const handleSave = () => {
    const mustFloat = [];
    const mustFix = [];
    const maybe = [];

    Object.entries(selections).forEach(([id, value]) => {
      if (value.mustFloat) mustFloat.push(id);
      if (value.mustFix) mustFix.push(id);
      if (value.maybe) maybe.push(id);
    });

    saveRecipeSchema(workspaceId, {
      cdStrategy: {
        mustFloat,
        mustFix,
        maybe,
        selections,
        gridFixed,
        schemes
      }
    });
  };

  const addScheme = () => {
    const nextIndex = schemes.length + 1;
    setSchemes((prev) => [
      ...prev,
      { id: `scheme-${Date.now()}`, name: `Scheme ${nextIndex}`, expression: "" }
    ]);
  };

  const updateScheme = (id, field, value) => {
    setSchemes((prev) => prev.map((scheme) => (scheme.id === id ? { ...scheme, [field]: value } : scheme)));
  };

  const removeScheme = (id) => {
    setSchemes((prev) => prev.filter((scheme) => scheme.id !== id));
  };

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Recipe</p>
          <h2>CD Strategy</h2>
          <p className="subtle">Classify CDs into Must Float, Must Fix, or Maybe.</p>
        </div>
        <div />
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>CD Classification</h3>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>CD Name</span>
            <span>Custom Name</span>
            <span>Must Float</span>
            <span>Must Fix</span>
            <span>Maybe</span>
          </div>
          {rows.map((row) => (
            <div className="table-row" key={row.id}>
              <span>{row.name}</span>
              <span>{row.customName}</span>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selections[row.id]?.mustFloat || false}
                  onChange={() => toggleSelection(row.id, "mustFloat")}
                />
                <span />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selections[row.id]?.mustFix || false}
                  onChange={() => toggleSelection(row.id, "mustFix")}
                />
                <span />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selections[row.id]?.maybe || false}
                  onChange={() => toggleSelection(row.id, "maybe")}
                />
                <span />
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Grid Fixed Parameters</h3>
          <div />
        </div>
          <div className="table">
            <div className="table-row table-head">
              <span>CD</span>
              <span>Range</span>
              <span>Step</span>
              <span>Custom CD Values</span>
            </div>
            {rows.filter((row) => selections[row.id]?.maybe).map((row) => (
              <div className="table-row" key={`${row.id}-grid`}>
                <span>{row.name}</span>
                <input
                  type="text"
                  value={gridFixed[row.id]?.range || ""}
                  onChange={(event) => updateGrid(row.id, "range", event.target.value)}
                />
                <input
                  type="text"
                  value={gridFixed[row.id]?.step || ""}
                  onChange={(event) => updateGrid(row.id, "step", event.target.value)}
                />
                <input
                  type="text"
                  placeholder="[1,2,3,4]"
                  value={gridFixed[row.id]?.customValues || ""}
                  onChange={(event) => updateGrid(row.id, "customValues", event.target.value)}
                />
              </div>
            ))}
          </div>
        </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Coupling Scheme</h3>
          <button className="ghost-button" onClick={addScheme}>Add Scheme</button>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>Scheme Name</span>
            <span>Expression</span>
          </div>
          {schemes.map((scheme) => (
            <div className="table-row" key={scheme.id}>
              <div className="table-cell">
                <input
                  value={scheme.name}
                  onChange={(event) => updateScheme(scheme.id, "name", event.target.value)}
                />
                <button className="delete-chip" onClick={() => removeScheme(scheme.id)}>×</button>
              </div>
              <input
                value={scheme.expression}
                onChange={(event) => updateScheme(scheme.id, "expression", event.target.value)}
              />
            </div>
          ))}
        </div>
      </section>

      <WorkflowFooter workspaceId={workspaceId} onSave={handleSave} readOnly={readOnly} />
    </div>
  );
}
