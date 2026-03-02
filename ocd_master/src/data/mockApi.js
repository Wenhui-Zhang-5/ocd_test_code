import { spectrumByWafer } from "./mock.js";
import {
  MODELS_API_BASE,
  NK_API_BASE,
  RECIPE_HUB_API_BASE,
  SPECTRUM_API_BASE,
  WORKSPACE_CACHE_API_BASE
} from "../config/env.js";

const STORAGE_KEY = "ocd_mock_state_v1";
export const MOCK_STATE_UPDATED_EVENT = "ocd-mock-state-updated";

const defaultMetaOptions = {
  projects: ["Project-01", "Project-02", "Project-03"],
  productsByProject: {
    "Project-01": ["P-01", "P-02", "P-03"],
    "Project-02": ["P-11", "P-12"],
    "Project-03": ["P-21", "P-22", "P-23"]
  },
  loopsByProduct: {
    "P-01": ["L1", "L2"],
    "P-02": ["L3"],
    "P-03": ["L4", "L5"],
    "P-11": ["L1"],
    "P-12": ["L2", "L3"],
    "P-21": ["L1", "L2"],
    "P-22": ["L3"],
    "P-23": ["L4"]
  }
};

const defaultState = {
  workspaces: [
    {
      id: "temp",
      type: "temporary",
      status: "temp",
      modelID: null,
      recipeName: "Temporary Workspace",
      owner: "You",
      project: "Project-Temp",
      productId: "P-Temp",
      version: "v0.1",
      updatedAt: "Just now"
    },
    {
      id: "M-ALD-77",
      type: "model",
      status: "running",
      modelID: "M-ALD-77",
      recipeName: "ALD Gate V2",
      owner: "L. Chen",
      project: "Project-01",
      productId: "P-01",
      version: "v1.2",
      updatedAt: "4 min ago"
    },
    {
      id: "M-ALD-65",
      type: "model",
      status: "queued",
      modelID: "M-ALD-65",
      recipeName: "Spacer Etch B",
      owner: "J. Wu",
      project: "Project-02",
      productId: "P-02",
      version: "v1.0",
      updatedAt: "25 min ago"
    },
    {
      id: "M-ET-21",
      type: "model",
      status: "completed",
      modelID: "M-ET-21",
      recipeName: "High-K Stack",
      owner: "Y. Zhang",
      project: "Project-03",
      productId: "P-03",
      version: "v2.0",
      updatedAt: "Yesterday"
    }
  ],
  templates: [
    {
      templateId: "tpl_001",
      templateName: "Gate Stack Template",
      templateComment: "Baseline stack",
      couplingScheme: "CS-A",
      modelId: "OCD_MODEL_187",
      recipeMeta: {
        recipeName: "OCD_Recipe_A1",
        project: "Proj-X",
        productId: "P123",
        owner: "Alice",
        loop: "L1",
        layout: "Layout-A",
        state: "DEV",
        version: "v1.0"
      },
      updatedAt: "2026-02-05T10:15:00Z",
      recipeSchemaJson: {
        recipeMeta: {
          recipeName: "OCD_Recipe_A1",
          project: "Proj-X",
          productId: "P123",
          owner: "Alice",
          loop: "L1",
          layout: "Layout-A",
          state: "DEV",
          version: "v1.0"
        },
        seedSourceType: "material",
        cdStrategy: {
          mustFloat: ["CD1"],
          mustFix: ["CD2"],
          maybe: ["CD3"]
        },
        fittingStrategy: {
          mode: "byColumn",
          steps: [
            { step: 1, cells: [{ rowIndex: 0, colKey: "Amplitude" }] }
          ]
        }
      }
    },
    {
      templateId: "tpl_002",
      templateName: "Spacer Core Template",
      templateComment: "Process window",
      couplingScheme: "CS-B",
      modelId: "OCD_MODEL_204",
      recipeMeta: {
        recipeName: "OCD_Recipe_B2",
        project: "Proj-Y",
        productId: "P204",
        owner: "Chen",
        loop: "L2",
        layout: "Layout-B",
        state: "PROD",
        version: "v2.3"
      },
      updatedAt: "2026-02-01T08:40:00Z",
      recipeSchemaJson: {
        recipeMeta: {
          recipeName: "OCD_Recipe_B2",
          project: "Proj-Y",
          productId: "P204",
          owner: "Chen",
          loop: "L2",
          layout: "Layout-B",
          state: "PROD",
          version: "v2.3"
        },
        seedSourceType: "checkpoint",
        cdStrategy: {
          mustFloat: ["CD1", "CD4"],
          mustFix: ["CD2"],
          maybe: ["CD3", "CD5"]
        },
        fittingStrategy: {
          mode: "custom",
          steps: [
            { step: 1, cells: [{ rowIndex: 0, colKey: "En" }] },
            { step: 2, cells: [{ rowIndex: 1, colKey: "Eg" }] }
          ]
        }
      }
    }
  ],
  checkpointLibrary: {
    "M-ALD-77": {
      v1: [
        {
          id: "CP-ALD-01",
          name: "SeedSearch-1",
          version: "v1",
          modelID: "M-ALD-77",
          kpi: { r2: "0.96", slope: "1.01", sideBySideNm: "0.92", precision: "0.40" },
          summary: "Seed search checkpoint",
          createdAt: "2026-02-05 10:20"
        }
      ],
      v2: [
        {
          id: "CP-ALD-11",
          name: "Fitting-Stage-1",
          version: "v2",
          modelID: "M-ALD-77",
          kpi: { r2: "0.98", slope: "1.03", sideBySideNm: "0.85", precision: "0.32" },
          summary: "Fitting checkpoint",
          createdAt: "2026-02-05 11:05"
        },
        {
          id: "CP-ALD-12",
          name: "Fitting-Stage-2",
          version: "v2",
          modelID: "M-ALD-77",
          kpi: { r2: "0.99", slope: "1.02", sideBySideNm: "0.80", precision: "0.28" },
          summary: "Fitting checkpoint",
          createdAt: "2026-02-05 11:40"
        }
      ]
    },
    "M-ALD-65": {
      v1: [
        {
          id: "CP-ALD65-01",
          name: "SeedSearch-Init",
          version: "v1",
          modelID: "M-ALD-65",
          kpi: { r2: "0.94", slope: "0.99", sideBySideNm: "0.98", precision: "0.45" },
          summary: "Seed search checkpoint",
          createdAt: "2026-02-05 09:10"
        }
      ],
      v2: [
        {
          id: "CP-ALD65-11",
          name: "Fitting-Stage-1",
          version: "v2",
          modelID: "M-ALD-65",
          kpi: { r2: "0.97", slope: "1.01", sideBySideNm: "0.86", precision: "0.36" },
          summary: "Fitting checkpoint",
          createdAt: "2026-02-05 10:55"
        }
      ]
    },
    "M-ET-21": {
      v1: [
        {
          id: "CP-ET-01",
          name: "SeedSearch-1",
          version: "v1",
          modelID: "M-ET-21",
          kpi: { r2: "0.95", slope: "1.00", sideBySideNm: "0.90", precision: "0.42" },
          summary: "Seed search checkpoint",
          createdAt: "2026-02-04 16:20"
        }
      ],
      v2: [
        {
          id: "CP-ET-11",
          name: "Fitting-Stage-2",
          version: "v2",
          modelID: "M-ET-21",
          kpi: { r2: "0.98", slope: "1.02", sideBySideNm: "0.82", precision: "0.30" },
          summary: "Fitting checkpoint",
          createdAt: "2026-02-04 18:05"
        }
      ]
    }
  },
  runs: [
    {
      modelID: "M-ALD-77",
      recipeName: "ALD Gate V2",
      owner: "L. Chen",
      project: "Project-01",
      productId: "P-01",
      version: "v1.2",
      status: "running",
      currentStage: "Fitting Step 2",
      bestKPI: "0.95"
    },
    {
      modelID: "M-ALD-65",
      recipeName: "Spacer Etch B",
      owner: "J. Wu",
      project: "Project-02",
      productId: "P-02",
      version: "v1.0",
      status: "queued",
      currentStage: "Seed Search",
      bestKPI: "-"
    },
    {
      modelID: "M-ET-21",
      recipeName: "High-K Stack",
      owner: "Y. Zhang",
      project: "Project-03",
      productId: "P-03",
      version: "v2.0",
      status: "completed",
      currentStage: "KPI Evaluation",
      bestKPI: "0.97"
    }
  ],
  runDetail: {
    "M-ALD-77": {
      status: "running",
      iteration: 12,
      ranking: [
        {
          rank: 1,
          rowId: "rank_1",
          couplingScheme: "A",
          seedId: "Seed #1",
          iteration: 2,
          r2: 0.991,
          slope: 0.981,
          sideBySideNm: 0.95,
          precision: 0.52,
          status: "running",
          artifacts: {
            linearPlotId: "art_linear_iter_002",
            nkPlotId: "art_nk_iter_002",
            fittingPlotId: "art_fit_iter_002"
          }
        },
        {
          rank: 2,
          rowId: "rank_2",
          couplingScheme: "A",
          seedId: "Seed #2",
          iteration: null,
          r2: null,
          slope: null,
          sideBySideNm: null,
          precision: null,
          status: "queued",
          artifacts: null
        }
      ],
      traceTree: [
        {
          nodeId: "cs_001",
          type: "couplingScheme",
          label: "Coupling Scheme A",
          status: "running",
          kpi: {
            r2: 0.992,
            slope: 0.985,
            sideBySideNm: 0.82,
            precision: 0.45
          },
          artifacts: {
            linearPlotId: "art_linear_cs_001",
            nkPlotId: "art_nk_cs_001",
            fittingPlotId: "art_fit_cs_001"
          },
          children: [
            {
              nodeId: "seed_001",
              type: "seed",
              label: "Seed #1 (MatCombo_03)",
              status: "running",
              kpi: {
                r2: 0.991,
                slope: 0.981,
                sideBySideNm: 0.95,
                precision: 0.52
              },
              artifacts: {
                linearPlotId: "art_linear_seed_001",
                nkPlotId: "art_nk_seed_001",
                fittingPlotId: "art_fit_seed_001"
              },
              children: [
                {
                  nodeId: "iter_001",
                  type: "iteration",
                  label: "Iteration 1",
                  status: "done",
                  kpi: {
                    r2: 0.978,
                    slope: 0.952,
                    sideBySideNm: 1.8,
                    precision: 0.7
                  },
                  artifacts: {
                    linearPlotId: "art_linear_iter_001",
                    nkPlotId: "art_nk_iter_001",
                    fittingPlotId: "art_fit_iter_001"
                  },
                  children: [
                    {
                      nodeId: "mat_Si_iter1",
                      type: "material",
                      label: "Material: Si",
                      status: "done",
                      kpi: {
                        r2: 0.981,
                        slope: 0.958,
                        sideBySideNm: 1.62,
                        precision: 0.66
                      },
                      artifacts: {
                        linearPlotId: "art_linear_mat_Si_iter1",
                        nkPlotId: "art_nk_mat_Si_iter1",
                        fittingPlotId: "art_fit_mat_Si_iter1"
                      },
                      children: [
                        {
                          nodeId: "step_Si_1",
                          type: "step",
                          label: "Step 1 (Amplitude cells)",
                          status: "done",
                          kpi: {
                            r2: 0.979,
                            slope: 0.956,
                            sideBySideNm: 1.7,
                            precision: 0.68
                          },
                          artifacts: {
                            linearPlotId: "art_linear_step_Si_1",
                            nkPlotId: "art_nk_step_Si_1",
                            fittingPlotId: "art_fit_step_Si_1"
                          },
                          stepCells: [
                            { rowIndex: 0, colKey: "Amplitude" },
                            { rowIndex: 1, colKey: "Amplitude" },
                            { rowIndex: 2, colKey: "Amplitude" }
                          ]
                        },
                        {
                          nodeId: "step_Si_2",
                          type: "step",
                          label: "Step 2 (En cells)",
                          status: "done",
                          kpi: {
                            r2: 0.981,
                            slope: 0.958,
                            sideBySideNm: 1.62,
                            precision: 0.66
                          },
                          artifacts: {
                            linearPlotId: "art_linear_step_Si_2",
                            nkPlotId: "art_nk_step_Si_2",
                            fittingPlotId: "art_fit_step_Si_2"
                          },
                          stepCells: [
                            { rowIndex: 0, colKey: "En" },
                            { rowIndex: 1, colKey: "En" },
                            { rowIndex: 2, colKey: "En" }
                          ]
                        }
                      ]
                    },
                    {
                      nodeId: "mat_SiN_iter1",
                      type: "material",
                      label: "Material: SiN",
                      status: "done",
                      kpi: {
                        r2: 0.985,
                        slope: 0.967,
                        sideBySideNm: 1.35,
                        precision: 0.62
                      },
                      artifacts: {
                        linearPlotId: "art_linear_mat_SiN_iter1",
                        nkPlotId: "art_nk_mat_SiN_iter1",
                        fittingPlotId: "art_fit_mat_SiN_iter1"
                      },
                      children: [
                        {
                          nodeId: "step_SiN_1",
                          type: "step",
                          label: "Step 1 (Row 1 all cols)",
                          status: "done",
                          kpi: {
                            r2: 0.983,
                            slope: 0.964,
                            sideBySideNm: 1.44,
                            precision: 0.64
                          },
                          artifacts: {
                            linearPlotId: "art_linear_step_SiN_1",
                            nkPlotId: "art_nk_step_SiN_1",
                            fittingPlotId: "art_fit_step_SiN_1"
                          },
                          stepCells: [
                            { rowIndex: 0, colKey: "Amplitude" },
                            { rowIndex: 0, colKey: "En" },
                            { rowIndex: 0, colKey: "Eg" },
                            { rowIndex: 0, colKey: "Phi" },
                            { rowIndex: 0, colKey: "Nu" }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  nodeId: "iter_002",
                  type: "iteration",
                  label: "Iteration 2",
                  status: "running",
                  kpi: {
                    r2: 0.991,
                    slope: 0.981,
                    sideBySideNm: 0.95,
                    precision: 0.52
                  },
                  artifacts: {
                    linearPlotId: "art_linear_iter_002",
                    nkPlotId: "art_nk_iter_002",
                    fittingPlotId: "art_fit_iter_002"
                  },
                  children: []
                }
              ]
            },
            {
              nodeId: "seed_002",
              type: "seed",
              label: "Seed #2 (MatCombo_01)",
              status: "queued",
              kpi: null,
              artifacts: null,
              children: []
            }
          ]
        },
        {
          nodeId: "cs_002",
          type: "couplingScheme",
          label: "Coupling Scheme B",
          status: "queued",
          kpi: null,
          artifacts: null,
          children: []
        }
      ],
      checkpoints: []
    }
  },
  recipeSchemas: {},
  spectrumTransfers: [],
  metaOptions: defaultMetaOptions,
  workspaceCounter: 0
};

let cachedState = null;
let runTickerStarted = false;
const runtimeCache = {
  spectrumByWorkspace: {},
  precisionByWorkspace: {},
  tempSpectrumSelection: null,
  tempPrecisionSelection: null
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const ensureMetaOptions = (state) => {
  if (!state.metaOptions) {
    state.metaOptions = clone(defaultMetaOptions);
  }
  state.metaOptions.projects = state.metaOptions.projects || [];
  state.metaOptions.productsByProject = state.metaOptions.productsByProject || {};
  state.metaOptions.loopsByProduct = state.metaOptions.loopsByProduct || {};
  if (typeof state.workspaceCounter !== "number") {
    state.workspaceCounter = 0;
  }
  if (!Array.isArray(state.spectrumTransfers)) {
    state.spectrumTransfers = [];
  }
};

const ensureWorkspaceSequence = (state) => {
  if (!Array.isArray(state.workspaces)) {
    return;
  }
  const modelRows = state.workspaces.filter((workspace) => workspace?.type === "model");
  let maxSeq = 0;
  modelRows.forEach((workspace) => {
    if (typeof workspace.seq === "number" && workspace.seq > maxSeq) {
      maxSeq = workspace.seq;
    }
  });
  modelRows.forEach((workspace) => {
    if (typeof workspace.seq !== "number") {
      maxSeq += 1;
      workspace.seq = maxSeq;
    }
  });
  state.workspaces.forEach((workspace) => {
    if (workspace?.type !== "model" && typeof workspace.seq !== "number") {
      workspace.seq = 0;
    }
  });
  state.workspaceCounter = maxSeq;
};

const stripLocalRecipeHubModels = (state) => {
  if (!state || !Array.isArray(state.workspaces)) return;
  state.workspaces = state.workspaces.filter((workspace) => workspace?.type !== "model");
};

const loadState = () => {
  if (cachedState) {
    return cachedState;
  }
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cachedState = JSON.parse(raw);
      ensureMetaOptions(cachedState);
      // Recipe Hub source-of-truth is backend SQLite. Do not trust stale local model rows.
      stripLocalRecipeHubModels(cachedState);
      ensureWorkspaceSequence(cachedState);
      hydrateRecipeHubFromServer();
      return cachedState;
    }
  }
  cachedState = clone(defaultState);
  ensureMetaOptions(cachedState);
  ensureWorkspaceSequence(cachedState);
  hydrateRecipeHubFromServer();
  return cachedState;
};

const saveState = () => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedState));
    window.dispatchEvent(new CustomEvent(MOCK_STATE_UPDATED_EVENT));
    scheduleRecipeHubSync();
  }
};

