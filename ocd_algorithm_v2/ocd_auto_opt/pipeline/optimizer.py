from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import pandas as pd

from ocd_algorithm_api.ocd_auto_opt.api.get_spectrum import SpectrumClient
from ocd_algorithm_api.ocd_auto_opt.api.run_hpc import HPCAPIError, HPCClient
from ocd_algorithm_api.ocd_auto_opt.core.coupling import apply_coupling, coupling_candidates
from ocd_algorithm_api.ocd_auto_opt.core.final_regression import run_final_regression_stage_for_grid
from ocd_algorithm_api.ocd_auto_opt.core.fitting import FittingConfig, run_fitting
from ocd_algorithm_api.ocd_auto_opt.core.precision_check import PrecisionConfig, precision_check
from ocd_algorithm_api.ocd_auto_opt.core.regression import (
    KPIThreshold,
    RegressionMetrics,
    compute_regression_metrics,
    precision_three_sigma,
)
from ocd_algorithm_api.ocd_auto_opt.core.seed_search import SeedSearchConfig, search_material_seeds
from ocd_algorithm_api.ocd_auto_opt.core.sensitivity import sensitivity_analysis
from ocd_algorithm_api.ocd_auto_opt.utils.parse_hpc_result import parse_hpc_result
from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import (
    apply_grid_fix_values,
    build_grid_specs,
    coupling_expressions,
    enumerate_grid_combinations,
    get_basis_rows,
    get_material_rows,
    sync_new_fields_from_nominal_value,
)
from ocd_algorithm_api.ocd_auto_opt.utils.spectrum_utils import align_spectra, normalize_spectrum_df, plain_mse


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

    @staticmethod
    def _write_json(path: Path, payload: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    @staticmethod
    def _append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")

    @staticmethod
    def _finite_or_none(value: Any) -> Optional[float]:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return None
        return v if math.isfinite(v) else None

    @staticmethod
    def _nk_snapshot(model_json: Dict[str, Any]) -> Dict[str, Any]:
        materials: Dict[str, Dict[str, Dict[str, float]]] = {}
        for row in get_material_rows(model_json):
            material = str(row.get("material") or "").strip() or "unknown_material"
            model = str(row.get("model") or "").strip() or "unknown_model"
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            value = row.get("valueNew", row.get("value"))
            try:
                val = float(value)
            except (TypeError, ValueError):
                continue
            materials.setdefault(material, {}).setdefault(model, {})[name] = val
        return {"materials": materials}

    @staticmethod
    def _curve_payload(df: pd.DataFrame) -> Dict[str, Any]:
        if df is None or df.empty:
            return {"wavelength": [], "channels": {}}
        channels = [c for c in df.columns if c != "wavelength"]
        return {
            "wavelength": [float(x) for x in df["wavelength"].tolist()],
            "channels": {c: [float(v) for v in df[c].tolist()] for c in channels},
        }

    def _spectrum_fit_payload(
        self,
        *,
        model_json: Dict[str, Any],
        model_id: str,
        measured_path: str,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "measured_path": measured_path,
            "mse": None,
            "measured": {"wavelength": [], "channels": {}},
            "simulated": {"wavelength": [], "channels": {}},
            "aligned_measured": {"wavelength": [], "channels": {}},
            "aligned_simulated": {"wavelength": [], "channels": {}},
            "warning": "",
        }
        if not measured_path:
            payload["warning"] = "measured_path_empty"
            return payload

        try:
            measured_df = pd.read_csv(Path(measured_path))
        except Exception as exc:  # noqa: BLE001
            payload["warning"] = f"failed_to_read_measured:{exc}"
            return payload

        measured_df = normalize_spectrum_df(measured_df)
        payload["measured"] = self._curve_payload(measured_df)
        if measured_df.empty:
            payload["warning"] = "measured_empty_after_normalization"
            return payload

        simulated_df = pd.DataFrame()
        if self.cfg.spectrum_client is not None:
            try:
                simulated_df = self.cfg.spectrum_client.get_spectrum(
                    model_id=model_id,
                    model_json=model_json,
                )
            except Exception as exc:  # noqa: BLE001
                payload["warning"] = f"get_spectrum_failed:{exc}"
                simulated_df = pd.DataFrame()
        simulated_df = normalize_spectrum_df(simulated_df)
        payload["simulated"] = self._curve_payload(simulated_df)
        if simulated_df.empty:
            if not payload["warning"]:
                payload["warning"] = "simulated_empty"
            return payload

        aligned_measured, aligned_simulated = align_spectra(measured_df, simulated_df)
        payload["aligned_measured"] = self._curve_payload(aligned_measured)
        payload["aligned_simulated"] = self._curve_payload(aligned_simulated)
        payload["mse"] = self._finite_or_none(plain_mse(measured_df, simulated_df))
        return payload

    @staticmethod
    def _precision_row_payload(row: Any) -> Dict[str, Any]:
        return {
            "fixed_cds": list(getattr(row, "fixed_cds", []) or []),
            "float_cds": list(getattr(row, "float_cds", []) or []),
            "target_cds": list(getattr(row, "target_cds", []) or []),
            "target_precision_3sigma": dict(getattr(row, "target_precision_3sigma", {}) or {}),
            "score": float(getattr(row, "score", 0.0) or 0.0),
            "gof": float(getattr(row, "gof", 0.0) or 0.0),
            "precision_3sigma": OCDOptimizer._finite_or_none(getattr(row, "precision_3sigma", None)),
            "lbh": float(getattr(row, "lbh", 0.0) or 0.0),
            "passed": bool(getattr(row, "passed", False)),
        }

    def _resolve_case_data_root(self, schema: Dict[str, Any]) -> Path:
        return self._resolve_case_root(schema) / "data"

    def _resolve_case_root(self, schema: Dict[str, Any]) -> Path:
        if self.cfg.case_root is not None:
            return Path(self.cfg.case_root)
        try:
            from ocd_algorithm_api.config import OCD_CASE_ROOT
        except Exception:  # pragma: no cover
            from config import OCD_CASE_ROOT

        model_id = str(self.cfg.model_id or schema.get("modelID") or schema.get("modelId") or "").strip()
        version = str(schema.get("version") or "").strip()
        case_root = Path(OCD_CASE_ROOT) / f"model_{self._safe_token(model_id)}" / f"version_{self._safe_token(version)}"
        return case_root

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
        target_thresholds = self._target_precision_thresholds_from_kpi(schema)
        return PrecisionConfig(
            precision_spec_paths=list(spec_paths),
            target_cds=target_cds,
            target_precision_thresholds=target_thresholds,
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
    def _target_precision_thresholds_from_kpi(schema: Dict[str, Any]) -> Dict[str, float]:
        rows = schema.get("kpi") if isinstance(schema, dict) else []
        out: Dict[str, float] = {}
        if not isinstance(rows, list):
            return out
        for row in rows:
            if not isinstance(row, dict):
                continue
            cd = str(row.get("cd") or "").strip()
            if not cd:
                continue
            try:
                out[cd] = float(row.get("precision"))
            except (TypeError, ValueError):
                continue
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

    @staticmethod
    def _kpi_rows_by_cd(schema: Dict[str, Any]) -> Dict[str, Dict[str, float]]:
        rows = schema.get("kpi") if isinstance(schema, dict) else []
        out: Dict[str, Dict[str, float]] = {}
        if not isinstance(rows, list):
            return out
        for row in rows:
            if not isinstance(row, dict):
                continue
            cd = str(row.get("cd") or "").strip()
            if not cd:
                continue

            def _f(key: str) -> Optional[float]:
                try:
                    return float(row.get(key))
                except (TypeError, ValueError):
                    return None

            out[cd] = {
                "r2_min": _f("r2"),
                "slope_min": _f("slope_low"),
                "slope_max": _f("slope_high"),
                "side_by_side_max": _f("sbs"),
                "precision_max": _f("precision"),
            }
        return out

    def _evaluate_tm_regression(
        self,
        *,
        fitted_model: Dict[str, Any],
        model_id: str,
        regression_spec_paths: List[str],
        tem_cd_columns: List[str],
        tem_rows: List[Dict[str, Any]],
        target_cds: List[str],
        kpi_by_cd: Dict[str, Dict[str, float]],
        threshold: KPIThreshold,
    ) -> Tuple[RegressionMetrics, Dict[str, Dict[str, Any]], bool, str]:
        parsed_records = []
        warning = ""
        if self.cfg.hpc_client is not None and regression_spec_paths:
            try:
                response = self.cfg.hpc_client.run_hpc(
                    model_id=model_id,
                    model_json=fitted_model,
                    spec_paths=regression_spec_paths,
                    num_of_node=self.cfg.num_of_node,
                )
                parsed_records = parse_hpc_result(response).records
            except HPCAPIError as exc:
                warning = str(exc)

        basis_map = self._basis_value_map(fitted_model)
        per_cd: Dict[str, Dict[str, Any]] = {}
        merged_tm: List[float] = []
        merged_ocd: List[float] = []

        for cd in target_cds:
            cd_idx = tem_cd_columns.index(cd) + 1 if cd in tem_cd_columns else None
            tm_values: List[float] = []
            ocd_values: List[float] = []

            row_count = min(len(parsed_records), len(tem_rows)) if parsed_records else len(tem_rows)
            for row_i in range(row_count):
                row = tem_rows[row_i]
                tm_raw = row.get(f"cd{cd_idx}") if cd_idx is not None else row.get(cd)
                try:
                    tm_val = float(tm_raw)
                except (TypeError, ValueError):
                    continue

                if parsed_records:
                    raw_ocd = parsed_records[row_i].basis_values.get(cd)
                    try:
                        ocd_val = float(raw_ocd)
                    except (TypeError, ValueError):
                        continue
                else:
                    if cd not in basis_map:
                        continue
                    ocd_val = float(basis_map[cd])

                tm_values.append(tm_val)
                ocd_values.append(ocd_val)

            if not tm_values and cd in basis_map:
                x = float(basis_map[cd])
                tm_values = [x]
                ocd_values = [x]

            metrics = compute_regression_metrics(tm_values, ocd_values)
            cd_thresholds = kpi_by_cd.get(cd, {})
            r2_min = float(cd_thresholds.get("r2_min") or threshold.r2_min)
            slope_min = float(cd_thresholds.get("slope_min") or threshold.slope_min)
            slope_max = float(cd_thresholds.get("slope_max") or threshold.slope_max)
            sbs_max = float(cd_thresholds.get("side_by_side_max") or threshold.side_by_side_max)
            cd_passed = (
                metrics.r2 >= r2_min
                and metrics.slope >= slope_min
                and metrics.slope <= slope_max
                and metrics.side_by_side <= sbs_max
            )

            per_cd[cd] = {
                "r2": metrics.r2,
                "slope": metrics.slope,
                "side_by_side": metrics.side_by_side,
                "count": len(tm_values),
                "tm_values": tm_values,
                "ocd_values": ocd_values,
                "thresholds": {
                    "r2_min": r2_min,
                    "slope_min": slope_min,
                    "slope_max": slope_max,
                    "side_by_side_max": sbs_max,
                },
                "passed": cd_passed,
            }

            merged_tm.extend(tm_values)
            merged_ocd.extend(ocd_values)

        aggregate = compute_regression_metrics(merged_tm, merged_ocd)
        passed = bool(per_cd) and all(bool(v.get("passed")) for v in per_cd.values())
        return aggregate, per_cd, passed, warning

    def _evaluate_precision_targets(
        self,
        *,
        fitted_model: Dict[str, Any],
        model_id: str,
        precision_spec_paths: List[str],
        target_cds: List[str],
        target_precision_thresholds: Dict[str, float],
        default_precision_threshold: float,
    ) -> Dict[str, Any]:
        per_cd_precision: Dict[str, float] = {}
        warning = ""

        if self.cfg.hpc_client is None or not precision_spec_paths:
            for cd in target_cds:
                per_cd_precision[cd] = 0.2
            per_cd_passed = {
                cd: per_cd_precision.get(cd, float("inf")) <= float(target_precision_thresholds.get(cd, default_precision_threshold))
                for cd in target_cds
            }
            return {
                "target_precision_3sigma": per_cd_precision,
                "target_passed": per_cd_passed,
                "lbh": 0.0,
                "passed": bool(target_cds) and all(per_cd_passed.values()),
                "warning": warning,
            }

        try:
            response = self.cfg.hpc_client.run_hpc(
                model_id=model_id,
                model_json=fitted_model,
                spec_paths=precision_spec_paths,
                num_of_node=self.cfg.num_of_node,
            )
            records = parse_hpc_result(response).records
        except HPCAPIError as exc:
            warning = str(exc)
            records = []

        lbh = 1e9
        if records:
            lbh = float(max(abs(float(rec.lbh)) for rec in records))

        for cd in target_cds:
            values: List[float] = []
            for rec in records:
                raw = rec.basis_values.get(cd)
                try:
                    values.append(float(raw))
                except (TypeError, ValueError):
                    continue
            if len(values) <= 1:
                per_cd_precision[cd] = float("inf")
            else:
                per_cd_precision[cd] = float(precision_three_sigma(values))

        per_cd_passed = {}
        for cd in target_cds:
            limit = float(target_precision_thresholds.get(cd, default_precision_threshold))
            per_cd_passed[cd] = float(per_cd_precision.get(cd, float("inf"))) <= limit

        passed = bool(target_cds) and abs(lbh) <= 1e-12 and all(per_cd_passed.values())
        return {
            "target_precision_3sigma": per_cd_precision,
            "target_passed": per_cd_passed,
            "lbh": lbh,
            "passed": passed,
            "warning": warning,
        }

    def _baseline_fit_once(
        self,
        *,
        model_json: Dict[str, Any],
        model_id: str,
        baseline_fit_paths: List[str],
    ) -> Tuple[Dict[str, Any], float, float, float, str]:
        if self.cfg.hpc_client is None or not baseline_fit_paths:
            return sync_new_fields_from_nominal_value(model_json), 0.98, 0.01, 0.0, "offline baseline"

        try:
            response = self.cfg.hpc_client.run_hpc(
                model_id=model_id,
                model_json=model_json,
                spec_paths=baseline_fit_paths,
                num_of_node=self.cfg.num_of_node,
            )
        except HPCAPIError as exc:
            return sync_new_fields_from_nominal_value(model_json), 0.0, 1e9, 1e9, str(exc)

        parsed = parse_hpc_result(response)
        if not parsed.records:
            return sync_new_fields_from_nominal_value(model_json), 0.0, 1e9, 1e9, "empty hpc result"

        best = max(parsed.records, key=lambda r: r.gof)
        selected_model = model_json
        if parsed.mats and 0 <= best.index < len(parsed.mats) and isinstance(parsed.mats[best.index], dict):
            selected_model = parsed.mats[best.index]
        selected_model = sync_new_fields_from_nominal_value(selected_model)
        return selected_model, float(best.gof), float(best.residual), float(best.lbh), "ok"

    def run(self) -> OptimizerResult:
        schema = self.cfg.recipe_schema
        base_model = self.cfg.base_model_json
        case_root = self._resolve_case_root(schema)
        results_root = case_root / "Results"
        seed_search_root = results_root / "seed_search"
        fitting_root = results_root / "fitting"
        precision_root = results_root / "precision"
        final_regression_root = results_root / "final_regression"
        sensitivity_root = results_root / "sensitivity"
        fitting_spec_type = self._fitting_spec_type(schema)
        precision_spec_type = self._precision_spec_type(schema, fitting_spec_type)
        data_root = case_root / "data"

        regression_spec_paths = self._parse_regression_spec_paths(schema, data_root, fitting_spec_type)
        baseline_spec_paths = self._parse_baseline_spec_paths(schema, data_root, fitting_spec_type)
        precision_spec_paths = self._parse_precision_spec_paths(schema, data_root, precision_spec_type)
        if not baseline_spec_paths:
            raise ValueError("baseline spectrum path is required but unresolved from baselineWafer/baselineSpectrum")
        if not precision_spec_paths:
            raise ValueError("precision spectrum paths are required but unresolved from precision.selectedSpectra")
        seed_search_config = self._build_seed_search_config(schema)
        kpi_threshold = self._kpi_threshold(schema)
        fitting_config = self._build_fitting_config(schema)
        baseline_fit_paths = list(baseline_spec_paths)
        precision_eval_paths = list(precision_spec_paths)
        precision_config = self._build_precision_config(schema, precision_eval_paths, kpi_threshold)
        kpi_by_cd = self._kpi_rows_by_cd(schema)
        tem_cd_columns, tem_rows = self._extract_tem_inputs(schema)
        must_float, must_fix, maybe = self._cd_groups(schema)

        expressions = coupling_candidates(coupling_expressions(schema))
        solutions: List[OptimizationSolution] = []
        debug: Dict[str, Any] = {
            "data_root": str(data_root),
            "results_root": str(results_root),
            "seed_search_root": str(seed_search_root),
            "fitting_root": str(fitting_root),
            "precision_root": str(precision_root),
            "final_regression_root": str(final_regression_root),
            "sensitivity_root": str(sensitivity_root),
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
                "target_precision_thresholds": precision_config.target_precision_thresholds,
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
            "kpi_by_cd": kpi_by_cd,
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
                persist_dir=seed_search_root / f"coupling_{coupling_idx:02d}",
                persist_meta={
                    "coupling_index": coupling_idx,
                    "coupling_expression": expression,
                },
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
                fitting_seed_dir = fitting_root / f"coupling_{coupling_idx:02d}"
                fitting_event_file = fitting_seed_dir / f"{seed.seed_id}.events.jsonl"
                fitting_latest_file = fitting_seed_dir / f"{seed.seed_id}.latest.json"
                fitting_summary_file = fitting_seed_dir / f"{seed.seed_id}.summary.json"

                def _on_fitting_step(evt: Dict[str, Any]) -> None:
                    evt_payload = dict(evt)
                    model_snapshot = evt_payload.get("model_json")
                    if isinstance(model_snapshot, dict):
                        evt_payload["nk_snapshot"] = self._nk_snapshot(model_snapshot)
                        evt_payload["spectrum_fit"] = self._spectrum_fit_payload(
                            model_json=model_snapshot,
                            model_id=self.cfg.model_id,
                            measured_path=baseline_spec_paths[0],
                        )
                    payload = {
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "coupling_index": coupling_idx,
                        "coupling_expression": expression,
                        "seed_index": seed_idx,
                        "seed_id": seed.seed_id,
                        "event": evt_payload,
                    }
                    self._append_jsonl(fitting_event_file, payload)
                    self._write_json(fitting_latest_file, payload)

                fit_result = run_fitting(
                    seed_model_json=seed.model_json,
                    fitting_config=fitting_config,
                    model_id=self.cfg.model_id,
                    spec_paths=baseline_fit_paths,
                    hpc_client=self.cfg.hpc_client,
                    step_cb=_on_fitting_step,
                )
                fitting_spectrum = self._spectrum_fit_payload(
                    model_json=fit_result.model_json,
                    model_id=self.cfg.model_id,
                    measured_path=baseline_spec_paths[0],
                )
                self._write_json(
                    fitting_summary_file,
                    {
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "coupling_index": coupling_idx,
                        "coupling_expression": expression,
                        "seed_index": seed_idx,
                        "seed_id": seed.seed_id,
                        "best_gof": fit_result.best_gof,
                        "best_residual": fit_result.best_residual,
                        "best_lbh": fit_result.best_lbh,
                        "best_score": fit_result.best_score,
                        "step_count": len(fit_result.steps),
                        "stopped_early": bool(fit_result.best_gof >= float(fitting_config.early_stop_gof)),
                        "model_json": fit_result.model_json,
                        "nk_snapshot": self._nk_snapshot(fit_result.model_json),
                        "spectrum_fit": fitting_spectrum,
                        "steps": [
                            {
                                "step_name": s.step_name,
                                "accepted": s.accepted,
                                "score_before": s.score_before,
                                "score_after": s.score_after,
                                "gof": s.gof,
                                "residual": s.residual,
                                "message": s.message,
                            }
                            for s in fit_result.steps
                        ],
                    },
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
                        "events_path": str(fitting_event_file),
                        "latest_path": str(fitting_latest_file),
                        "summary_path": str(fitting_summary_file),
                    }
                )
                seed_baseline_gof = fit_result.best_gof

                precision_result = precision_check(
                    fitted_model_json=fit_result.model_json,
                    model_id=self.cfg.model_id,
                    precision_config=precision_config,
                    hpc_client=self.cfg.hpc_client,
                )
                precision_seed_dir = precision_root / f"coupling_{coupling_idx:02d}"
                precision_summary_file = precision_seed_dir / f"{seed.seed_id}.summary.json"
                self._write_json(
                    precision_summary_file,
                    {
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "coupling_index": coupling_idx,
                        "coupling_expression": expression,
                        "seed_index": seed_idx,
                        "seed_id": seed.seed_id,
                        "baseline_case": self._precision_row_payload(precision_result.baseline_case),
                        "selected_case": self._precision_row_payload(precision_result.selected_case),
                        "one_d_fix_table": [self._precision_row_payload(r) for r in precision_result.one_d_fix_table],
                        "two_d_fix_table": [self._precision_row_payload(r) for r in precision_result.two_d_fix_table],
                        "rows": [self._precision_row_payload(r) for r in precision_result.rows],
                        "grid_fix_cds": list(precision_result.grid_fix_cds),
                        "baseline_gof": float(precision_result.baseline_gof),
                        "baseline_precision_3sigma": float(precision_result.baseline_precision_3sigma),
                        "selected_precision_3sigma": float(precision_result.selected_precision_3sigma),
                        "selected_lbh": float(precision_result.selected_lbh),
                        "selected_case_passed": bool(precision_result.selected_case_passed),
                        "summary": precision_result.summary,
                        "fitting_spectrum": self._spectrum_fit_payload(
                            model_json=fit_result.model_json,
                            model_id=self.cfg.model_id,
                            measured_path=baseline_spec_paths[0],
                        ),
                        "nk_snapshot": self._nk_snapshot(fit_result.model_json),
                    },
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
                        "selected_case_passed": precision_result.selected_case_passed,
                        "summary": precision_result.summary,
                        "summary_path": str(precision_summary_file),
                    }
                )

                reference_spec_path = baseline_spec_paths[0]
                sensitivity_result = sensitivity_analysis(
                    fitted_model_json=fit_result.model_json,
                    model_id=self.cfg.model_id,
                    spec_type=fitting_spec_type,
                    target_cds=precision_result.baseline_case.target_cds,
                    spectrum_client=self.cfg.spectrum_client,
                    reference_spec_path=reference_spec_path,
                    persist_path=sensitivity_root / f"coupling_{coupling_idx:02d}" / f"{seed.seed_id}.json",
                    persist_meta={
                        "coupling_index": coupling_idx,
                        "coupling_expression": expression,
                        "seed_id": seed.seed_id,
                    },
                )
                debug["sensitivity"].append(
                    {
                        "coupling": expression,
                        "seed_id": seed.seed_id,
                        "interval_count": len(sensitivity_result.intervals),
                        "per_cd_count": len(sensitivity_result.per_cd_curves),
                        "artifact_path": str(sensitivity_root / f"coupling_{coupling_idx:02d}" / f"{seed.seed_id}.json"),
                        "events_path": str((sensitivity_root / f"coupling_{coupling_idx:02d}" / f"{seed.seed_id}.json").with_suffix(".events.jsonl")),
                        "latest_path": str((sensitivity_root / f"coupling_{coupling_idx:02d}" / f"{seed.seed_id}.json").with_suffix(".latest.json")),
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
                    target_cds = list(precision_result.baseline_case.target_cds or precision_config.target_cds)
                    final_reg_seed_dir = final_regression_root / f"coupling_{coupling_idx:02d}" / seed.seed_id
                    final_reg_event_file = final_reg_seed_dir / f"grid_{grid_idx:03d}.events.jsonl"
                    final_reg_latest_file = final_reg_seed_dir / f"grid_{grid_idx:03d}.latest.json"
                    final_reg_summary_file = final_reg_seed_dir / f"grid_{grid_idx:03d}.summary.json"

                    def _kpi_evaluator(
                        model_for_kpi: Dict[str, Any],
                        iter_idx: int,
                        material_name: str,
                        step_name: str,
                        baseline_gof: float,
                    ) -> Dict[str, Any]:
                        reg, reg_per_cd, reg_passed, reg_warning = self._evaluate_tm_regression(
                            fitted_model=model_for_kpi,
                            model_id=self.cfg.model_id,
                            regression_spec_paths=regression_spec_paths,
                            tem_cd_columns=tem_cd_columns,
                            tem_rows=tem_rows,
                            target_cds=target_cds,
                            kpi_by_cd=kpi_by_cd,
                            threshold=kpi_threshold,
                        )
                        precision_eval = self._evaluate_precision_targets(
                            fitted_model=model_for_kpi,
                            model_id=self.cfg.model_id,
                            precision_spec_paths=precision_eval_paths,
                            target_cds=target_cds,
                            target_precision_thresholds=precision_config.target_precision_thresholds,
                            default_precision_threshold=precision_config.precision_threshold,
                        )
                        precision_metric_raw = (
                            float(max(precision_eval["target_precision_3sigma"].values()))
                            if precision_eval["target_precision_3sigma"]
                            else float("inf")
                        )
                        precision_metric = self._finite_or_none(precision_metric_raw)
                        passed = bool(reg_passed and precision_eval["passed"])
                        return {
                            "passed": passed,
                            "iteration": iter_idx,
                            "material": material_name,
                            "step": step_name,
                            "baseline_gof": baseline_gof,
                            "regression_metrics": {
                                "r2": reg.r2,
                                "slope": reg.slope,
                                "side_by_side": reg.side_by_side,
                            },
                            "regression_per_cd": reg_per_cd,
                            "regression_passed": reg_passed,
                            "regression_warning": reg_warning,
                            "precision_eval": precision_eval,
                            "precision_metric": precision_metric,
                        }

                    def _on_final_reg_event(evt: Dict[str, Any]) -> None:
                        evt_payload = dict(evt)
                        model_snapshot = evt_payload.get("model_json")
                        if isinstance(model_snapshot, dict):
                            evt_payload["nk_snapshot"] = self._nk_snapshot(model_snapshot)
                            evt_payload["spectrum_fit"] = self._spectrum_fit_payload(
                                model_json=model_snapshot,
                                model_id=self.cfg.model_id,
                                measured_path=baseline_spec_paths[0],
                            )
                        payload = {
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                            "coupling_index": coupling_idx,
                            "coupling_expression": expression,
                            "seed_index": seed_idx,
                            "seed_id": seed.seed_id,
                            "grid_index": grid_idx,
                            "grid": grid_combo,
                            "event": evt_payload,
                        }
                        self._append_jsonl(final_reg_event_file, payload)
                        self._write_json(final_reg_latest_file, payload)

                    final_stage = run_final_regression_stage_for_grid(
                        start_model_json=grid_model,
                        fitting_config=fitting_config,
                        baseline_fit_once=lambda candidate: self._baseline_fit_once(
                            model_json=candidate,
                            model_id=self.cfg.model_id,
                            baseline_fit_paths=baseline_fit_paths,
                        ),
                        kpi_evaluator=_kpi_evaluator,
                        baseline_drop_limit_ratio=0.9,
                        event_cb=_on_final_reg_event,
                    )
                    self._write_json(
                        final_reg_summary_file,
                        {
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                            "coupling_index": coupling_idx,
                            "coupling_expression": expression,
                            "seed_index": seed_idx,
                            "seed_id": seed.seed_id,
                            "grid_index": grid_idx,
                            "grid": grid_combo,
                            "final_stage": final_stage,
                        },
                    )

                    debug_row: Dict[str, Any] = {
                        "coupling": expression,
                        "seed_id": seed.seed_id,
                        "grid": grid_combo,
                        "grid_index": grid_idx,
                        "baseline_gof_seed": seed_baseline_gof,
                        "final_baseline_gof": final_stage.get("final_baseline_gof"),
                        "final_baseline_residual": final_stage.get("final_baseline_residual"),
                        "final_baseline_lbh": final_stage.get("final_baseline_lbh"),
                        "history": final_stage.get("history", []),
                        "events_path": str(final_reg_event_file),
                        "latest_path": str(final_reg_latest_file),
                        "summary_path": str(final_reg_summary_file),
                    }
                    if not final_stage.get("accepted"):
                        debug_row["accepted"] = False
                        debug_row["reject_reason"] = final_stage.get("reject_reason", "final_stage_rejected")
                        debug["regression"].append(debug_row)
                        continue

                    result_payload = final_stage.get("result", {})
                    regression_metrics = result_payload.get("regression_metrics", {})
                    regression_per_cd = result_payload.get("regression_per_cd", {})
                    precision_eval = result_payload.get("precision_eval", {})
                    precision_metric = self._finite_or_none(result_payload.get("precision_metric"))
                    final_model_json = result_payload.get("model_json", grid_model)

                    debug_row.update(
                        {
                            "r2": float(regression_metrics.get("r2", 0.0)),
                            "slope": float(regression_metrics.get("slope", 0.0)),
                            "sbs": float(regression_metrics.get("side_by_side", 1e9)),
                            "precision": precision_metric,
                            "precision_lbh": float(precision_eval.get("lbh", 1e9)),
                            "precision_target_3sigma": dict(precision_eval.get("target_precision_3sigma", {})),
                            "precision_target_passed": dict(precision_eval.get("target_passed", {})),
                            "regression_per_cd": regression_per_cd,
                            "regression_passed": True,
                            "precision_passed": True,
                            "accepted": True,
                        }
                    )
                    if result_payload.get("regression_warning"):
                        debug_row["regression_warning"] = result_payload.get("regression_warning")
                    if isinstance(precision_eval, dict) and precision_eval.get("warning"):
                        debug_row["precision_warning"] = precision_eval.get("warning")
                    debug["regression"].append(debug_row)

                    solution = OptimizationSolution(
                        solution_id=f"sol_{len(solutions) + 1:03d}",
                        model_json=final_model_json,
                        grid_fix_values=grid_combo,
                        regression_metrics={
                            "r2": float(regression_metrics.get("r2", 0.0)),
                            "slope": float(regression_metrics.get("slope", 0.0)),
                            "side_by_side": float(regression_metrics.get("side_by_side", 1e9)),
                        },
                        precision_metrics={
                            "precision_3sigma": precision_metric,
                            "baseline_precision_3sigma": precision_result.baseline_precision_3sigma,
                            "selected_lbh": float(precision_eval.get("lbh", 1e9)),
                            "selected_case_passed": bool(precision_eval.get("passed", False)),
                            "target_precision_3sigma": dict(precision_eval.get("target_precision_3sigma", {})),
                            "target_precision_passed": dict(precision_eval.get("target_passed", {})),
                        },
                        spectrum_data={
                            "spec_type": fitting_spec_type,
                            "sensitivity_wavelengths": sensitivity_result.wavelengths,
                            "sensitivity": sensitivity_result.total_sensitivity,
                            "sensitivity_intervals": [
                                [x.start, x.end, x.step, x.weight] for x in sensitivity_result.intervals
                            ],
                            "baseline_spectrum": sensitivity_result.baseline_spectrum,
                            "per_cd_curves": sensitivity_result.per_cd_curves,
                            "regression_per_cd": regression_per_cd,
                        },
                        meta={
                            "coupling_expression": expression,
                            "seed_id": seed.seed_id,
                            "fit_gof": float(final_stage.get("final_baseline_gof", 0.0)),
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
