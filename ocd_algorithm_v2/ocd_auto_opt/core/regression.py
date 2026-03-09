from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List

import numpy as np


@dataclass
class RegressionMetrics:
    r2: float
    slope: float
    side_by_side: float


@dataclass
class KPIThreshold:
    r2_min: float = 0.95
    slope_min: float = 0.9
    slope_max: float = 1.1
    side_by_side_max: float = 2.0
    precision_max: float = 1.0


def compute_regression_metrics(tm_cd: Iterable[float], ocd_cd: Iterable[float]) -> RegressionMetrics:
    x = np.asarray(list(tm_cd), dtype=float)
    y = np.asarray(list(ocd_cd), dtype=float)
    if x.size == 0 or y.size == 0 or x.size != y.size:
        return RegressionMetrics(r2=0.0, slope=0.0, side_by_side=1e9)

    mask = np.isfinite(x) & np.isfinite(y)
    x = x[mask]
    y = y[mask]
    if x.size == 0:
        return RegressionMetrics(r2=0.0, slope=0.0, side_by_side=1e9)

    x_mean = float(np.mean(x))
    y_mean = float(np.mean(y))
    var_x = float(np.sum((x - x_mean) ** 2))
    if var_x <= 0.0:
        slope = 0.0
        intercept = y_mean
    else:
        cov_xy = float(np.sum((x - x_mean) * (y - y_mean)))
        slope = cov_xy / var_x
        intercept = y_mean - slope * x_mean

    pred = slope * x + intercept
    ss_res = float(np.sum((y - pred) ** 2))
    ss_tot = float(np.sum((y - y_mean) ** 2))
    r2 = 1.0 if ss_tot <= 0.0 and ss_res <= 0.0 else (0.0 if ss_tot <= 0.0 else 1.0 - ss_res / ss_tot)
    side_by_side = float(np.mean(np.abs(y - x)))
    return RegressionMetrics(r2=r2, slope=slope, side_by_side=side_by_side)


def precision_three_sigma(values: Iterable[float]) -> float:
    arr = np.asarray(list(values), dtype=float)
    if arr.size <= 1:
        return 0.0
    return float(np.std(arr, ddof=0) * 3.0)


def kpi_satisfied(metrics: RegressionMetrics, precision: float, threshold: KPIThreshold) -> bool:
    if metrics.r2 < threshold.r2_min:
        return False
    if metrics.slope < threshold.slope_min or metrics.slope > threshold.slope_max:
        return False
    if metrics.side_by_side > threshold.side_by_side_max:
        return False
    if precision > threshold.precision_max:
        return False
    return True


def baseline_gof_ok(prev_gof: float, new_gof: float, drop_limit_ratio: float = 0.9) -> bool:
    if prev_gof <= 0:
        return True
    return new_gof >= prev_gof * drop_limit_ratio
