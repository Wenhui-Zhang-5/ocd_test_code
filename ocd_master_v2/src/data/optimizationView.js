import {
  getRunResultJson,
  listOptimizationRuns,
  listRunArtifacts,
  listRunResultFiles
} from "./optimizationApi.js";

const ACTIVE_STATUSES = new Set(["running", "pausing", "paused", "queued"]);

export const pickPreferredWorkspaceRun = (items) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const active = list.find((item) => ACTIVE_STATUSES.has(String(item?.status || "").toLowerCase()));
  return active || list[0] || null;
};

export const loadWorkspacePreferredRun = async (workspaceId) => {
  const payload = await listOptimizationRuns({ workspaceId, page: 1, pageSize: 200 });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return pickPreferredWorkspaceRun(items);
};

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const buildRankingRowsFromFinalRegression = async (runId) => {
  if (!runId) return [];
  const indexPayload = await listRunResultFiles(runId, {
    contains: "final_regression",
    suffix: ".summary.json",
    limit: 2000
  });
  let files = Array.isArray(indexPayload?.items) ? indexPayload.items : [];

  if (!files.length) {
    const artifactPayload = await listRunArtifacts(runId).catch(() => ({ items: [] }));
    const artifactItems = Array.isArray(artifactPayload?.items) ? artifactPayload.items : [];
    files = artifactItems
      .map((item) => ({
        relative_path: item.relative_path,
        modified_at: item.created_at || ""
      }))
      .filter((item) => String(item.relative_path || "").toLowerCase().endsWith(".summary.json"));
  }
  if (!files.length) return [];

  const summaries = await Promise.all(
    files.map(async (file) => {
      try {
        const payload = await getRunResultJson(runId, file.relative_path);
        return {
          relativePath: file.relative_path,
          modifiedAt: file.modified_at || "",
          data: payload?.data || null
        };
      } catch (error) {
        return null;
      }
    })
  );

  const rows = [];
  summaries.forEach((entry) => {
    if (!entry?.data || typeof entry.data !== "object") return;
    const summary = entry.data;
    const finalStage = summary.final_stage && typeof summary.final_stage === "object" ? summary.final_stage : {};
    if (!finalStage.accepted) return;
    const result = finalStage.result && typeof finalStage.result === "object" ? finalStage.result : {};
    const metrics = result.regression_metrics && typeof result.regression_metrics === "object"
      ? result.regression_metrics
      : {};
    const precisionEval = result.precision_eval && typeof result.precision_eval === "object"
      ? result.precision_eval
      : {};
    const precisionMetric = toFiniteNumber(result.precision_metric);
    const targetPrecision = precisionEval.target_precision_3sigma && typeof precisionEval.target_precision_3sigma === "object"
      ? precisionEval.target_precision_3sigma
      : {};
    const targetPassed = precisionEval.target_passed && typeof precisionEval.target_passed === "object"
      ? precisionEval.target_passed
      : {};
    rows.push({
      runId,
      relativePath: entry.relativePath,
      modifiedAt: entry.modifiedAt,
      couplingExpression: summary.coupling_expression || "-",
      seedId: summary.seed_id || "-",
      gridIndex: summary.grid_index ?? null,
      grid: summary.grid || {},
      accepted: true,
      r2: toFiniteNumber(metrics.r2),
      slope: toFiniteNumber(metrics.slope),
      sideBySide: toFiniteNumber(metrics.side_by_side),
      precision: precisionMetric,
      lbh: toFiniteNumber(precisionEval.lbh),
      precisionPassed: Boolean(precisionEval.passed),
      targetPrecision3Sigma: targetPrecision,
      targetPassed,
      regressionPerCd: result.regression_per_cd && typeof result.regression_per_cd === "object"
        ? result.regression_per_cd
        : {},
      modelJson: result.model_json && typeof result.model_json === "object" ? result.model_json : null,
      nkSnapshot: finalStage.nk_snapshot && typeof finalStage.nk_snapshot === "object" ? finalStage.nk_snapshot : null,
      spectrumFit: finalStage.spectrum_fit && typeof finalStage.spectrum_fit === "object" ? finalStage.spectrum_fit : null
    });
  });

  rows.sort((a, b) => {
    const scoreA = (a.r2 ?? -1) - Math.abs((a.slope ?? 0) - 1) - (a.precision ?? 1e9) * 1e-3;
    const scoreB = (b.r2 ?? -1) - Math.abs((b.slope ?? 0) - 1) - (b.precision ?? 1e9) * 1e-3;
    return scoreB - scoreA;
  });

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
};