export const workspaceStatuses = ["temp", "draft", "queued", "running", "completed"];
export const workspaceTypes = ["temporary", "model"];
let recipeHubSyncTimer = null;
let recipeHubHydrationStarted = false;
let recipeHubHydrated = false;
let recipeHubHydrationPromise = null;
let recipeHubHydrationResolve = null;

const ensureRecipeHubHydrationPromise = () => {
  if (!recipeHubHydrationPromise) {
    recipeHubHydrationPromise = new Promise((resolve) => {
      recipeHubHydrationResolve = resolve;
    });
  }
  return recipeHubHydrationPromise;
};

const resolveWorkspaceCacheKeys = (workspaceId) => {
  const base = String(workspaceId || "").trim();
  if (!base) return [];
  const keys = new Set([base]);
  const workspace = getWorkspace(base);
  if (workspace) {
    if (workspace.id) keys.add(String(workspace.id));
    if (workspace.modelID) keys.add(String(workspace.modelID));
  }
  return Array.from(keys).filter(Boolean);
};

const resolveWorkspaceCacheWriteKeys = (workspaceId) => {
  const base = String(workspaceId || "").trim();
  if (!base) return [];
  const workspace = getWorkspace(base);
  if (workspace?.id) {
    return [String(workspace.id)];
  }
  return [base];
};

