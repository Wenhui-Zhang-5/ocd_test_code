from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from ocd_algorithm_api.ocd_auto_opt.api.run_hpc import HPCAPIError, HPCClient
from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import (
    set_basis_float_flags,
    set_material_float_targets,
    sync_new_fields_from_nominal_value,
)
from ocd_algorithm_api.ocd_auto_opt.utils.parse_hpc_result import best_record, parse_hpc_result, record_score


StepCallback = Callable[[Dict[str, Any]], None]


@dataclass
class FitStepResult:
    step_name: str
    accepted: bool
    score_before: float
    score_after: float
    gof: float
    residual: float
    message: str = ""


@dataclass
class FittingResult:
    model_json: Dict[str, Any]
    best_score: float
    best_gof: float
    best_residual: float
    best_lbh: float
    steps: List[FitStepResult] = field(default_factory=list)


@dataclass
class FittingConfig:
    execution_steps_by_material: Dict[str, Any] = field(default_factory=dict)
    material_order: List[str] = field(default_factory=list)
    fitting_iteration: int = 1
    must_float_cds: List[str] = field(default_factory=list)
    early_stop_gof: float = 0.99
    num_of_node: Optional[List[int]] = None


def _extract_steps(config: FittingConfig) -> List[Tuple[str, str, List[Tuple[str, str, str]]]]:
    out: List[Tuple[str, str, List[Tuple[str, str, str]]]] = []
    material_order = [str(x).strip() for x in config.material_order if str(x).strip()]
    by_material = config.execution_steps_by_material if isinstance(config.execution_steps_by_material, dict) else {}
    if not isinstance(by_material, dict):
        return []

    if not material_order:
        material_order = [str(k).strip() for k in by_material.keys() if str(k).strip()]

    for material_name in material_order:
        steps = by_material.get(material_name)
        if not isinstance(steps, list):
            continue
        for idx, step in enumerate(steps, start=1):
            if not isinstance(step, dict):
                continue
            name = str(step.get("name") or f"{material_name}-Step-{idx}")
            targets = []
            for row in step.get("targets", []) if isinstance(step.get("targets"), list) else []:
                if not isinstance(row, dict):
                    continue
                material = str(row.get("material") or "")
                model = str(row.get("model") or "")
                param = str(row.get("name") or "")
                if not (material and model and param):
                    continue
                # Keep step bounded to declared material iteration order.
                if material != material_name:
                    continue
                targets.append((material, model, param))
            out.append((material_name, name, targets))
    return out


def _fit_once(
    *,
    hpc_client: Optional[HPCClient],
    model_id: str,
    model_json: Dict[str, Any],
    spec_paths: List[str],
    num_of_node: Optional[List[int]] = None,
) -> Tuple[float, float, float, float, Dict[str, Any], str]:
    if hpc_client is None or not spec_paths:
        # Offline fallback score.
        return 900.0, 0.98, 0.01, 0.0, model_json, "offline score"

    try:
        response = hpc_client.run_hpc(
            model_id=model_id,
            model_json=model_json,
            spec_paths=spec_paths,
            num_of_node=num_of_node,
        )
    except HPCAPIError as exc:
        return -1e9, 0.0, 1e9, 1e9, model_json, str(exc)

    parsed = parse_hpc_result(response)
    top = best_record(parsed)
    if top is None:
        return -1e9, 0.0, 1e9, 1e9, model_json, "empty hpc result"

    rec, maybe_model = top
    selected_model = maybe_model if isinstance(maybe_model, dict) else model_json
    selected_model = sync_new_fields_from_nominal_value(selected_model)
    return record_score(rec), rec.gof, rec.residual, rec.lbh, selected_model, "ok"


def run_fitting(
    *,
    seed_model_json: Dict[str, Any],
    fitting_config: FittingConfig,
    model_id: str,
    spec_paths: List[str],
    hpc_client: Optional[HPCClient],
    step_cb: Optional[StepCallback] = None,
) -> FittingResult:
    def _emit(payload: Dict[str, Any]) -> None:
        if step_cb is None:
            return
        try:
            step_cb(payload)
        except Exception:
            return

    steps = _extract_steps(fitting_config)
    fit_iterations = max(1, int(fitting_config.fitting_iteration or 1))

    current_model = set_basis_float_flags(seed_model_json, fitting_config.must_float_cds)
    score, gof, residual, lbh, current_model, _ = _fit_once(
        hpc_client=hpc_client,
        model_id=model_id,
        model_json=current_model,
        spec_paths=spec_paths,
        num_of_node=fitting_config.num_of_node,
    )

    history: List[FitStepResult] = []
    best_score = score
    best_gof = gof
    best_residual = residual
    best_lbh = lbh
    _emit(
        {
            "kind": "init",
            "best_score": best_score,
            "best_gof": best_gof,
            "best_residual": best_residual,
            "best_lbh": best_lbh,
            "model_json": current_model,
        }
    )

    stop_early = False
    for iteration_idx in range(1, fit_iterations + 1):
        if stop_early:
            break
        for material_name, step_name, targets in steps:
            if not targets:
                continue
            candidate = set_basis_float_flags(current_model, fitting_config.must_float_cds)
            candidate = set_material_float_targets(candidate, targets)
            new_score, new_gof, new_residual, new_lbh, fitted_model, message = _fit_once(
                hpc_client=hpc_client,
                model_id=model_id,
                model_json=candidate,
                spec_paths=spec_paths,
                num_of_node=fitting_config.num_of_node,
            )

            # Stage-2 acceptance rule: GOF improves -> accept; otherwise rollback.
            accepted = new_gof > best_gof
            if accepted:
                current_model = set_basis_float_flags(fitted_model, fitting_config.must_float_cds)
                best_score = new_score
                best_gof = new_gof
                best_residual = new_residual
                best_lbh = new_lbh

            history.append(
                FitStepResult(
                    step_name=f"iter{iteration_idx}:{material_name}:{step_name}",
                    accepted=accepted,
                    score_before=score,
                    score_after=new_score,
                    gof=new_gof,
                    residual=new_residual,
                    message=message,
                )
            )
            _emit(
                {
                    "kind": "step",
                    "iteration": iteration_idx,
                    "material": material_name,
                    "step": step_name,
                    "accepted": accepted,
                    "score_before": score,
                    "score_after": new_score,
                    "gof": new_gof,
                    "residual": new_residual,
                    "lbh": new_lbh,
                    "best_score": best_score,
                    "best_gof": best_gof,
                    "best_residual": best_residual,
                    "best_lbh": best_lbh,
                    "message": message,
                    "model_json": fitted_model,
                }
            )
            score = best_score
            if best_gof >= float(fitting_config.early_stop_gof):
                stop_early = True
                break

    result = FittingResult(
        model_json=current_model,
        best_score=best_score,
        best_gof=best_gof,
        best_residual=best_residual,
        best_lbh=best_lbh,
        steps=history,
    )
    _emit(
        {
            "kind": "completed",
            "best_score": result.best_score,
            "best_gof": result.best_gof,
            "best_residual": result.best_residual,
            "best_lbh": result.best_lbh,
            "step_count": len(result.steps),
            "model_json": result.model_json,
        }
    )
    return result
