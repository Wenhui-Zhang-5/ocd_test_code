const stripTrailingSlashes = (value) => String(value || "").replace(/\/+$/, "");

const apiOrigin = stripTrailingSlashes(import.meta.env.VITE_API_ORIGIN || "http://localhost:8002");
const apiPrefixRaw = String(import.meta.env.VITE_API_PREFIX || "/api").trim();
const apiPrefix = apiPrefixRaw.startsWith("/") ? apiPrefixRaw : `/${apiPrefixRaw}`;

export const API_BASE = `${apiOrigin}${apiPrefix}`;
export const SPECTRUM_API_BASE = `${API_BASE}/spectrum`;
export const NK_API_BASE = `${API_BASE}/nk`;
export const OUTLIER_API_URL = `${API_BASE}/outlier-detect`;
export const WORKSPACE_CACHE_API_BASE = `${API_BASE}/workspace-cache`;
export const RECIPE_HUB_API_BASE = `${API_BASE}/recipe-hub`;
export const MODELS_API_BASE = `${API_BASE}/models`;
export const OPTIMIZATION_API_BASE = `${API_BASE}/optimization`;
export const OPTIMIZATION_API_ENABLED = String(import.meta.env.VITE_ENABLE_OPTIMIZATION_API || "0")
  .trim()
  .toLowerCase() === "1";

export const MOCK_SPECTRUM_ROOT =
  import.meta.env.VITE_SPECTRUM_ROOT || "/Users/wenhuizhang/Projects/Gradio/ocd_master/spectrum_data";