const normalizeRecipeHubWorkspaces = (items = []) =>
  items
    .filter((item) => item && typeof item === "object" && item.id)
    .map((item) => ({
      ...item,
      type: item.type || "model",
      status: item.status || "draft",
      modelID: item.modelID || item.id
    }))
    .filter((item) => item.type === "model");

const syncRecipeHubToServer = async () => {
  if (typeof window === "undefined") return;
  const state = loadState();
  const workspaces = (state.workspaces || []).filter((workspace) => {
    if (!workspace || workspace.type !== "model") return false;
    if (String(workspace.status || "").toLowerCase() === "temp") return false;
    return Boolean(workspace.modelID);
  });
  try {
    await fetch(`${RECIPE_HUB_API_BASE}/workspaces/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaces })
    });
  } catch (_error) {
    // keep local data on sync failure
  }
};

function scheduleRecipeHubSync() {
  if (typeof window === "undefined") return;
  if (recipeHubHydrationStarted && !recipeHubHydrated) return;
  if (recipeHubSyncTimer) {
    window.clearTimeout(recipeHubSyncTimer);
  }
  recipeHubSyncTimer = window.setTimeout(() => {
    recipeHubSyncTimer = null;
    syncRecipeHubToServer();
  }, 300);
}

const applyRecipeHubRemote = (remoteWorkspaces) => {
  const state = loadState();
  const normalizedRemote = normalizeRecipeHubWorkspaces(remoteWorkspaces || []);
  const nonModelRows = (state.workspaces || []).filter((workspace) => workspace?.type !== "model");
  const nextWorkspaces = [...nonModelRows, ...normalizedRemote];
  const before = JSON.stringify(state.workspaces || []);
  const after = JSON.stringify(nextWorkspaces);
  state.workspaces = nextWorkspaces;
  ensureMetaOptions(state);
  ensureWorkspaceSequence(state);
  if (before !== after) {
    saveState();
    return true;
  }
  return false;
};

const pullRecipeHubFromServer = async () => {
  if (typeof window === "undefined") return false;
  const response = await fetch(`${RECIPE_HUB_API_BASE}/workspaces`);
  if (!response.ok) return false;
  const payload = await response.json();
  return applyRecipeHubRemote(payload?.workspaces || []);
};

function hydrateRecipeHubFromServer() {
  if (typeof window === "undefined" || recipeHubHydrationStarted) return;
  recipeHubHydrationStarted = true;
  ensureRecipeHubHydrationPromise();
  window.setTimeout(async () => {
    try {
      await pullRecipeHubFromServer();
    } catch (_error) {
      // keep local state on fetch failure
    } finally {
      recipeHubHydrated = true;
      if (recipeHubHydrationResolve) {
        recipeHubHydrationResolve(true);
        recipeHubHydrationResolve = null;
      }
      scheduleRecipeHubSync();
    }
  }, 0);
}

export const refreshRecipeHubFromServer = async () => {
  try {
    return await pullRecipeHubFromServer();
  } catch (_error) {
    return false;
  }
};

export const waitForRecipeHubHydration = async () => {
  hydrateRecipeHubFromServer();
  if (recipeHubHydrated) return true;
  const waiter = ensureRecipeHubHydrationPromise();
  try {
    await waiter;
    return true;
  } catch (_error) {
    return false;
  }
};

export const listModelHub = () => {
  const state = loadState();
  return state.workspaces
    .filter((workspace) => {
      if (workspace.type !== "model") return false;
      if (String(workspace.status || "").toLowerCase() === "temp") return false;
      if (!workspace.modelID) return false;
      return true;
    })
    .slice()
    .reverse();
};

export const listWorkspaces = () => {
  const state = loadState();
  return state.workspaces;
};

export const recipeHubModelExists = (modelId) => {
  const target = String(modelId || "").trim();
  if (!target) return false;
  const state = loadState();
  return (state.workspaces || []).some((workspace) => {
    if (!workspace || workspace.type !== "model") return false;
    const status = String(workspace.status || "").toLowerCase();
    if (status === "temp") return false;
    return (
      String(workspace.modelID || "").trim() === target || String(workspace.id || "").trim() === target
    );
  });
};

export const recipeHubModelVersionExists = (modelId, version) => {
  const targetModel = String(modelId || "").trim().toLowerCase();
  const targetVersion = String(version || "").trim().toLowerCase();
  if (!targetModel || !targetVersion) return false;
  const state = loadState();
  return (state.workspaces || []).some((workspace) => {
    if (!workspace || workspace.type !== "model") return false;
    const status = String(workspace.status || "").toLowerCase();
    if (status === "temp") return false;
    const model = String(workspace.modelID || "").trim().toLowerCase();
    const ver = String(workspace.version || "").trim().toLowerCase();
    return model === targetModel && ver === targetVersion;
  });
};

export const resetMockState = () => {
  cachedState = null;
  runtimeCache.spectrumByWorkspace = {};
  runtimeCache.precisionByWorkspace = {};
  runtimeCache.tempSpectrumSelection = null;
  runtimeCache.tempPrecisionSelection = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
};

export const clearRecipeHub = () => {
  const state = loadState();
  const tempWorkspace =
    state.workspaces.find((workspace) => workspace.id === "temp") || {
      id: "temp",
      type: "temporary",
      status: "temp",
      modelID: null,
      recipeName: "Temporary Workspace",
      owner: "You",
      project: "Project-Temp",
      productId: "P-Temp",
      version: "v0.1",
      updatedAt: "Just now"
    };
  const clearedState = {
    ...clone(defaultState),
    workspaces: [{ ...tempWorkspace, updatedAt: "Just now", seq: 0 }],
    runs: [],
    runDetail: {},
    checkpointLibrary: {},
    recipeSchemas: {},
    spectrumTransfers: [],
    spectrumSelection: null,
    temSelection: null,
    precisionSelection: null,
    workspaceCounter: 0,
    metaOptions: clone(state.metaOptions || defaultMetaOptions)
  };
  cachedState = clearedState;
  saveState();
  runtimeCache.spectrumByWorkspace = {};
  runtimeCache.precisionByWorkspace = {};
  runtimeCache.tempSpectrumSelection = null;
  runtimeCache.tempPrecisionSelection = null;
};

const isDeletableRecipeStatus = (status) => {
  const normalized = String(status || "").toLowerCase();
  return normalized === "draft" || normalized === "completed" || normalized === "complete";
};

export const deleteRecipeHubEntries = async (workspaceIds = []) => {
  const ids = Array.from(new Set((workspaceIds || []).filter(Boolean).map((value) => String(value))));
  if (!ids.length) return { deleted: 0 };

  const state = loadState();
  const byId = new Set(ids);
  const targets = state.workspaces.filter(
    (workspace) =>
      workspace?.type === "model" &&
      byId.has(String(workspace.id)) &&
      isDeletableRecipeStatus(workspace.status)
  );
  if (!targets.length) return { deleted: 0 };

  const targetKeys = new Set();
  targets.forEach((workspace) => {
    const workspaceId = String(workspace.id || "");
    const modelId = String(workspace.modelID || "");
    if (workspaceId) targetKeys.add(workspaceId);
    if (modelId) targetKeys.add(modelId);
  });

  state.workspaces = state.workspaces.filter(
    (workspace) => !(workspace?.type === "model" && targetKeys.has(String(workspace.id || "")))
  );

  state.runs = (state.runs || []).filter((item) => !targetKeys.has(String(item.modelID || "")));

  Object.keys(state.runDetail || {}).forEach((key) => {
    if (targetKeys.has(String(key))) {
      delete state.runDetail[key];
    }
  });

  Object.keys(state.checkpointLibrary || {}).forEach((key) => {
    if (targetKeys.has(String(key))) {
      delete state.checkpointLibrary[key];
    }
  });

  Object.keys(state.recipeSchemas || {}).forEach((key) => {
    if (targetKeys.has(String(key))) {
      delete state.recipeSchemas[key];
    }
  });

  state.spectrumTransfers = (state.spectrumTransfers || []).filter(
    (item) =>
      !targetKeys.has(String(item.workspaceId || "")) && !targetKeys.has(String(item.modelID || ""))
  );

  if (state.spectrumSelection && targetKeys.has(String(state.spectrumSelection.workspaceId || ""))) {
    state.spectrumSelection = null;
  }
  if (state.precisionSelection && targetKeys.has(String(state.precisionSelection.workspaceId || ""))) {
    state.precisionSelection = null;
  }
  if (state.temSelection && targetKeys.has(String(state.temSelection.workspaceId || ""))) {
    state.temSelection = null;
  }

  targets.forEach((workspace) => {
    clearSpectrumRuntimeCache(workspace.id);
    clearSpectrumRuntimeCache(workspace.modelID);
    clearPrecisionRuntimeCache(workspace.id);
    clearPrecisionRuntimeCache(workspace.modelID);
  });

  saveState();

  await Promise.allSettled(
    targets.flatMap((workspace) => [
      clearWorkspaceCaseCache(workspace.id),
      workspace.modelID && workspace.modelID !== workspace.id
        ? clearWorkspaceCaseCache(workspace.modelID)
        : Promise.resolve(true)
    ])
  );

  return { deleted: targets.length };
};

export const getWorkspace = (id) => {
  const state = loadState();
  return state.workspaces.find((workspace) => workspace.id === id || workspace.modelID === id) || null;
};

export const shouldPersistWorkspaceCaseCache = (workspaceId) => {
  if (!workspaceId) return false;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return false;
  const status = String(workspace.status || "").toLowerCase();
  return status === "draft" || status === "completed" || status === "complete";
};

export const loadWorkspaceCaseCache = async (workspaceId) => {
  const keys = resolveWorkspaceCacheKeys(workspaceId);
  if (!keys.length) return null;
  const merged = {};
  let seenAny = false;
  for (const key of keys) {
    try {
      const response = await fetch(
        `${WORKSPACE_CACHE_API_BASE}/${encodeURIComponent(key)}`
      );
      if (!response.ok) {
        continue;
      }
      const payload = await response.json();
      const cache = payload?.cache && typeof payload.cache === "object" ? payload.cache : null;
      if (!cache) continue;
      Object.assign(merged, cache);
      seenAny = true;
    } catch (error) {
      // try next key
    }
  }
  return seenAny ? merged : null;
};

export const saveWorkspaceCaseCacheSection = async (workspaceId, section, data) => {
  const keys = resolveWorkspaceCacheWriteKeys(workspaceId);
  if (!keys.length || !section) return false;
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const response = await fetch(
        `${WORKSPACE_CACHE_API_BASE}/${encodeURIComponent(key)}/${encodeURIComponent(section)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: data || {} })
        }
      );
      return response.ok;
    })
  );
  return results.some((item) => item.status === "fulfilled" && item.value);
};

