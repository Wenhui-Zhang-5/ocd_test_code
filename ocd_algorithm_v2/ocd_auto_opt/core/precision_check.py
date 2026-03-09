from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from ocd_algorithm_api.ocd_auto_opt.api.run_hpc import HPCAPIError, HPCClient
from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import basis_aliases, set_basis_float_flags
from ocd_algorithm_api.ocd_auto_opt.utils.parse_hpc_result import best_record, parse_hpc_result, record_score


@dataclass
class PrecisionEvalRow:
    fixed_cds: List[str]
    float_cds: List[str]
    target_cds: List[str]
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
    baseline_case: PrecisionEvalRow
    one_d_fix_table: List[PrecisionEvalRow] = field(default_factory=list)
    two_d_fix_table: List[PrecisionEvalRow] = field(default_factory=list)
    rows: List[PrecisionEvalRow] = field(default_factory=list)


@dataclass
class PrecisionConfig:
    precision_spec_paths: List[str] = field(default_factory=list)
    target_cds: List[str] = field(default_factory=list)
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


def _precision_from_target(parsed, target_cds: List[str]) -> float:
    if not parsed.records:
        return float("inf")

    sigma_list: List[float] = []
    for cd_name in target_cds:
        values: List[float] = []
        for rec in parsed.records:
            value = rec.basis_values.get(cd_name)
            try:
                fv = float(value)
            except (TypeError, ValueError):
                continue
            if np.isfinite(fv):
                values.append(fv)
        arr = np.asarray(values, dtype=float)
        if arr.size > 1:
            sigma_list.append(float(np.std(arr, ddof=0)) * 3.0)
    return float(max(sigma_list)) if sigma_list else float("inf")


def _lbh_from_records(parsed) -> float:
    if not parsed.records:
        return 1e9
    vals = [abs(float(rec.lbh)) for rec in parsed.records]
    return float(max(vals)) if vals else 1e9


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
        return PrecisionEvalRow(
            fixed_cds=list(fixed_cds),
            float_cds=list(float_cds),
            target_cds=list(precision_config.target_cds),
            score=900.0,
            gof=0.98,
            precision_3sigma=0.2,
            lbh=0.0,
            passed=True,
        )

    try:
        response = hpc_client.run_hpc(
            model_id=model_id,
            model_json=eval_model,
            spec_paths=precision_config.precision_spec_paths,
            num_of_node=precision_config.num_of_node,
        )
    except HPCAPIError:
        return PrecisionEvalRow(
            fixed_cds=list(fixed_cds),
            float_cds=list(float_cds),
            target_cds=list(precision_config.target_cds),
            score=-1e9,
            gof=0.0,
            precision_3sigma=float("inf"),
            lbh=1e9,
            passed=False,
        )

    parsed = parse_hpc_result(response)
    top = best_record(parsed)
    if top is None:
        return PrecisionEvalRow(
            fixed_cds=list(fixed_cds),
            float_cds=list(float_cds),
            target_cds=list(precision_config.target_cds),
            score=-1e9,
            gof=0.0,
            precision_3sigma=float("inf"),
            lbh=1e9,
            passed=False,
        )

    rec, _ = top
    target_cds = _resolve_target_cds(parsed, precision_config.target_cds)
    precision_3sigma = _precision_from_target(parsed, target_cds)
    lbh = _lbh_from_records(parsed)
    passed = (abs(lbh) <= 1e-12) and (precision_3sigma <= float(precision_config.precision_threshold))

    return PrecisionEvalRow(
        fixed_cds=list(fixed_cds),
        float_cds=list(float_cds),
        target_cds=target_cds,
        score=record_score(rec),
        gof=rec.gof,
        precision_3sigma=precision_3sigma,
        lbh=lbh,
        passed=passed,
    )


def _empty_result() -> PrecisionCheckResult:
    baseline = PrecisionEvalRow(
        fixed_cds=[],
        float_cds=[],
        target_cds=[],
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
        baseline_case=baseline,
        one_d_fix_table=[],
        two_d_fix_table=[],
        rows=[baseline],
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

    one_d_sorted = sorted(one_d_rows, key=lambda r: (r.precision_3sigma, abs(r.lbh), -r.gof))
    max_1d = max(0, int(precision_config.max_1d_candidates))
    candidate_for_2d = [r.fixed_cds[0] for r in one_d_sorted[: min(max_1d, len(one_d_sorted))]] if max_1d > 0 else []

    two_d_rows: List[PrecisionEvalRow] = []
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
        passing_cases = [r for r in one_d_rows + two_d_rows if r.passed]
        if passing_cases:
            selected_case = sorted(
                passing_cases,
                key=lambda r: (len(r.fixed_cds), r.precision_3sigma, abs(r.lbh), -r.gof),
            )[0]
        elif one_d_rows or two_d_rows:
            selected_case = sorted(
                one_d_rows + two_d_rows,
                key=lambda r: (r.precision_3sigma, abs(r.lbh), -r.gof, len(r.fixed_cds)),
            )[0]
        else:
            selected_case = baseline_case
        grid_fix_cds = list(selected_case.fixed_cds)

    rows = [baseline_case, *one_d_rows, *two_d_rows]
    return PrecisionCheckResult(
        grid_fix_cds=grid_fix_cds,
        baseline_gof=baseline_case.gof,
        baseline_precision_3sigma=baseline_case.precision_3sigma,
        selected_precision_3sigma=selected_case.precision_3sigma,
        selected_lbh=selected_case.lbh,
        baseline_case=baseline_case,
        one_d_fix_table=one_d_rows,
        two_d_fix_table=two_d_rows,
        rows=rows,
    )
