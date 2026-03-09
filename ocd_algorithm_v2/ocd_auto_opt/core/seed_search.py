from __future__ import annotations

import itertools
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd

from ocd_algorithm_api.ocd_auto_opt.api.get_spectrum import SpectrumAPIError, SpectrumClient
from ocd_algorithm_api.ocd_auto_opt.api.run_hpc import HPCAPIError, HPCClient
from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import (
    apply_material_values,
    get_material_rows,
    set_basis_float_flags,
    sync_new_fields_from_nominal_value,
)
from ocd_algorithm_api.ocd_auto_opt.utils.parse_hpc_result import best_record, parse_hpc_result
from ocd_algorithm_api.ocd_auto_opt.utils.spectrum_utils import (
    align_spectra,
    build_wavelength_grid,
    interpolate_spectrum_to_grid,
    normalize_spectrum_df,
    plain_mse,
)

try:
    from ocd_algorithm_api.config import OCD_CASE_ROOT
except Exception:  # pragma: no cover
    from config import OCD_CASE_ROOT


@dataclass
class SeedCandidate:
    seed_id: str
    model_json: Dict[str, Any]
    score: float
    gof: float
    residual: float
    correlation: float
    lbh: float
    mse: float
    material_values: Dict[Tuple[str, str, str], float]
    material_combo: Dict[str, str]
    material_sources: Dict[str, str]
    plot_data: Dict[str, Any]


@dataclass
class SeedSearchResult:
    top_seeds: List[SeedCandidate]
    debug_rows: List[Dict[str, Any]]


@dataclass
class SeedSearchConfig:
    version: str = ""
    material_map: Dict[str, str] = field(default_factory=dict)
    material_float_map: Dict[str, bool] = field(default_factory=dict)
    selected_libraries: List[str] = field(default_factory=list)
    material_seeds: Dict[str, List[str]] = field(default_factory=dict)


@dataclass
class _MaterialSeedOption:
    material_key: str
    label: str
    source: str
    values: Dict[Tuple[str, str, str], float]


def _safe_token(value: str) -> str:
    token = "".join(ch if ch.isalnum() or ch in {"_", "-", "."} else "_" for ch in (value or "").strip())
    return token or "unknown"


def _model_family(material_key: str, rows: List[Dict[str, Any]]) -> str:
    text = str(material_key or "").lower()
    if "cauchy" in text:
        return "cauchy"
    if "ho" in text:
        return "ho"
    for row in rows:
        model_name = str(row.get("model") or "").lower()
        if "cauchy" in model_name:
            return "cauchy"
        if "harmonics" in model_name or "ho" in model_name:
            return "ho"
    return "unknown"


def _model_osc_index(row: Dict[str, Any]) -> int:
    model_name = str(row.get("model") or "")
    digits = "".join(ch for ch in model_name if ch.isdigit())
    if digits:
        try:
            idx = int(digits)
            return max(0, idx - 1)
        except ValueError:
            return 0
    return 0


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _resolve_case_material_seed_paths(*, material_key: str, case_nk_dir: Path) -> List[Path]:
    candidates = [
        case_nk_dir / material_key,
        case_nk_dir / _safe_token(material_key),
    ]
    out: List[Path] = []
    for folder in candidates:
        if not folder.exists() or not folder.is_dir():
            continue
        for p in sorted(folder.glob("*.json")):
            if p.is_file():
                out.append(p.resolve())
        if out:
            break
    return out


def _material_seed_options(
    *,
    material_key: str,
    material_rows: List[Dict[str, Any]],
    seed_config: SeedSearchConfig,
    model_id: str,
) -> List[_MaterialSeedOption]:
    version = str(seed_config.version or "").strip()
    case_root = OCD_CASE_ROOT / f"model_{_safe_token(model_id)}" / f"version_{_safe_token(version)}"
    case_nk_dir = case_root / "nk_library"

    paths = _resolve_case_material_seed_paths(material_key=material_key, case_nk_dir=case_nk_dir)
    family = _model_family(material_key, material_rows)

    options: List[_MaterialSeedOption] = []
    for path in paths:
        payload = _read_json(path)
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        values: Dict[Tuple[str, str, str], float] = {}

        if family == "cauchy":
            for row in material_rows:
                name = str(row.get("name") or "").strip()
                if not name:
                    continue
                if name in params:
                    values[(material_key, str(row.get("model") or ""), name)] = float(params[name])
        else:
            oscillators = params.get("oscillators") if isinstance(params, dict) else []
            oscillators = oscillators if isinstance(oscillators, list) else []
            for row in material_rows:
                name = str(row.get("name") or "").strip()
                model_name = str(row.get("model") or "")
                if not name:
                    continue
                idx = _model_osc_index(row)
                if oscillators:
                    idx = min(idx, len(oscillators) - 1)
                osc = oscillators[idx] if idx >= 0 and idx < len(oscillators) and isinstance(oscillators[idx], dict) else {}
                key_map = {"amp": "amp", "en": "en", "eg": "eg", "phi": "phi", "nu": "nu"}
                src_key = key_map.get(name.lower())
                if src_key and src_key in osc:
                    values[(material_key, model_name, name)] = float(osc[src_key])

        if not values:
            continue
        try:
            source_rel = str(path.relative_to(case_root))
        except Exception:
            source_rel = str(path)
        options.append(
            _MaterialSeedOption(
                material_key=material_key,
                label=path.stem,
                source=source_rel,
                values=values,
            )
        )

    if not options:
        options.append(_MaterialSeedOption(material_key=material_key, label="current", source="current", values={}))
    return options


