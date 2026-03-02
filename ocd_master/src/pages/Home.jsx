import React from "react";
import {
  createTemporaryWorkspace,
  listGlobalRuns,
  listModelHub,
  resetTemporaryWorkspaceSession
} from "../data/mockApi.js";
import { buildHashHref } from "../router.js";

export default function Home() {
  const runs = listGlobalRuns();
  const recipes = listModelHub();
  const runningCount = runs.filter((run) => run.status === "running").length;
  const queuedCount = runs.filter((run) => run.status === "queued").length;
  const completedCount = runs.filter((run) => run.status === "completed").length;
  const previewRows = recipes.slice(0, 5);

  const handleNewModel = () => {
    resetTemporaryWorkspaceSession();
    createTemporaryWorkspace();
    window.location.hash = buildHashHref("/ocd/workspace/temp/spectrum-analysis/spectrum");
  };

  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">OCD Intelligent Platform</p>
          <h1>Auto-generate optical metrology recipes.</h1>
          <p className="hero-subtitle">
            Start spectrum analysis or monitor global run status across the OCD platform.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={handleNewModel}>New Recipe</button>
            <a className="ghost-button" href={buildHashHref("/ocd/recipe-hub")}>Recipe Hub</a>
          </div>
        </div>
        <div className="hero-panel">
          <div className="flow-node">
            <span>Capability Intro</span>
            <p>Pre-Recipe analysis, recipe build, and run monitoring.</p>
          </div>
          <div className="flow-node">
            <span>Workflow</span>
            <p>Temporary workspace to model workspace</p>
          </div>
          <div className="flow-node">
            <span>Run Summary</span>
            <p>Monitor running, queued, completed</p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recipe Hub Summary</h2>
          <a className="ghost-button" href={buildHashHref("/ocd/recipe-hub")}>View Details</a>
        </div>
        <div className="signal-grid">
          <div className="signal-card">
            <h3>Running</h3>
            <p>{runningCount} active</p>
          </div>
          <div className="signal-card">
            <h3>Queued</h3>
            <p>{queuedCount} waiting</p>
          </div>
          <div className="signal-card">
            <h3>Completed</h3>
            <p>{completedCount} done</p>
          </div>
        </div>
      </section>

    </div>
  );
}
