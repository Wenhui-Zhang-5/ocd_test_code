import json
import re
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter
from pydantic import BaseModel, Field

try:
    from ocd_algorithm_api.config import OCD_BACKEND_DATA_DIR
except Exception:  # pragma: no cover
    from config import OCD_BACKEND_DATA_DIR

router = APIRouter()

CACHE_DIR = OCD_BACKEND_DATA_DIR / "workspace_case_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _safe_name(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return "unknown"
    return re.sub(r"[^a-zA-Z0-9_-]", "_", text)


def _cache_path(workspace_id: str) -> Path:
    return CACHE_DIR / f"{_safe_name(workspace_id)}.json"


def _read_cache(workspace_id: str) -> Dict[str, Any]:
    path = _cache_path(workspace_id)
    if not path.exists():
        return {}
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(content, dict):
            return content
    except Exception:
        return {}
    return {}


def _write_cache(workspace_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    path = _cache_path(workspace_id)
    clean_payload = payload if isinstance(payload, dict) else {}
    path.write_text(json.dumps(clean_payload, indent=2), encoding="utf-8")
    return clean_payload


class WorkspaceCacheBody(BaseModel):
    cache: Dict[str, Any] = Field(default_factory=dict)


class WorkspaceCacheSectionBody(BaseModel):
    data: Dict[str, Any] = Field(default_factory=dict)


@router.get("/workspace-cache/{workspace_id}")
def get_workspace_cache(workspace_id: str):
    return {"workspace_id": workspace_id, "cache": _read_cache(workspace_id)}


@router.put("/workspace-cache/{workspace_id}")
def put_workspace_cache(workspace_id: str, body: WorkspaceCacheBody):
    saved = _write_cache(workspace_id, body.cache or {})
    return {"workspace_id": workspace_id, "cache": saved}


@router.patch("/workspace-cache/{workspace_id}/{section}")
def patch_workspace_cache_section(workspace_id: str, section: str, body: WorkspaceCacheSectionBody):
    cache = _read_cache(workspace_id)
    cache[section] = body.data or {}
    saved = _write_cache(workspace_id, cache)
    return {"workspace_id": workspace_id, "cache": saved}


@router.delete("/workspace-cache/{workspace_id}")
def delete_workspace_cache(workspace_id: str):
    path = _cache_path(workspace_id)
    if path.exists():
        path.unlink()
    return {"workspace_id": workspace_id, "deleted": True}
