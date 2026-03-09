from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from ocd_algorithm_api.ocd_auto_opt.api.get_spectrum import SpectrumClient
from ocd_algorithm_api.ocd_auto_opt.api.run_hpc import HPCClient
from ocd_algorithm_api.ocd_auto_opt.core.coupling import apply_coupling, coupling_candidates
from ocd_algorithm_api.ocd_auto_opt.core.fitting import FittingConfig, run_fitting
from ocd_algorithm_api.ocd_auto_opt.core.precision_check import PrecisionCheckResult, PrecisionConfig, precision_check
from ocd_algorithm_api.ocd_auto_opt.core.regression import (
    KPIThreshold,
    baseline_gof_ok,
    compute_regression_metrics,
    kpi_satisfied,
)
from ocd_algorithm_api.ocd_auto_opt.core.seed_search import SeedSearchConfig, search_material_seeds
from ocd_algorithm_api.ocd_auto_opt.core.sensitivity import sensitivity_analysis
from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import (
    apply_grid_fix_values,
    build_grid_specs,
    coupling_expressions,
    enumerate_grid_combinations,
    get_basis_rows,
)


ProgressCallback = Callable[[str, Dict[str, Any]], None]


@dataclass
class OptimizationSolution:
    solution_id: str
    model_json: Dict[str, Any]
    grid_fix_values: Dict[str, float]
    regression_metrics: Dict[str, float]
    precision_metrics: Dict[str, float]
    spectrum_data: Dict[str, Any]
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OptimizerConfig:
    model_id: str
    recipe_schema: Dict[str, Any]
    base_model_json: Dict[str, Any]
    hpc_client: Optional[HPCClient] = None
    spectrum_client: Optional[SpectrumClient] = None
    top_n: int = 5
    seed_top_k: int = 5
    max_grid_combos: int = 64
    num_of_node: Optional[List[int]] = None
    case_root: Optional[Path] = None


@dataclass
class OptimizerResult:
    valid_solution_list: List[OptimizationSolution]
    debug_info: Dict[str, Any] = field(default_factory=dict)


