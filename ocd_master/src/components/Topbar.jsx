import React from "react";
import { breadcrumbMap } from "../data/routes.js";
import { matchRoute } from "../router.js";
import { createTemporaryWorkspace, resetTemporaryWorkspaceSession } from "../data/mockApi.js";
import { buildHashHref } from "../router.js";
import ThemeToggle from "./ThemeToggle.jsx";

const getBreadcrumbs = (pathname) => {
  const patterns = Object.keys(breadcrumbMap);
  for (const pattern of patterns) {
    if (matchRoute(pattern, pathname)) {
      return breadcrumbMap[pattern];
    }
  }
  return ["Home"];
};

export default function Topbar({ currentPath }) {
  const crumbs = getBreadcrumbs(currentPath);

  const handleNewRun = () => {
    resetTemporaryWorkspaceSession();
    createTemporaryWorkspace();
    window.location.hash = buildHashHref("/ocd/workspace/temp/spectrum-analysis/spectrum");
  };

  return (
    <header className="topbar">
      <div className="breadcrumbs">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb}-${index}`}>
            {crumb}
            {index < crumbs.length - 1 ? <span className="crumb-sep">/</span> : null}
          </span>
        ))}
      </div>
      <div className="topbar-actions">
        <ThemeToggle className="ghost-button" label="Switch Theme" />
        <button className="primary-button" onClick={handleNewRun}>New Recipe</button>
      </div>
    </header>
  );
}
