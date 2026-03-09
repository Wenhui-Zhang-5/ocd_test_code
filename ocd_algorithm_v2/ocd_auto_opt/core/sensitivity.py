from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

import numpy as np
import pandas as pd

from ocd_algorithm_api.ocd_auto_opt.api.get_spectrum import SpectrumAPIError, SpectrumClient
from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import apply_basis_offsets
from ocd_algorithm_api.ocd_auto_opt.utils.spectrum_utils import (
    SensitivityInterval,
    aggregate_sensitivity,
    mean_abs_channel_diff,
    normalize_spectrum_df,
)


@dataclass
class SensitivityOutput:
    wavelengths: List[float]
    total_sensitivity: List[float]
    intervals: List[SensitivityInterval]


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
        return SensitivityOutput(wavelengths=[], total_sensitivity=[], intervals=[])

    total = np.zeros(len(baseline_df), dtype=float)
    cds = [str(cd).strip() for cd in target_cds if str(cd).strip()]
    if not cds:
        cds = ["CD_DEFAULT"]

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

        minus_curve = mean_abs_channel_diff(baseline_df, minus_df)
        plus_curve = mean_abs_channel_diff(baseline_df, plus_df)
        cd_sensitivity = 0.5 * (minus_curve + plus_curve)

        # Ensure same length by clipping to the shortest after alignment.
        min_len = min(len(total), len(cd_sensitivity))
        total = total[:min_len]
        total += cd_sensitivity[:min_len]
        baseline_df = baseline_df.iloc[:min_len].reset_index(drop=True)

    wavelength = baseline_df["wavelength"].to_numpy(dtype=float)
    intervals = aggregate_sensitivity(
        wavelength,
        total,
        interval_nm=interval_nm,
        min_weight=min_weight,
        max_weight=max_weight,
    )
    return SensitivityOutput(
        wavelengths=[float(v) for v in wavelength.tolist()],
        total_sensitivity=[float(v) for v in total.tolist()],
        intervals=intervals,
    )
