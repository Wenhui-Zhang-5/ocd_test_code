from __future__ import annotations

import copy
import itertools
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np


@dataclass
class GridSpec:
    cd_name: str
    values: List[float]


def deep_copy_model(model_json: Dict[str, Any]) -> Dict[str, Any]:
    return copy.deepcopy(model_json)


def model_content(model_json: Dict[str, Any]) -> Dict[str, Any]:
    content = model_json.get("content")
    if isinstance(content, dict):
        return content
    model_json["content"] = {}
    return model_json["content"]


def get_basis_rows(model_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    content = model_content(model_json)
    basis = content.get("basis")
    if not isinstance(basis, list):
        return []
    return [row for row in basis if isinstance(row, dict)]


def get_constraint_rows(model_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    content = model_content(model_json)
    rows = content.get("constraint")
    if not isinstance(rows, list):
        rows = []
        content["constraint"] = rows
    return [row for row in rows if isinstance(row, dict)]


def get_material_rows(model_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    content = model_content(model_json)
    mat = content.get("mat")
    if not isinstance(mat, list):
        return []
    return [row for row in mat if isinstance(row, dict)]


def basis_aliases(model_json: Dict[str, Any]) -> List[str]:
    aliases: List[str] = []
    for row in get_basis_rows(model_json):
        alias = str(row.get("alias") or row.get("name") or "").strip()
        if alias:
            aliases.append(alias)
    return aliases


def set_basis_values(model_json: Dict[str, Any], basis_values: Dict[str, float]) -> Dict[str, Any]:
    out = deep_copy_model(model_json)
    for row in get_basis_rows(out):
        alias = str(row.get("alias") or row.get("name") or "").strip()
        if alias and alias in basis_values:
            row["nominalNew"] = float(basis_values[alias])
            row["nominal"] = float(basis_values[alias])
    return out


def set_basis_float_flags(model_json: Dict[str, Any], float_aliases: Iterable[str]) -> Dict[str, Any]:
    out = deep_copy_model(model_json)
    allow = {str(x).strip() for x in float_aliases if str(x).strip()}
    for row in get_basis_rows(out):
        alias = str(row.get("alias") or row.get("name") or "").strip()
        row["float"] = alias in allow
    return out


def set_material_float_targets(
    model_json: Dict[str, Any],
    targets: Iterable[Tuple[str, str, str]],
) -> Dict[str, Any]:
    out = deep_copy_model(model_json)
    target_set = {(str(m), str(md), str(n)) for (m, md, n) in targets}
    for row in get_material_rows(out):
        key = (
            str(row.get("material") or ""),
            str(row.get("model") or ""),
            str(row.get("name") or ""),
        )
        row["float"] = key in target_set
    return out


def apply_material_values(model_json: Dict[str, Any], values: Dict[Tuple[str, str, str], float]) -> Dict[str, Any]:
    out = deep_copy_model(model_json)
    for row in get_material_rows(out):
        key = (
            str(row.get("material") or ""),
            str(row.get("model") or ""),
            str(row.get("name") or ""),
        )
        if key in values:
            v = float(values[key])
            row["valueNew"] = v
            row["value"] = v
    return out


def sync_new_fields_from_nominal_value(model_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    Sync `*New` fields from base fields.
    Used for vendor compatibility when returned model carries latest values in
    `nominal` / `value` instead of `nominalNew` / `valueNew`.
    """
    out = deep_copy_model(model_json)
    for row in get_basis_rows(out):
        if "nominal" in row:
            row["nominalNew"] = float(row.get("nominal") or 0.0)

    for row in get_constraint_rows(out):
        if "nominal" in row:
            row["nominalNew"] = float(row.get("nominal") or 0.0)

    for row in get_material_rows(out):
        if "value" in row:
            row["valueNew"] = float(row.get("value") or 0.0)
    return out


def apply_grid_fix_values(model_json: Dict[str, Any], grid_values: Dict[str, float]) -> Dict[str, Any]:
    out = deep_copy_model(model_json)
    for row in get_basis_rows(out):
        alias = str(row.get("alias") or row.get("name") or "").strip()
        if alias in grid_values:
            val = float(grid_values[alias])
            row["nominal"] = val
            row["nominalNew"] = val
            row["float"] = False
    return out


def apply_basis_offsets(model_json: Dict[str, Any], basis_offsets: Dict[str, float]) -> Dict[str, Any]:
    out = deep_copy_model(model_json)
    for row in get_basis_rows(out):
        alias = str(row.get("alias") or row.get("name") or "").strip()
        if alias not in basis_offsets:
            continue
        base = float(row.get("nominalNew", row.get("nominal", 0.0)) or 0.0)
        value = base + float(basis_offsets[alias])
        row["nominal"] = value
        row["nominalNew"] = value
    return out


def material_seed_candidates(model_json: Dict[str, Any], per_param_variants: int = 3) -> List[Dict[Tuple[str, str, str], float]]:
    rows = get_material_rows(model_json)
    if not rows:
        return [{}]

    values_by_key: Dict[Tuple[str, str, str], List[float]] = {}
    for row in rows:
        key = (
            str(row.get("material") or ""),
            str(row.get("model") or ""),
            str(row.get("name") or ""),
        )
        base = float(row.get("valueNew", row.get("value", 0.0)) or 0.0)
        if per_param_variants <= 1:
            values_by_key[key] = [base]
            continue
        span = max(abs(base) * 0.05, 0.01)
        values_by_key[key] = [base - span, base, base + span]

    keys = list(values_by_key.keys())
    grids = [values_by_key[k] for k in keys]
    candidates: List[Dict[Tuple[str, str, str], float]] = []
    # Limit to avoid combinational explosion.
    max_candidate = 40
    for combo in itertools.product(*grids):
        candidates.append({k: float(v) for k, v in zip(keys, combo)})
        if len(candidates) >= max_candidate:
            break
    return candidates or [{}]


def _parse_range(value: str) -> List[float]:
    text = str(value or "").strip()
    if not text:
        return []
    if "-" in text:
        try:
            lo_txt, hi_txt = text.split("-", 1)
            lo = float(lo_txt)
            hi = float(hi_txt)
            if lo > hi:
                lo, hi = hi, lo
            return [lo, hi]
        except ValueError:
            return []
    try:
        x = float(text)
        return [x, x]
    except ValueError:
        return []


def _parse_custom_values(value: str) -> List[float]:
    text = str(value or "").strip()
    if not text:
        return []
    out: List[float] = []
    for token in text.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            out.append(float(token))
        except ValueError:
            continue
    return sorted(set(out))


def _grid_values_from_spec(spec: Dict[str, Any], cap: int = 8) -> List[float]:
    custom = _parse_custom_values(str(spec.get("customValues") or ""))
    if custom:
        return custom[:cap]

    bounds = _parse_range(str(spec.get("range") or ""))
    if not bounds:
        return []
    lo, hi = bounds
    try:
        step = float(spec.get("step") or 0.1)
    except ValueError:
        step = 0.1
    if step <= 0:
        step = 0.1

    values = np.arange(lo, hi + step * 0.5, step)
    if len(values) > cap:
        idx = np.linspace(0, len(values) - 1, cap).astype(int)
        values = values[idx]
    return [round(float(v), 6) for v in values]


def build_grid_specs(recipe_schema: Dict[str, Any], grid_fix_cds: List[str]) -> List[GridSpec]:
    cd_strategy = recipe_schema.get("cdStrategy") if isinstance(recipe_schema, dict) else {}
    if not isinstance(cd_strategy, dict):
        return []

    grid_fixed = cd_strategy.get("gridFixed")
    if not isinstance(grid_fixed, dict):
        return []

    specs: List[GridSpec] = []
    for cd_name in grid_fix_cds:
        raw = grid_fixed.get(cd_name)
        if not isinstance(raw, dict):
            continue
        values = _grid_values_from_spec(raw)
        if values:
            specs.append(GridSpec(cd_name=cd_name, values=values))
    return specs


def enumerate_grid_combinations(grid_specs: List[GridSpec], limit: int = 64) -> List[Dict[str, float]]:
    if not grid_specs:
        return [{}]
    combos: List[Dict[str, float]] = []
    pools = [spec.values for spec in grid_specs]
    names = [spec.cd_name for spec in grid_specs]
    for tup in itertools.product(*pools):
        combos.append({name: float(v) for name, v in zip(names, tup)})
        if len(combos) >= limit:
            break
    return combos


def extract_spec_paths(recipe_schema: Dict[str, Any], section: str = "spectrumSelection") -> List[str]:
    spectrum_analysis = recipe_schema.get("spectrumAnalysis") if isinstance(recipe_schema, dict) else {}
    if not isinstance(spectrum_analysis, dict):
        return []

    part = spectrum_analysis.get(section)
    if not isinstance(part, dict):
        return []

    selected = part.get("selectedSpectra")
    object_rows = part.get("objectRows")
    object_by_wafer: Dict[str, Dict[str, Any]] = {}
    if isinstance(object_rows, list):
        for row in object_rows:
            if not isinstance(row, dict):
                continue
            wafer = str(row.get("waferId") or "").strip()
            if wafer:
                object_by_wafer[wafer] = row

    paths: List[str] = []
    if isinstance(selected, list):
        for item in selected:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path") or "").strip()
            if path:
                paths.append(path)
                continue
            wafer = str(item.get("waferId") or "").strip()
            spectrum_id = str(item.get("spectrumId") or "").strip()
            if not wafer or not spectrum_id:
                continue
            folder = ""
            if wafer in object_by_wafer:
                folder = str(object_by_wafer[wafer].get("spectrumFolder") or "").strip()
            if folder:
                filename = spectrum_id if spectrum_id.endswith(".csv") else f"{spectrum_id}.csv"
                paths.append(str(Path(folder) / filename))

    dedup: List[str] = []
    seen = set()
    for p in paths:
        key = str(Path(p))
        if key in seen:
            continue
        seen.add(key)
        dedup.append(key)
    return dedup


def extract_precision_spec_paths(recipe_schema: Dict[str, Any]) -> List[str]:
    precision = recipe_schema.get("precision") if isinstance(recipe_schema, dict) else {}
    if not isinstance(precision, dict):
        return []

    selected = precision.get("selectedSpectra")
    rows = precision.get("objectRows")
    object_by_wafer: Dict[str, Dict[str, Any]] = {}
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            wafer = str(row.get("waferId") or "").strip()
            if wafer:
                object_by_wafer[wafer] = row

    out: List[str] = []
    if isinstance(selected, list):
        for item in selected:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path") or "").strip()
            if path:
                out.append(path)
                continue
            wafer = str(item.get("waferId") or "").strip()
            spectrum_id = str(item.get("spectrumId") or "").strip()
            row = object_by_wafer.get(wafer, {})
            folder = str(row.get("spectrumFolder") or "").strip()
            if folder and spectrum_id:
                filename = spectrum_id if spectrum_id.endswith(".csv") else f"{spectrum_id}.csv"
                out.append(str(Path(folder) / filename))

    dedup: List[str] = []
    seen = set()
    for p in out:
        key = str(Path(p))
        if key in seen:
            continue
        seen.add(key)
        dedup.append(key)
    return dedup


def extract_baseline_spec_path(recipe_schema: Dict[str, Any], fallback_paths: Optional[List[str]] = None) -> str:
    baseline_wafer = str(recipe_schema.get("baselineWafer") or "").strip()
    baseline_spectrum = str(recipe_schema.get("baselineSpectrum") or "").strip()

    spectrum_analysis = recipe_schema.get("spectrumAnalysis") if isinstance(recipe_schema, dict) else {}
    if not isinstance(spectrum_analysis, dict):
        return (fallback_paths or [""])[0] if fallback_paths else ""

    selection = spectrum_analysis.get("spectrumSelection")
    if not isinstance(selection, dict):
        return (fallback_paths or [""])[0] if fallback_paths else ""

    selected = selection.get("selectedSpectra")
    object_rows = selection.get("objectRows")

    object_by_wafer: Dict[str, Dict[str, Any]] = {}
    if isinstance(object_rows, list):
        for row in object_rows:
            if not isinstance(row, dict):
                continue
            wafer = str(row.get("waferId") or "").strip()
            if wafer:
                object_by_wafer[wafer] = row

    if isinstance(selected, list):
        for item in selected:
            if not isinstance(item, dict):
                continue
            wafer = str(item.get("waferId") or "").strip()
            spectrum_id = str(item.get("spectrumId") or "").strip()
            se_filename = str(item.get("seFilename") or "").strip()
            if baseline_wafer and wafer != baseline_wafer:
                continue

            hit = False
            if baseline_spectrum:
                baseline_file = baseline_spectrum if baseline_spectrum.endswith(".csv") else f"{baseline_spectrum}.csv"
                hit = se_filename == baseline_file or spectrum_id == baseline_spectrum.replace(".csv", "")
            else:
                hit = True
            if not hit:
                continue

            path = str(item.get("path") or "").strip()
            if path:
                return str(Path(path))

            folder = str(object_by_wafer.get(wafer, {}).get("spectrumFolder") or "").strip()
            if folder:
                filename = se_filename or (f"{spectrum_id}.csv" if spectrum_id else "")
                if filename:
                    return str(Path(folder) / filename)

    return (fallback_paths or [""])[0] if fallback_paths else ""


def detect_spec_type(recipe_schema: Dict[str, Any]) -> str:
    precision = recipe_schema.get("precision") if isinstance(recipe_schema, dict) else {}
    if isinstance(precision, dict):
        value = str(precision.get("specType") or "").strip().upper()
        if value:
            return value
    pre_recipe = recipe_schema.get("preRecipe") if isinstance(recipe_schema, dict) else {}
    if isinstance(pre_recipe, dict):
        confirm = pre_recipe.get("recipeSetupConfirm")
        if isinstance(confirm, dict):
            value = str(confirm.get("specType") or "").strip().upper()
            if value:
                return value
    return "SE"


def coupling_expressions(recipe_schema: Dict[str, Any]) -> List[str]:
    cd_strategy = recipe_schema.get("cdStrategy") if isinstance(recipe_schema, dict) else {}
    if not isinstance(cd_strategy, dict):
        return []
    schemes = cd_strategy.get("schemes")
    if not isinstance(schemes, list):
        return []
    out: List[str] = []
    for row in schemes:
        if not isinstance(row, dict):
            continue
        expr = str(row.get("expression") or "").strip()
        if expr:
            out.append(expr)
    return out
