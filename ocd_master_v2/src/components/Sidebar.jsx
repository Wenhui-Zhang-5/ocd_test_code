import React from "react";
import { platformNavSections } from "../data/routes.js";
import { buildHashHref } from "../router.js";

export default function Sidebar({ currentPath }) {
  const isActive = (path) => currentPath === path;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">OCD</span>
        <div>
          <p className="brand-title">Intelligent Platform</p>
          <p className="brand-subtitle">Spectra → Recipe → Run</p>
        </div>
      </div>
      <div className="workspace-status">
        <a className="nav-link" href={buildHashHref("/")}>Switch Platform</a>
      </div>
      <nav className="nav">
        {platformNavSections.map((section) => (
          <div className={`nav-section nav-${section.theme}`} key={section.title}>
            <p className="nav-title">{section.title}</p>
            <div className="nav-links">
              {section.items.map((item) => (
                <a
                  key={item.path}
                  href={buildHashHref(item.path)}
                  className={isActive(item.path) ? "nav-link nav-link-active" : "nav-link"}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="chip">API: Mock Mode</div>
        <div className="chip">Status: Ready</div>
      </div>
    </aside>
  );
}
