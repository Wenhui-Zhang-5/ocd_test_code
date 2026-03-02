import React from "react";
import { buildHashHref } from "../../router.js";

export default function ThkPlaceholder() {
  return (
    <div className="page">
      <section className="panel">
        <div className="panel-header">
          <h2>THK Recipe</h2>
          <span className="chip chip-muted">Coming Soon</span>
        </div>
        <p className="subtle">This platform is not available yet.</p>
        <a className="primary-button" href={buildHashHref("/")}>Back to App Selector</a>
      </section>
    </div>
  );
}