export const clearWorkspaceCaseCache = async (workspaceId) => {
  const keys = resolveWorkspaceCacheKeys(workspaceId);
  if (!keys.length) return false;
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const response = await fetch(
        `${WORKSPACE_CACHE_API_BASE}/${encodeURIComponent(key)}`,
        { method: "DELETE" }
      );
      return response.ok;
    })
  );
  return results.some((item) => item.status === "fulfilled" && item.value);
};

export const createTemporaryWorkspace = () => {
  const state = loadState();
  let existing = state.workspaces.find((workspace) => workspace.id === "temp");
  if (!existing) {
    existing = {
      id: "temp",
      type: "temporary",
      status: "temp",
      modelID: null,
      recipeName: "Temporary Workspace",
      owner: "You",
      updatedAt: "Just now"
    };
    state.workspaces.unshift(existing);
    saveState();
    return existing;
  }
  let dirty = false;
  if (existing.type !== "temporary") {
    existing.type = "temporary";
    dirty = true;
  }
  if (existing.status !== "temp") {
    existing.status = "temp";
    dirty = true;
  }
  if (existing.modelID !== null) {
    existing.modelID = null;
    dirty = true;
  }
  if (!existing.recipeName) {
    existing.recipeName = "Temporary Workspace";
    dirty = true;
  }
  if (!existing.owner) {
    existing.owner = "You";
    dirty = true;
  }
  if (dirty) {
    existing.updatedAt = "Just now";
    saveState();
  }
  return existing;
};

