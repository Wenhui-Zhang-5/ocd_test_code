import React, { useState } from "react";
import { createModelWorkspace, saveRecipeSchema } from "../../data/mockApi.js";
import { buildHashHref } from "../../router.js";

export default function NewRecipe({ workspaceId }) {
  const [form, setForm] = useState({
    modelID: "M-ALD-77",
    owner: "You",
    productID: "P-01",
    loop: "L1",
    recipeName: "New Recipe",
    layout: "Default",
    state: "draft",
    version: "v1",
    templateEnabled: false,
    templateId: ""
  });

  const handleChange = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreate = () => {
    const workspace = createModelWorkspace(form);
    saveRecipeSchema(workspace.modelID, form);
    window.location.hash = buildHashHref(`/ocd/workspace/${workspace.modelID}/recipe/model`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Recipe Build</p>
          <h2>Create Recipe</h2>
          <p className="subtle">Provide modelID and persist recipe schema.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Recipe Fields</h3>
          <span className="chip">Workspace: {workspaceId || "temp"}</span>
        </div>
        <div className="grid two-col">
          <div className="panel">
            <div className="panel-header">
              <h3>Model Setup</h3>
            </div>
            <div className="form-grid">
              <div className="form-row">
                <label>Model ID</label>
                <input type="text" value={form.modelID} onChange={handleChange("modelID")} />
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
                <label>Product ID</label>
                <input type="text" value={form.productID} onChange={handleChange("productID")} />
              </div>
              <div className="form-row">
                <label>Loop</label>
                <input type="text" value={form.loop} onChange={handleChange("loop")} />
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <h3>Configuration</h3>
            </div>
            <div className="form-grid">
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
                <input type="text" value={form.version} onChange={handleChange("version")} />
              </div>
              <div className="form-row">
                <label>Template Enabled</label>
                <label className="switch">
                  <input type="checkbox" checked={form.templateEnabled} onChange={handleChange("templateEnabled")} />
                  <span className="slider" />
                </label>
              </div>
              <div className="form-row">
                <label>Template ID</label>
                <input type="text" value={form.templateId} onChange={handleChange("templateId")} />
              </div>
            </div>
          </div>
        </div>
        <div className="inline-actions">
          <button className="ghost-button">Load Template</button>
          <button className="primary-button" onClick={handleCreate}>Create Recipe</button>
        </div>
      </section>
    </div>
  );
}
