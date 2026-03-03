import React, { useEffect, useState } from "react";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import { getSpectrumSelection, loadRecipeSchema, saveRecipeSchema } from "../../data/mockApi.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";

const initialRows = [
  { wafer: "WAFER-223A", spectrum: "SPEC-001", cd1: "32.4", cd2: "64.1" },
  { wafer: "WAFER-118C", spectrum: "SPEC-002", cd1: "31.9", cd2: "63.8" }
];

const defaultKpi = { sbs: "1.2", slopeLow: "0.9", slopeHigh: "1", r2: "0.95", precision: "0.8" };
const initialKpiByCd = {
  CD1: { ...defaultKpi },
  CD2: { ...defaultKpi, sbs: "1.5", precision: "0.9" }
};

export default function TmKpi({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const [cdColumns, setCdColumns] = useState(["CD1", "CD2"]);
  const [cdKeys, setCdKeys] = useState(["cd1", "cd2"]);
  const [rows, setRows] = useState(initialRows);
  const [kpiByCd, setKpiByCd] = useState(initialKpiByCd);
  const [basisCdNames, setBasisCdNames] = useState([]);
  const [confirmedFittingWafers, setConfirmedFittingWafers] = useState([]);
  const [specType, setSpecType] = useState("SE");
  const [spectrumOptionsByWafer, setSpectrumOptionsByWafer] = useState({});
  const [cdHeaderError, setCdHeaderError] = useState("");
  const sanitizeWafer = (value, waferPool = confirmedFittingWafers) => {
    if (!waferPool.length) return "";
    return waferPool.includes(value) ? value : waferPool[0];
  };
  const resolveSpectrumName = (item, currentSpecType) => {
    if (currentSpecType === "SR") {
      return item?.srFilename || item?.sr_filename || item?.spectrumId || "";
    }
    if (currentSpecType === "Combine") {
      return (
        item?.combineFilename ||
        item?.combine_filename ||
        item?.seFilename ||
        item?.srFilename ||
        item?.spectrumId ||
        ""
      );
    }
    return item?.seFilename || item?.se_filename || item?.spectrumId || "";
  };
  const sanitizeSpectrum = (waferId, spectrumValue, optionsMap = spectrumOptionsByWafer) => {
    const options = optionsMap[waferId] || [];
    if (!options.length) return "";
    return options.includes(spectrumValue) ? spectrumValue : options[0];
  };

  const addCdColumn = () => {
    const nextIndex = cdKeys.length + 1;
    const preferred = basisCdNames[0] || `CD${nextIndex}`;
    const fallback = basisCdNames.find((name) => !cdColumns.includes(name));
    let nextLabel = preferred;
    if (cdColumns.includes(nextLabel)) {
      nextLabel = fallback || `${preferred}_${nextIndex}`;
    }
    const nextKey = `cd${nextIndex}`;
    setCdColumns((prev) => [...prev, nextLabel]);
    setCdKeys((prev) => [...prev, nextKey]);
    setRows((prev) => prev.map((row) => ({ ...row, [nextKey]: "" })));
    setKpiByCd((prev) => ({
      ...prev,
      [nextLabel]: { ...defaultKpi }
    }));
  };

  const updateCdHeader = (index, value) => {
    if (!value) return;
    const current = cdColumns[index];
    if (current === value) return;
    const duplicated = cdColumns.some((col, idx) => idx !== index && col === value);
    if (duplicated) {
      setCdHeaderError(`"${value}" already exists in TEM Input Table.`);
      return;
    }
    setCdHeaderError("");
    setCdColumns((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setKpiByCd((prev) => {
      const next = { ...prev };
      if (next[current]) {
        next[value] = next[current];
        delete next[current];
      } else if (!next[value]) {
        next[value] = { ...defaultKpi };
      }
      return next;
    });
  };

  const updateRow = (rowIndex, field, value) => {
    setRows((prev) => prev.map((row, idx) => (idx === rowIndex ? { ...row, [field]: value } : row)));
  };

  const deleteRow = (rowIndex) => {
    setRows((prev) => prev.filter((_, idx) => idx !== rowIndex));
  };

  const deleteColumn = (colIndex) => {
    const remainingCols = cdColumns.filter((_, idx) => idx !== colIndex);
    const remainingKeys = cdKeys.filter((_, idx) => idx !== colIndex);
    const removedLabel = cdColumns[colIndex];
    setCdColumns(remainingCols);
    setCdKeys(remainingKeys);
    setRows((prev) =>
      prev.map((row) => {
        const next = { wafer: row.wafer, spectrum: row.spectrum };
        remainingKeys.forEach((key) => {
          next[key] = row[key] || "";
        });
        return next;
      })
    );
    setKpiByCd((prev) => {
      const next = { ...prev };
      delete next[removedLabel];
      return next;
    });
  };

  const updateKpiValue = (cd, field, value) => {
    setKpiByCd((prev) => ({
      ...prev,
      [cd]: { ...(prev[cd] || {}), [field]: value }
    }));
  };

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId);
    const spectrumSelection =
      schema?.spectrumAnalysis?.spectrumSelection || getSpectrumSelection(workspaceId) || {};
    const basisNames = (schema?.model?.basisRows || [])
      .map((row) => row?.name)
      .filter(Boolean);
    const nextSpecType =
      schema?.preRecipe?.recipeSetupConfirm?.specType ||
      schema?.spectrumAnalysis?.spectrumTransfer?.specType ||
      "SE";
    setSpecType(nextSpecType);
    const confirmedWafers =
      schema?.preRecipe?.recipeSetupConfirm?.fittingWaferIds?.length
        ? schema.preRecipe.recipeSetupConfirm.fittingWaferIds
        : schema?.waferIds?.length
          ? schema.waferIds
          : [];
    const selectedSpectra = spectrumSelection?.selectedSpectra || [];
    const nextSpectrumOptionsByWafer = {};
    selectedSpectra.forEach((item) => {
      const waferId = item?.waferId;
      if (!waferId) return;
      const spectrumName = resolveSpectrumName(item, nextSpecType);
      if (!spectrumName) return;
      if (!nextSpectrumOptionsByWafer[waferId]) {
        nextSpectrumOptionsByWafer[waferId] = [];
      }
      if (!nextSpectrumOptionsByWafer[waferId].includes(spectrumName)) {
        nextSpectrumOptionsByWafer[waferId].push(spectrumName);
      }
    });
    setSpectrumOptionsByWafer(nextSpectrumOptionsByWafer);
    setConfirmedFittingWafers(Array.from(new Set((confirmedWafers || []).filter(Boolean))));
    setBasisCdNames(basisNames);
    const defaultBasisColumns = basisNames.slice(0, 2);
    const nextCdColumns = schema?.tem?.cdColumns?.length
      ? schema.tem.cdColumns
      : (defaultBasisColumns.length ? defaultBasisColumns : cdColumns);
    setCdColumns(nextCdColumns);
    const keysFromRows =
      schema?.tem?.rows && schema.tem.rows.length
        ? Object.keys(schema.tem.rows[0]).filter((key) => key !== "wafer" && key !== "spectrum")
        : nextCdColumns.map((_, index) => `cd${index + 1}`);
    if (schema?.tem?.rows && schema.tem.rows.length) {
      setRows(
        schema.tem.rows.map((row) => ({
          ...row,
          wafer: sanitizeWafer(row.wafer, confirmedWafers),
          spectrum: sanitizeSpectrum(
            sanitizeWafer(row.wafer, confirmedWafers),
            row.spectrum,
            nextSpectrumOptionsByWafer
          )
        }))
      );
    } else {
      setRows(
        initialRows.map((row) => {
          const next = { wafer: row.wafer, spectrum: row.spectrum };
          keysFromRows.forEach((key) => {
            next[key] = row[key] || "";
          });
          next.wafer = sanitizeWafer(next.wafer, confirmedWafers);
          next.spectrum = sanitizeSpectrum(next.wafer, next.spectrum, nextSpectrumOptionsByWafer);
          return next;
        })
      );
    }
    if (keysFromRows.length) {
      setCdKeys(keysFromRows);
    }
    if (Array.isArray(schema?.kpi)) {
      const nextKpi = {};
      schema.kpi.forEach((row) => {
        nextKpi[row.cd] = {
          sbs: row.sbs ?? "",
          slopeLow: row.slope_low ?? "",
          slopeHigh: row.slope_high ?? "",
          r2: row.r2 ?? "",
          precision: row.precision ?? ""
        };
      });
      setKpiByCd((prev) => {
        const merged = { ...prev, ...nextKpi };
        nextCdColumns.forEach((cd) => {
          if (!merged[cd]) merged[cd] = { ...defaultKpi };
        });
        return merged;
      });
    } else {
      setKpiByCd((prev) => {
        const next = { ...prev };
        nextCdColumns.forEach((cd) => {
          if (!next[cd]) next[cd] = { ...defaultKpi };
        });
        return next;
      });
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!confirmedFittingWafers.length) return;
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        wafer: sanitizeWafer(row.wafer, confirmedFittingWafers),
        spectrum: sanitizeSpectrum(
          sanitizeWafer(row.wafer, confirmedFittingWafers),
          row.spectrum,
          spectrumOptionsByWafer
        )
      }))
    );
  }, [confirmedFittingWafers, spectrumOptionsByWafer]);

  const parseNumber = (value) => {
    if (value === "" || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handleSaveStep = () => {
    if (!workspaceId) return;
    const sanitizedRows = rows.map((row) => ({
      ...row,
      wafer: sanitizeWafer(row.wafer, confirmedFittingWafers),
      spectrum: sanitizeSpectrum(
        sanitizeWafer(row.wafer, confirmedFittingWafers),
        row.spectrum,
        spectrumOptionsByWafer
      )
    }));
    setRows(sanitizedRows);
    const kpiRows = cdColumns.map((cd) => {
      const entry = kpiByCd[cd] || {};
      return {
        cd,
        sbs: parseNumber(entry.sbs),
        slope_low: parseNumber(entry.slopeLow),
        slope_high: parseNumber(entry.slopeHigh),
        r2: parseNumber(entry.r2),
        precision: parseNumber(entry.precision)
      };
    });
    saveRecipeSchema(workspaceId, {
      tem: {
        cdColumns,
        rows: sanitizedRows
      },
      kpi: kpiRows
    });
  };

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Pre-Recipe</p>
          <h2>TEM & KPI</h2>
          <p className="subtle">Define TEM values and KPI thresholds before launching run.</p>
        </div>
        <div />
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>TEM Input Table</h3>
          <div className="inline-actions">
            <button className="ghost-button" onClick={addCdColumn}>Add CD Column</button>
            <button
              className="ghost-button"
              onClick={() =>
                setRows((prev) => [
                  ...prev,
                  {
                    wafer: confirmedFittingWafers[0] || "",
                    spectrum: "",
                    ...Object.fromEntries(cdKeys.map((key) => [key, ""]))
                  }
                ])
              }
            >
              Add Row
            </button>
          </div>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>WaferID</span>
            <span>SpectrumID</span>
            {cdColumns.map((col, index) => (
              <div key={`${col}-${index}`} className="table-head-cell">
                <select
                  value={col}
                  onChange={(event) => updateCdHeader(index, event.target.value)}
                >
                  {[...new Set([col, ...basisCdNames])].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button className="delete-chip" onClick={() => deleteColumn(index)}>×</button>
              </div>
            ))}
          </div>
          {rows.map((row, rowIndex) => (
            <div className="table-row" key={`${row.wafer}-${rowIndex}`}>
              <div className="table-cell">
                <select
                  value={sanitizeWafer(row.wafer, confirmedFittingWafers)}
                  onChange={(event) => updateRow(rowIndex, "wafer", event.target.value)}
                >
                  <option value="">
                    {confirmedFittingWafers.length ? "Select wafer" : "No confirmed wafer"}
                  </option>
                  {confirmedFittingWafers.map((waferId) => (
                    <option key={`${rowIndex}-${waferId}`} value={waferId}>
                      {waferId}
                    </option>
                  ))}
                </select>
                <button className="delete-chip" onClick={() => deleteRow(rowIndex)}>×</button>
              </div>
              <select
                value={sanitizeSpectrum(sanitizeWafer(row.wafer, confirmedFittingWafers), row.spectrum)}
                onChange={(event) => updateRow(rowIndex, "spectrum", event.target.value)}
              >
                <option value="">Select spectrum</option>
                {(spectrumOptionsByWafer[sanitizeWafer(row.wafer, confirmedFittingWafers)] || []).map((name) => (
                  <option key={`${rowIndex}-${name}`} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {cdKeys.map((field) => {
                return (
                  <input
                    key={`${rowIndex}-${field}`}
                    value={row[field] || ""}
                    onChange={(event) => updateRow(rowIndex, field, event.target.value)}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {cdHeaderError ? <div className="panel-note">{cdHeaderError}</div> : null}
        <div className="panel-note">KPI validation runs before start.</div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>KPI Thresholds</h3>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>CD</span>
            <span>SBS</span>
            <span>Slope Low</span>
            <span>Slope High</span>
            <span>R2</span>
            <span>Precision</span>
          </div>
          {cdColumns.map((cd) => {
            const row = kpiByCd[cd] || {};
            return (
              <div className="table-row" key={cd}>
                <div className="table-cell">{cd}</div>
                <input
                  type="number"
                  value={row.sbs || ""}
                  onChange={(event) => updateKpiValue(cd, "sbs", event.target.value)}
                />
                <input
                  type="number"
                  value={row.slopeLow || ""}
                  onChange={(event) => updateKpiValue(cd, "slopeLow", event.target.value)}
                />
                <input
                  type="number"
                  value={row.slopeHigh || ""}
                  onChange={(event) => updateKpiValue(cd, "slopeHigh", event.target.value)}
                />
                <input
                  type="number"
                  value={row.r2 || ""}
                  onChange={(event) => updateKpiValue(cd, "r2", event.target.value)}
                />
                <input
                  type="number"
                  value={row.precision || ""}
                  onChange={(event) => updateKpiValue(cd, "precision", event.target.value)}
                />
              </div>
            );
          })}
        </div>
      </section>

      <WorkflowFooter workspaceId={workspaceId} onSave={handleSaveStep} readOnly={readOnly} />
    </div>
  );
}