class OCDOptimizer:
    def __init__(self, config: OptimizerConfig, progress_cb: Optional[ProgressCallback] = None):
        self.cfg = config
        self.progress_cb = progress_cb

    def _emit(self, stage: str, payload: Dict[str, Any]) -> None:
        if self.progress_cb is not None:
            self.progress_cb(stage, payload)

    @staticmethod
    def _safe_token(value: str) -> str:
        token = "".join(ch if ch.isalnum() or ch in {"_", "-", "."} else "_" for ch in (value or "").strip())
        return token or "unknown"

    def _resolve_case_data_root(self, schema: Dict[str, Any]) -> Path:
        if self.cfg.case_root is not None:
            return Path(self.cfg.case_root) / "data"
        try:
            from ocd_algorithm_api.config import OCD_CASE_ROOT
        except Exception:  # pragma: no cover
            from config import OCD_CASE_ROOT

        model_id = str(self.cfg.model_id or schema.get("modelID") or schema.get("modelId") or "").strip()
        version = str(schema.get("version") or "").strip()
        case_root = Path(OCD_CASE_ROOT) / f"model_{self._safe_token(model_id)}" / f"version_{self._safe_token(version)}"
        return case_root / "data"

    @staticmethod
    def _fitting_spec_type(schema: Dict[str, Any]) -> str:
        pre = schema.get("preRecipe") if isinstance(schema, dict) else {}
        confirm = pre.get("recipeSetupConfirm") if isinstance(pre, dict) else {}
        val = str(confirm.get("specType") or "").strip().upper() if isinstance(confirm, dict) else ""
        if val in {"SE", "SR", "COMBINE"}:
            return val
        return "SE"

    @staticmethod
    def _precision_spec_type(schema: Dict[str, Any], default: str) -> str:
        precision = schema.get("precision") if isinstance(schema, dict) else {}
        val = str(precision.get("specType") or "").strip().upper() if isinstance(precision, dict) else ""
        if val in {"SE", "SR", "COMBINE"}:
            return val
        return default

    @staticmethod
    def _filename_for_spec(item: Dict[str, Any], spec_type: str) -> str:
        st = str(spec_type or "SE").strip().upper()
        if st == "SR":
            name = str(item.get("srFilename") or "").strip()
        elif st == "COMBINE":
            name = str(item.get("combineFilename") or "").strip()
        else:
            name = str(item.get("seFilename") or "").strip()
        if name:
            return name
        sid = str(item.get("spectrumId") or "").strip()
        return f"{sid}.csv" if sid else ""

    def _parse_regression_spec_paths(self, schema: Dict[str, Any], data_root: Path, spec_type: str) -> List[str]:
        tem = schema.get("tem") if isinstance(schema, dict) else {}
        rows = tem.get("rows") if isinstance(tem, dict) else []
        out: List[str] = []
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                wafer = str(row.get("wafer") or row.get("waferId") or "").strip()
                filename = str(row.get("spectrum") or row.get("spectrumFilename") or "").strip()
                if not wafer or not filename:
                    continue
                out.append(str(data_root / "fitting_wafer" / wafer / spec_type / filename))
        dedup: List[str] = []
        seen = set()
        for p in out:
            if p in seen:
                continue
            seen.add(p)
            dedup.append(p)
        return dedup

    def _parse_baseline_spec_paths(self, schema: Dict[str, Any], data_root: Path, spec_type: str) -> List[str]:
        wafer = str(schema.get("baselineWafer") or "").strip()
        filename = str(schema.get("baselineSpectrum") or "").strip()
        if wafer and filename:
            return [str(data_root / "fitting_wafer" / wafer / spec_type / filename)]
        return []

    @staticmethod
    def _point_rank(value: str) -> int:
        text = str(value or "").strip().lower().replace("-", "_")
        digits = "".join(ch for ch in text if ch.isdigit())
        try:
            return int(digits) if digits else -1
        except ValueError:
            return -1

    def _parse_precision_spec_paths(self, schema: Dict[str, Any], data_root: Path, spec_type: str) -> List[str]:
        precision = schema.get("precision") if isinstance(schema, dict) else {}
        if not isinstance(precision, dict):
            return []

        selected = precision.get("selectedSpectra")
        selected = selected if isinstance(selected, list) else []
        selected_rows = precision.get("selectedRows")
        selected_rows = selected_rows if isinstance(selected_rows, list) else []
        points = precision.get("points")
        points = points if isinstance(points, list) else []
        worst_point = str(precision.get("worstPointId") or "").strip()

        candidate_points = [p for p in [worst_point, *[str(x) for x in points]] if str(p).strip()]
        point_id = ""
        if candidate_points:
            point_id = max(candidate_points, key=self._point_rank)

        filenames: List[str] = []
        for item in selected:
            if not isinstance(item, dict):
                continue
            raw_path = str(item.get("path") or "").strip().lower()
            if point_id:
                normalized_point = point_id.lower().replace("-", "_")
                if raw_path and normalized_point not in raw_path:
                    continue
            filename = self._filename_for_spec(item, spec_type)
            if filename:
                filenames.append(filename)
        if not filenames:
            for item in selected:
                if not isinstance(item, dict):
                    continue
                filename = self._filename_for_spec(item, spec_type)
                if filename:
                    filenames.append(filename)

        dedup_files: List[str] = []
        seen_files = set()
        for name in filenames:
            if name in seen_files:
                continue
            seen_files.add(name)
            dedup_files.append(name)

        repeat_count = len(selected_rows)
        if repeat_count <= 0:
            repeat_count = max(1, len(precision.get("wafers") or [])) if isinstance(precision.get("wafers"), list) else 1

        out: List[str] = []
        for repeat_idx in range(1, repeat_count + 1):
            repeat_id = f"repeat_{repeat_idx}"
            for name in dedup_files:
                out.append(str(data_root / "precision_wafer" / repeat_id / spec_type / name))
        return out

    @staticmethod
    def _build_seed_search_config(schema: Dict[str, Any]) -> SeedSearchConfig:
        start = schema.get("startingPoint") if isinstance(schema, dict) else {}
        start = start if isinstance(start, dict) else {}

        raw_map = start.get("materialMap")
        material_map = {str(k): str(v) for k, v in raw_map.items()} if isinstance(raw_map, dict) else {}

        raw_float_map = start.get("materialFloatMap")
        material_float_map = (
            {str(k): bool(v) for k, v in raw_float_map.items()} if isinstance(raw_float_map, dict) else {}
        )

        raw_libraries = start.get("selectedLibraries")
        selected_libraries = [str(x).strip() for x in raw_libraries if str(x).strip()] if isinstance(raw_libraries, list) else []

        raw_seeds = start.get("materialSeeds")
        material_seeds: Dict[str, List[str]] = {}
        if isinstance(raw_seeds, dict):
            for key, value in raw_seeds.items():
                if isinstance(value, list):
                    material_seeds[str(key)] = [str(x).strip() for x in value if str(x).strip()]

        return SeedSearchConfig(
            version=str(schema.get("version") or "").strip(),
            material_map=material_map,
            material_float_map=material_float_map,
            selected_libraries=selected_libraries,
            material_seeds=material_seeds,
        )

    def _build_fitting_config(self, schema: Dict[str, Any]) -> FittingConfig:
        fitting = schema.get("fittingStrategy") if isinstance(schema, dict) else {}
        fitting = fitting if isinstance(fitting, dict) else {}
        execution_steps = fitting.get("executionStepsByMaterial")
        execution_steps = execution_steps if isinstance(execution_steps, dict) else {}
        material_order = fitting.get("materialOrder") if isinstance(fitting.get("materialOrder"), list) else []
        material_order = [str(x).strip() for x in material_order if str(x).strip()]

        global_settings = fitting.get("globalSettings") if isinstance(fitting.get("globalSettings"), dict) else {}
        early_stop_gof = 0.99
        raw_stop = global_settings.get("earlyStopGOF") if isinstance(global_settings, dict) else None
        try:
            if raw_stop is not None:
                early_stop_gof = float(raw_stop)
        except (TypeError, ValueError):
            early_stop_gof = 0.99
        fitting_iteration = 1
        raw_iteration = global_settings.get("fittingIteration") if isinstance(global_settings, dict) else None
        try:
            if raw_iteration is not None:
                fitting_iteration = max(1, int(raw_iteration))
        except (TypeError, ValueError):
            fitting_iteration = 1

        must_float, _, _ = self._cd_groups(schema)

        return FittingConfig(
            execution_steps_by_material=execution_steps,
            material_order=material_order,
            fitting_iteration=fitting_iteration,
            must_float_cds=must_float,
            early_stop_gof=early_stop_gof,
            num_of_node=self.cfg.num_of_node,
        )

    def _build_precision_config(self, schema: Dict[str, Any], spec_paths: List[str], threshold: KPIThreshold) -> PrecisionConfig:
        must_float, must_fix, maybe = self._cd_groups(schema)
        target_cds = self._target_cds_from_kpi(schema)
        return PrecisionConfig(
            precision_spec_paths=list(spec_paths),
            target_cds=target_cds,
            must_float_cds=must_float,
            must_fix_cds=must_fix,
            maybe_cds=maybe,
            precision_threshold=float(threshold.precision_max),
            max_1d_candidates=4,
            max_2d_combinations=12,
            num_of_node=self.cfg.num_of_node,
        )

    @staticmethod
    def _target_cds_from_kpi(schema: Dict[str, Any]) -> List[str]:
        rows = schema.get("kpi") if isinstance(schema, dict) else []
        out: List[str] = []
        seen = set()
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                token = str(row.get("cd") or "").strip()
                if not token or token in seen:
                    continue
                seen.add(token)
                out.append(token)
        return out

    @staticmethod
    def _cd_groups(schema: Dict[str, Any]) -> Tuple[List[str], List[str], List[str]]:
        cd_strategy = schema.get("cdStrategy") if isinstance(schema, dict) else {}
        cd_strategy = cd_strategy if isinstance(cd_strategy, dict) else {}

        def _list(name: str) -> List[str]:
            raw = cd_strategy.get(name)
            if not isinstance(raw, list):
                return []
            out: List[str] = []
            seen = set()
            for item in raw:
                token = str(item or "").strip()
                if not token or token in seen:
                    continue
                seen.add(token)
                out.append(token)
            return out

        return _list("mustFloat"), _list("mustFix"), _list("maybe")

    @staticmethod
    def _extract_tem_inputs(schema: Dict[str, Any]) -> Tuple[List[str], List[Dict[str, Any]]]:
        tem = schema.get("tem") if isinstance(schema, dict) else {}
        tem = tem if isinstance(tem, dict) else {}
        raw_cols = tem.get("cdColumns")
        raw_rows = tem.get("rows")

        cd_columns = [str(x).strip() for x in raw_cols if str(x).strip()] if isinstance(raw_cols, list) else []
        rows = [r for r in raw_rows if isinstance(r, dict)] if isinstance(raw_rows, list) else []
        return cd_columns, rows

    def run(self) -> OptimizerResult:
        schema = self.cfg.recipe_schema
        base_model = self.cfg.base_model_json
        fitting_spec_type = self._fitting_spec_type(schema)
        precision_spec_type = self._precision_spec_type(schema, fitting_spec_type)
        data_root = self._resolve_case_data_root(schema)

        regression_spec_paths = self._parse_regression_spec_paths(schema, data_root, fitting_spec_type)
        baseline_spec_paths = self._parse_baseline_spec_paths(schema, data_root, fitting_spec_type)
        precision_spec_paths = self._parse_precision_spec_paths(schema, data_root, precision_spec_type)
        seed_search_config = self._build_seed_search_config(schema)
        kpi_threshold = self._kpi_threshold(schema)
        fitting_config = self._build_fitting_config(schema)
        baseline_fit_paths = baseline_spec_paths or regression_spec_paths
        precision_eval_paths = precision_spec_paths or baseline_fit_paths
        precision_config = self._build_precision_config(schema, precision_eval_paths, kpi_threshold)
        tem_cd_columns, tem_rows = self._extract_tem_inputs(schema)
        must_float, must_fix, maybe = self._cd_groups(schema)

        expressions = coupling_candidates(coupling_expressions(schema))
        solutions: List[OptimizationSolution] = []
        debug: Dict[str, Any] = {
            "data_root": str(data_root),
            "fitting_spec_type": fitting_spec_type,
            "precision_spec_type": precision_spec_type,
            "baseline_spec_paths": baseline_spec_paths,
            "regression_spec_paths": regression_spec_paths,
            "precision_spec_paths": precision_spec_paths,
            "seed_search_config": {
                "version": seed_search_config.version,
                "material_map_keys": sorted(seed_search_config.material_map.keys()),
                "material_float_map_keys": sorted(seed_search_config.material_float_map.keys()),
                "selected_libraries": seed_search_config.selected_libraries,
                "material_seed_keys": sorted(seed_search_config.material_seeds.keys()),
            },
            "fitting_config": {
                "execution_material_count": len(fitting_config.execution_steps_by_material),
                "early_stop_gof": fitting_config.early_stop_gof,
                "num_of_node": fitting_config.num_of_node or [],
            },
            "precision_config": {
                "path_count": len(precision_config.precision_spec_paths),
                "target_cds": precision_config.target_cds,
                "must_float_cds": precision_config.must_float_cds,
                "must_fix_cds": precision_config.must_fix_cds,
                "maybe_cds": precision_config.maybe_cds,
                "precision_threshold": precision_config.precision_threshold,
                "max_1d_candidates": precision_config.max_1d_candidates,
                "max_2d_combinations": precision_config.max_2d_combinations,
                "num_of_node": precision_config.num_of_node or [],
            },
            "cd_groups": {
                "must_float": must_float,
                "must_fix": must_fix,
                "maybe": maybe,
            },
            "kpi_threshold": {
                "r2_min": kpi_threshold.r2_min,
                "slope_min": kpi_threshold.slope_min,
                "slope_max": kpi_threshold.slope_max,
                "side_by_side_max": kpi_threshold.side_by_side_max,
                "precision_max": kpi_threshold.precision_max,
            },
            "tem_input": {
                "cd_column_count": len(tem_cd_columns),
                "row_count": len(tem_rows),
            },
            "baseline_spec_path_count": len(baseline_spec_paths),
            "regression_spec_path_count": len(regression_spec_paths),
            "precision_spec_path_count": len(precision_spec_paths),
            "couplings": expressions,
            "seed_search": [],
            "fitting": [],
            "precision": [],
            "sensitivity": [],
            "regression": [],
        }

        baseline_solution_gof = None

        for coupling_idx, expression in enumerate(expressions, start=1):
            coupled_model = apply_coupling(base_model, expression)
            self._emit("coupling", {"index": coupling_idx, "total": len(expressions), "expression": expression})

            seed_result = search_material_seeds(
                base_model_json=coupled_model,
                seed_config=seed_search_config,
                model_id=self.cfg.model_id,
                baseline_spec_paths=baseline_spec_paths,
                hpc_client=self.cfg.hpc_client,
                spectrum_client=self.cfg.spectrum_client,
                must_float_cds=must_float,
                top_k=self.cfg.seed_top_k,
                num_of_node=self.cfg.num_of_node,
            )
            debug["seed_search"].append(
                {
                    "coupling": expression,
                    "top_seed_scores": [s.score for s in seed_result.top_seeds],
                    "records": seed_result.debug_rows,
                }
            )

            for seed_idx, seed in enumerate(seed_result.top_seeds, start=1):
                self._emit(
                    "seed_fitting",
                    {
                        "coupling_index": coupling_idx,
                        "seed_index": seed_idx,
                        "seed_id": seed.seed_id,
                    },
                )
                fit_result = run_fitting(
                    seed_model_json=seed.model_json,
                    fitting_config=fitting_config,
                    model_id=self.cfg.model_id,
                    spec_paths=baseline_fit_paths,
                    hpc_client=self.cfg.hpc_client,
                )
                debug["fitting"].append(
                    {
                        "coupling": expression,
                        "seed_id": seed.seed_id,
                        "best_gof": fit_result.best_gof,
                        "best_residual": fit_result.best_residual,
                        "best_lbh": fit_result.best_lbh,
                        "best_score": fit_result.best_score,
                        "step_count": len(fit_result.steps),
                    }
                )

                if baseline_solution_gof is None:
                    baseline_solution_gof = fit_result.best_gof

                precision_result = precision_check(
                    fitted_model_json=fit_result.model_json,
                    model_id=self.cfg.model_id,
                    precision_config=precision_config,
                    hpc_client=self.cfg.hpc_client,
                )
                debug["precision"].append(
                    {
                        "coupling": expression,
                        "seed_id": seed.seed_id,
                        "baseline_case": {
                            "gof": precision_result.baseline_case.gof,
                            "precision_3sigma": precision_result.baseline_case.precision_3sigma,
                            "lbh": precision_result.baseline_case.lbh,
                            "passed": precision_result.baseline_case.passed,
                        },
                        "one_d_count": len(precision_result.one_d_fix_table),
                        "two_d_count": len(precision_result.two_d_fix_table),
                        "grid_fix_cds": precision_result.grid_fix_cds,
                        "baseline_precision_3sigma": precision_result.baseline_precision_3sigma,
                        "selected_precision_3sigma": precision_result.selected_precision_3sigma,
                        "selected_lbh": precision_result.selected_lbh,
                    }
                )

                reference_spec_path = (
                    (baseline_spec_paths[0] if baseline_spec_paths else "")
                    or (regression_spec_paths[0] if regression_spec_paths else "")
                )
                sensitivity_result = sensitivity_analysis(
                    fitted_model_json=fit_result.model_json,
                    model_id=self.cfg.model_id,
                    spec_type=fitting_spec_type,
                    target_cds=precision_result.baseline_case.target_cds,
                    spectrum_client=self.cfg.spectrum_client,
                    reference_spec_path=reference_spec_path,
                )
                debug["sensitivity"].append(
                    {
                        "coupling": expression,
                        "seed_id": seed.seed_id,
                        "interval_count": len(sensitivity_result.intervals),
                    }
                )

                grid_specs = build_grid_specs(schema, precision_result.grid_fix_cds)
                grid_combos = enumerate_grid_combinations(grid_specs, limit=self.cfg.max_grid_combos)

                for grid_idx, grid_combo in enumerate(grid_combos, start=1):
                    self._emit(
                        "grid_fit",
                        {
                            "coupling_index": coupling_idx,
                            "seed_index": seed_idx,
                            "grid_index": grid_idx,
                            "grid_total": len(grid_combos),
                        },
                    )

                    grid_model = apply_grid_fix_values(fit_result.model_json, grid_combo)
                    final_fit = run_fitting(
                        seed_model_json=grid_model,
                        fitting_config=fitting_config,
                        model_id=self.cfg.model_id,
                        spec_paths=baseline_fit_paths,
                        hpc_client=self.cfg.hpc_client,
                    )

                    if baseline_solution_gof is not None and not baseline_gof_ok(
                        baseline_solution_gof,
                        final_fit.best_gof,
                        drop_limit_ratio=0.9,
                    ):
                        continue

                    regression_metrics, precision_metric, threshold = self._evaluate_kpi_inputs(
                        fitted_model=final_fit.model_json,
                        precision_result=precision_result,
                        tem_cd_columns=tem_cd_columns,
                        tem_rows=tem_rows,
                        threshold=kpi_threshold,
                    )
                    ok = kpi_satisfied(regression_metrics, precision_metric, threshold)

                    debug["regression"].append(
                        {
                            "coupling": expression,
                            "seed_id": seed.seed_id,
                            "grid": grid_combo,
                            "r2": regression_metrics.r2,
                            "slope": regression_metrics.slope,
                            "sbs": regression_metrics.side_by_side,
                            "precision": precision_metric,
                            "accepted": ok,
                        }
                    )
                    if not ok:
                        continue

                    solution = OptimizationSolution(
                        solution_id=f"sol_{len(solutions) + 1:03d}",
                        model_json=final_fit.model_json,
                        grid_fix_values=grid_combo,
                        regression_metrics={
                            "r2": regression_metrics.r2,
                            "slope": regression_metrics.slope,
                            "side_by_side": regression_metrics.side_by_side,
                        },
                        precision_metrics={
                            "precision_3sigma": precision_metric,
                            "baseline_precision_3sigma": precision_result.baseline_precision_3sigma,
                            "selected_lbh": precision_result.selected_lbh,
                        },
                        spectrum_data={
                            "spec_type": fitting_spec_type,
                            "sensitivity_wavelengths": sensitivity_result.wavelengths,
                            "sensitivity": sensitivity_result.total_sensitivity,
                            "sensitivity_intervals": [
                                [x.start, x.end, x.step, x.weight] for x in sensitivity_result.intervals
                            ],
                        },
                        meta={
                            "coupling_expression": expression,
                            "seed_id": seed.seed_id,
                            "fit_gof": final_fit.best_gof,
                        },
                    )
                    solutions.append(solution)
                    if len(solutions) >= self.cfg.top_n:
                        return OptimizerResult(valid_solution_list=solutions, debug_info=debug)

        return OptimizerResult(valid_solution_list=solutions, debug_info=debug)

    @staticmethod
    def _basis_value_map(model_json: Dict[str, Any]) -> Dict[str, float]:
        out: Dict[str, float] = {}
        for row in get_basis_rows(model_json):
            alias = str(row.get("alias") or row.get("name") or "").strip()
            if not alias:
                continue
            out[alias] = float(row.get("nominalNew", row.get("nominal", 0.0)) or 0.0)
        return out

    def _evaluate_kpi_inputs(
        self,
        *,
        fitted_model: Dict[str, Any],
        precision_result: PrecisionCheckResult,
        tem_cd_columns: List[str],
        tem_rows: List[Dict[str, Any]],
        threshold: KPIThreshold,
    ):
        tm_values: List[float] = []
        ocd_values: List[float] = []

        basis_map = self._basis_value_map(fitted_model)

        for row in tem_rows:
            for idx, cd_alias in enumerate(tem_cd_columns, start=1):
                tm_key = f"cd{idx}"
                try:
                    tm_val = float(row.get(tm_key))
                except (TypeError, ValueError):
                    continue
                ocd_val = float(basis_map.get(cd_alias, tm_val))
                tm_values.append(tm_val)
                ocd_values.append(ocd_val)

        if not tm_values:
            # fallback: identity mapping using basis values
            for alias, value in basis_map.items():
                tm_values.append(float(value))
                ocd_values.append(float(value))

        reg = compute_regression_metrics(tm_values, ocd_values)
        precision_metric = float(precision_result.selected_precision_3sigma)
        return reg, precision_metric, threshold

    @staticmethod
    def _kpi_threshold(schema: Dict[str, Any]) -> KPIThreshold:
        rows = schema.get("kpi") if isinstance(schema, dict) else []
        if not isinstance(rows, list) or not rows:
            return KPIThreshold()

        r2_min = 0.95
        slope_min = 0.9
        slope_max = 1.1
        side_by_side_max = 2.0
        precision_max = 1.0

        def _to_float(value: Any, default: float) -> float:
            try:
                return float(value)
            except (TypeError, ValueError):
                return default

        r2_min = min(_to_float(r.get("r2"), r2_min) for r in rows if isinstance(r, dict))
        slope_min = min(_to_float(r.get("slope_low"), slope_min) for r in rows if isinstance(r, dict))
        slope_max = max(_to_float(r.get("slope_high"), slope_max) for r in rows if isinstance(r, dict))
        side_by_side_max = max(_to_float(r.get("sbs"), side_by_side_max) for r in rows if isinstance(r, dict))
        precision_max = max(_to_float(r.get("precision"), precision_max) for r in rows if isinstance(r, dict))

        return KPIThreshold(
            r2_min=r2_min,
            slope_min=slope_min,
            slope_max=slope_max,
            side_by_side_max=side_by_side_max,
            precision_max=precision_max,
        )


