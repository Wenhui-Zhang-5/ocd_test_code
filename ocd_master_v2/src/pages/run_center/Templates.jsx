import React from "react";
import { templates } from "../../data/mock.js";

export default function Templates() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Center</p>
          <h2>Templates</h2>
          <p className="subtle">Reusable strategy bundles for quick run creation.</p>
        </div>
        <button className="primary-button">New Template</button>
      </header>

      <section className="grid three-col">
        {templates.map((template) => (
          <div className="panel" key={template.name}>
            <div className="panel-header">
              <h3>{template.name}</h3>
              <span className="chip">{template.updated}</span>
            </div>
            <p className="subtle">Materials: {template.materials}</p>
            <p className="subtle">Owner: {template.owner}</p>
            <div className="inline-actions">
              <button className="ghost-button">Preview</button>
              <button className="primary-button">Apply</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