def _material_combinations(
    *,
    base_model_json: Dict[str, Any],
    seed_config: SeedSearchConfig,
    model_id: str,
    max_candidates: int,
) -> List[Tuple[Dict[Tuple[str, str, str], float], Dict[str, str], Dict[str, str]]]:
    rows = get_material_rows(base_model_json)
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        key = str(row.get("material") or "").strip()
        if key:
            grouped.setdefault(key, []).append(row)

    pools: List[List[_MaterialSeedOption]] = []
    material_order = [k for k in grouped.keys() if bool(seed_config.material_float_map.get(k, True))]
    for material_key in material_order:
        pools.append(
            _material_seed_options(
                material_key=material_key,
                material_rows=grouped[material_key],
                seed_config=seed_config,
                model_id=model_id,
            )
        )

    out: List[Tuple[Dict[Tuple[str, str, str], float], Dict[str, str], Dict[str, str]]] = []
    for combo in itertools.product(*pools) if pools else [()]:
        values: Dict[Tuple[str, str, str], float] = {}
        labels: Dict[str, str] = {}
        sources: Dict[str, str] = {}
        for option in combo:
            if not isinstance(option, _MaterialSeedOption):
                continue
            labels[option.material_key] = option.label
            sources[option.material_key] = option.source
            values.update(option.values)
        out.append((values, labels, sources))
        if len(out) >= max(1, max_candidates):
            break
    if not out:
        out.append(({}, {}, {}))
    return out


def _load_baseline_interpolated(base_model_json: Dict[str, Any], baseline_path: str) -> pd.DataFrame:
    try:
        raw = pd.read_csv(Path(baseline_path))
    except Exception:  # noqa: BLE001
        return pd.DataFrame()
    raw = normalize_spectrum_df(raw)
    proj = base_model_json.get("content", {}).get("proj_params", {})
    se_wavelength = proj.get("SEwavelength") if isinstance(proj, dict) else []
    grid = build_wavelength_grid(se_wavelength if isinstance(se_wavelength, list) else [])
    return interpolate_spectrum_to_grid(raw, grid)


def _score(gof: float, residual: float, correlation: float, lbh: float, mse: float) -> float:
    mse_penalty = 1e3 if mse == float("inf") else mse
    return float(gof * 10000.0 - residual * 100.0 + correlation * 100.0 - lbh * 10.0 - mse_penalty)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")