def load_case_inputs(case_root: Path) -> Dict[str, Any]:
    recipe_schema_path = case_root / "recipe_json" / "recipe_schema.json"
    model_json_path = case_root / "recipe_json" / "model_json.json"
    if not recipe_schema_path.exists():
        raise FileNotFoundError(f"recipe schema not found: {recipe_schema_path}")

    recipe_schema = json.loads(recipe_schema_path.read_text(encoding="utf-8"))
    if model_json_path.exists():
        model_json = json.loads(model_json_path.read_text(encoding="utf-8"))
    else:
        model_json = recipe_schema.get("model", {}).get("modelJson", {})

    if "content" not in model_json:
        model_json = recipe_schema.get("model", {}).get("modelJson", model_json)

    model_id = str(recipe_schema.get("modelID") or recipe_schema.get("modelId") or "").strip()
    return {
        "model_id": model_id,
        "recipe_schema": recipe_schema,
        "base_model_json": model_json,
        "recipe_schema_path": str(recipe_schema_path),
        "model_json_path": str(model_json_path),
    }


def save_optimizer_result(result: OptimizerResult, output_path: Path) -> None:
    payload = {
        "valid_solution_list": [
            {
                "solution_id": sol.solution_id,
                "model_json": sol.model_json,
                "gridFix": sol.grid_fix_values,
                "regression": sol.regression_metrics,
                "precision": sol.precision_metrics,
                "spectrum": sol.spectrum_data,
                "meta": sol.meta,
            }
            for sol in result.valid_solution_list
        ],
        "debug_info": result.debug_info,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_case_pipeline(
    *,
    case_root: Path,
    hpc_base_url: Optional[str] = None,
    top_n: int = 5,
    progress_cb: Optional[ProgressCallback] = None,
) -> Path:
    inputs = load_case_inputs(case_root)
    if hpc_base_url:
        hpc_client: Optional[HPCClient] = HPCClient(base_url=hpc_base_url)
        spectrum_client: Optional[SpectrumClient] = SpectrumClient(base_url=hpc_base_url)
    else:
        hpc_client = None
        spectrum_client = None

    optimizer = OCDOptimizer(
        OptimizerConfig(
            model_id=inputs["model_id"],
            recipe_schema=inputs["recipe_schema"],
            base_model_json=inputs["base_model_json"],
            hpc_client=hpc_client,
            spectrum_client=spectrum_client,
            top_n=top_n,
            case_root=case_root,
        ),
        progress_cb=progress_cb,
    )
    result = optimizer.run()

    output_path = case_root / "Results" / "optimization_result.json"
    save_optimizer_result(result, output_path)
    return output_path