export const resetTemporaryWorkspaceSession = () => {
  const state = loadState();
  runtimeCache.tempSpectrumSelection = null;
  runtimeCache.tempPrecisionSelection = null;
  clearSpectrumRuntimeCache("temp");
  clearPrecisionRuntimeCache("temp");
  state.temSelection = null;
  state.spectrumTransfers = (state.spectrumTransfers || []).filter(
    (item) => String(item?.workspaceId || "") !== "temp" && String(item?.modelID || "") !== "temp"
  );
  delete state.recipeSchemas.temp;
  saveState();
  // Keep API-side cache clean in case a temp file was accidentally persisted before.
  clearWorkspaceCaseCache("temp");
};

export const createModelWorkspace = (payload) => {
  const state = loadState();
  const maxExistingSeq = (state.workspaces || [])
    .filter((item) => item?.type === "model")
    .reduce((max, item) => {
      const seq = typeof item?.seq === "number" ? item.seq : 0;
      return seq > max ? seq : max;
    }, 0);
  const nextIndex = Math.max(state.workspaceCounter || 0, maxExistingSeq) + 1;
  state.workspaceCounter = nextIndex;
  const workspaceId = `WKS-${String(nextIndex).padStart(4, "0")}`;
  const modelID = payload.modelID || `M-${Date.now().toString().slice(-5)}`;
  const workspace = {
    id: workspaceId,
    type: "model",
    status: "draft",
    modelID,
    seq: nextIndex,
    recipeName: payload.recipeName || "New Recipe",
    owner: payload.owner || "You",
    project: payload.project || "",
    productId: payload.productID || "",
    loop: payload.loop || "",
    layout: payload.layout || "Default",
    version: payload.version || "v1",
    state: payload.state || "draft",
    updatedAt: "Just now"
  };
  state.workspaces = state.workspaces.filter((item) => item.id !== "temp");
  state.workspaces.unshift(workspace);
  state.recipeSchemas[modelID] = payload;
  saveState();
  return workspace;
};

export const updateWorkspaceStatus = (id, status) => {
  const state = loadState();
  const workspace = state.workspaces.find((item) => item.id === id);
  if (workspace) {
    workspace.status = status;
    workspace.updatedAt = "Just now";
    saveState();
  }
  return workspace;
};

export const promoteWorkspaceDraftIfTemp = (id) => {
  const state = loadState();
  const workspace = state.workspaces.find((item) => item.id === id || item.modelID === id);
  if (!workspace) return null;
  if ((workspace.status || "").toLowerCase() !== "temp") {
    return workspace;
  }
  workspace.status = "draft";
  workspace.updatedAt = "Just now";
  saveState();
  return workspace;
};

export const listGlobalRuns = () => {
  const state = loadState();
  return state.runs;
};

export const listTemplates = () => {
  const state = loadState();
  return state.templates || [];
};

export const getTemplate = (templateId) => {
  const state = loadState();
  return (state.templates || []).find((item) => item.templateId === templateId) || null;
};

export const addTemplateEntry = (payload) => {
  const state = loadState();
  const templates = state.templates || [];
  const nextId = `tpl_${String(templates.length + 1).padStart(3, "0")}`;
  const record = {
    templateId: payload.templateId || nextId,
    templateName: payload.templateName || "Untitled",
    templateComment: payload.templateComment || "",
    couplingScheme: payload.couplingScheme || "-",
    modelId: payload.modelId || payload.recipeMeta?.modelId || "",
    recipeMeta: payload.recipeMeta || {},
    recipeSchemaJson: payload.recipeSchemaJson || {},
    updatedAt: new Date().toISOString()
  };
  state.templates = [record, ...templates];
  saveState();
  return record;
};

const tickRunDetail = (detail) => {
  detail.iteration += 1;
  detail.ranking = detail.ranking.map((row) => ({
    ...row,
    iteration: typeof row.iteration === "number" ? row.iteration + 1 : row.iteration
  }));
  if (detail.ranking[0]) {
    detail.ranking[0].r2 = Number((0.98 + Math.random() * 0.02).toFixed(3));
  }
  const topNode = detail.traceTree?.[0];
  if (topNode && topNode.kpi) {
    topNode.kpi.r2 = Number((0.98 + Math.random() * 0.02).toFixed(3));
  }
};

export const startRunTicker = () => {
  if (runTickerStarted || typeof window === "undefined") {
    return;
  }
  runTickerStarted = true;
  window.setInterval(() => {
    const state = loadState();
    Object.values(state.runDetail).forEach((detail) => tickRunDetail(detail));
    saveState();
  }, 6000);
};

const cloneRunDetail = (detail) => JSON.parse(JSON.stringify(detail));

