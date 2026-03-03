import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from ocd_algorithm_api.config import OCD_CASE_ROOT, OCD_NK_LIBRARY_DIR
except Exception:  # pragma: no cover
    from config import OCD_CASE_ROOT, OCD_NK_LIBRARY_DIR

router = APIRouter()

NK_BASE = OCD_NK_LIBRARY_DIR
INDEX_PATH = NK_BASE / "index.json"
ORDER_PATH = NK_BASE / "material_order.json"
CASE_ROOT = OCD_CASE_ROOT


def load_index() -> List[dict]:
    if not INDEX_PATH.exists():
        return []
    return json_read(INDEX_PATH)


def json_read(path: Path):
    import json

    return json.loads(path.read_text())


def resolve_record(library: str, material: str, model_type: str, model_name: Optional[str]):
    records = load_index()
    candidates = [
        r
        for r in records
        if r.get("library") == library
        and r.get("material") == material
        and r.get("modelType") == model_type
    ]
    if not candidates:
        return None
    if model_name:
        for record in candidates:
            if record.get("modelName") == model_name:
                return record
    return candidates[0]


def compute_nk(record: dict):
    path = NK_BASE / record["path"]
    payload = json_read(path)
    model_type = payload.get("modelType") or payload.get("model") or payload.get("method")
    params = payload.get("params", {})

    wavelengths = np.arange(190, 1000 + 1e-6, 5.0)
    if str(model_type).lower() == "cauchy":
        n_values, k_values = _compute_cauchy_nk(wavelengths, params)
    else:
        n_values, k_values = _compute_ho_nk(wavelengths, params)

    return {
        "wavelength": wavelengths.round(1).tolist(),
        "n": n_values,
        "k": k_values,
        "meta": payload,
    }


def _compute_cauchy_nk(wavelength_nm: np.ndarray, params: dict):
    # n(λ) = A + B/λ^2 + C/λ^4, λ in nm
    # k(λ) = D * exp(F * (Eph - G)), Eph = 1239.84193 / λ
    lam = np.asarray(wavelength_nm, dtype=np.float64)
    eph = 1239.84193 / np.clip(lam, 1e-9, None)

    A = float(params.get("A", 1.5))
    B = float(params.get("B", 0.0))
    C = float(params.get("C", 0.0))
    D = float(params.get("D", 0.0))
    F = float(params.get("F", 0.0))
    G = float(params.get("G", 0.0))

    lam2 = lam * lam
    n = A + (B / lam2) + (C / (lam2 * lam2))
    k = D * np.exp(F * (eph - G))
    n = np.maximum(n, 1e-6)
    k = np.maximum(k, 0.0)
    return np.round(n, 6).tolist(), np.round(k, 6).tolist()


def _compute_ho_nk(wavelength_nm: np.ndarray, params: dict):
    # Multi-oscillator HO (complex dielectric):
    # ε(E) = ε_inf + Σ_j S_j(E) * [Amp_j * exp(i*phi_j)] / [En_j^2 - E^2 - i*nu_j*E]
    # S_j(E) = 1/(1+exp(-(E-Eg_j)/delta))
    # n,k from ε = ε1 + iε2:
    # n = sqrt((|ε| + ε1)/2), k = sqrt((|ε| - ε1)/2)
    lam = np.asarray(wavelength_nm, dtype=np.float64)
    eph = 1239.84193 / np.clip(lam, 1e-9, None)  # eV

    n0 = float(params.get("n0", 1.5))
    eps_inf = max(n0 * n0, 1e-8)
    delta = 0.05

    oscillators = params.get("oscillators", []) or []
    if not isinstance(oscillators, list):
        oscillators = []

    eps = np.full(eph.shape, eps_inf + 0j, dtype=np.complex128)
    for osc in oscillators:
        amp = float(osc.get("amp", 0.0))
        en = max(float(osc.get("en", 0.0)), 1e-6)
        eg = float(osc.get("eg", 0.0))
        phi = float(osc.get("phi", 0.0))
        nu = max(float(osc.get("nu", 0.0)), 1e-8)

        gate = 1.0 / (1.0 + np.exp(-(eph - eg) / delta))
        numerator = amp * np.exp(1j * phi)
        denominator = (en * en) - (eph * eph) - 1j * nu * eph
        eps += gate * (numerator / denominator)

    eps1 = np.real(eps)
    eps2 = np.imag(eps)
    abs_eps = np.sqrt(eps1 * eps1 + eps2 * eps2)
    n = np.sqrt(np.maximum((abs_eps + eps1) * 0.5, 0.0))
    k = np.sqrt(np.maximum((abs_eps - eps1) * 0.5, 0.0))
    n = np.maximum(n, 1e-6)
    k = np.maximum(k, 0.0)
    return np.round(n, 6).tolist(), np.round(k, 6).tolist()


class NkCurveRequest(BaseModel):
    library: str
    material: str
    modelType: str
    modelName: Optional[str] = None


