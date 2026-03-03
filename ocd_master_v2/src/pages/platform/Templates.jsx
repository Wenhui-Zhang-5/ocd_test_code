import React, { useMemo, useState } from "react";
import { getTemplate, listTemplates } from "../../data/mockApi.js";

export default function Templates() {
  const templates = useMemo(() => listTemplates(), []);
  const [selectedId, setSelectedId] = useState(templates[0]?.templateId || "");
  const [projectFilter, setProjectFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [recipeFilter, setRecipeFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const selected = getTemplate(selectedId) || templates[0];

  const handleCopy = () => {
    return;
  };

  const filterOptions = useMemo(() => {
    const projects = new Set();
    const products = new Set();
    const recipes = new Set();
    const owners = new Set();
    templates.forEach((template) => {
      const meta = template.recipeMeta || {};
      if (meta.project) projects.add(meta.project);
      if (meta.productId) products.add(meta.productId);
      if (meta.recipeName) recipes.add(meta.recipeName);
      if (meta.owner) owners.add(meta.owner);
    });
    return {
      projects: Array.from(projects),
      products: Array.from(products),
      recipes: Array.from(recipes),
      owners: Array.from(owners)
    };
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const meta = template.recipeMeta || {};
      if (projectFilter && meta.project !== projectFilter) return false;
      if (productFilter && meta.productId !== productFilter) return false;
      if (recipeFilter && meta.recipeName !== recipeFilter) return false;
      if (ownerFilter && meta.owner !== ownerFilter) return false;
      return true;
    });
  }, [templates, projectFilter, productFilter, recipeFilter, ownerFilter]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Platform</p>
          <h2>Templates</h2>
          <p className="subtle">Preview recipe templates and their JSON schema.</p>
        </div>
      </header>

      <section className="grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Template List</h3>
            <div className="inline-actions template-filters">
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="">By Project</option>
                {filterOptions.projects.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
                <option value="">By Product</option>
                {filterOptions.products.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select value={recipeFilter} onChange={(event) => setRecipeFilter(event.target.value)}>
                <option value="">By Recipe Name</option>
                {filterOptions.recipes.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                <option value="">By Owner</option>
                {filterOptions.owners.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="table-scroll">
            <div className="table template-table">
              <div className="table-row table-head">
                <span className="stacked"><span>Template</span><span>ID</span></span>
                <span className="stacked"><span>Template</span><span>Name</span></span>
                <span className="stacked"><span>Model</span><span>ID</span></span>
                <span className="stacked"><span>Recipe</span><span>Name</span></span>
                <span className="stacked"><span>Owner</span><span>&nbsp;</span></span>
                <span className="stacked"><span>Project</span><span>&nbsp;</span></span>
                <span className="stacked"><span>Product</span><span>ID</span></span>
                <span className="stacked"><span>Coupling</span><span>Scheme</span></span>
                <span className="stacked"><span>Comment</span><span>&nbsp;</span></span>
                <span className="stacked"><span>Version</span><span>&nbsp;</span></span>
              </div>
              {filteredTemplates.map((template) => (
                <button
                  key={template.templateId}
                  className="table-row"
                  onClick={() => setSelectedId(template.templateId)}
                >
                  <span>{template.templateId}</span>
                  <span>{template.templateName || "-"}</span>
                  <span>{template.modelId || "-"}</span>
                  <span>{template.recipeMeta?.recipeName || "-"}</span>
                  <span>{template.recipeMeta?.owner || "-"}</span>
                  <span>{template.recipeMeta?.project || "-"}</span>
                  <span>{template.recipeMeta?.productId || "-"}</span>
                  <span>{template.couplingScheme || "-"}</span>
                  <span>{template.templateComment || "-"}</span>
                  <span>{template.recipeMeta?.version || "-"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h3>Strategy Preview</h3>
          <button className="ghost-button" onClick={handleCopy}>Copy JSON</button>
        </div>
        {selected ? (
          <>
            <div className="panel-note">
              Strategy details (CD strategy, fitting strategy, seeds) will be shown here.
            </div>
            <div className="plot-placeholder">Strategy JSON Placeholder</div>
          </>
        ) : (
          <p className="summary-label">Select a template to preview.</p>
        )}
      </section>
    </div>
  );
}
