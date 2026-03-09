import copy
import csv
import hashlib
import io
import math
import os
from typing import Any, Dict, List

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

try:
    from ocd_algorithm_api.ocd_auto_opt.utils.spectrum_utils import build_wavelength_grid
except Exception:  # pragma: no cover
    from ocd_auto_opt.utils.spectrum_utils import build_wavelength_grid


router = APIRouter(tags=["mock-hpc"])

ENABLE_HPC_MOCK = str(os.getenv("OCD_ENABLE_HPC_MOCK", "1")).strip().lower() in {"1", "true", "yes", "on"}


class MockGetResultRequest(BaseModel):
    model_json: Dict[str, Any] = Field(default_factory=dict)
    server: str = "HPC"
    specPath: List[str] = Field(default_factory=list)
    num_of_node: List[int] = Field(default_factory=list)


class MockGetSpectrumRequest(BaseModel):
    model_json: Dict[str, Any] = Field(default_factory=dict)
    server: str = "HPC"


def _stable_unit(text: str) -> float:
    digest = hashlib.sha256(str(text).encode("utf-8")).hexdigest()
    value = int(digest[:12], 16)
    return (value % 1000000) / 1000000.0


def _basis_rows(model_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    content = model_json.get("content") if isinstance(model_json, dict) else {}
    basis = content.get("basis") if isinstance(content, dict) else []
    return [row for row in basis if isinstance(row, dict)]


def _material_rows(model_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    content = model_json.get("content") if isinstance(model_json, dict) else {}
    mat = content.get("mat") if isinstance(content, dict) else []
    return [row for row in mat if isinstance(row, dict)]


@router.post("/get_result/{model_id}")
def mock_get_result(model_id: str, payload: MockGetResultRequest):
    if not ENABLE_HPC_MOCK:
        return {"error": "mock disabled", "data": []}

    model_json = payload.model_json if isinstance(payload.model_json, dict) else {}
    spec_paths = [str(path) for path in (payload.specPath or []) if str(path).strip()]
    if not spec_paths:
        spec_paths = [f"{model_id}::baseline.csv"]

    basis_rows = _basis_rows(model_json)
    basis_aliases: List[str] = []
    for row in basis_rows:
        alias = str(row.get("alias") or row.get("name") or "").strip()
        if alias:
            basis_aliases.append(alias)
    headers = list(basis_aliases) + ["GOF", "Residual", "correlation", "LBH"]

    mats: List[Dict[str, Any]] = []
    records: List[List[float]] = []

    for index, spec_path in enumerate(spec_paths):
        seed = _stable_unit(f"{model_id}::{spec_path}::{index}")
        record: List[float] = []
        mat_model = copy.deepcopy(model_json)
        mat_basis_rows = _basis_rows(mat_model)
        mat_material_rows = _material_rows(mat_model)

        for b_idx, alias in enumerate(basis_aliases):
            src_row = next(
                (
                    row
                    for row in basis_rows
                    if str(row.get("alias") or row.get("name") or "").strip() == alias
                ),
                {},
            )
            base_nominal = float(src_row.get("nominal", src_row.get("nominalNew", 0.0)) or 0.0)
            span = max(abs(base_nominal) * 0.01, 0.05)
            phase = (index + 1) * 0.57 + (b_idx + 1) * 0.31 + seed * math.pi
            value = base_nominal + span * math.sin(phase)
            record.append(float(round(value, 6)))
            for row in mat_basis_rows:
                row_alias = str(row.get("alias") or row.get("name") or "").strip()
                if row_alias == alias:
                    row["nominal"] = float(round(value, 6))
                    row["nominalNew"] = float(round(value, 6))
                    break

        for m_idx, row in enumerate(mat_material_rows):
            base_val = float(row.get("value", row.get("valueNew", 0.0)) or 0.0)
            span = max(abs(base_val) * 0.02, 0.002)
            phase = (index + 1) * 0.43 + (m_idx + 1) * 0.19 + seed * math.pi
            next_val = base_val + span * math.cos(phase)
            row["value"] = float(round(next_val, 8))
            row["valueNew"] = float(round(next_val, 8))

        gof = 0.975 + 0.02 * (0.5 + 0.5 * math.sin((index + 1) * 0.71 + seed * math.pi))
        residual = 0.004 + 0.02 * abs(math.cos((index + 1) * 0.83 + seed * math.pi))
        correlation = 0.92 + 0.07 * (0.5 + 0.5 * math.sin((index + 1) * 0.47 + seed * math.pi))
        lbh = 0.0 if gof >= 0.985 else 1.0
        record.extend(
            [
                float(round(gof, 6)),
                float(round(residual, 6)),
                float(round(correlation, 6)),
                float(round(lbh, 6)),
            ]
        )

        records.append(record)
        mats.append(mat_model)

    return {
        "mat": mats,
        "data": [headers] + records,
        "mock": True,
        "model_id": model_id,
        "server": payload.server,
    }


@router.post("/getSpectrum/{model_id}", response_class=PlainTextResponse)
def mock_get_spectrum(model_id: str, payload: MockGetSpectrumRequest):
    if not ENABLE_HPC_MOCK:
        return ""

    model_json = payload.model_json if isinstance(payload.model_json, dict) else {}
    content = model_json.get("content") if isinstance(model_json, dict) else {}
    proj_params = content.get("proj_params") if isinstance(content, dict) else {}
    se_wavelength = proj_params.get("SEwavelength") if isinstance(proj_params, dict) else []
    grid = build_wavelength_grid(se_wavelength if isinstance(se_wavelength, list) else [])
    if grid.size == 0:
        grid = build_wavelength_grid([])

    basis_rows = _basis_rows(model_json)
    material_rows = _material_rows(model_json)
    basis_sum = sum(float(row.get("nominal", row.get("nominalNew", 0.0)) or 0.0) for row in basis_rows)
    material_sum = sum(float(row.get("value", row.get("valueNew", 0.0)) or 0.0) for row in material_rows)
    phase_a = _stable_unit(f"{model_id}:{basis_sum}")
    phase_b = _stable_unit(f"{model_id}:{material_sum}")

    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(["wavelength", "n", "c", "s"])
    wl_min = float(grid.min())
    wl_max = float(grid.max())
    wl_span = max(1.0, wl_max - wl_min)

    for wl in grid.tolist():
        x = (float(wl) - wl_min) / wl_span
        n = 1.45 + 0.06 * math.sin(2.8 * math.pi * x + phase_a * 6.28318) + 0.01 * math.cos(phase_b * 12.0 * x)
        c = 0.25 + 0.05 * math.cos(3.4 * math.pi * x + phase_b * 6.28318) + 0.01 * math.sin(phase_a * 9.0 * x)
        s = 0.08 + 0.03 * math.sin(5.2 * math.pi * x + 0.5 * phase_a * 6.28318)
        writer.writerow([f"{wl:.6f}", f"{n:.8f}", f"{c:.8f}", f"{s:.8f}"])

    return PlainTextResponse(content=stream.getvalue(), media_type="text/csv")
