from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Sequence, Tuple

import numpy as np
import pandas as pd


@dataclass
class SensitivityInterval:
    start: float
    end: float
    step: float
    weight: float


@dataclass
class SensitivityResult:
    wavelengths: List[float]
    total_sensitivity: List[float]
    intervals: List[SensitivityInterval]


def normalize_spectrum_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["wavelength"])

    out = df.copy()
    lower_map = {col: str(col).strip().lower() for col in out.columns}
    wavelength_col = None
    for col, low in lower_map.items():
        if low in {"wavelength", "wavelengths", "wl", "lambda"}:
            wavelength_col = col
            break
    if wavelength_col is None:
        wavelength_col = out.columns[0]

    out = out.rename(columns={wavelength_col: "wavelength"})
    out = out.dropna(subset=["wavelength"]).copy()
    out["wavelength"] = pd.to_numeric(out["wavelength"], errors="coerce")
    out = out.dropna(subset=["wavelength"]).copy()

    for col in out.columns:
        if col == "wavelength":
            continue
        out[col] = pd.to_numeric(out[col], errors="coerce")

    out = out.sort_values("wavelength").reset_index(drop=True)
    return out


def channel_columns(df: pd.DataFrame) -> List[str]:
    return [col for col in df.columns if col != "wavelength"]


def align_spectra(base: pd.DataFrame, other: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    base_n = normalize_spectrum_df(base)
    other_n = normalize_spectrum_df(other)
    merged = base_n.merge(other_n, on="wavelength", suffixes=("_a", "_b"))
    cols_a = [c for c in merged.columns if c.endswith("_a")]
    cols_b = [c for c in merged.columns if c.endswith("_b")]

    names_a = [c[:-2] for c in cols_a]
    names_b = [c[:-2] for c in cols_b]
    common = sorted(set(names_a).intersection(names_b))

    left = pd.DataFrame({"wavelength": merged["wavelength"]})
    right = pd.DataFrame({"wavelength": merged["wavelength"]})
    for name in common:
        left[name] = merged[f"{name}_a"]
        right[name] = merged[f"{name}_b"]
    return left, right


def mean_abs_channel_diff(base: pd.DataFrame, other: pd.DataFrame) -> np.ndarray:
    a, b = align_spectra(base, other)
    channels = channel_columns(a)
    if not channels:
        return np.zeros(len(a), dtype=float)

    diffs = []
    for ch in channels:
        x = a[ch].to_numpy(dtype=float)
        y = b[ch].to_numpy(dtype=float)
        diffs.append(np.abs(x - y))
    return np.mean(np.vstack(diffs), axis=0)


def aggregate_sensitivity(
    wavelength: np.ndarray,
    sensitivity: np.ndarray,
    *,
    interval_nm: float = 10.0,
    min_weight: float = 0.5,
    max_weight: float = 3.0,
) -> List[SensitivityInterval]:
    if wavelength.size == 0 or sensitivity.size == 0:
        return []

    wl_min = float(np.min(wavelength))
    wl_max = float(np.max(wavelength))
    if wl_max < wl_min:
        wl_min, wl_max = wl_max, wl_min

    interval_nm = max(float(interval_nm), 1.0)
    bins = np.arange(wl_min, wl_max + interval_nm, interval_nm)
    if bins.size < 2:
        bins = np.array([wl_min, wl_max + interval_nm], dtype=float)

    bucket_values: List[Tuple[float, float, float]] = []
    for i in range(len(bins) - 1):
        left, right = float(bins[i]), float(bins[i + 1])
        mask = (wavelength >= left) & (wavelength < right)
        if i == len(bins) - 2:
            mask = (wavelength >= left) & (wavelength <= right)
        if not np.any(mask):
            continue
        bucket_values.append((left, right, float(np.mean(sensitivity[mask]))))

    if not bucket_values:
        return []

    raw = np.array([v[2] for v in bucket_values], dtype=float)
    if np.allclose(raw.max(), raw.min()):
        normalized = np.full(raw.shape, 0.5)
    else:
        normalized = (raw - raw.min()) / (raw.max() - raw.min())

    weights = min_weight + normalized * (max_weight - min_weight)
    intervals = [
        SensitivityInterval(start=left, end=right, step=1.0, weight=float(round(weight, 6)))
        for (left, right, _), weight in zip(bucket_values, weights)
    ]
    return intervals


def build_wavelength_grid(se_wavelength: Sequence[Sequence[Any]]) -> np.ndarray:
    """
    Build wavelength grid from proj_params.SEwavelength configuration.
    Expected row format: [start, end, step, weight].
    """
    values: List[float] = []
    if isinstance(se_wavelength, (list, tuple)):
        for row in se_wavelength:
            if not isinstance(row, (list, tuple)) or len(row) < 3:
                continue
            try:
                start = float(row[0])
                end = float(row[1])
                step = float(row[2])
            except (TypeError, ValueError):
                continue
            if step <= 0:
                continue
            if end < start:
                start, end = end, start
            seg = np.arange(start, end + step * 0.5, step, dtype=float)
            values.extend(seg.tolist())
    if not values:
        return np.arange(190.0, 1001.0, 1.0, dtype=float)
    out = np.asarray(sorted(set(round(v, 10) for v in values)), dtype=float)
    return out


def interpolate_spectrum_to_grid(df: pd.DataFrame, grid: np.ndarray) -> pd.DataFrame:
    src = normalize_spectrum_df(df)
    if src.empty or grid.size == 0:
        return pd.DataFrame(columns=["wavelength"])
    out = pd.DataFrame({"wavelength": grid.astype(float)})
    if src.shape[0] < 2:
        for col in channel_columns(src):
            out[col] = float(src[col].iloc[0]) if not src[col].empty else 0.0
        return out

    x = src["wavelength"].to_numpy(dtype=float)
    for col in channel_columns(src):
        y = pd.to_numeric(src[col], errors="coerce").to_numpy(dtype=float)
        valid = np.isfinite(x) & np.isfinite(y)
        if np.sum(valid) < 2:
            out[col] = 0.0
            continue
        xv = x[valid]
        yv = y[valid]
        order = np.argsort(xv)
        xv = xv[order]
        yv = yv[order]
        out[col] = np.interp(grid, xv, yv, left=yv[0], right=yv[-1])
    return out


def plain_mse(base: pd.DataFrame, sim: pd.DataFrame) -> float:
    a, b = align_spectra(base, sim)
    channels = channel_columns(a)
    if not channels:
        return float("inf")
    all_err = []
    for ch in channels:
        x = a[ch].to_numpy(dtype=float)
        y = b[ch].to_numpy(dtype=float)
        valid = np.isfinite(x) & np.isfinite(y)
        if np.any(valid):
            all_err.append((x[valid] - y[valid]) ** 2)
    if not all_err:
        return float("inf")
    stacked = np.concatenate(all_err)
    return float(np.mean(stacked))
