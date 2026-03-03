import React, { useEffect, useMemo, useState } from "react";
import { getRunDetail, loadRecipeSchema, saveCheckpoint, startRunTicker } from "../../../data/mockApi.js";

export default function MonitorTrace({ workspaceId }) {
  const [detail, setDetail] = useState(() => getRunDetail(workspaceId));
  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [checkpointDialog, setCheckpointDialog] = useState({ open: false, nodeId: "", name: "" });

  useEffect(() => {
    startRunTicker();
    const interval = window.setInterval(() => {
      setDetail({ ...getRunDetail(workspaceId) });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [workspaceId]);

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatStatus = (status) => status || "queued";

  const openCheckpointDialog = (nodeId) => {
    setCheckpointDialog({ open: true, nodeId, name: "" });
  };

  const closeCheckpointDialog = () => {
    setCheckpointDialog({ open: false, nodeId: "", name: "" });
  };

  const handleCheckpointSave = () => {
    if (!checkpointDialog.name.trim()) {
      return;
    }
    const version = loadRecipeSchema(workspaceId)?.version || "v1";
    saveCheckpoint(workspaceId, {
      nodeId: checkpointDialog.nodeId,
      name: checkpointDialog.name.trim(),
      version
    });
    setDetail({ ...getRunDetail(workspaceId) });
    closeCheckpointDialog();
  };

  const isExpanded = (id, defaultOpen = false) =>
    expanded.has(id) || (expanded.size === 0 && defaultOpen);

  const tree = useMemo(() => detail.traceTree || [], [detail.traceTree]);

  const findNode = (nodes, nodeId) => {
    for (const node of nodes) {
      if (node.nodeId === nodeId) {
        return node;
      }
      if (node.children?.length) {
        const match = findNode(node.children, nodeId);
        if (match) {
          return match;
        }
      }
    }
    return null;
  };

  const selectedNode = useMemo(() => {
    if (!tree.length) {
      return null;
    }
    return findNode(tree, selectedNodeId) || tree[0];
  }, [tree, selectedNodeId]);

  const renderKpiSummary = (kpi) => {
    if (!kpi) {
      return "KPI -";
    }
    return `R2 ${kpi.r2} · slope ${kpi.slope} · SBS ${kpi.sideBySideNm} · prec ${kpi.precision}`;
  };

  const renderNode = (node, depth) => {
    const nodeKey = `${node.nodeId}-${depth}`;
    const hasChildren = node.children && node.children.length > 0;
    const nodeOpen = hasChildren && isExpanded(node.nodeId, depth === 0);
    const isSelected = selectedNode?.nodeId === node.nodeId;
    return (
      <div key={nodeKey} className="trace-tree-node">
        <div
          className={`trace-tree-row ${isSelected ? "trace-row-active" : ""}`}
          style={{ paddingLeft: `${depth * 18 + 12}px` }}
        >
          <button
            className="trace-expand"
            onClick={() => hasChildren && toggleExpanded(node.nodeId)}
            disabled={!hasChildren}
            aria-label={hasChildren ? "Toggle" : "No children"}
          >
            {hasChildren ? (nodeOpen ? "▾" : "▸") : "•"}
          </button>
          <button
            className="trace-label-button"
            onClick={() => setSelectedNodeId(node.nodeId)}
          >
            <span className={`status-dot status-dot-${formatStatus(node.status)}`} />
            <span className="trace-label">{node.label}</span>
            <span className="trace-meta">{node.status}</span>
            {node.type === "step" && node.kpi ? (
              <span className="trace-badge">R2 {node.kpi.r2}</span>
            ) : null}
          </button>
          {node.type === "step" ? (
            <div className="trace-actions">
              {node.checkpointed && <span className="chip chip-success">checkpointed</span>}
              <button className="ghost-button" onClick={() => openCheckpointDialog(node.nodeId)}>
                Save Checkpoint
              </button>
            </div>
          ) : null}
        </div>
        {nodeOpen && (
          <div className="trace-branch">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Monitor</p>
          <h2>Trace</h2>
          <p className="subtle">Click any node to inspect KPI and artifacts.</p>
        </div>
      </header>

      <section className="panel trace-layout">
        <div className="panel-header">
          <h3>Trace Tree</h3>
          <span className="chip">Live</span>
        </div>
        {tree.length === 0 ? (
          <div className="panel-note">No trace data yet.</div>
        ) : (
          <div className="trace-layout-grid">
            <div className="trace-tree">
              {tree.map((node) => renderNode(node, 0))}
            </div>
            <div className="trace-detail">
              <div className="detail-header">
                <span>Node Detail</span>
                {selectedNode ? (
                  <span className="chip chip-muted">{selectedNode.type}</span>
                ) : null}
              </div>
              {selectedNode ? (
                <>
                  <div className="trace-detail-meta">
                    <h4>{selectedNode.label}</h4>
                    <span className={`status-pill status-${selectedNode.status}`}>
                      {selectedNode.status}
                    </span>
                  </div>
                  {selectedNode.checkpointed && (
                    <div className="chip-row">
                      <span className="chip chip-success">
                        Checkpoint: {selectedNode.checkpointName || "Saved"}
                      </span>
                    </div>
                  )}
                  <div className="table kpi-table">
                    <div className="table-row table-head">
                      <span>KPI</span>
                      <span>R2</span>
                      <span>Slope</span>
                      <span>SBS</span>
                      <span>Precision</span>
                    </div>
                    <div className="table-row">
                      <span>KPI1</span>
                      <span>{selectedNode.kpi?.r2 ?? "-"}</span>
                      <span>{selectedNode.kpi?.slope ?? "-"}</span>
                      <span>{selectedNode.kpi?.sideBySideNm ?? "-"}</span>
                      <span>{selectedNode.kpi?.precision ?? "-"}</span>
                    </div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-section-header">Linear Plots</div>
                    <div className="detail-scroll">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div className="plot-placeholder" key={`linear-${index}`}>
                          Linear Plot {selectedNode.artifacts?.linearPlotId || "-"}-{index + 1}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-section-header">NK Curves</div>
                    <div className="detail-scroll nk-scroll">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div className="plot-placeholder" key={`nk-${index}`}>
                          NK Curve {selectedNode.artifacts?.nkPlotId || "-"}-{index + 1}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-section-header">Spectrum Fitting</div>
                    <div className="plot-placeholder">
                      Spectrum Fitting {selectedNode.artifacts?.fittingPlotId || "-"}
                    </div>
                  </div>
                  {selectedNode.type === "step" ? (
                    <div className="inline-actions">
                      <button className="ghost-button" onClick={() => openCheckpointDialog(selectedNode.nodeId)}>
                        Save Checkpoint
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="summary-label">Select a node to inspect details.</p>
              )}
            </div>
          </div>
        )}
      </section>
      {checkpointDialog.open && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Save Checkpoint</h3>
            <div className="form-row">
              <label>Checkpoint Name</label>
              <input
                type="text"
                placeholder="Enter name"
                value={checkpointDialog.name}
                onChange={(event) =>
                  setCheckpointDialog((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="inline-actions">
              <button className="primary-button" onClick={handleCheckpointSave}>Save</button>
              <button className="ghost-button" onClick={closeCheckpointDialog}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
