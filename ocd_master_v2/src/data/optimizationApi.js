import { OPTIMIZATION_API_BASE, OPTIMIZATION_API_ENABLED } from "../config/env.js";

const parseJson = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || `HTTP ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : `HTTP ${response.status}`);
  }
  return payload;
};

export const isOptimizationApiEnabled = () => OPTIMIZATION_API_ENABLED;

export const listOptimizationRuns = async ({ status, modelId, workspaceId, page = 1, pageSize = 200 } = {}) => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (modelId) params.set("model_id", modelId);
  if (workspaceId) params.set("workspace_id", workspaceId);
  params.set("page", String(page));
  params.set("page_size", String(pageSize));

  const response = await fetch(`${OPTIMIZATION_API_BASE}/runs?${params.toString()}`);
  return parseJson(response);
};

export const getOptimizationRun = async (runId) => {
  const response = await fetch(`${OPTIMIZATION_API_BASE}/runs/${encodeURIComponent(runId)}`);
  return parseJson(response);
};

export const cancelOptimizationRun = async (runId) => {
  const response = await fetch(`${OPTIMIZATION_API_BASE}/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST"
  });
  return parseJson(response);
};

export const pauseOptimizationRun = async (runId, reason = "") => {
  const response = await fetch(`${OPTIMIZATION_API_BASE}/runs/${encodeURIComponent(runId)}/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
  return parseJson(response);
};

export const resumeOptimizationRun = async (runId) => {
  const response = await fetch(`${OPTIMIZATION_API_BASE}/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST"
  });
  return parseJson(response);
};

export const subscribeOptimizationEvents = ({ lastEventId = 0, onEvent, onError } = {}) => {
  if (!isOptimizationApiEnabled() || typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => {};
  }
  const url = new URL(`${OPTIMIZATION_API_BASE}/events/stream`, window.location.origin);
  if (lastEventId) url.searchParams.set("last_event_id", String(lastEventId));
  const source = new EventSource(url.toString());

  source.onmessage = (event) => {
    if (onEvent) onEvent(event);
  };
  source.onerror = (event) => {
    if (onError) onError(event);
  };

  return () => {
    source.close();
  };
};
