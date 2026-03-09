from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import numpy as np
import pandas as pd

from ocd_algorithm_api.ocd_auto_opt.api.get_spectrum import SpectrumAPIError, SpectrumClient
from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import apply_basis_offsets
from ocd_algorithm_api.ocd_auto_opt.utils.spectrum_utils import (
    SensitivityInterval,
    aggregate_sensitivity,
    normalize_spectrum_df,
)


@dataclass
class SensitivityOutput:
    wavelengths: List[float]
    total_sensitivity: List[float]
    intervals: List[SensitivityInterval]
    baseline_spectrum: Dict[str, Any] = field(default_factory=dict)
    per_cd_curves: Dict[str, Dict[str, Any]] = field(default_factory=dict)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _channels(df: pd.DataFrame) -> List[str]:
    return [c for c in df.columns if c != "wavelength"]


def _curve_payload(df: pd.DataFrame) -> Dict[str, Any]:
    if df is None or df.empty:
        return {"wavelength": [], "channels": {}}
    chs = _channels(df)
    return {
        "wavelength": [float(x) for x in df["wavelength"].tolist()],
        "channels": {c: [float(v) for v in df[c].tolist()] for c in chs},
    }


def _align_three_spectra(base: pd.DataFrame, minus: pd.DataFrame, plus: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    b = normalize_spectrum_df(base)
    m = normalize_spectrum_df(minus)
    p = normalize_spectrum_df(plus)
    if b.empty or m.empty or p.empty:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()

    wb = b[["wavelength"]]
    wm = m[["wavelength"]]
    wp = p[["wavelength"]]
    common_wl = wb.merge(wm, on="wavelength", how="inner").merge(wp, on="wavelength", how="inner")
    if common_wl.empty:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()

    ch_b = _channels(b)
    ch_m = set(_channels(m))
    ch_p = set(_channels(p))
    common_ch = [c for c in ch_b if c in ch_m and c in ch_p]
    if not common_ch:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()

    b_aligned = common_wl.merge(b[["wavelength", *common_ch]], on="wavelength", how="left")
    m_aligned = common_wl.merge(m[["wavelength", *common_ch]], on="wavelength", how="left")
    p_aligned = common_wl.merge(p[["wavelength", *common_ch]], on="wavelength", how="left")
    return b_aligned.reset_index(drop=True), m_aligned.reset_index(drop=True), p_aligned.reset_index(drop=True)


def _mean_abs_diff_curve(left: pd.DataFrame, right: pd.DataFrame) -> np.ndarray:
    if left.empty or right.empty:
        return np.asarray([], dtype=float)
    chs = [c for c in _channels(left) if c in right.columns]
    if not chs:
        return np.asarray([], dtype=float)
    diffs = []
    for c in chs:
        x = left[c].to_numpy(dtype=float)
        y = right[c].to_numpy(dtype=float)
        n = min(len(x), len(y))
        if n <= 0:
            continue
        diffs.append(np.abs(x[:n] - y[:n]))
    if not diffs:
        return np.asarray([], dtype=float)
    return np.mean(np.vstack(diffs), axis=0)


def _synthetic_baseline_from_model(model_json: Dict[str, Any], spec_type: str) -> pd.DataFrame:
    wl = np.arange(190.0, 1001.0, 1.0, dtype=float)
    st = str(spec_type or "SE").strip().upper()
    if st == "SE":
        channels = ["N", "C", "S"]
    elif st == "SR":
        channels = ["TE", "TM"]
    else:
        channels = [f"ch{i}" for i in range(1, 6)]

    basis_rows = model_json.get("content", {}).get("basis", [])
    mat_rows = model_json.get("content", {}).get("mat", [])
    basis_sum = 0.0
    mat_sum = 0.0
    if isinstance(basis_rows, list):
        basis_sum = float(
            sum(float(r.get("nominalNew", r.get("nominal", 0.0)) or 0.0) for r in basis_rows if isinstance(r, dict))
        )
    if isinstance(mat_rows, list):
        mat_sum = float(sum(float(r.get("valueNew", r.get("value", 0.0)) or 0.0) for r in mat_rows if isinstance(r, dict)))

    phase = 0.01 * basis_sum + 0.1 * mat_sum
    df = pd.DataFrame({"wavelength": wl})
    for idx, name in enumerate(channels, start=1):
        base = 0.5 + 0.05 * idx
        curve = base + 0.03 * np.sin(wl / (40.0 + 5.0 * idx) + phase) + 0.01 * np.cos(wl / (65.0 + idx))
        df[name] = curve
    return df


def _synthetic_shift(df: pd.DataFrame, seed_text: str, scale_nm: float) -> pd.DataFrame:
    out = normalize_spectrum_df(df)
    channels = [c for c in out.columns if c != "wavelength"]
    if not channels:
        return out

    digest = hashlib.sha256(seed_text.encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)
    factor = (seed % 2000) / 2000.0
    for col in channels:
        arr = out[col].to_numpy(dtype=float)
        out[col] = arr + (factor - 0.5) * 0.01 * scale_nm
    return out


def _simulate_spectrum(
    *,
    spectrum_client: Optional[SpectrumClient],
    model_id: str,
    model_json: Dict[str, Any],
    fallback_df: pd.DataFrame,
    tag: str,
) -> pd.DataFrame:
    if spectrum_client is not None:
        try:
            return spectrum_client.get_spectrum(
                model_id=model_id,
                model_json=model_json,
            )
        except SpectrumAPIError:
            pass
    if fallback_df is not None and not fallback_df.empty:
        return _synthetic_shift(fallback_df, seed_text=tag, scale_nm=1.0)
    return pd.DataFrame()


def sensitivity_analysis(
    *,
    fitted_model_json: Dict[str, Any],
    model_id: str,
    spec_type: str,
    target_cds: Iterable[str],
    spectrum_client: Optional[SpectrumClient],
    reference_spec_path: str,
    delta_nm: float = 10.0,
    interval_nm: float = 10.0,
    min_weight: float = 0.5,
    max_weight: float = 3.0,
    persist_path: Optional[Path] = None,
    persist_meta: Optional[Dict[str, Any]] = None,
) -> SensitivityOutput:
    # Keep parameter for interface compatibility; simulated spectrum no longer needs raw spec files.
    _ = reference_spec_path
    baseline_df = pd.DataFrame()
    if spectrum_client is not None:
        try:
            baseline_df = spectrum_client.get_spectrum(
                model_id=model_id,
                model_json=fitted_model_json,
            )
        except SpectrumAPIError:
            baseline_df = pd.DataFrame()

    if baseline_df.empty:
        baseline_df = _synthetic_baseline_from_model(fitted_model_json, spec_type)
    baseline_df = normalize_spectrum_df(baseline_df)

    if baseline_df.empty:
        out_empty = SensitivityOutput(
            wavelengths=[],
            total_sensitivity=[],
            intervals=[],
            baseline_spectrum={"wavelength": [], "channels": {}},
            per_cd_curves={},
        )
        if persist_path is not None:
            _write_json(
                Path(persist_path),
                {
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "model_id": model_id,
                    "spec_type": spec_type,
                    "target_cds": [str(cd).strip() for cd in target_cds if str(cd).strip()],
                    "reference_spec_path": reference_spec_path,
                    "meta": persist_meta or {},
                    "wavelengths": [],
                    "total_sensitivity": [],
                    "intervals": [],
                    "baseline_spectrum": out_empty.baseline_spectrum,
                    "per_cd_curves": out_empty.per_cd_curves,
                },
            )
            empty_payload = {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "kind": "completed",
                "model_id": model_id,
                "spec_type": spec_type,
                "target_cds": [str(cd).strip() for cd in target_cds if str(cd).strip()],
                "meta": persist_meta or {},
                "wavelength_count": 0,
                "interval_count": 0,
                "warning": "baseline_empty",
            }
            _append_jsonl(Path(persist_path).with_suffix(".events.jsonl"), empty_payload)
            _write_json(Path(persist_path).with_suffix(".latest.json"), empty_payload)
        return out_empty

    baseline_payload = _curve_payload(baseline_df)
    total = np.asarray([], dtype=float)
    wavelength_ref = np.asarray([], dtype=float)
    per_cd_curves: Dict[str, Dict[str, Any]] = {}
    cds = [str(cd).strip() for cd in target_cds if str(cd).strip()]
    if not cds:
        cds = ["CD_DEFAULT"]
    events_path = Path(persist_path).with_suffix(".events.jsonl") if persist_path is not None else None
    latest_path = Path(persist_path).with_suffix(".latest.json") if persist_path is not None else None

    for cd_name in cds:
        minus_model = apply_basis_offsets(fitted_model_json, {cd_name: -abs(delta_nm)})
        plus_model = apply_basis_offsets(fitted_model_json, {cd_name: abs(delta_nm)})

        minus_df = _simulate_spectrum(
            spectrum_client=spectrum_client,
            model_id=model_id,
            model_json=minus_model,
            fallback_df=baseline_df,
            tag=f"{cd_name}:minus",
        )
        plus_df = _simulate_spectrum(
            spectrum_client=spectrum_client,
            model_id=model_id,
            model_json=plus_model,
            fallback_df=baseline_df,
            tag=f"{cd_name}:plus",
        )

        base_aligned, minus_aligned, plus_aligned = _align_three_spectra(baseline_df, minus_df, plus_df)
        if base_aligned.empty:
            continue

        minus_curve = _mean_abs_diff_curve(base_aligned, minus_aligned)
        plus_curve = _mean_abs_diff_curve(base_aligned, plus_aligned)
        cd_sensitivity = 0.5 * (minus_curve + plus_curve)
        per_cd_curves[cd_name] = {
            "baseline": _curve_payload(base_aligned),
            "minus": _curve_payload(minus_aligned),
            "plus": _curve_payload(plus_aligned),
            "diff_minus": [float(v) for v in minus_curve.tolist()],
            "diff_plus": [float(v) for v in plus_curve.tolist()],
            "cd_sensitivity": [float(v) for v in cd_sensitivity.tolist()],
        }
        if events_path is not None and latest_path is not None:
            event_payload = {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "kind": "cd_done",
                "model_id": model_id,
                "spec_type": spec_type,
                "cd_name": cd_name,
                "meta": persist_meta or {},
                "baseline_spectrum": baseline_payload,
                "per_cd_curves": {cd_name: per_cd_curves[cd_name]},
            }
            _append_jsonl(events_path, event_payload)
            _write_json(latest_path, event_payload)

        # Ensure same length by clipping to the shortest after alignment.
        if total.size == 0:
            total = cd_sensitivity.copy()
            wavelength_ref = base_aligned["wavelength"].to_numpy(dtype=float)
        else:
            min_len = min(len(total), len(cd_sensitivity), len(wavelength_ref))
            total = total[:min_len]
            total += cd_sensitivity[:min_len]
            wavelength_ref = wavelength_ref[:min_len]

    if total.size == 0:
        total = np.zeros(len(baseline_df), dtype=float)
        wavelength_ref = baseline_df["wavelength"].to_numpy(dtype=float)

    intervals = aggregate_sensitivity(
        wavelength_ref,
        total,
        interval_nm=interval_nm,
        min_weight=min_weight,
        max_weight=max_weight,
    )
    output = SensitivityOutput(
        wavelengths=[float(v) for v in wavelength_ref.tolist()],
        total_sensitivity=[float(v) for v in total.tolist()],
        intervals=intervals,
        baseline_spectrum=baseline_payload,
        per_cd_curves=per_cd_curves,
    )
    if persist_path is not None:
        _write_json(
            Path(persist_path),
            {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "model_id": model_id,
                "spec_type": spec_type,
                "target_cds": cds,
                "reference_spec_path": reference_spec_path,
                "meta": persist_meta or {},
                "wavelengths": output.wavelengths,
                "total_sensitivity": output.total_sensitivity,
                "intervals": [
                    {"start": x.start, "end": x.end, "step": x.step, "weight": x.weight}
                    for x in output.intervals
                ],
                "baseline_spectrum": output.baseline_spectrum,
                "per_cd_curves": output.per_cd_curves,
            },
        )
        completed_payload = {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "kind": "completed",
            "model_id": model_id,
            "spec_type": spec_type,
            "target_cds": cds,
            "meta": persist_meta or {},
            "wavelength_count": len(output.wavelengths),
            "interval_count": len(output.intervals),
        }
        _append_jsonl(Path(persist_path).with_suffix(".events.jsonl"), completed_payload)
        _write_json(Path(persist_path).with_suffix(".latest.json"), completed_payload)
    return output
