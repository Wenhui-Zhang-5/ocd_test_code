from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from ocd_algorithm_api.ocd_auto_opt.api.run_hpc import HPCAPIError, HPCClient
from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import basis_aliases, set_basis_float_flags
from ocd_algorithm_api.ocd_auto_opt.utils.parse_hpc_result import best_record, parse_hpc_result, record_score


@dataclass
class PrecisionEvalRow:
    fixed_cds: List[str]
    float_cds: List[str]
    target_cds: List[str]
    target_precision_3sigma: Dict[str, float]
    score: float
    gof: float
    precision_3sigma: float
    lbh: float
    passed: bool


@dataclass
class PrecisionCheckResult:
    grid_fix_cds: List[str]
    baseline_gof: float
    baseline_precision_3sigma: float
    selected_precision_3sigma: float
    selected_lbh: float
    selected_case_passed: bool
    baseline_case: PrecisionEvalRow
    selected_case: PrecisionEvalRow
    one_d_fix_table: List[PrecisionEvalRow] = field(default_factory=list)
    two_d_fix_table: List[PrecisionEvalRow] = field(default_factory=list)
    rows: List[PrecisionEvalRow] = field(default_factory=list)
    summary: Dict[str, object] = field(default_factory=dict)


@dataclass
class PrecisionConfig:
    precision_spec_paths: List[str] = field(default_factory=list)
    target_cds: List[str] = field(default_factory=list)
    target_precision_thresholds: Dict[str, float] = field(default_factory=dict)
    must_float_cds: List[str] = field(default_factory=list)
    must_fix_cds: List[str] = field(default_factory=list)
    maybe_cds: List[str] = field(default_factory=list)
    precision_threshold: float = 1.0
    max_1d_candidates: int = 4
    max_2d_combinations: int = 12
    num_of_node: Optional[List[int]] = None