class NkSeedCopyRequest(BaseModel):
    model_id: str
    version: str
    material_seeds: Dict[str, List[str]] = Field(default_factory=dict)


class NkSeedCopyResponse(BaseModel):
    ok: bool = True
    model_id: str
    version: str
    case_root: str
    nk_library_dir: str
    manifest_path: str
    copied_count: int = 0
    skipped_count: int = 0
    errors: List[str] = Field(default_factory=list)


def _safe_token(value: str) -> str:
    token = "".join(ch if ch.isalnum() or ch in {"_", "-", "."} else "_" for ch in (value or "").strip())
    return token or "unknown"


def _safe_filename_from_path(value: str) -> str:
    normalized = (value or "").replace("\\", "/").strip("/")
    if not normalized:
        return "unknown.json"
    filename = normalized.lower().replace("/", "_")
    return filename


@router.get("/nk/index")
def nk_index():
    return load_index()


@router.get("/nk/libraries")
def nk_libraries():
    libs = sorted({item.get("library") for item in load_index() if item.get("library")})
    return libs


@router.get("/nk/materials")
def nk_materials(library: str):
    mats = sorted(
        {
            item.get("material")
            for item in load_index()
            if item.get("library") == library and item.get("material")
        }
    )
    return mats


@router.get("/nk/models")
def nk_models(library: str, material: str):
    models = [
        {
            "modelType": item.get("modelType"),
            "modelName": item.get("modelName"),
        }
        for item in load_index()
        if item.get("library") == library and item.get("material") == material
    ]
    return models


@router.post("/nk/curve")
def nk_curve(payload: NkCurveRequest):
    record = resolve_record(payload.library, payload.material, payload.modelType, payload.modelName)
    if not record:
        return {"wavelength": [], "n": [], "k": [], "meta": None}
    return compute_nk(record)


@router.get("/nk/material-order")
def nk_material_order():
    if not ORDER_PATH.exists():
        return ["TiN", "Si", "SiN", "SiO2"]
    try:
        return json_read(ORDER_PATH)
    except Exception:
        return ["TiN", "Si", "SiN", "SiO2"]


@router.post("/nk/copy-seeds", response_model=NkSeedCopyResponse)
def nk_copy_seeds(payload: NkSeedCopyRequest):
    model_id = (payload.model_id or "").strip()
    version = (payload.version or "").strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")
    if not version:
        raise HTTPException(status_code=400, detail="version is required")
    if not payload.material_seeds:
        raise HTTPException(status_code=400, detail="material_seeds is required")

    safe_model = _safe_token(model_id)
    safe_version = _safe_token(version)
    case_root = CASE_ROOT / f"model_{safe_model}" / f"version_{safe_version}"
    nk_library_dir = case_root / "nk_library"
    nk_library_dir.mkdir(parents=True, exist_ok=True)

    copied_count = 0
    skipped_count = 0
    errors: List[str] = []
    manifest: Dict[str, object] = {
        "model_id": model_id,
        "version": version,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "nk_library_dir": str(nk_library_dir),
        "materialSeedsCopied": {},
    }

    for material, paths in payload.material_seeds.items():
        material_name = (material or "").strip()
        safe_material = _safe_token(material_name)
        target_dir = nk_library_dir / safe_material
        target_dir.mkdir(parents=True, exist_ok=True)
        copied_rows = []
        used_names = set()
        for source_rel in (paths or []):
            rel = (source_rel or "").strip().replace("\\", "/")
            if not rel:
                skipped_count += 1
                continue
            source_path = (NK_BASE / rel).resolve()
            try:
                source_path.relative_to(NK_BASE.resolve())
            except Exception:
                errors.append(f"[{material_name}] invalid path outside nk_library: {rel}")
                skipped_count += 1
                continue
            if not source_path.exists() or not source_path.is_file():
                errors.append(f"[{material_name}] source missing: {rel}")
                skipped_count += 1
                continue
            target_name = _safe_filename_from_path(rel)
            if not target_name.endswith(".json"):
                target_name = f"{target_name}.json"
            base = target_name[:-5] if target_name.endswith(".json") else target_name
            ext = ".json"
            suffix = 1
            while target_name in used_names or (target_dir / target_name).exists():
                target_name = f"{base}_{suffix}{ext}"
                suffix += 1
            used_names.add(target_name)
            target_path = target_dir / target_name
            shutil.copy2(source_path, target_path)
            copied_count += 1
            copied_rows.append(
                {
                    "source": rel,
                    "target": str(target_path.relative_to(case_root)),
                    "target_filename": target_name,
                }
            )
        manifest["materialSeedsCopied"][material_name] = copied_rows

    manifest_path = nk_library_dir / "nk_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    return NkSeedCopyResponse(
        ok=True,
        model_id=model_id,
        version=version,
        case_root=str(case_root),
        nk_library_dir=str(nk_library_dir),
        manifest_path=str(manifest_path),
        copied_count=copied_count,
        skipped_count=skipped_count,
        errors=errors,
    )
