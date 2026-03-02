import React, { useEffect, useMemo, useState } from "react";
import PageShell from "./components/PageShell.jsx";
import Home from "./pages/Home.jsx";
import Spectrum from "./pages/pre_recipe/Spectrum.jsx";
import Sensitivity from "./pages/pre_recipe/Sensitivity.jsx";
import SliceSelection from "./pages/pre_recipe/SliceSelection.jsx";
import Precision from "./pages/pre_recipe/Precision.jsx";
import RecipeSetup from "./pages/pre_recipe/RecipeSetup.jsx";
import Model from "./pages/recipe/Model.jsx";
import CdStrategy from "./pages/recipe/CdStrategy.jsx";
import FittingStrategy from "./pages/recipe/FittingStrategy.jsx";
import TmKpi from "./pages/recipe/TmKpi.jsx";
import StartingPoint from "./pages/recipe/StartingPoint.jsx";
import RecipeCheck from "./pages/recipe/RecipeCheck.jsx";
import MonitorControl from "./pages/workspace/run_monitor/Control.jsx";
import MonitorTrace from "./pages/workspace/run_monitor/Trace.jsx";
import MonitorRanking from "./pages/workspace/run_monitor/Ranking.jsx";
import ResultsSummary from "./pages/workspace/results/Summary.jsx";
import ResultsTemplate from "./pages/workspace/results/Template.jsx";
import Assets from "./pages/platform/History.jsx";
import Templates from "./pages/platform/Templates.jsx";
import NkLibrary from "./pages/platform/NkLibrary.jsx";
import Overview from "./pages/workspace/Overview.jsx";
import WorkspaceLocked from "./pages/workspace/WorkspaceLocked.jsx";
import AppSelector from "./pages/app/AppSelector.jsx";
import ThkPlaceholder from "./pages/app/ThkPlaceholder.jsx";
import { buildHashHref, getCurrentPath, matchRoute } from "./router.js";
import { applyRefreshCachePolicy, createTemporaryWorkspace, getWorkspace } from "./data/mockApi.js";

const RedirectTo = ({ to }) => {
  useEffect(() => {
    window.location.hash = buildHashHref(to);
  }, [to]);
  return null;
};

let reloadPolicyApplied = false;

const applyReloadPolicyIfNeeded = () => {
  if (reloadPolicyApplied || typeof window === "undefined") return;
  reloadPolicyApplied = true;
  const navEntry = window.performance?.getEntriesByType?.("navigation")?.[0];
  const isReload = navEntry?.type === "reload" || window.performance?.navigation?.type === 1;
  if (!isReload) return;
  const path = getCurrentPath();
  const match = path.match(/^\/ocd\/workspace\/([^/]+)/);
  if (!match?.[1]) return;
  applyRefreshCachePolicy(decodeURIComponent(match[1]));
};

