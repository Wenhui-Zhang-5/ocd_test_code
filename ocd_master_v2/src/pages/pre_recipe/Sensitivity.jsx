import React, { useEffect, useMemo, useState } from "react";
import MultiSelectDropdown from "../../components/MultiSelectDropdown.jsx";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import { getSpectrumSelection, loadRecipeSchema, saveRecipeSchema } from "../../data/mockApi.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";
import { waferIds } from "../../data/mock.js";

export default function Sensitivity({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const [splitTags, setSplitTags] = useState(["splitTag1"]);
  const [analysisTargets, setAnalysisTargets] = useState(["splitTag1"]);
  const [tagAssignments, setTagAssignments] = useState({});

  const updateSplitTag = (index, value) => {
    setSplitTags((prev) => prev.map((tag, idx) => (idx === index ? value : tag)));
  };

  const addSplitTag = () => {
    setSplitTags((prev) => [...prev, `splitTag${prev.length + 1}`]);
  };

  const removeSplitTag = (removeIndex) => {
    setSplitTags((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, index) => index !== removeIndex);
      return next.length ? next : prev;
    });
    setTagAssignments((prev) => {
      const next = {};
      Object.keys(prev || {}).forEach((waferId) => {
        const current = prev[waferId] || {};
        const updated = {};
        Object.keys(current).forEach((key) => {
          if (!key.startsWith("tag_")) return;
          const oldIndex = Number(key.replace("tag_", ""));
          if (Number.isNaN(oldIndex) || oldIndex === removeIndex) return;
          const newIndex = oldIndex > removeIndex ? oldIndex - 1 : oldIndex;
          updated[`tag_${newIndex}`] = current[key];
        });
        next[waferId] = updated;
      });
      return next;
    });
  };

  const spectrumSelection = getSpectrumSelection(workspaceId);
  const availableWafers = useMemo(
    () => (spectrumSelection?.waferIds?.length ? spectrumSelection.waferIds : waferIds),
    [spectrumSelection]
  );

  const targetOptions = useMemo(
    () => splitTags.map((tag) => ({ value: tag, label: tag })),
    [splitTags]
  );

  useEffect(() => {
    setAnalysisTargets((prev) => prev.filter((value) => splitTags.includes(value)));
  }, [splitTags]);

  useEffect(() => {
    if (!workspaceId) return;
    const schema = loadRecipeSchema(workspaceId);
    if (schema?.sensitivity) {
      if (Array.isArray(schema.sensitivity.splitTags) && schema.sensitivity.splitTags.length) {
        setSplitTags(schema.sensitivity.splitTags);
      }
      if (Array.isArray(schema.sensitivity.analysisTargets) && schema.sensitivity.analysisTargets.length) {
        setAnalysisTargets(schema.sensitivity.analysisTargets);
      }
      if (schema.sensitivity.tagAssignments) {
        setTagAssignments(schema.sensitivity.tagAssignments);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!availableWafers.length) return;
    setTagAssignments((prev) => {
      const next = { ...prev };
      availableWafers.forEach((waferId) => {
        if (!next[waferId]) {
          next[waferId] = {};
        }
        splitTags.forEach((tag, index) => {
          const key = `tag_${index}`;
          if (!next[waferId][key]) {
            next[waferId][key] = `${tag}_Baseline`;
          }
        });
      });
      return next;
    });
  }, [availableWafers, splitTags]);

  const handleSaveStep = () => {
    if (!workspaceId) return;
    saveRecipeSchema(workspaceId, {
      sensitivity: {
        splitTags,
        analysisTargets,
        tagAssignments
      }
    });
  };

  const updateAssignment = (waferId, tagIndex, value) => {
    setTagAssignments((prev) => ({
      ...prev,
      [waferId]: {
        ...(prev[waferId] || {}),
        [`tag_${tagIndex}`]: value
      }
    }));
  };

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Pre-Recipe</p>
          <h2>Sensitivity Analysis</h2>
          <p className="subtle">Analyze sensitive bands and overlay on spectra.</p>
        </div>
        <div />
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Split Tag Panel</h3>
          <button className="ghost-button" onClick={addSplitTag} disabled={readOnly}>Add Split</button>
        </div>
        <div className="form-grid two-col">
          {splitTags.map((tag, index) => (
            <div className="form-row" key={`split-${index}`}>
              <label>Split Tag {index + 1}</label>
              <div className="inline-actions">
                <input
                  type="text"
                  value={tag}
                  onChange={(event) => updateSplitTag(index, event.target.value)}
                />
                <button
                  type="button"
                  className="ghost-button"
                  disabled={readOnly || splitTags.length <= 1}
                  onClick={() => removeSplitTag(index)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="panel-note">
          Each wafer can take up to two split tags (example: splitA_Baseline, splitA_Baseline-, splitA_Baseline+).
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>Wafer</span>
            {splitTags.map((tag, index) => (
              <span key={`head-${tag}-${index}`}>Tag {index + 1}</span>
            ))}
          </div>
          {availableWafers.map((id) => (
            <div className="table-row" key={id}>
              <span>{id}</span>
              {splitTags.map((tag, index) => (
                <select
                  key={`${id}-${tag}-${index}`}
                  value={tagAssignments[id]?.[`tag_${index}`] || `${tag}_Baseline`}
                  onChange={(event) => updateAssignment(id, index, event.target.value)}
                >
                  <option value={`${tag}_Baseline`}>{tag}_Baseline</option>
                  <option value={`${tag}_Baseline-`}>{tag}_Baseline-</option>
                  <option value={`${tag}_Baseline+`}>{tag}_Baseline+</option>
                  <option value="">None</option>
                </select>
              ))}
            </div>
          ))}
        </div>
        <div className="form-row">
          <label>Analysis Target</label>
          <MultiSelectDropdown
            label="Analysis Target"
            options={targetOptions}
            value={analysisTargets}
            onChange={setAnalysisTargets}
            enableSelectAll
          />
        </div>
        <button className="primary-button top-pad looser">Start Sensitivity Analysis</button>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Sensitivity Curve Plot</h3>
          <div className="inline-actions">
            <button className="ghost-button">Toggle Bands</button>
            <button className="ghost-button">Overlay Spectra</button>
          </div>
        </div>
        <div className="plot-placeholder">Plotly Sensitivity Container</div>
        <div className="band-list">
          <div className="band-item">480-520 nm - High</div>
          <div className="band-item">610-660 nm - Medium</div>
          <div className="band-item">720-750 nm - Low</div>
        </div>
      </section>
      <WorkflowFooter workspaceId={workspaceId} onSave={handleSaveStep} readOnly={readOnly} />
    </div>
  );
}