def search_material_seeds(
    *,
    base_model_json: Dict[str, Any],
    seed_config: SeedSearchConfig,
    model_id: str,
    baseline_spec_paths: List[str],
    hpc_client: Optional[HPCClient],
    spectrum_client: Optional[SpectrumClient],
    must_float_cds: Iterable[str],
    top_k: int = 5,
    max_candidates: int = 24,
    num_of_node: Optional[List[int]] = None,
    persist_dir: Optional[Path] = None,
    persist_meta: Optional[Dict[str, Any]] = None,
) -> SeedSearchResult:
    baseline_path = str((baseline_spec_paths[0] if baseline_spec_paths else "") or "").strip()
    baseline_interp = _load_baseline_interpolated(base_model_json, baseline_path)
    hpc_spec_paths = [baseline_path] if baseline_path else []
    persist_root = Path(persist_dir) if persist_dir is not None else None
    if persist_root is not None:
        meta_payload = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "model_id": model_id,
            "baseline_path": baseline_path,
            "top_k": int(top_k),
            "max_candidates": int(max_candidates),
            "meta": persist_meta or {},
        }
        _write_json(persist_root / "meta.json", meta_payload)

    material_combinations = _material_combinations(
        base_model_json=base_model_json,
        seed_config=seed_config,
        model_id=model_id,
        max_candidates=max_candidates,
    )

    rows: List[SeedCandidate] = []
    debug_rows: List[Dict[str, Any]] = []

    for idx, (values, labels, sources) in enumerate(material_combinations, start=1):
        candidate_model = apply_material_values(base_model_json, values)
        candidate_model = set_basis_float_flags(candidate_model, must_float_cds)

        selected_model = candidate_model
        gof, residual, correlation, lbh = (0.0, 1e9, 0.0, 1e9)
        hpc_warning = ""
        if hpc_client is not None and hpc_spec_paths:
            try:
                response = hpc_client.run_hpc(
                    model_id=model_id,
                    model_json=candidate_model,
                    spec_paths=hpc_spec_paths,
                    num_of_node=num_of_node,
                )
                parsed = parse_hpc_result(response)
                top = best_record(parsed)
                if top is not None:
                    rec, maybe_model = top
                    gof, residual, correlation, lbh = (rec.gof, rec.residual, rec.correlation, rec.lbh)
                    if isinstance(maybe_model, dict):
                        selected_model = maybe_model
            except HPCAPIError as exc:
                hpc_warning = str(exc)

        selected_model = sync_new_fields_from_nominal_value(selected_model)

        simulated_df = pd.DataFrame()
        if spectrum_client is not None:
            try:
                simulated_df = spectrum_client.get_spectrum(model_id=model_id, model_json=selected_model)
            except SpectrumAPIError:
                simulated_df = pd.DataFrame()
        simulated_df = normalize_spectrum_df(simulated_df)

        mse = float("inf")
        plot_data: Dict[str, Any] = {}
        if not baseline_interp.empty and not simulated_df.empty:
            aligned_baseline, aligned_simulated = align_spectra(baseline_interp, simulated_df)
            mse = plain_mse(aligned_baseline, aligned_simulated)
            channels = [c for c in aligned_baseline.columns if c != "wavelength"]
            plot_data = {
                "wavelength": [float(x) for x in aligned_baseline["wavelength"].tolist()],
                "baseline": {c: [float(v) for v in aligned_baseline[c].tolist()] for c in channels},
                "simulated": {c: [float(v) for v in aligned_simulated[c].tolist()] for c in channels if c in aligned_simulated},
            }

        score = _score(gof, residual, correlation, lbh, mse)
        seed = SeedCandidate(
            seed_id=f"seed_{idx:03d}",
            model_json=selected_model,
            score=score,
            gof=float(gof),
            residual=float(residual),
            correlation=float(correlation),
            lbh=float(lbh),
            mse=float(mse),
            material_values=values,
            material_combo=labels,
            material_sources=sources,
            plot_data=plot_data,
        )
        rows.append(seed)
        debug_row: Dict[str, Any] = {
            "seed_id": seed.seed_id,
            "material_combo": labels,
            "material_sources": sources,
            "gof": seed.gof,
            "residual": seed.residual,
            "correlation": seed.correlation,
            "lbh": seed.lbh,
            "mse": seed.mse,
            "score": seed.score,
        }
        if hpc_warning:
            debug_row["warning"] = hpc_warning

        if persist_root is not None:
            seed_payload = {
                "seed_id": seed.seed_id,
                "material_combo": labels,
                "material_sources": sources,
                "metrics": {
                    "gof": seed.gof,
                    "residual": seed.residual,
                    "correlation": seed.correlation,
                    "lbh": seed.lbh,
                    "mse": seed.mse,
                    "score": seed.score,
                },
                "model_json": selected_model,
                "plot_data": plot_data,
                "warning": hpc_warning,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            seed_file = persist_root / f"{seed.seed_id}.json"
            _write_json(seed_file, seed_payload)
            _append_jsonl(
                persist_root / "candidates.jsonl",
                {
                    "seed_id": seed.seed_id,
                    "file": str(seed_file),
                    "gof": seed.gof,
                    "residual": seed.residual,
                    "correlation": seed.correlation,
                    "lbh": seed.lbh,
                    "mse": seed.mse,
                    "score": seed.score,
                },
            )
            debug_row["artifact_path"] = str(seed_file)
        debug_rows.append(debug_row)

    # Top-K selection rule: GOF only (descending).
    rows.sort(key=lambda s: -s.gof)
    top = rows[: max(1, top_k)]
    if persist_root is not None:
        _write_json(
            persist_root / "top_seeds.json",
            {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "top_seeds": [
                    {
                        "seed_id": seed.seed_id,
                        "gof": seed.gof,
                        "residual": seed.residual,
                        "correlation": seed.correlation,
                        "lbh": seed.lbh,
                        "mse": seed.mse,
                        "score": seed.score,
                        "file": str(persist_root / f"{seed.seed_id}.json"),
                    }
                    for seed in top
                ],
            },
        )
    return SeedSearchResult(top_seeds=top, debug_rows=debug_rows)
