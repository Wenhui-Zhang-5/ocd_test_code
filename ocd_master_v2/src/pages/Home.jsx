import React from "react";
import {
  createTemporaryWorkspace,
  resetTemporaryWorkspaceSession
} from "../data/mockApi.js";
import { buildHashHref } from "../router.js";

export default function Home() {
  const handleNewModel = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("ocd_open_new_recipe_modal", "1");
    }
    window.location.hash = buildHashHref("/ocd/recipe-hub");
  };

  const handleQuickExplore = () => {
    resetTemporaryWorkspaceSession();
    createTemporaryWorkspace();
    window.location.hash = buildHashHref("/ocd/workspace/temp/spectrum-analysis/spectrum");
  };

  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">OCD Intelligent Platform</p>
          <h1>Build Optical Metrology Recipes Faster.</h1>
          <p className="hero-subtitle">
            Pick a workflow below: build a persistent recipe case, or quickly inspect spectra in a temporary session.
          </p>
        </div>
        <div className="hero-panel">
          <div className="flow-node">
            <span>New Recipe</span>
            <p>Create a draft case in Recipe Hub with a unique workspace and recipe name.</p>
          </div>
          <div className="flow-node">
            <span>Quick Explore</span>
            <p>Open a temporary workspace for spectrum analysis without creating a case.</p>
          </div>
        </div>
      </section>

      <section className="panel home-entry-panel">
        <div className="home-entry-grid">
          <div className="home-entry-card">
            <h3>New Recipe</h3>
            <p>
              Start from blank or load from an existing case, then continue in a persistent draft workspace.
            </p>
            <button className="primary-button home-entry-button" onClick={handleNewModel}>
              Create In Recipe Hub
            </button>
          </div>
          <div className="home-entry-card">
            <h3>Quick Explore</h3>
            <p>
              Analyze spectra immediately in a temporary session. Use this when you do not need to build a recipe case.
            </p>
            <button className="ghost-button home-entry-button" onClick={handleQuickExplore}>
              Open Temporary Session
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
