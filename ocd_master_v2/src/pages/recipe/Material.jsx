import React from "react";
import { seedCandidates, materialSummary } from "../../data/mock.js";

export default function Material() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Recipe</p>
          <h2>Material & Model</h2>
          <p className="subtle">Read-only material library overview and HO structure.</p>
        </div>
        <button className="primary-button">Refresh</button>
      </header>

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h3>Material Library</h3>
            <button className="ghost-button">Select All</button>
          </div>
          <div className="list">
            {seedCandidates.map((item) => (
              <div className="list-row" key={item.name}>
                <div>
                  <p className="list-title">{item.name}</p>
                  <p className="list-subtitle">{item.nk}</p>
                </div>
                <label className="switch">
                  <input type="checkbox" defaultChecked />
                  <span className="slider" />
                </label>
              </div>
            ))}
          </div>
          <div className="plot-placeholder">NK Curves Placeholder</div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <h3>Seed Search</h3>
            <button className="ghost-button">Defaults</button>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Seed Count (Top K)</label>
              <input type="number" defaultValue={5} />
            </div>
            <div className="form-row">
              <label>Material Range</label>
              <input type="text" defaultValue="Top 20 ranked" />
            </div>
            <div className="form-row">
              <label>Candidate Filter</label>
              <input type="text" defaultValue="No filter" />
            </div>
          </div>
          <div className="panel-note">Material list sourced from model summary.</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Model Summary</h3>
          <button className="ghost-button">Open HO Detail</button>
        </div>
        <div className="summary-grid">
          <div>
            <p className="summary-label">Model Type</p>
            <p className="summary-value">{materialSummary.model}</p>
          </div>
          <div>
            <p className="summary-label">Oscillator Groups</p>
            <p className="summary-value">{materialSummary.oscillators}</p>
          </div>
          <div>
            <p className="summary-label">Materials</p>
            <p className="summary-value">{materialSummary.materials.join(", ")}</p>
          </div>
        </div>
        <div className="plot-placeholder">HO Structure Placeholder</div>
      </section>
    </div>
  );
}
