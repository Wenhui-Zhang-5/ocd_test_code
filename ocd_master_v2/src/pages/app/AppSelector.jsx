import React from "react";
import { buildHashHref } from "../../router.js";

export default function AppSelector() {
  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Recipe Platform</p>
          <h1>Platform for Automated Optical Metrology Recipes</h1>
          <p className="hero-subtitle">
            One workspace for spectra analysis, strategy build, and run visibility across OCD and THK.
          </p>
        </div>
        <div className="promo-visual">
          <div className="promo-header">
            <span className="chip">OCD Intelligence</span>
            <h3>From spectra to deployable recipes</h3>
          </div>
          <div className="promo-grid">
            <div className="promo-card">
              <span className="promo-label">Signal Stack</span>
              <p>Spectra + optics stack</p>
            </div>
            <div className="promo-card">
              <span className="promo-label">Strategy Pipeline</span>
              <p>Recipe orchestration</p>
            </div>
            <div className="promo-card">
              <span className="promo-label">Run Monitor</span>
              <p>Trace + history</p>
            </div>
          </div>
          <div className="promo-visuals">
            <div className="hud-card">
              <div className="hud-header">
                <span>Spectrum Trace</span>
                <span className="hud-dot" />
              </div>
              <svg viewBox="0 0 260 120" className="hud-plot" aria-hidden="true">
                <path d="M0,70 C30,40 60,90 90,55 C120,20 150,80 180,45 C210,15 235,35 260,25" />
                <path className="hud-plot-secondary" d="M0,95 C35,75 70,110 105,80 C140,60 175,95 210,70 C235,55 250,60 260,50" />
              </svg>
            </div>
            <div className="orbital-card">
              <div className="orbital-ring" />
              <div className="orbital-ring ring-two" />
              <div className="orbital-core" />
              <div className="orbital-labels">
                <span>Optics</span>
                <span>AI</span>
                <span>Recipe</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h2>OCD Recipe</h2>
            <span className="chip">Available</span>
          </div>
          <p className="subtle">Spectra analysis, recipe build, and run monitoring.</p>
          <a className="primary-button" href={buildHashHref("/ocd/home")}>
            Enter OCD Platform
          </a>
        </div>
        <div className="panel">
          <div className="panel-header">
            <h2>THK Recipe</h2>
            <span className="chip chip-muted">Coming Soon</span>
          </div>
          <p className="subtle">Thickness recipe workflows will land here.</p>
          <a className="ghost-button" href={buildHashHref("/thk")}>Coming Soon</a>
        </div>
      </section>
    </div>
  );
}