def _dedup_keep_order(values: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        token = str(value or "").strip()
        if not token or token in seen:
            continue
        seen.add(token)
        out.append(token)
    return out


def _resolve_target_cds(parsed, preferred_target_cds: List[str]) -> List[str]:
    preferred = _dedup_keep_order([str(x) for x in preferred_target_cds])
    if preferred:
        return preferred
    if not parsed.records:
        return []
    first = parsed.records[0]
    return _dedup_keep_order(list(first.basis_values.keys()))


def _target_precision_map(parsed, target_cds: List[str]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for cd_name in target_cds:
        values: List[float] = []
        for rec in parsed.records:
            val = rec.basis_values.get(cd_name)
            try:
                values.append(float(val))
            except (TypeError, ValueError):
                continue
        if len(values) <= 1:
            out[cd_name] = float("inf")
            continue
        mean = sum(values) / len(values)
        variance = sum((v - mean) ** 2 for v in values) / len(values)
        sigma3 = (variance ** 0.5) * 3.0
        out[cd_name] = float(sigma3)
    return out


def _aggregate_precision(target_precision_3sigma: Dict[str, float]) -> float:
    if not target_precision_3sigma:
        return float("inf")
    values = [float(v) for v in target_precision_3sigma.values()]
    return max(values) if values else float("inf")


def _lbh_from_records(parsed) -> float:
    if not parsed.records:
        return 1e9
    vals = [abs(float(rec.lbh)) for rec in parsed.records]
    return float(max(vals)) if vals else 1e9


def _threshold_for_cd(config: PrecisionConfig, cd_name: str) -> float:
    raw = config.target_precision_thresholds.get(cd_name)
    try:
        if raw is not None:
            return float(raw)
    except (TypeError, ValueError):
        pass
    return float(config.precision_threshold)


def _pass_rule(
    *,
    lbh: float,
    target_cds: List[str],
    target_precision_3sigma: Dict[str, float],
    config: PrecisionConfig,
) -> bool:
    if abs(lbh) > 1e-12:
        return False
    if not target_cds:
        return False
    for cd_name in target_cds:
        value = target_precision_3sigma.get(cd_name, float("inf"))
        if value > _threshold_for_cd(config, cd_name):
            return False
    return True


def _evaluate_case(
    *,
    model_id: str,
    base_model_json: Dict,
    float_cds: List[str],
    fixed_cds: List[str],
    precision_config: PrecisionConfig,
    hpc_client: Optional[HPCClient],
) -> PrecisionEvalRow:
    eval_model = set_basis_float_flags(base_model_json, float_cds)

    if hpc_client is None or not precision_config.precision_spec_paths:
        target_cds = _dedup_keep_order([str(x) for x in precision_config.target_cds])
        mock_map = {cd: 0.2 for cd in target_cds}
        return PrecisionEvalRow(
            fixed_cds=list(fixed_cds),
            float_cds=list(float_cds),
            target_cds=target_cds,
            target_precision_3sigma=mock_map,
            score=900.0,
            gof=0.98,
            precision_3sigma=_aggregate_precision(mock_map),
            lbh=0.0,
            passed=_pass_rule(
                lbh=0.0,
                target_cds=target_cds,
                target_precision_3sigma=mock_map,
                config=precision_config,
            ),
        )

    try:
        response = hpc_client.run_hpc(
            model_id=model_id,
            model_json=eval_model,
            spec_paths=precision_config.precision_spec_paths,
            num_of_node=precision_config.num_of_node,
        )
    except HPCAPIError:
        target_cds = _dedup_keep_order([str(x) for x in precision_config.target_cds])
        inf_map = {cd: float("inf") for cd in target_cds}
        return PrecisionEvalRow(
            fixed_cds=list(fixed_cds),
            float_cds=list(float_cds),
            target_cds=target_cds,
            target_precision_3sigma=inf_map,
            score=-1e9,
            gof=0.0,
            precision_3sigma=float("inf"),
            lbh=1e9,
            passed=False,
        )

    parsed = parse_hpc_result(response)
    top = best_record(parsed)
    if top is None:
        target_cds = _dedup_keep_order([str(x) for x in precision_config.target_cds])
        inf_map = {cd: float("inf") for cd in target_cds}
        return PrecisionEvalRow(
            fixed_cds=list(fixed_cds),
            float_cds=list(float_cds),
            target_cds=target_cds,
            target_precision_3sigma=inf_map,
            score=-1e9,
            gof=0.0,
            precision_3sigma=float("inf"),
            lbh=1e9,
            passed=False,
        )

    rec, _ = top
    target_cds = _resolve_target_cds(parsed, precision_config.target_cds)
    target_map = _target_precision_map(parsed, target_cds)
    lbh = _lbh_from_records(parsed)
    passed = _pass_rule(
        lbh=lbh,
        target_cds=target_cds,
        target_precision_3sigma=target_map,
        config=precision_config,
    )
    return PrecisionEvalRow(
        fixed_cds=list(fixed_cds),
        float_cds=list(float_cds),
        target_cds=target_cds,
        target_precision_3sigma=target_map,
        score=record_score(rec),
        gof=rec.gof,
        precision_3sigma=_aggregate_precision(target_map),
        lbh=lbh,
        passed=passed,
    )


def _empty_result() -> PrecisionCheckResult:
    baseline = PrecisionEvalRow(
        fixed_cds=[],
        float_cds=[],
        target_cds=[],
        target_precision_3sigma={},
        score=-1e9,
        gof=0.0,
        precision_3sigma=float("inf"),
        lbh=1e9,
        passed=False,
    )
    return PrecisionCheckResult(
        grid_fix_cds=[],
        baseline_gof=0.0,
        baseline_precision_3sigma=float("inf"),
        selected_precision_3sigma=float("inf"),
        selected_lbh=1e9,
        selected_case_passed=False,
        baseline_case=baseline,
        selected_case=baseline,
        one_d_fix_table=[],
        two_d_fix_table=[],
        rows=[baseline],
        summary={},
    )


def precision_check(
    *,
    fitted_model_json: Dict[str, object],
    model_id: str,
    precision_config: PrecisionConfig,
    hpc_client: Optional[HPCClient],
) -> PrecisionCheckResult:
    basis = basis_aliases(fitted_model_json)
    if not basis:
        return _empty_result()

    must_fix_set = set(_dedup_keep_order([x for x in precision_config.must_fix_cds if x in basis]))
    must_float_set = set(_dedup_keep_order([x for x in precision_config.must_float_cds if x in basis]))
    maybe_default = [x for x in basis if x not in must_fix_set and x not in must_float_set]
    maybe_cds = _dedup_keep_order([x for x in precision_config.maybe_cds if x in basis]) or maybe_default

    # Baseline Case: all non-mustFix CDs float.
    baseline_float = [x for x in basis if x not in must_fix_set]
    baseline_case = _evaluate_case(
        model_id=model_id,
        base_model_json=fitted_model_json,
        float_cds=baseline_float,
        fixed_cds=[],
        precision_config=precision_config,
        hpc_client=hpc_client,
    )

    one_d_rows: List[PrecisionEvalRow] = []
    two_d_rows: List[PrecisionEvalRow] = []

    # Rule 1: 1D first; only when 1D has no passing case, evaluate 2D.
    if not baseline_case.passed:
        for cd in maybe_cds:
            float_cds = [x for x in baseline_float if x != cd]
            row = _evaluate_case(
                model_id=model_id,
                base_model_json=fitted_model_json,
                float_cds=float_cds,
                fixed_cds=[cd],
                precision_config=precision_config,
                hpc_client=hpc_client,
            )
            one_d_rows.append(row)

        one_d_pass = [r for r in one_d_rows if r.passed]
        if not one_d_pass:
            one_d_sorted = sorted(one_d_rows, key=lambda r: (r.precision_3sigma, abs(r.lbh), -r.gof))
            max_1d = max(0, int(precision_config.max_1d_candidates))
            candidate_for_2d = [r.fixed_cds[0] for r in one_d_sorted[: min(max_1d, len(one_d_sorted))]] if max_1d > 0 else []

            max_2d = max(0, int(precision_config.max_2d_combinations))
            for cd1, cd2 in itertools.combinations(candidate_for_2d, 2):
                if max_2d and len(two_d_rows) >= max_2d:
                    break
                fixed = [cd1, cd2]
                float_cds = [x for x in baseline_float if x not in {cd1, cd2}]
                row = _evaluate_case(
                    model_id=model_id,
                    base_model_json=fitted_model_json,
                    float_cds=float_cds,
                    fixed_cds=fixed,
                    precision_config=precision_config,
                    hpc_client=hpc_client,
                )
                two_d_rows.append(row)

    if baseline_case.passed:
        selected_case = baseline_case
        grid_fix_cds: List[str] = []
    else:
        one_d_pass = [r for r in one_d_rows if r.passed]
        if one_d_pass:
            selected_case = sorted(one_d_pass, key=lambda r: (len(r.fixed_cds), r.precision_3sigma, abs(r.lbh), -r.gof))[0]
            grid_fix_cds = list(selected_case.fixed_cds)
        else:
            two_d_pass = [r for r in two_d_rows if r.passed]
            if two_d_pass:
                selected_case = sorted(two_d_pass, key=lambda r: (len(r.fixed_cds), r.precision_3sigma, abs(r.lbh), -r.gof))[0]
                grid_fix_cds = list(selected_case.fixed_cds)
            elif one_d_rows or two_d_rows:
                selected_case = sorted(one_d_rows + two_d_rows, key=lambda r: (r.precision_3sigma, abs(r.lbh), -r.gof, len(r.fixed_cds)))[0]
                grid_fix_cds = list(selected_case.fixed_cds)
            else:
                selected_case = baseline_case
                grid_fix_cds = []

    rows = [baseline_case, *one_d_rows, *two_d_rows]
    summary = {
        "target_cds": list(selected_case.target_cds),
        "target_precision_thresholds": {
            cd: _threshold_for_cd(precision_config, cd) for cd in selected_case.target_cds
        },
        "baseline": {
            "passed": baseline_case.passed,
            "gof": baseline_case.gof,
            "lbh": baseline_case.lbh,
            "target_precision_3sigma": baseline_case.target_precision_3sigma,
        },
        "selected": {
            "passed": selected_case.passed,
            "fixed_cds": list(selected_case.fixed_cds),
            "gof": selected_case.gof,
            "lbh": selected_case.lbh,
            "target_precision_3sigma": selected_case.target_precision_3sigma,
        },
        "one_d_count": len(one_d_rows),
        "two_d_count": len(two_d_rows),
    }

    return PrecisionCheckResult(
        grid_fix_cds=grid_fix_cds,
        baseline_gof=baseline_case.gof,
        baseline_precision_3sigma=baseline_case.precision_3sigma,
        selected_precision_3sigma=selected_case.precision_3sigma,
        selected_lbh=selected_case.lbh,
        selected_case_passed=selected_case.passed,
        baseline_case=baseline_case,
        selected_case=selected_case,
        one_d_fix_table=one_d_rows,
        two_d_fix_table=two_d_rows,
        rows=rows,
        summary=summary,
    )
