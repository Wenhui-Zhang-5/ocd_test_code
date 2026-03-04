import React, { useEffect, useMemo, useState } from "react";
import {
  clearRecipeHub,
  cloneWorkspaceCaseCache,
  createRecipeHubWorkspace,
  deleteRecipeHubEntries,
  listModelHub,
  recipeHubRecipeNameExists,
  refreshRecipeHubFromServer
} from "../../data/mockApi.js";
import { buildHashHref } from "../../router.js";

export default function Assets() {
  const [reloadKey, setReloadKey] = useState(0);
  const models = useMemo(() => listModelHub(), [reloadKey]);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMode, setCreateMode] = useState("blank");
  const [newRecipeName, setNewRecipeName] = useState("");
  const [cloneSourceId, setCloneSourceId] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const changed = await refreshRecipeHubFromServer();
      if (!cancelled && changed) {
        setReloadKey((value) => value + 1);
      }
    };
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldOpen = window.sessionStorage.getItem("ocd_open_new_recipe_modal") === "1";
    if (!shouldOpen) return;
    window.sessionStorage.removeItem("ocd_open_new_recipe_modal");
    setShowCreateModal(true);
    setCreateMode("blank");
    setNewRecipeName("");
    setCloneSourceId("");
    setCreateError("");
  }, []);

  const canDeleteItem = (item) => {
    const normalized = String(item?.status || "").toLowerCase();
    return normalized === "draft" || normalized === "completed" || normalized === "complete";
  };

  const handleClearRecipeHub = async () => {
    const confirmed = window.confirm("Clear all Recipe Hub entries? This will remove all current recipes and runs.");
    if (!confirmed) return;
    await clearRecipeHub();
    setProjectFilter("");
    setProductFilter("");
    setOwnerFilter("");
    setStatusFilter("");
    setSelectedWorkspaceIds([]);
    setReloadKey((value) => value + 1);
  };

  const filterOptions = useMemo(() => {
    const projects = new Set();
    const products = new Set();
    const owners = new Set();
    const statuses = new Set();
    models.forEach((item) => {
      if (item.project) projects.add(item.project);
      if (item.productId) products.add(item.productId);
      if (item.owner) owners.add(item.owner);
      if (item.status) statuses.add(item.status);
    });
    return {
      projects: Array.from(projects),
      products: Array.from(products),
      owners: Array.from(owners),
      statuses: Array.from(statuses)
    };
  }, [models]);

  const filteredModels = useMemo(
    () =>
      models.filter((item) => {
        if (projectFilter && item.project !== projectFilter) return false;
        if (productFilter && item.productId !== productFilter) return false;
        if (ownerFilter && item.owner !== ownerFilter) return false;
        if (statusFilter && item.status !== statusFilter) return false;
        return true;
      }),
    [models, projectFilter, productFilter, ownerFilter, statusFilter]
  );

  const cloneCandidates = useMemo(
    () =>
      models.filter((item) => {
        const status = String(item?.status || "").toLowerCase();
        return status === "draft" || status === "completed" || status === "complete";
      }),
    [models]
  );

  useEffect(() => {
    if (!showCreateModal) return;
    if (createMode !== "clone") return;
    if (cloneSourceId) return;
    if (!cloneCandidates.length) return;
    setCloneSourceId(cloneCandidates[0].id);
  }, [showCreateModal, createMode, cloneSourceId, cloneCandidates]);

  const handleToggleSelect = (workspaceId) => {
    setSelectedWorkspaceIds((current) => {
      if (current.includes(workspaceId)) {
        return current.filter((item) => item !== workspaceId);
      }
      return [...current, workspaceId];
    });
  };

  const handleDeleteSelected = async () => {
    const selectedItems = filteredModels.filter(
      (item) => selectedWorkspaceIds.includes(item.id) && canDeleteItem(item)
    );
    if (!selectedItems.length) {
      window.alert("Please select at least one draft/completed recipe.");
      return;
    }
    const confirmed = window.confirm(
      `Delete ${selectedItems.length} selected draft/completed recipe(s)? This will also delete all related cache data.`
    );
    if (!confirmed) return;
    await deleteRecipeHubEntries(selectedItems.map((item) => item.id));
    setSelectedWorkspaceIds([]);
    setReloadKey((value) => value + 1);
  };

  const openCreateModal = () => {
    setShowCreateModal(true);
    setCreateMode("blank");
    setNewRecipeName("");
    setCloneSourceId(cloneCandidates[0]?.id || "");
    setCreateError("");
  };

  const closeCreateModal = () => {
    if (creating) return;
    setShowCreateModal(false);
    setCreateError("");
  };

  const handleCreateRecipe = async () => {
    const recipeName = String(newRecipeName || "").trim();
    if (!recipeName) {
      setCreateError("Recipe Name is required.");
      return;
    }
    if (recipeHubRecipeNameExists(recipeName)) {
      setCreateError(`Recipe Name "${recipeName}" already exists.`);
      return;
    }
    if (createMode === "clone" && !cloneSourceId) {
      setCreateError("Please select an existing case to clone.");
      return;
    }
    setCreating(true);
    setCreateError("");
    let workspace = null;
    try {
      workspace = createRecipeHubWorkspace({ recipeName });
      if (createMode === "clone") {
        const cloned = await cloneWorkspaceCaseCache({
          sourceWorkspaceId: cloneSourceId,
          targetWorkspaceId: workspace.id,
          recipeName
        });
        if (!cloned) {
          throw new Error("Failed to clone workspace cache.");
        }
      }
      setShowCreateModal(false);
      setReloadKey((value) => value + 1);
      window.location.hash = buildHashHref(`/ocd/workspace/${workspace.id}/spectrum-analysis/spectrum`);
    } catch (error) {
      if (workspace?.id) {
        await deleteRecipeHubEntries([workspace.id]);
      }
      setCreateError(error?.message || "Failed to create recipe.");
      setReloadKey((value) => value + 1);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header recipe-hub-header">
        <div>
          <p className="eyebrow">Platform</p>
          <h2>Recipe Hub</h2>
          <p className="subtle">All active and created OCD recipes (model hub + run status).</p>
        </div>
        <div className="inline-actions">
          <button className="primary-button" onClick={openCreateModal}>
            New Recipe
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="inline-actions recipe-hub-actions">
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="">By Project</option>
            {filterOptions.projects.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
            <option value="">By Product</option>
            {filterOptions.products.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
            <option value="">By Owner</option>
            {filterOptions.owners.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">By Status</option>
            {filterOptions.statuses.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <button
            className="ghost-button"
            onClick={handleDeleteSelected}
          >
            Delete Selected
          </button>
          <button className="danger-button" onClick={handleClearRecipeHub}>Clear Recipe Hub</button>
        </div>
      </section>

      <section className="panel recipe-hub-panel">
        <div className="table-scroll recipe-hub-scroll">
          <div className="table recipe-hub-table">
            <div className="table-row table-head">
              <span>Delete</span>
              <span>No.</span>
              <span>Workspace ID</span>
              <span>Model ID</span>
              <span>Recipe</span>
              <span>Owner</span>
              <span>Project</span>
              <span>Product</span>
              <span>Version</span>
              <span>Status</span>
            </div>
            {filteredModels.map((item) => {
              const modelId = item.modelID || "-";
              const workspaceId = item.id || modelId;
              const displayIndex = Math.max(0, models.findIndex((row) => row.id === item.id)) + 1;
              const targetHash = buildHashHref(`/ocd/workspace/${workspaceId}/overview`);
              return (
                <div
                  key={workspaceId}
                  className="table-row link-row"
                  role="link"
                  tabIndex={0}
                  onClick={() => {
                    window.location.hash = targetHash;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      window.location.hash = targetHash;
                    }
                  }}
                >
                  <span>
                    <input
                      type="checkbox"
                      checked={selectedWorkspaceIds.includes(item.id)}
                      disabled={!canDeleteItem(item)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        event.stopPropagation();
                        if (!canDeleteItem(item)) return;
                        handleToggleSelect(item.id);
                      }}
                    />
                  </span>
                  <span className="mono">{displayIndex || "-"}</span>
                  <span className="mono" title={workspaceId || "-"}>
                    {workspaceId || "-"}
                  </span>
                  <span className="mono" title={modelId || "-"}>
                    {modelId || "-"}
                  </span>
                  <span>{item.recipeName}</span>
                  <span>{item.owner}</span>
                  <span>{item.project || "-"}</span>
                  <span>{item.productId || "-"}</span>
                  <span>{item.version || "-"}</span>
                  <span className={`status-pill status-${item.status}`}>{item.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {showCreateModal ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Create Recipe</h3>
            <div className="form-row">
              <label>Create Mode</label>
              <div className="inline-actions">
                <button
                  className={createMode === "blank" ? "primary-button" : "ghost-button"}
                  onClick={() => setCreateMode("blank")}
                  disabled={creating}
                >
                  Blank
                </button>
                <button
                  className={createMode === "clone" ? "primary-button" : "ghost-button"}
                  onClick={() => setCreateMode("clone")}
                  disabled={creating}
                >
                  Load From Existing
                </button>
              </div>
            </div>
            <div className="form-row">
              <label>Recipe Name</label>
              <input
                type="text"
                value={newRecipeName}
                onChange={(event) => setNewRecipeName(event.target.value)}
                placeholder="Enter unique recipe name"
                disabled={creating}
              />
            </div>
            {createMode === "clone" ? (
              <div className="form-row">
                <label>Source Case</label>
                <select
                  value={cloneSourceId}
                  onChange={(event) => setCloneSourceId(event.target.value)}
                  disabled={creating}
                >
                  <option value="">Select case</option>
                  {cloneCandidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} · {item.recipeName || "-"} · {item.status}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {createError ? <p className="panel-note">{createError}</p> : null}
            <div className="inline-actions">
              <button className="ghost-button" onClick={closeCreateModal} disabled={creating}>
                Cancel
              </button>
              <button className="primary-button" onClick={handleCreateRecipe} disabled={creating}>
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
