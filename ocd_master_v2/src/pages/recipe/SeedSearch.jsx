import React from "react";
import { seedCandidates } from "../../data/mock.js";

export default function SeedSearch() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Recipe</p>
          <h2>Seed Search</h2>
          <p className="subtle">Filter material candidates and configure seed search.</p>
        </div>
        <button className="primary-button">Save Seed Config</button>
      </header>

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h3>Material Filter</h3>
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
        </div>
        <div className="panel">
          <div className="panel-header">
            <h3>Seed Parameters</h3>
            <button className="ghost-button">Defaults</button>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Seed Count</label>
              <input type="number" defaultValue={5} />
            </div>
            <div className="form-row">
              <label>CD Float in Seed Search</label>
              <label className="switch">
                <input type="checkbox" defaultChecked />
                <span className="slider" />
              </label>
            </div>
            <div className="form-row">
              <label>Material Range</label>
              <input type="text" defaultValue="Top 20 ranked" />
            </div>
          </div>
          <div className="plot-placeholder">NK Curves Placeholder</div>
        </div>
      </section>
    </div>
  );
}