const buildMockRunDetail = () => ({
  status: "running",
  iteration: 2,
  ranking: [
    {
      rank: 1,
      rowId: "rank_1",
      couplingScheme: "A",
      seedId: "Seed #1",
      iteration: 2,
      r2: 0.991,
      slope: 0.981,
      sideBySideNm: 0.95,
      precision: 0.52,
      status: "running",
      artifacts: {
        linearPlotId: "art_linear_iter_002",
        nkPlotId: "art_nk_iter_002",
        fittingPlotId: "art_fit_iter_002"
      }
    },
    {
      rank: 2,
      rowId: "rank_2",
      couplingScheme: "A",
      seedId: "Seed #2",
      iteration: null,
      r2: null,
      slope: null,
      sideBySideNm: null,
      precision: null,
      status: "queued",
      artifacts: null
    }
  ],
  traceTree: [
    {
      nodeId: "cs_001",
      type: "couplingScheme",
      label: "Coupling Scheme A",
      status: "running",
      kpi: {
        r2: 0.992,
        slope: 0.985,
        sideBySideNm: 0.82,
        precision: 0.45
      },
      artifacts: {
        linearPlotId: "art_linear_cs_001",
        nkPlotId: "art_nk_cs_001",
        fittingPlotId: "art_fit_cs_001"
      },
      children: [
        {
          nodeId: "seed_001",
          type: "seed",
          label: "Seed #1 (MatCombo_03)",
          status: "running",
          kpi: {
            r2: 0.991,
            slope: 0.981,
            sideBySideNm: 0.95,
            precision: 0.52
          },
          artifacts: {
            linearPlotId: "art_linear_seed_001",
            nkPlotId: "art_nk_seed_001",
            fittingPlotId: "art_fit_seed_001"
          },
          children: [
            {
              nodeId: "iter_001",
              type: "iteration",
              label: "Iteration 1",
              status: "done",
              kpi: {
                r2: 0.978,
                slope: 0.952,
                sideBySideNm: 1.8,
                precision: 0.7
              },
              artifacts: {
                linearPlotId: "art_linear_iter_001",
                nkPlotId: "art_nk_iter_001",
                fittingPlotId: "art_fit_iter_001"
              },
              children: [
                {
                  nodeId: "mat_Si_iter1",
                  type: "material",
                  label: "Material: Si",
                  status: "done",
                  kpi: {
                    r2: 0.981,
                    slope: 0.958,
                    sideBySideNm: 1.62,
                    precision: 0.66
                  },
                  artifacts: {
                    linearPlotId: "art_linear_mat_Si_iter1",
                    nkPlotId: "art_nk_mat_Si_iter1",
                    fittingPlotId: "art_fit_mat_Si_iter1"
                  },
                  children: [
                    {
                      nodeId: "step_Si_1",
                      type: "step",
                      label: "Step 1 (Amplitude cells)",
                      status: "done",
                      kpi: {
                        r2: 0.979,
                        slope: 0.956,
                        sideBySideNm: 1.7,
                        precision: 0.68
                      },
                      artifacts: {
                        linearPlotId: "art_linear_step_Si_1",
                        nkPlotId: "art_nk_step_Si_1",
                        fittingPlotId: "art_fit_step_Si_1"
                      },
                      stepCells: [
                        { rowIndex: 0, colKey: "Amplitude" },
                        { rowIndex: 1, colKey: "Amplitude" },
                        { rowIndex: 2, colKey: "Amplitude" }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  checkpoints: []
});

export const getRunDetail = (modelID) => {
  const state = loadState();
  let fallback = state.runDetail["M-ALD-77"];
  if (!fallback || !fallback.traceTree || fallback.traceTree.length === 0) {
    fallback = buildMockRunDetail();
    state.runDetail["M-ALD-77"] = cloneRunDetail(fallback);
    saveState();
  }
  if (!state.runDetail[modelID]) {
    state.runDetail[modelID] = fallback ? cloneRunDetail(fallback) : buildMockRunDetail();
  }
  if (
    state.runDetail[modelID] &&
    (!state.runDetail[modelID].traceTree || state.runDetail[modelID].traceTree.length === 0)
  ) {
    const next = fallback ? cloneRunDetail(fallback) : buildMockRunDetail();
    state.runDetail[modelID] = {
      ...state.runDetail[modelID],
      traceTree: next.traceTree,
      ranking: next.ranking
    };
    saveState();
  }
  return state.runDetail[modelID];
};

const findTraceNode = (nodes, nodeId) => {
  for (const node of nodes) {
    if (node.nodeId === nodeId) {
      return node;
    }
    if (node.children?.length) {
      const match = findTraceNode(node.children, nodeId);
      if (match) {
        return match;
      }
    }
  }
  return null;
};

export const saveCheckpoint = (modelID, payload = {}) => {
  const state = loadState();
  const detail = getRunDetail(modelID);
  if (payload.nodeId) {
    const match = findTraceNode(detail.traceTree || [], payload.nodeId);
    if (match) {
      match.checkpointed = true;
      if (payload.name) {
        match.checkpointName = payload.name;
      }
    }
  }
  const version = payload.version || "v1";
  const baseName = (payload.name || `Checkpoint-${Date.now()}`).trim() || `Checkpoint-${Date.now()}`;
  const library = state.checkpointLibrary || {};
  library[modelID] = library[modelID] || {};
  library[modelID][version] = library[modelID][version] || [];
  const existingNames = new Set(library[modelID][version].map((item) => item.name));
  let finalName = baseName;
  let suffix = 1;
  while (existingNames.has(finalName)) {
    finalName = `${baseName}-${suffix}`;
    suffix += 1;
  }
  const checkpointRecord = {
    id: `CP-${Date.now()}`,
    name: finalName,
    version,
    modelID,
    kpi: payload.kpi || { r2: "0.98", slope: "1.02", sideBySideNm: "0.85", precision: "0.35" },
    summary: payload.summary || "Fitting snapshot",
    createdAt: "now"
  };
  library[modelID][version].unshift(checkpointRecord);
  state.checkpointLibrary = library;
  detail.checkpoints = detail.checkpoints || [];
  detail.checkpoints.unshift({
    id: `CP-${Date.now()}`,
    savedAt: "now",
    name: finalName,
    version,
    ...payload
  });
  state.runDetail[modelID] = detail;
  saveState();
  return detail;
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const deepMerge = (base, patch) => {
  const result = { ...base };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  });
  return result;
};

export const saveRecipeSchema = (modelID, schema) => {
  const state = loadState();
  const workspace = state.workspaces.find((item) => item.id === modelID || item.modelID === modelID);
  const schemaKey = workspace?.modelID || modelID;
  const existing = state.recipeSchemas[schemaKey] || {};
  const merged = deepMerge(existing, schema);
  state.recipeSchemas[schemaKey] = merged;
  if (workspace?.id && workspace.id !== schemaKey) {
    state.recipeSchemas[workspace.id] = merged;
  }
  if (modelID !== schemaKey) {
    state.recipeSchemas[modelID] = merged;
  }
  if (workspace) {
    if (schema.modelID) workspace.modelID = schema.modelID;
    if (schema.recipeName) workspace.recipeName = schema.recipeName;
    if (schema.owner) workspace.owner = schema.owner;
    if (schema.project) workspace.project = schema.project;
    if (schema.productID) workspace.productId = schema.productID;
    if (schema.version) workspace.version = schema.version;
    if (schema.state) workspace.state = schema.state;
    workspace.updatedAt = "Just now";
  }
  saveState();

  const status = String(workspace?.status || "").toLowerCase();
  if (status === "draft" || status === "completed" || status === "complete") {
    // Persist every step save to workspace_case_cache for reload across sessions.
    saveWorkspaceCaseCacheSection(workspace?.id || schemaKey, "schema", {
      recipeSchema: merged
    });
  }
};

export const loadRecipeSchema = (modelID) => {
  const state = loadState();
  if (state.recipeSchemas[modelID]) return state.recipeSchemas[modelID];
  const workspace = state.workspaces.find((item) => item.id === modelID || item.modelID === modelID);
  if (workspace) {
    if (state.recipeSchemas[workspace.modelID]) return state.recipeSchemas[workspace.modelID];
    if (state.recipeSchemas[workspace.id]) return state.recipeSchemas[workspace.id];
  }
  return null;
};

export const listCheckpointVersions = (modelID) => {
  const state = loadState();
  const library = state.checkpointLibrary || {};
  return Object.keys(library[modelID] || {});
};

export const listCheckpoints = (modelID, version) => {
  const state = loadState();
  const library = state.checkpointLibrary || {};
  return (library[modelID] && library[modelID][version]) || [];
};

export const setSpectrumSelection = (payload) => {
  const workspaceId = String(payload?.workspaceId || "").trim();
  if (workspaceId === "temp") {
    runtimeCache.tempSpectrumSelection = payload || null;
    return;
  }
  const state = loadState();
  state.spectrumSelection = payload;
  saveState();
};

export const getSpectrumSelection = (workspaceId) => {
  const requestedWorkspaceId = String(workspaceId || "").trim();
  if (runtimeCache.tempSpectrumSelection) {
    if (!requestedWorkspaceId || requestedWorkspaceId === "temp") {
      return runtimeCache.tempSpectrumSelection;
    }
  }
  const state = loadState();
  const persisted = state.spectrumSelection || null;
  if (!requestedWorkspaceId) {
    return persisted || runtimeCache.tempSpectrumSelection || null;
  }
  if (persisted && String(persisted.workspaceId || "") === requestedWorkspaceId) {
    return persisted;
  }
  if (
    runtimeCache.tempSpectrumSelection &&
    String(runtimeCache.tempSpectrumSelection.workspaceId || "") === requestedWorkspaceId
  ) {
    return runtimeCache.tempSpectrumSelection;
  }
  return null;
};

export const setSpectrumRuntimeCache = (workspaceId, payload) => {
  const keys = resolveWorkspaceCacheKeys(workspaceId);
  if (!keys.length) return;
  if (!payload) {
    keys.forEach((key) => {
      delete runtimeCache.spectrumByWorkspace[key];
    });
    return;
  }
  keys.forEach((key) => {
    runtimeCache.spectrumByWorkspace[key] = payload;
  });
};

export const getSpectrumRuntimeCache = (workspaceId) => {
  const keys = resolveWorkspaceCacheKeys(workspaceId);
  if (!keys.length) return null;
  for (const key of keys) {
    if (runtimeCache.spectrumByWorkspace[key]) {
      return runtimeCache.spectrumByWorkspace[key];
    }
  }
  return null;
};

export const clearSpectrumRuntimeCache = (workspaceId) => {
  const keys = resolveWorkspaceCacheKeys(workspaceId);
  if (!keys.length) return;
  keys.forEach((key) => {
    delete runtimeCache.spectrumByWorkspace[key];
  });
};

export const setPrecisionRuntimeCache = (workspaceId, payload) => {
  const keys = resolveWorkspaceCacheKeys(workspaceId);
  if (!keys.length) return;
  if (!payload) {
    keys.forEach((key) => {
      delete runtimeCache.precisionByWorkspace[key];
    });
    return;
  }
  keys.forEach((key) => {
    runtimeCache.precisionByWorkspace[key] = payload;
  });
};

export const getPrecisionRuntimeCache = (workspaceId) => {
  const keys = resolveWorkspaceCacheKeys(workspaceId);
  if (!keys.length) return null;
  for (const key of keys) {
    if (runtimeCache.precisionByWorkspace[key]) {
      return runtimeCache.precisionByWorkspace[key];
    }
  }
  return null;
};

export const clearPrecisionRuntimeCache = (workspaceId) => {
  const keys = resolveWorkspaceCacheKeys(workspaceId);
  if (!keys.length) return;
  keys.forEach((key) => {
    delete runtimeCache.precisionByWorkspace[key];
  });
};

export const setTemSelection = (payload) => {
  const state = loadState();
  state.temSelection = payload;
  saveState();
};

export const getTemSelection = () => {
  const state = loadState();
  return state.temSelection || null;
};

export const setPrecisionSelection = (payload) => {
  const workspaceId = String(payload?.workspaceId || "").trim();
  if (workspaceId === "temp") {
    runtimeCache.tempPrecisionSelection = payload || null;
    return;
  }
  const state = loadState();
  state.precisionSelection = payload;
  saveState();
};

export const getPrecisionSelection = (workspaceId) => {
  const requestedWorkspaceId = String(workspaceId || "").trim();
  if (runtimeCache.tempPrecisionSelection) {
    if (!requestedWorkspaceId || requestedWorkspaceId === "temp") {
      return runtimeCache.tempPrecisionSelection;
    }
  }
  const state = loadState();
  const persisted = state.precisionSelection || null;
  if (!requestedWorkspaceId) {
    return persisted || runtimeCache.tempPrecisionSelection || null;
  }
  if (persisted && String(persisted.workspaceId || "") === requestedWorkspaceId) {
    return persisted;
  }
  if (
    runtimeCache.tempPrecisionSelection &&
    String(runtimeCache.tempPrecisionSelection.workspaceId || "") === requestedWorkspaceId
  ) {
    return runtimeCache.tempPrecisionSelection;
  }
  return null;
};

const markReloadCleanupForSchema = (schema) => {
  if (!schema || typeof schema !== "object") return schema;
  const next = { ...schema };
  if (next.spectrumAnalysis?.spectrumViewer) {
    next.spectrumAnalysis = {
      ...next.spectrumAnalysis,
      spectrumViewer: {
        ...next.spectrumAnalysis.spectrumViewer,
        restoreReady: false,
        showPlot: false
      }
    };
  }
  if (next.precision) {
    next.precision = {
      ...next.precision,
      restoreReady: false
    };
  }
  return next;
};

export const applyRefreshCachePolicy = (workspaceId) => {
  if (!workspaceId) return;
  const state = loadState();
  const workspace =
    state.workspaces.find((item) => item.id === workspaceId || item.modelID === workspaceId) || null;
  if (!workspace) return;

  const isTempWorkspace =
    workspace.id === "temp" || workspace.type === "temporary" || workspace.status === "temp";

  if (isTempWorkspace) {
    runtimeCache.tempSpectrumSelection = null;
    runtimeCache.tempPrecisionSelection = null;
    state.spectrumSelection = null;
    state.precisionSelection = null;
    state.temSelection = null;
    delete state.recipeSchemas.temp;
    if (workspace.modelID) {
      delete state.recipeSchemas[workspace.modelID];
    }
    saveState();
    return;
  }
};

export const listSpectrumTransfers = (workspaceId) => {
  const state = loadState();
  const rows = state.spectrumTransfers || [];
  if (!workspaceId) return rows;
  return rows.filter((item) => item.workspaceId === workspaceId);
};

export const getPreRecipeSpectrum = ({ waferIds, timeRange }) => ({
  waferIds,
  timeRange,
  curves: waferIds.map((id) => ({ id, points: [] }))
});

export const getSensitivityAnalysis = ({ target }) => ({
  target,
  bands: [
    { range: "480-520", level: "high" },
    { range: "610-660", level: "medium" }
  ],
  curve: []
});

export const getPrecisionSummary = ({ waferId, pointId }) => ({
  waferId,
  pointId,
  summary: Array.from({ length: 17 }).map((_, index) => ({
    point: `P-${String(index + 1).padStart(2, "0")}`,
    mean: (0.7 + index * 0.02).toFixed(2),
    std: (0.12 + index * 0.01).toFixed(2)
  }))
});

const hashString = (value) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const seededRandom = (seed) => {
  let t = seed % 2147483647;
  if (t <= 0) t += 2147483646;
  return () => {
    t = (t * 16807) % 2147483647;
    return (t - 1) / 2147483646;
  };
};

const pickSpectrumId = (waferId, index) => {
  const options = spectrumByWafer[waferId] || [];
  if (!options.length) {
    return `SPEC_${String((index % 20) + 1).padStart(4, "0")}`;
  }
  return options[index % options.length];
};

export const fetchTemPlanOutput = ({ algorithm, quotas, config }) =>
  new Promise((resolve) => {
    const delay = 300 + Math.floor(Math.random() * 300);
    window.setTimeout(() => {
      const output = [];
      const trimRadius = Number(config?.trimRadius) || 148;
      const centerBoundary = Number(config?.centerBoundary) || 50;
      const middleBoundary = Number(config?.middleBoundary) || 100;

      quotas.forEach((row) => {
        const seedBase = hashString(`${algorithm}-${row.waferId}`);
        const random = seededRandom(seedBase);
        const regions = [
          { count: Number(row.center) || 0, min: 0, max: centerBoundary },
          { count: Number(row.middle) || 0, min: centerBoundary, max: middleBoundary },
          { count: Number(row.edge) || 0, min: middleBoundary, max: trimRadius }
        ];
        let index = 0;
        regions.forEach((region) => {
          for (let i = 0; i < region.count; i += 1) {
            const angle = random() * Math.PI * 2;
            const radius = region.min + (region.max - region.min) * random();
            const x = (Math.cos(angle) * radius).toFixed(1);
            const y = (Math.sin(angle) * radius).toFixed(1);
            output.push({
              waferId: row.waferId,
              spectrumId: pickSpectrumId(row.waferId, index),
              x,
              y,
              distance: radius.toFixed(1)
            });
            index += 1;
          }
        });
      });
      resolve(output);
    }, delay);
  });

let nkIndexCache = null;

export const fetchNkIndex = async () => {
  if (nkIndexCache) {
    return nkIndexCache;
  }
  const response = await fetch(`${NK_API_BASE}/index`);
  if (!response.ok) {
    throw new Error("NK index fetch failed");
  }
  nkIndexCache = await response.json();
  return nkIndexCache;
};

export const listNkLibraries = async () => {
  const index = await fetchNkIndex();
  return Array.from(new Set(index.map((item) => item.library))).filter(Boolean);
};

export const listNkMaterials = async (library) => {
  const index = await fetchNkIndex();
  return Array.from(
    new Set(index.filter((item) => item.library === library).map((item) => item.material))
  ).filter(Boolean);
};

export const listNkModels = async (library, material) => {
  const index = await fetchNkIndex();
  return index
    .filter((item) => item.library === library && item.material === material)
    .map((item) => ({ modelType: item.modelType, modelName: item.modelName }));
};

export const fetchNkCurve = async ({ library, material, modelType, modelName }) => {
  const response = await fetch(`${NK_API_BASE}/curve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ library, material, modelType, modelName })
  });
  if (!response.ok) {
    throw new Error("NK curve fetch failed");
  }
  return response.json();
};

export const fetchNkMaterialOrder = async () => {
  try {
    const response = await fetch(`${NK_API_BASE}/material-order`);
    if (!response.ok) {
      throw new Error("material order fetch failed");
    }
    const order = await response.json();
    return Array.isArray(order) ? order : [];
  } catch (error) {
    return ["TiN", "Si", "SiN", "SiO2"];
  }
};

export const fetchModelJson = async (modelID) => {
  const response = await fetch(`${MODELS_API_BASE}/${encodeURIComponent(modelID)}`);
  if (!response.ok) {
    throw new Error("Model fetch failed");
  }
  return response.json();
};

export const listProjects = () => {
  const state = loadState();
  return state.metaOptions.projects || [];
};

export const listProducts = (project) => {
  const state = loadState();
  return (state.metaOptions.productsByProject || {})[project] || [];
};

export const listLoops = (productId) => {
  const state = loadState();
  return (state.metaOptions.loopsByProduct || {})[productId] || [];
};

export const fetchRecipeHubMetaOptions = async ({ project = "", product = "" } = {}) => {
  try {
    const params = new URLSearchParams();
    if (project) params.set("project", project);
    if (product) params.set("product", product);
    const response = await fetch(`${RECIPE_HUB_API_BASE}/meta-options?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Recipe Hub meta options API failed");
    }
    const payload = await response.json();
    return {
      projects: Array.isArray(payload?.projects) ? payload.projects : [],
      products: Array.isArray(payload?.products) ? payload.products : [],
      loops: Array.isArray(payload?.loops) ? payload.loops : []
    };
  } catch (_error) {
    return { projects: [], products: [], loops: [] };
  }
};

export const addRecipeHubMetaOption = async ({ valueType, value, project = "", product = "" }) => {
  try {
    const response = await fetch(`${RECIPE_HUB_API_BASE}/meta-options/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value_type: valueType,
        value,
        project,
        product
      })
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    if (payload && typeof payload.ok === "boolean") {
      return payload.ok;
    }
    return true;
  } catch (_error) {
    return false;
  }
};

export const addProject = (name) => {
  const state = loadState();
  if (!name) return listProjects();
  if (!state.metaOptions.projects.includes(name)) {
    state.metaOptions.projects.push(name);
    saveState();
  }
  return listProjects();
};

export const addProduct = (project, productId) => {
  const state = loadState();
  if (!project || !productId) return listProducts(project);
  const map = state.metaOptions.productsByProject;
  if (!map[project]) map[project] = [];
  if (!map[project].includes(productId)) {
    map[project].push(productId);
    if (!state.metaOptions.loopsByProduct[productId]) {
      state.metaOptions.loopsByProduct[productId] = [];
    }
    saveState();
  }
  return listProducts(project);
};

export const addLoop = (productId, loop) => {
  const state = loadState();
  if (!productId || !loop) return listLoops(productId);
  const map = state.metaOptions.loopsByProduct;
  if (!map[productId]) map[productId] = [];
  if (!map[productId].includes(loop)) {
    map[productId].push(loop);
    saveState();
  }
  return listLoops(productId);
};
