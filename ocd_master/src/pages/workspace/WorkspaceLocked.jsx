import React from "react";
import { buildHashHref } from "../../router.js";

export default function WorkspaceLocked({ workspaceId, message }) {
  return (
    <div className="page">
      <section className="panel">
        <div className="panel-header">
          <h3>Access Locked</h3>
          <span className="chip">Temporary Workspace</span>
        </div>
        <p className="subtle">
          {message || "This workspace is temporary. Complete Pre-Recipe before Recipe Build or Run Monitor."}
        </p>
        <a
          className="primary-button"
          href={buildHashHref(`/ocd/workspace/${workspaceId}/spectrum-analysis/spectrum`)}
        >
          Go to Pre-Recipe
        </a>
      </section>
    </div>
  );
}
