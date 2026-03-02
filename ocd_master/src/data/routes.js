export const platformNavSections = [
  {
    title: "Platform",
    theme: "home",
    items: [
      { label: "Home", path: "/ocd/home" },
      { label: "Recipe Hub", path: "/ocd/recipe-hub" }
    ]
  },
  {
    title: "Assets",
    theme: "recipe",
    items: [
      { label: "Templates", path: "/ocd/templates" },
      { label: "NK Library", path: "/ocd/nk-library" }
    ]
  }
];

export const workspaceNavSections = [
  {
    title: "Workspace",
    theme: "pre",
    items: [
      { label: "Overview", path: "/overview" }
    ],
    children: [
      {
        label: "Spectrum Analysis",
        path: "/spectrum-analysis",
        items: [
          { label: "Spectrum", path: "/spectrum-analysis/spectrum" },
          { label: "Sensitivity", path: "/spectrum-analysis/sensitivity" },
          { label: "TEM Selection", path: "/spectrum-analysis/slice-selection" },
          { label: "Precision", path: "/spectrum-analysis/precision" }
        ]
      },
      {
        label: "Pre-Recipe",
        path: "/pre-recipe",
        items: [
          { label: "Recipe Setup", path: "/pre-recipe/recipe-setup" },
          { label: "Model", path: "/pre-recipe/model" },
          { label: "TEM & KPI", path: "/pre-recipe/tm-kpi" }
        ]
      },
      {
        label: "Recipe Build",
        path: "/recipe",
        items: [
          { label: "Starting Point", path: "/recipe/starting-point" },
          { label: "CD Strategy", path: "/recipe/cd-strategy" },
          { label: "Fitting Strategy", path: "/recipe/fitting-strategy" },
          { label: "Recipe Check", path: "/recipe/recipe-check" }
        ]
      },
      {
        label: "Run Monitor",
        path: "/run-monitor",
        items: [
          { label: "Trace", path: "/run-monitor/trace" },
          { label: "Ranking", path: "/run-monitor/ranking" },
          { label: "Control", path: "/run-monitor/control" }
        ]
      },
      {
        label: "Results",
        path: "/results",
        items: [
          { label: "Summary", path: "/results/summary" },
          { label: "Report", path: "/results/template" }
        ]
      }
    ]
  }
];

export const breadcrumbMap = {
  "/": ["App Selector"],
  "/ocd": ["OCD", "Home"],
  "/ocd/home": ["OCD", "Home"],
  "/ocd/assets": ["OCD", "Recipe Hub"],
  "/ocd/recipe-hub": ["OCD", "Recipe Hub"],
  "/ocd/run-monitor": ["OCD", "Recipe Hub"],
  "/ocd/templates": ["OCD", "Templates"],
  "/ocd/nk-library": ["OCD", "NK Library"],
  "/ocd/workspace/:id/overview": ["Workspace", "Overview"],
  "/ocd/workspace/:id/spectrum-analysis/spectrum": ["Workspace", "Spectrum Analysis", "Spectrum Viewer"],
  "/ocd/workspace/:id/spectrum-analysis/sensitivity": ["Workspace", "Spectrum Analysis", "Sensitivity Analysis"],
  "/ocd/workspace/:id/spectrum-analysis/slice-selection": ["Workspace", "Spectrum Analysis", "TEM Selection"],
  "/ocd/workspace/:id/spectrum-analysis/precision": ["Workspace", "Spectrum Analysis", "Precision"],
  "/ocd/workspace/:id/pre-recipe/recipe-setup": ["Workspace", "Pre-Recipe", "Recipe Setup"],
  "/ocd/workspace/:id/pre-recipe/model": ["Workspace", "Pre-Recipe", "Model"],
  "/ocd/workspace/:id/pre-recipe/tm-kpi": ["Workspace", "Pre-Recipe", "TEM & KPI"],
  "/ocd/workspace/:id/recipe/starting-point": ["Workspace", "Recipe Build", "Starting Point"],
  "/ocd/workspace/:id/recipe/cd-strategy": ["Workspace", "Recipe Build", "CD Strategy"],
  "/ocd/workspace/:id/recipe/fitting-strategy": ["Workspace", "Recipe Build", "Fitting Strategy"],
  "/ocd/workspace/:id/recipe/recipe-check": ["Workspace", "Recipe Build", "Recipe Check"],
  "/ocd/workspace/:id/run-monitor/control": ["Workspace", "Run Monitor", "Control"],
  "/ocd/workspace/:id/run-monitor/trace": ["Workspace", "Run Monitor", "Trace"],
  "/ocd/workspace/:id/run-monitor/ranking": ["Workspace", "Run Monitor", "Ranking"],
  "/ocd/workspace/:id/results/summary": ["Workspace", "Results", "Summary"],
  "/ocd/workspace/:id/results/template": ["Workspace", "Results", "Report"]
};
