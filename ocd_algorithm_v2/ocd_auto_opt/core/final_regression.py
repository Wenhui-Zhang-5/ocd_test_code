from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple

from ocd_algorithm_api.ocd_auto_opt.core.fitting import FittingConfig
from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import set_basis_float_flags, set_material_float_targets


BaselineFitFn = Callable[[Dict[str, Any]], Tuple[Dict[str, Any], float, float, float, str]]
KPIEvalFn = Callable[[Dict[str, Any], int, str, str, float], Dict[str, Any]]


def _final_stage_steps(fitting_config: FittingConfig) -> List[Tuple[str, str, List[Tuple[str, str, str]]]]:
    out: List[Tuple[str, str, List[Tuple[str, str, str]]]] = []
    material_order = [str(x).strip() for x in fitting_config.material_order if str(x).strip()]
    by_material = (
        fitting_config.execution_steps_by_material
        if isinstance(fitting_config.execution_steps_by_material, dict)
        else {}
    )
    if not material_order:
        material_order = [str(k).strip() for k in by_material.keys() if str(k).strip()]

    for material_name in material_order:
        steps = by_material.get(material_name)
        if not isinstance(steps, list):
            continue
        for idx, step in enumerate(steps, start=1):
            if not isinstance(step, dict):
                continue
            step_name = str(step.get("name") or f"{material_name}-Step-{idx}")
            targets: List[Tuple[str, str, str]] = []
            rows = step.get("targets") if isinstance(step.get("targets"), list) else []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                material = str(row.get("material") or "").strip()
                model = str(row.get("model") or "").strip()
                param = str(row.get("name") or "").strip()
                if not (material and model and param):
                    continue
                if material != material_name:
                    continue
                targets.append((material, model, param))
            out.append((material_name, step_name, targets))
    return out


def run_final_regression_stage_for_grid(
    *,
    start_model_json: Dict[str, Any],
    fitting_config: FittingConfig,
    baseline_fit_once: BaselineFitFn,
    kpi_evaluator: KPIEvalFn,
    baseline_drop_limit_ratio: float = 0.9,
) -> Dict[str, Any]:
    current_model = set_basis_float_flags(start_model_json, fitting_config.must_float_cds)
    current_gof: float | None = None
    current_residual: float | None = None
    current_lbh: float | None = None

    history: List[Dict[str, Any]] = [
        {
            "kind": "init",
            "message": "grid values applied",
        }
    ]

    steps = _final_stage_steps(fitting_config)
    fit_iterations = max(1, int(fitting_config.fitting_iteration or 1))
    for iter_idx in range(1, fit_iterations + 1):
        for material_name, step_name, targets in steps:
            if not targets:
                history.append(
                    {
                        "kind": "step",
                        "iteration": iter_idx,
                        "material": material_name,
                        "step": step_name,
                        "accepted": False,
                        "reason": "no_targets",
                    }
                )
                continue

            candidate = set_basis_float_flags(current_model, fitting_config.must_float_cds)
            candidate = set_material_float_targets(candidate, targets)
            fitted_model, step_gof, step_residual, step_lbh, step_msg = baseline_fit_once(candidate)
            row = {
                "kind": "step",
                "iteration": iter_idx,
                "material": material_name,
                "step": step_name,
                "baseline_gof_prev": current_gof,
                "baseline_gof_new": step_gof,
                "baseline_residual_new": step_residual,
                "baseline_lbh_new": step_lbh,
                "message": step_msg,
            }

            if current_gof is not None and step_gof < float(current_gof) * float(baseline_drop_limit_ratio):
                row["accepted"] = False
                row["reason"] = "baseline_gof_guard_failed"
                history.append(row)
                continue

            current_model = set_basis_float_flags(fitted_model, fitting_config.must_float_cds)
            current_gof = float(step_gof)
            current_residual = float(step_residual)
            current_lbh = float(step_lbh)
            row["accepted"] = True
            history.append(row)

            if current_gof < float(fitting_config.early_stop_gof):
                continue

            kpi_eval = kpi_evaluator(current_model, iter_idx, material_name, step_name, current_gof)
            history.append(
                {
                    "kind": "kpi_check",
                    "iteration": iter_idx,
                    "material": material_name,
                    "step": step_name,
                    "baseline_gof": current_gof,
                    "result": kpi_eval,
                }
            )
            if bool(kpi_eval.get("passed")):
                return {
                    "accepted": True,
                    "history": history,
                    "result": {
                        "model_json": current_model,
                        "baseline_gof": current_gof,
                        "baseline_residual": current_residual,
                        "baseline_lbh": current_lbh,
                        **kpi_eval,
                    },
                    "final_baseline_gof": current_gof,
                    "final_baseline_residual": current_residual,
                    "final_baseline_lbh": current_lbh,
                }

    return {
        "accepted": False,
        "reject_reason": "kpi_not_satisfied_after_final_stage_iterations",
        "history": history,
        "final_baseline_gof": current_gof,
        "final_baseline_residual": current_residual,
        "final_baseline_lbh": current_lbh,
    }

