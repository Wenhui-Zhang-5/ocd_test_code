import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent


def _resolve_path_env(name: str, default: Path) -> Path:
    raw = os.getenv(name, "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return default.expanduser().resolve()


OCD_FRONTEND_DIR = _resolve_path_env("OCD_FRONTEND_DIR", PROJECT_ROOT / "ocd_master")
OCD_BACKEND_DATA_DIR = _resolve_path_env("OCD_BACKEND_DATA_DIR", BACKEND_DIR / "data")
OCD_NK_LIBRARY_DIR = _resolve_path_env("OCD_NK_LIBRARY_DIR", PROJECT_ROOT / "nk_library")
OCD_SPECTRUM_ROOT = _resolve_path_env("OCD_SPECTRUM_ROOT", OCD_FRONTEND_DIR / "spectrum_data")
OCD_CASE_ROOT = _resolve_path_env("OCD_CASE_ROOT", PROJECT_ROOT / "ocd_master_58")
