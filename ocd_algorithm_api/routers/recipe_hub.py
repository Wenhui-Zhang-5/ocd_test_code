import json
import sqlite3
from typing import Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel, Field

try:
    from ocd_algorithm_api.config import OCD_BACKEND_DATA_DIR
except Exception:  # pragma: no cover
    from config import OCD_BACKEND_DATA_DIR

router = APIRouter()

DATA_DIR = OCD_BACKEND_DATA_DIR
DB_PATH = DATA_DIR / "recipe_hub.sqlite3"
DATA_DIR.mkdir(parents=True, exist_ok=True)
_DB: sqlite3.Connection = None


def _init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS recipe_hub_workspaces (
            workspace_id TEXT PRIMARY KEY,
            seq INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS recipe_hub_meta_values (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            value_type TEXT NOT NULL,
            project TEXT NOT NULL DEFAULT '',
            product TEXT NOT NULL DEFAULT '',
            value TEXT NOT NULL,
            UNIQUE(value_type, project, product, value)
        )
        """
    )
    conn.commit()
    return conn


def _get_db() -> sqlite3.Connection:
    global _DB
    if _DB is None:
        _DB = _init_db()
        return _DB
    try:
        _DB.execute("SELECT 1")
    except Exception:
        try:
            _DB.close()
        except Exception:
            pass
        _DB = _init_db()
        return _DB
    # If sqlite file is deleted while process is running, recreate a fresh file+connection.
    if not DB_PATH.exists():
        try:
            _DB.close()
        except Exception:
            pass
        _DB = _init_db()
    return _DB


class RecipeHubSyncBody(BaseModel):
    workspaces: List[Dict[str, Any]] = Field(default_factory=list)


class RecipeHubMetaAddBody(BaseModel):
    value_type: str
    value: str
    project: str = ""
    product: str = ""


class RecipeHubMetaOptionsResponse(BaseModel):
    projects: List[str] = Field(default_factory=list)
    products: List[str] = Field(default_factory=list)
    loops: List[str] = Field(default_factory=list)


def _workspace_sort_key(item: Dict[str, Any]) -> int:
    try:
        return int(item.get("seq") or 0)
    except Exception:
        return 0


def _upsert_workspace(item: Dict[str, Any]) -> None:
    workspace_id = str(item.get("id") or "").strip()
    if not workspace_id:
        return
    seq = _workspace_sort_key(item)
    payload_json = json.dumps(item, ensure_ascii=False)
    _get_db().execute(
        """
        INSERT INTO recipe_hub_workspaces (workspace_id, seq, payload_json)
        VALUES (?, ?, ?)
        ON CONFLICT(workspace_id)
        DO UPDATE SET
            seq = excluded.seq,
            payload_json = excluded.payload_json
        """,
        (workspace_id, seq, payload_json),
    )


def _collect_workspace_meta() -> Dict[str, Any]:
    rows = _get_db().execute(
        """
        SELECT payload_json FROM recipe_hub_workspaces
        """
    ).fetchall()
    projects = set()
    products_by_project: Dict[str, set] = {}
    loops_by_product: Dict[str, set] = {}
    for (payload_json,) in rows:
        try:
            payload = json.loads(payload_json)
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        recipe_meta = payload.get("recipeMeta") if isinstance(payload.get("recipeMeta"), dict) else {}
        project = str(payload.get("project") or recipe_meta.get("project") or "").strip()
        product = str(
            payload.get("productId")
            or payload.get("productID")
            or payload.get("product")
            or recipe_meta.get("productId")
            or recipe_meta.get("productID")
            or ""
        ).strip()
        loop = str(payload.get("loop") or recipe_meta.get("loop") or "").strip()
        if project:
            projects.add(project)
            products_by_project.setdefault(project, set())
        if project and product:
            products_by_project.setdefault(project, set()).add(product)
        if product:
            loops_by_product.setdefault(product, set())
        if product and loop:
            loops_by_product.setdefault(product, set()).add(loop)
    return {
        "projects": projects,
        "products_by_project": products_by_project,
        "loops_by_product": loops_by_product,
    }


def _collect_manual_meta() -> Dict[str, Any]:
    rows = _get_db().execute(
        """
        SELECT value_type, project, product, value
        FROM recipe_hub_meta_values
        """
    ).fetchall()
    projects = set()
    products_by_project: Dict[str, set] = {}
    loops_by_product: Dict[str, set] = {}
    for value_type, project, product, value in rows:
        vtype = str(value_type or "").strip().lower()
        project = str(project or "").strip()
        product = str(product or "").strip()
        value = str(value or "").strip()
        if not value:
            continue
        if vtype == "project":
            projects.add(value)
            products_by_project.setdefault(value, set())
            continue
        if vtype == "product":
            if project:
                products_by_project.setdefault(project, set()).add(value)
            continue
        if vtype == "loop":
            if product:
                loops_by_product.setdefault(product, set()).add(value)
    return {
        "projects": projects,
        "products_by_project": products_by_project,
        "loops_by_product": loops_by_product,
    }


def _merge_meta(primary: Dict[str, Any], secondary: Dict[str, Any]) -> Dict[str, Any]:
    projects = set(primary.get("projects", set())) | set(secondary.get("projects", set()))
    products_by_project: Dict[str, set] = {}
    loops_by_product: Dict[str, set] = {}

    for source in (primary, secondary):
        for project, products in source.get("products_by_project", {}).items():
            products_by_project.setdefault(project, set()).update(products)
        for product, loops in source.get("loops_by_product", {}).items():
            loops_by_product.setdefault(product, set()).update(loops)

    return {
        "projects": projects,
        "products_by_project": products_by_project,
        "loops_by_product": loops_by_product,
    }


@router.get("/recipe-hub/workspaces")
def list_recipe_hub_workspaces():
    rows = _get_db().execute(
        """
        SELECT payload_json
        FROM recipe_hub_workspaces
        ORDER BY seq DESC, workspace_id DESC
        """
    ).fetchall()
    out: List[Dict[str, Any]] = []
    for (payload_json,) in rows:
        try:
            value = json.loads(payload_json)
        except Exception:
            continue
        if isinstance(value, dict):
            out.append(value)
    return {"workspaces": out}


@router.post("/recipe-hub/workspaces/sync")
def sync_recipe_hub_workspaces(body: RecipeHubSyncBody):
    conn = _get_db()
    incoming = [item for item in (body.workspaces or []) if isinstance(item, dict)]
    incoming_ids = {str(item.get("id") or "").strip() for item in incoming if item.get("id")}

    if incoming_ids:
        placeholders = ",".join(["?"] * len(incoming_ids))
        conn.execute(
            f"DELETE FROM recipe_hub_workspaces WHERE workspace_id NOT IN ({placeholders})",
            tuple(incoming_ids),
        )
    else:
        conn.execute("DELETE FROM recipe_hub_workspaces")

    for item in incoming:
        _upsert_workspace(item)

    conn.commit()
    return {"ok": True, "count": len(incoming)}


@router.get("/recipe-hub/meta-options", response_model=RecipeHubMetaOptionsResponse)
def get_recipe_hub_meta_options(project: str = "", product: str = ""):
    merged = _merge_meta(_collect_workspace_meta(), _collect_manual_meta())
    projects = sorted(merged["projects"])
    products_by_project = merged["products_by_project"]
    loops_by_product = merged["loops_by_product"]

    if project:
        products = sorted(products_by_project.get(project, set()))
    else:
        products_set = set()
        for values in products_by_project.values():
            products_set.update(values)
        products = sorted(products_set)

    if product:
        loops = sorted(loops_by_product.get(product, set()))
    else:
        loops_set = set()
        for values in loops_by_product.values():
            loops_set.update(values)
        loops = sorted(loops_set)

    return RecipeHubMetaOptionsResponse(projects=projects, products=products, loops=loops)


@router.post("/recipe-hub/meta-options/add")
def add_recipe_hub_meta_option(body: RecipeHubMetaAddBody):
    value_type = str(body.value_type or "").strip().lower()
    value = str(body.value or "").strip()
    project = str(body.project or "").strip()
    product = str(body.product or "").strip()
    if value_type not in {"project", "product", "loop"}:
        return {"ok": False, "error": "value_type must be project/product/loop"}
    if not value:
        return {"ok": False, "error": "value is required"}

    if value_type == "product" and not project:
        return {"ok": False, "error": "project is required for product"}
    if value_type == "loop" and not product:
        return {"ok": False, "error": "product is required for loop"}

    conn = _get_db()
    conn.execute(
        """
        INSERT OR IGNORE INTO recipe_hub_meta_values (value_type, project, product, value)
        VALUES (?, ?, ?, ?)
        """,
        (value_type, project, product, value),
    )
    conn.commit()
    return {"ok": True}