export default function App() {
  applyReloadPolicyIfNeeded();
  const [currentPath, setCurrentPath] = useState(getCurrentPath);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPath(getCurrentPath());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const routes = useMemo(
    () => [
      { path: "/", render: () => <AppSelector /> },
      { path: "/thk", render: () => <ThkPlaceholder /> },
      { path: "/home", render: () => <RedirectTo to="/ocd/home" /> },
      { path: "/global-run-monitor", render: () => <RedirectTo to="/ocd/run-monitor" /> },
      { path: "/templates", render: () => <RedirectTo to="/ocd/templates" /> },
      { path: "/history", render: () => <RedirectTo to="/ocd/assets" /> },
      { path: "/ocd", render: () => <RedirectTo to="/ocd/home" /> },
      { path: "/ocd/home", render: () => <Home /> },
      { path: "/ocd/assets", render: () => <RedirectTo to="/ocd/recipe-hub" /> },
      { path: "/ocd/recipe-hub", render: () => <Assets /> },
      { path: "/ocd/run-monitor", render: () => <RedirectTo to="/ocd/recipe-hub" /> },
      { path: "/ocd/templates", render: () => <Templates /> },
      { path: "/ocd/nk-library", render: () => <NkLibrary /> },
      { path: "/ocd/workspace/:id/overview", render: ({ id }) => <Overview workspaceId={id} /> },
      { path: "/ocd/workspace/:id/spectrum-analysis", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/spectrum-analysis/spectrum`} /> },
      { path: "/ocd/workspace/:id/spectrum-analysis/spectrum", render: ({ id }) => <Spectrum workspaceId={id} /> },
      { path: "/ocd/workspace/:id/spectrum-analysis/sensitivity", render: ({ id }) => <Sensitivity workspaceId={id} /> },
      { path: "/ocd/workspace/:id/spectrum-analysis/slice-selection", render: ({ id }) => <SliceSelection workspaceId={id} /> },
      { path: "/ocd/workspace/:id/spectrum-analysis/precision", render: ({ id }) => <Precision workspaceId={id} /> },
      { path: "/ocd/workspace/:id/pre-recipe", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/pre-recipe/recipe-setup`} /> },
      { path: "/ocd/workspace/:id/pre-recipe/recipe-setup", render: ({ id }) => <RecipeSetup workspaceId={id} /> },
      { path: "/ocd/workspace/:id/pre-recipe/model", render: ({ id }) => <Model workspaceId={id} /> },
      { path: "/ocd/workspace/:id/pre-recipe/tm-kpi", render: ({ id }) => <TmKpi workspaceId={id} /> },
      { path: "/ocd/workspace/:id/pre-recipe/spectrum", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/spectrum-analysis/spectrum`} /> },
      { path: "/ocd/workspace/:id/pre-recipe/sensitivity", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/spectrum-analysis/sensitivity`} /> },
      { path: "/ocd/workspace/:id/pre-recipe/slice-selection", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/spectrum-analysis/slice-selection`} /> },
      { path: "/ocd/workspace/:id/pre-recipe/precision", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/spectrum-analysis/precision`} /> },
      { path: "/ocd/workspace/:id/recipe", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/recipe/starting-point`} /> },
      { path: "/ocd/workspace/:id/recipe/create", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/pre-recipe/recipe-setup`} /> },
      { path: "/ocd/workspace/:id/recipe/model", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/pre-recipe/model`} /> },
      { path: "/ocd/workspace/:id/recipe/starting-point", render: ({ id }) => <StartingPoint workspaceId={id} /> },
      { path: "/ocd/workspace/:id/recipe/starting-point/material", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/recipe/starting-point`} /> },
      { path: "/ocd/workspace/:id/recipe/starting-point/checkpoint", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/recipe/starting-point`} /> },
      { path: "/ocd/workspace/:id/recipe/cd-strategy", render: ({ id }) => <CdStrategy workspaceId={id} /> },
      { path: "/ocd/workspace/:id/recipe/material", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/recipe/starting-point`} /> },
      { path: "/ocd/workspace/:id/recipe/fitting-strategy", render: ({ id }) => <FittingStrategy workspaceId={id} /> },
      { path: "/ocd/workspace/:id/recipe/recipe-check", render: ({ id }) => <RecipeCheck workspaceId={id} /> },
      { path: "/ocd/workspace/:id/recipe/tem-kpi", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/pre-recipe/tm-kpi`} /> },
      { path: "/ocd/workspace/:id/run-monitor", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/run-monitor/trace`} /> },
      { path: "/ocd/workspace/:id/run-monitor/trace", render: ({ id }) => <MonitorTrace workspaceId={id} /> },
      { path: "/ocd/workspace/:id/run-monitor/ranking", render: ({ id }) => <MonitorRanking workspaceId={id} /> },
      { path: "/ocd/workspace/:id/run-monitor/control", render: ({ id }) => <MonitorControl workspaceId={id} /> },
      { path: "/ocd/workspace/:id/run-monitor/detail", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/run-monitor/ranking`} /> },
      { path: "/ocd/workspace/:id/results", render: ({ id }) => <RedirectTo to={`/ocd/workspace/${id}/results/summary`} /> },
      { path: "/ocd/workspace/:id/results/summary", render: ({ id }) => <ResultsSummary workspaceId={id} /> },
      { path: "/ocd/workspace/:id/results/template", render: ({ id }) => <ResultsTemplate workspaceId={id} /> }
    ],
    []
  );

  const activeRoute = routes.find((route) => matchRoute(route.path, currentPath));
  const routeParams = activeRoute ? matchRoute(activeRoute.path, currentPath) : null;
  let page = activeRoute ? activeRoute.render(routeParams) : <Home />;

  if (!activeRoute && currentPath.startsWith("/workspace/")) {
    const parts = currentPath.split("/").filter(Boolean);
    const workspaceId = parts[1];
    if (workspaceId) {
      page = <RedirectTo to={`/ocd/workspace/${workspaceId}/overview`} />;
    }
  }

  if (!activeRoute && currentPath.startsWith("/ocd/workspace/")) {
    const parts = currentPath.split("/").filter(Boolean);
    const workspaceId = parts[2];
    if (workspaceId) {
      page = <RedirectTo to={`/ocd/workspace/${workspaceId}/overview`} />;
    }
  }

  if (routeParams && routeParams.id) {
    let workspace = getWorkspace(routeParams.id);
    if (routeParams.id === "temp") {
      workspace = createTemporaryWorkspace();
    }
    const isTemp = workspace && workspace.type === "temporary";
    const isRestricted =
      currentPath.includes("/recipe/") ||
      currentPath.includes("/run-monitor") ||
      currentPath.includes("/results") ||
      currentPath.includes("/pre-recipe/model") ||
      currentPath.includes("/pre-recipe/tm-kpi");
    if (isTemp && isRestricted) {
      page = <WorkspaceLocked workspaceId={routeParams.id} />;
    }
  }

  return (
    <PageShell currentPath={currentPath}>{page}</PageShell>
  );
}
