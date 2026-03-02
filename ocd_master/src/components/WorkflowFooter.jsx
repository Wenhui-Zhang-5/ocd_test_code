import React, { useState } from "react";
import { buildHashHref, getCurrentPath } from "../router.js";
import { getNextWorkflowPath } from "../data/workflow.js";

export default function WorkflowFooter({
  workspaceId,
  onSave,
  onNext,
  saveLabel = "Save",
  nextLabel = "Next Step",
  readOnly = false
}) {
  const [saveStatus, setSaveStatus] = useState("");
  const currentPath = getCurrentPath();
  const nextPath = getNextWorkflowPath(currentPath, workspaceId);

  const setTransientStatus = (status) => {
    setSaveStatus(status);
    window.clearTimeout(setTransientStatus._timer);
    setTransientStatus._timer = window.setTimeout(() => setSaveStatus(""), 1500);
  };

  const runSave = async ({ notifyReadOnly = true } = {}) => {
    if (readOnly) {
      if (notifyReadOnly) {
        setTransientStatus("Read-only");
      }
      return true;
    }
    if (!onSave) {
      return true;
    }
    try {
      const result = await onSave();
      if (result === false) {
        setTransientStatus("Save failed");
        return false;
      }
      setTransientStatus("Saved");
      return true;
    } catch (error) {
      setTransientStatus("Save failed");
      return false;
    }
  };

  const handleSave = async () => {
    await runSave({ notifyReadOnly: true });
  };

  const handleNext = async () => {
    const saved = await runSave({ notifyReadOnly: false });
    if (!saved) {
      return;
    }
    if (onNext) {
      onNext();
      return;
    }
    if (nextPath) {
      window.location.hash = buildHashHref(nextPath);
    }
  };

  return (
    <div className="inline-actions workflow-footer">
      <button className="ghost-button" onClick={handleSave} disabled={readOnly}>{saveLabel}</button>
      <button className="primary-button" onClick={handleNext} disabled={!onNext && !nextPath}>
        {nextLabel}
      </button>
      {saveStatus || readOnly ? <span className="save-status">{saveStatus || "Read-only"}</span> : null}
    </div>
  );
}
