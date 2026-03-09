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

export const listRunEvents = async (runId, { afterId = 0, limit = 200 } = {}) => {
  const params = new URLSearchParams();
  params.set("after_id", String(afterId));
  params.set("limit", String(limit));
  const response = await fetch(
    `${OPTIMIZATION_API_BASE}/runs/${encodeURIComponent(runId)}/events?${params.toString()}`
  );
  return parseJson(response);
};

export const listRunArtifacts = async (runId) => {
  const response = await fetch(`${OPTIMIZATION_API_BASE}/runs/${encodeURIComponent(runId)}/artifacts`);
  return parseJson(response);
};

export const listRunResultFiles = async (
  runId,
  { prefix = "", contains = "", suffix = "", limit = 1000 } = {}
) => {
  const params = new URLSearchParams();
  if (prefix) params.set("prefix", prefix);
  if (contains) params.set("contains", contains);
  if (suffix) params.set("suffix", suffix);
  params.set("limit", String(limit));
  const response = await fetch(
    `${OPTIMIZATION_API_BASE}/runs/${encodeURIComponent(runId)}/results/index?${params.toString()}`
  );
  return parseJson(response);
};

export const getRunResultJson = async (runId, relativePath, { tail = 0 } = {}) => {
  const params = new URLSearchParams();
  params.set("relative_path", relativePath);
  if (tail) params.set("tail", String(tail));
  const response = await fetch(
    `${OPTIMIZATION_API_BASE}/runs/${encodeURIComponent(runId)}/results/json?${params.toString()}`
  );
  return parseJson(response);
};

const OPTIMIZATION_EVENT_NAMES = [
  "run_created",
  "run_started",
  "run_progress",
  "run_pausing",
  "run_paused",
  "run_resumed",
  "run_canceled",
  "run_completed",
  "run_failed",
  "run_artifacts_updated",
  "queue_reordered"
];

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
  OPTIMIZATION_EVENT_NAMES.forEach((eventName) => {
    source.addEventListener(eventName, (event) => {
      if (onEvent) onEvent(event);
    });
  });
  source.onerror = (event) => {
    if (onError) onError(event);
  };

  return () => {
    source.close();
  };
};
