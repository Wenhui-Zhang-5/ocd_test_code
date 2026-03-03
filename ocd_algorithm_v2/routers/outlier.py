from typing import List, Optional

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


class SpectrumItem(BaseModel):
    wafer_id: str
    spectrum_id: str
    n: Optional[List[float]] = Field(default=None)
    c: Optional[List[float]] = Field(default=None)
    s: Optional[List[float]] = Field(default=None)


class OutlierDetectRequest(BaseModel):
    method: str = Field(default="zscore", description="zscore | isolation_forest | lof")
    threshold: float = Field(default=3.0, description="Threshold (z-score) or contamination (0-0.5)")
    spectra: List[SpectrumItem]


class OutlierItem(BaseModel):
    wafer_id: str
    spectrum_id: str
    score: float


class OutlierDetectResponse(BaseModel):
    outliers: List[OutlierItem]
    threshold: float
    total: int


def _to_array(values: Optional[List[float]]) -> Optional[np.ndarray]:
    if not values:
        return None
    return np.asarray(values, dtype=float)


def _median_curve(arrays: List[np.ndarray]) -> Optional[np.ndarray]:
    if not arrays:
        return None
    min_len = min(a.shape[0] for a in arrays)
    if min_len == 0:
        return None
    stacked = np.vstack([a[:min_len] for a in arrays])
    return np.median(stacked, axis=0)


def _rmse(arr: np.ndarray, ref: np.ndarray) -> float:
    min_len = min(arr.shape[0], ref.shape[0])
    if min_len == 0:
        return float("nan")
    diff = arr[:min_len] - ref[:min_len]
    return float(np.sqrt(np.mean(diff * diff)))


def _robust_z_scores(values: np.ndarray) -> np.ndarray:
    median = np.median(values)
    mad = np.median(np.abs(values - median))
    if mad < 1e-12:
        std = np.std(values)
        scale = std if std > 1e-12 else 1.0
    else:
        scale = mad * 1.4826  # make it comparable to std for normal dist
    return (values - median) / scale


def _build_feature_matrix(
    items: List[SpectrumItem],
    median_n: Optional[np.ndarray],
    median_c: Optional[np.ndarray],
    median_s: Optional[np.ndarray],
) -> np.ndarray:
    rows = []
    for item in items:
        values = []
        if median_n is not None and item.n:
            values.append(_rmse(_to_array(item.n), median_n))
        else:
            values.append(np.nan)
        if median_c is not None and item.c:
            values.append(_rmse(_to_array(item.c), median_c))
        else:
            values.append(np.nan)
        if median_s is not None and item.s:
            values.append(_rmse(_to_array(item.s), median_s))
        else:
            values.append(np.nan)
        rows.append(values)
    matrix = np.array(rows, dtype=float)
    if matrix.size == 0:
        return matrix
    col_medians = np.nanmedian(matrix, axis=0)
    nan_rows, nan_cols = np.where(np.isnan(matrix))
    if nan_rows.size:
        matrix[nan_rows, nan_cols] = col_medians[nan_cols]
    return matrix


def _coerce_contamination(value: float) -> float:
    if 0 < value < 0.5:
        return float(value)
    return 0.1


@router.post("/outlier-detect", response_model=OutlierDetectResponse)
def detect_outliers(payload: OutlierDetectRequest) -> OutlierDetectResponse:
    spectra = payload.spectra
    threshold = float(payload.threshold)
    method = (payload.method or "zscore").lower()
    if not spectra:
        return OutlierDetectResponse(outliers=[], threshold=threshold, total=0)

    # Group spectra by wafer_id
    groups = {}
    for item in spectra:
        groups.setdefault(item.wafer_id, []).append(item)

    outliers: List[OutlierItem] = []

    for wafer_id, items in groups.items():
        n_arrays = [_to_array(i.n) for i in items if _to_array(i.n) is not None]
        c_arrays = [_to_array(i.c) for i in items if _to_array(i.c) is not None]
        s_arrays = [_to_array(i.s) for i in items if _to_array(i.s) is not None]

        median_n = _median_curve(n_arrays)
        median_c = _median_curve(c_arrays)
        median_s = _median_curve(s_arrays)

        feature_matrix = _build_feature_matrix(items, median_n, median_c, median_s)
        if feature_matrix.size == 0:
            continue

        if method == "isolation_forest":
            try:
                from sklearn.ensemble import IsolationForest
            except Exception:
                continue
            contamination = _coerce_contamination(threshold)
            model = IsolationForest(random_state=42, contamination=contamination)
            preds = model.fit_predict(feature_matrix)
            scores = -model.decision_function(feature_matrix)
            for item, pred, score in zip(items, preds, scores):
                if pred == -1:
                    outliers.append(
                        OutlierItem(
                            wafer_id=wafer_id,
                            spectrum_id=item.spectrum_id,
                            score=float(score),
                        )
                    )
        elif method == "lof":
            if len(items) < 3:
                continue
            try:
                from sklearn.neighbors import LocalOutlierFactor
            except Exception:
                continue
            contamination = _coerce_contamination(threshold)
            n_neighbors = min(10, len(items) - 1)
            n_neighbors = max(2, n_neighbors)
            model = LocalOutlierFactor(
                n_neighbors=n_neighbors,
                contamination=contamination,
            )
            preds = model.fit_predict(feature_matrix)
            scores = -model.negative_outlier_factor_
            for item, pred, score in zip(items, preds, scores):
                if pred == -1:
                    outliers.append(
                        OutlierItem(
                            wafer_id=wafer_id,
                            spectrum_id=item.spectrum_id,
                            score=float(score),
                        )
                    )
        else:
            rmse_arr = np.nanmean(feature_matrix, axis=1)
            valid_mask = np.isfinite(rmse_arr)
            if not np.any(valid_mask):
                continue
            z = np.zeros_like(rmse_arr)
            z[valid_mask] = _robust_z_scores(rmse_arr[valid_mask])
            for item, score in zip(items, z):
                if np.isfinite(score) and score >= threshold:
                    outliers.append(
                        OutlierItem(
                            wafer_id=wafer_id,
                            spectrum_id=item.spectrum_id,
                            score=float(score),
                        )
                    )

    return OutlierDetectResponse(outliers=outliers, threshold=threshold, total=len(spectra))
