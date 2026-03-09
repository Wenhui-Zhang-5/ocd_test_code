import json
import os
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    from ocd_algorithm_api.config import OCD_BACKEND_DATA_DIR, OCD_CASE_ROOT
except Exception:  # pragma: no cover
    from config import OCD_BACKEND_DATA_DIR, OCD_CASE_ROOT

router = APIRouter(prefix="/optimization", tags=["optimization"])

DATA_DIR = OCD_BACKEND_DATA_DIR
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "optimization_queue.sqlite3"
DEFAULT_RESULTS_ROOT = Path(
    os.getenv("OCD_OPTIMIZATION_RESULTS_ROOT", str(OCD_CASE_ROOT)).strip() or str(OCD_CASE_ROOT)
).expanduser()
AUTO_DISPATCH_ENABLED = str(os.getenv("OCD_OPTIMIZATION_AUTO_DISPATCH", "0")).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

_LOCK = threading.RLock()
_DB: Optional[sqlite3.Connection] = None

TERMINAL_STATUSES = {"completed", "failed", "canceled"}
QUEUE_STATUSES = {"queued"}
ACTIVE_STATUSES = {"running", "pausing"}


class CreateRunRequest(BaseModel):
    workspace_id: str
    model_id: str
    version: str
    recipe_schema_path: str
    model_json_path: str
    results_root: Optional[str] = None
    priority: int = 100
    submitted_by: str = ""


class CreateRunResponse(BaseModel):
    run_id: str
    status: str
    queue_position: int
    created_at: str


class RunRow(BaseModel):
    run_id: str
    workspace_id: str
    model_id: str
    version: str
    status: str
    progress: float = 0.0
    current_stage: str = ""
    best_kpi: Optional[float] = None
    message: str = ""
    recipe_schema_path: str = ""
    model_json_path: str = ""
    results_root: str = ""
    results_path: str = ""
    checkpoint_path: str = ""
    paused_reason: str = ""
    error: str = ""
    priority: int = 100
    submitted_by: str = ""
    queue_position: Optional[int] = None
    created_at: str = ""
    updated_at: str = ""
    started_at: str = ""
    finished_at: str = ""


class ListRunsResponse(BaseModel):
    items: List[RunRow] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class PauseRunRequest(BaseModel):
    reason: str = ""


class QueueItem(BaseModel):
    run_id: str
    workspace_id: str
    model_id: str
    version: str
    status: str
    position: int
    priority: int
    queued_at: str


class QueueResponse(BaseModel):
    items: List[QueueItem] = Field(default_factory=list)


class ReorderQueueRequest(BaseModel):
    run_id: str
    new_position: int = Field(ge=1)


class HeartbeatRequest(BaseModel):
    progress: float = Field(ge=0.0, le=100.0)
    current_stage: str
    best_kpi: Optional[float] = None
    message: str = ""
    checkpoint_path: str = ""
    status: str = "running"
    error: str = ""


class ArtifactItem(BaseModel):
    type: str
    relative_path: str
    created_at: str = ""
    meta: Dict[str, Any] = Field(default_factory=dict)


class ArtifactUploadRequest(BaseModel):
    artifacts: List[ArtifactItem] = Field(default_factory=list)


class SimpleAckResponse(BaseModel):
    ok: bool = True
    run_id: str
    status: str


class MarkFailedRequest(BaseModel):
    error: str = ""


class MarkCompletedRequest(BaseModel):
    checkpoint_path: str = ""


class RunEventItem(BaseModel):
    id: int
    run_id: str
    event_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = ""


class RunEventsResponse(BaseModel):
    items: List[RunEventItem] = Field(default_factory=list)
    next_after_id: int = 0


class RunArtifactItem(BaseModel):
    id: int
    run_id: str
    artifact_type: str
    relative_path: str
    abs_path: str
    created_at: str = ""
    meta: Dict[str, Any] = Field(default_factory=dict)


class RunArtifactsResponse(BaseModel):
    items: List[RunArtifactItem] = Field(default_factory=list)


class ResultFileItem(BaseModel):
    relative_path: str
    abs_path: str
    size: int
    modified_at: str


class RunResultIndexResponse(BaseModel):
    items: List[ResultFileItem] = Field(default_factory=list)


class RunResultJsonResponse(BaseModel):
    run_id: str
    relative_path: str
    data: Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_token(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "_", (value or "").strip())


def _safe_relative_path(value: str) -> str:
    text = (value or "").strip().replace("\\", "/")
    text = text.lstrip("/")
    while "../" in text or text.startswith(".."):
        text = text.replace("../", "")
        if text.startswith(".."):
            text = text[2:]
    return text


def _build_results_path(results_root: str, model_id: str, version: str, run_id: str) -> Path:
    root = Path(results_root).expanduser()
    return root / f"model_{_safe_token(model_id)}" / f"version_{_safe_token(version)}" / "Results" / f"run_{_safe_token(run_id)}"


def _db() -> sqlite3.Connection:
    global _DB
    with _LOCK:
        if _DB is None:
            conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            _init_db(conn)
            _DB = conn
        return _DB


def _init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS optimization_runs (
            run_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            version TEXT NOT NULL,
            recipe_schema_path TEXT NOT NULL,
            model_json_path TEXT NOT NULL,
            results_root TEXT NOT NULL,
            results_path TEXT NOT NULL,
            status TEXT NOT NULL,
            progress REAL NOT NULL DEFAULT 0,
            current_stage TEXT NOT NULL DEFAULT '',
            best_kpi REAL,
            message TEXT NOT NULL DEFAULT '',
            checkpoint_path TEXT NOT NULL DEFAULT '',
            paused_reason TEXT NOT NULL DEFAULT '',
            error TEXT NOT NULL DEFAULT '',
            priority INTEGER NOT NULL DEFAULT 100,
            submitted_by TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT NOT NULL DEFAULT '',
            finished_at TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS optimization_queue (
            run_id TEXT PRIMARY KEY,
            position INTEGER NOT NULL,
            priority INTEGER NOT NULL,
            queued_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES optimization_runs(run_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS optimization_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS optimization_artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            artifact_type TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            abs_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            meta_json TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES optimization_runs(run_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_opt_runs_status_created ON optimization_runs(status, created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_opt_runs_workspace_created ON optimization_runs(workspace_id, created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_opt_events_id ON optimization_events(id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_opt_artifacts_run ON optimization_artifacts(run_id)")
    conn.commit()


def _append_event(conn: sqlite3.Connection, run_id: str, event_type: str, payload: Dict[str, Any]) -> int:
    now = _now_iso()
    row = {
        "run_id": run_id,
        "event_type": event_type,
        "payload": payload,
        "created_at": now,
    }
    cur = conn.execute(
        "INSERT INTO optimization_events (run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)",
        (run_id, event_type, json.dumps(row, ensure_ascii=False), now),
    )
    return int(cur.lastrowid)


def _get_run_row(conn: sqlite3.Connection, run_id: str) -> Optional[sqlite3.Row]:
    return conn.execute("SELECT * FROM optimization_runs WHERE run_id = ?", (run_id,)).fetchone()


def _repack_queue_positions(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT run_id FROM optimization_queue ORDER BY position ASC, queued_at ASC, run_id ASC"
    ).fetchall()
    for idx, row in enumerate(rows, start=1):
        conn.execute("UPDATE optimization_queue SET position = ?, updated_at = ? WHERE run_id = ?", (idx, _now_iso(), row[0]))


def _enqueue_run(conn: sqlite3.Connection, run_id: str, priority: int, *, position: Optional[int] = None) -> int:
    now = _now_iso()
    max_pos = conn.execute("SELECT COALESCE(MAX(position), 0) FROM optimization_queue").fetchone()[0]
    if position is None or position > max_pos + 1:
        position = max_pos + 1
    if position < 1:
        position = 1

    conn.execute("UPDATE optimization_queue SET position = position + 1, updated_at = ? WHERE position >= ?", (now, position))
    conn.execute(
        "INSERT OR REPLACE INTO optimization_queue (run_id, position, priority, queued_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (run_id, position, priority, now, now),
    )
    _repack_queue_positions(conn)
    row = conn.execute("SELECT position FROM optimization_queue WHERE run_id = ?", (run_id,)).fetchone()
    return int(row[0]) if row else position


def _dequeue_run(conn: sqlite3.Connection, run_id: str) -> None:
    conn.execute("DELETE FROM optimization_queue WHERE run_id = ?", (run_id,))
    _repack_queue_positions(conn)


def _queue_position(conn: sqlite3.Connection, run_id: str) -> Optional[int]:
    row = conn.execute("SELECT position FROM optimization_queue WHERE run_id = ?", (run_id,)).fetchone()
    if not row:
        return None
    return int(row[0])


def _resolve_run_results_path(conn: sqlite3.Connection, run_id: str) -> Path:
    row = _get_run_row(conn, run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="run not found")
    root = Path(str(row["results_path"] or "")).expanduser().resolve()
    if not str(root):
        raise HTTPException(status_code=500, detail="run results path missing")
    if not root.exists():
        raise HTTPException(status_code=404, detail="run results path not found")
    return root


def _resolve_relative_file(base_dir: Path, relative_path: str) -> Path:
    rel = _safe_relative_path(relative_path)
    if not rel:
        raise HTTPException(status_code=400, detail="relative_path is required")
    candidate = (base_dir / rel).resolve()
    try:
        candidate.relative_to(base_dir)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="relative_path escapes run results directory") from exc
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail="result file not found")
    return candidate


def _status_row_to_dict(row: sqlite3.Row, queue_position: Optional[int]) -> Dict[str, Any]:
    return {
        "run_id": row["run_id"],
        "workspace_id": row["workspace_id"],
        "model_id": row["model_id"],
        "version": row["version"],
        "status": row["status"],
        "progress": float(row["progress"] or 0.0),
        "current_stage": row["current_stage"] or "",
        "best_kpi": row["best_kpi"],
        "message": row["message"] or "",
        "recipe_schema_path": row["recipe_schema_path"] or "",
        "model_json_path": row["model_json_path"] or "",
        "results_root": row["results_root"] or "",
        "results_path": row["results_path"] or "",
        "checkpoint_path": row["checkpoint_path"] or "",
        "paused_reason": row["paused_reason"] or "",
        "error": row["error"] or "",
        "priority": int(row["priority"] or 100),
        "submitted_by": row["submitted_by"] or "",
        "queue_position": queue_position,
        "created_at": row["created_at"] or "",
        "updated_at": row["updated_at"] or "",
        "started_at": row["started_at"] or "",
        "finished_at": row["finished_at"] or "",
    }


def _dispatch_next_run_if_enabled(conn: sqlite3.Connection) -> None:
    if not AUTO_DISPATCH_ENABLED:
        return

    active = conn.execute(
        "SELECT COUNT(1) FROM optimization_runs WHERE status IN ('running', 'pausing')"
    ).fetchone()[0]
    if int(active or 0) > 0:
        return

    row = conn.execute(
        "SELECT q.run_id FROM optimization_queue q JOIN optimization_runs r ON r.run_id = q.run_id "
        "WHERE r.status = 'queued' ORDER BY q.position ASC, q.queued_at ASC LIMIT 1"
    ).fetchone()
    if not row:
        return

    run_id = str(row[0])
    now = _now_iso()
    conn.execute(
        "UPDATE optimization_runs SET status = 'running', current_stage = 'starting', started_at = ?, updated_at = ? WHERE run_id = ?",
        (now, now, run_id),
    )
    _dequeue_run(conn, run_id)
    _append_event(
        conn,
        run_id,
        "run_started",
        {"run_id": run_id, "status": "running", "started_at": now},
    )


def create_run_internal(
    *,
    workspace_id: str,
    model_id: str,
    version: str,
    recipe_schema_path: str,
    model_json_path: str,
    results_root: Optional[str],
    priority: int,
    submitted_by: str,
) -> Dict[str, Any]:
    workspace_id = (workspace_id or "").strip()
    model_id = (model_id or "").strip()
    version = (version or "").strip()
    recipe_schema_path = (recipe_schema_path or "").strip()
    model_json_path = (model_json_path or "").strip()

    if not workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id is required")
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")
    if not version:
        raise HTTPException(status_code=400, detail="version is required")
    if not recipe_schema_path:
        raise HTTPException(status_code=400, detail="recipe_schema_path is required")
    if not model_json_path:
        raise HTTPException(status_code=400, detail="model_json_path is required")

    run_id = f"RUN-{uuid.uuid4().hex[:12].upper()}"
    now = _now_iso()
    root_text = (results_root or "").strip() or str(DEFAULT_RESULTS_ROOT)
    results_path = _build_results_path(root_text, model_id, version, run_id)
    try:
        results_path.mkdir(parents=True, exist_ok=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"results path not writable: {exc}") from exc

    conn = _db()
    with _LOCK:
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                """
                INSERT INTO optimization_runs (
                    run_id, workspace_id, model_id, version,
                    recipe_schema_path, model_json_path,
                    results_root, results_path,
                    status, progress, current_stage,
                    best_kpi, message,
                    checkpoint_path, paused_reason, error,
                    priority, submitted_by,
                    created_at, updated_at, started_at, finished_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 'queued', NULL, '', '', '', '', ?, ?, ?, ?, '', '')
                """,
                (
                    run_id,
                    workspace_id,
                    model_id,
                    version,
                    recipe_schema_path,
                    model_json_path,
                    root_text,
                    str(results_path),
                    int(priority),
                    (submitted_by or "").strip(),
                    now,
                    now,
                ),
            )
            queue_position = _enqueue_run(conn, run_id, int(priority))
            _append_event(
                conn,
                run_id,
                "run_created",
                {
                    "run_id": run_id,
                    "workspace_id": workspace_id,
                    "model_id": model_id,
                    "version": version,
                    "status": "queued",
                    "queue_position": queue_position,
                    "created_at": now,
                },
            )
            _dispatch_next_run_if_enabled(conn)
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {
        "run_id": run_id,
        "status": "queued",
        "queue_position": queue_position,
        "created_at": now,
        "results_path": str(results_path),
        "results_root": root_text,
    }


@router.post("/runs", response_model=CreateRunResponse)
def create_run(body: CreateRunRequest):
    result = create_run_internal(
        workspace_id=body.workspace_id,
        model_id=body.model_id,
        version=body.version,
        recipe_schema_path=body.recipe_schema_path,
        model_json_path=body.model_json_path,
        results_root=body.results_root,
        priority=body.priority,
        submitted_by=body.submitted_by,
    )
    return CreateRunResponse(**result)


@router.get("/runs/{run_id}", response_model=RunRow)
def get_run(run_id: str):
    conn = _db()
    with _LOCK:
        row = _get_run_row(conn, run_id)
        if row is None:
            raise HTTPException(status_code=404, detail="run not found")
        qp = _queue_position(conn, run_id)
        return RunRow(**_status_row_to_dict(row, qp))


@router.get("/runs", response_model=ListRunsResponse)
def list_runs(
    status: Optional[str] = Query(default=None),
    model_id: Optional[str] = Query(default=None),
    workspace_id: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
):
    where: List[str] = []
    params: List[Any] = []

    if status:
        statuses = [s.strip().lower() for s in str(status).split(",") if s.strip()]
        if statuses:
            placeholders = ",".join(["?"] * len(statuses))
            where.append(f"LOWER(status) IN ({placeholders})")
            params.extend(statuses)
    if model_id:
        where.append("model_id = ?")
        params.append(str(model_id).strip())
    if workspace_id:
        where.append("workspace_id = ?")
        params.append(str(workspace_id).strip())

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    limit = int(page_size)
    offset = (int(page) - 1) * limit

    conn = _db()
    with _LOCK:
        total = int(conn.execute(f"SELECT COUNT(1) FROM optimization_runs {where_sql}", params).fetchone()[0])
        rows = conn.execute(
            f"SELECT * FROM optimization_runs {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        items: List[RunRow] = []
        for row in rows:
            qp = _queue_position(conn, str(row["run_id"]))
            items.append(RunRow(**_status_row_to_dict(row, qp)))

    return ListRunsResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("/runs/{run_id}/pause", response_model=SimpleAckResponse)
def pause_run(run_id: str, body: PauseRunRequest):
    conn = _db()
    with _LOCK:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = _get_run_row(conn, run_id)
            if row is None:
                raise HTTPException(status_code=404, detail="run not found")
            current = str(row["status"] or "").lower()
            if current != "running":
                raise HTTPException(status_code=409, detail="only running run can be paused")

            now = _now_iso()
            reason = (body.reason or "").strip()
            conn.execute(
                "UPDATE optimization_runs SET status = 'pausing', paused_reason = ?, updated_at = ? WHERE run_id = ?",
                (reason, now, run_id),
            )
            _append_event(conn, run_id, "run_pausing", {"run_id": run_id, "status": "pausing", "reason": reason})

            # Interface-first mode: simulate immediate safe-point acknowledgement.
            conn.execute(
                "UPDATE optimization_runs SET status = 'paused', current_stage = 'paused', updated_at = ? WHERE run_id = ?",
                (now, run_id),
            )
            _append_event(conn, run_id, "run_paused", {"run_id": run_id, "status": "paused", "reason": reason})
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise

    return SimpleAckResponse(run_id=run_id, status="paused")


@router.post("/runs/{run_id}/resume", response_model=SimpleAckResponse)
def resume_run(run_id: str):
    conn = _db()
    with _LOCK:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = _get_run_row(conn, run_id)
            if row is None:
                raise HTTPException(status_code=404, detail="run not found")
            current = str(row["status"] or "").lower()
            if current != "paused":
                raise HTTPException(status_code=409, detail="only paused run can be resumed")

            now = _now_iso()
            priority = int(row["priority"] or 100)
            conn.execute(
                "UPDATE optimization_runs SET status = 'queued', current_stage = 'queued', paused_reason = '', updated_at = ? WHERE run_id = ?",
                (now, run_id),
            )
            queue_position = _enqueue_run(conn, run_id, priority)
            _append_event(
                conn,
                run_id,
                "run_resumed",
                {"run_id": run_id, "status": "queued", "queue_position": queue_position},
            )
            _dispatch_next_run_if_enabled(conn)
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise

    return SimpleAckResponse(run_id=run_id, status="queued")


@router.post("/runs/{run_id}/cancel", response_model=SimpleAckResponse)
def cancel_run(run_id: str):
    conn = _db()
    with _LOCK:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = _get_run_row(conn, run_id)
            if row is None:
                raise HTTPException(status_code=404, detail="run not found")
            current = str(row["status"] or "").lower()
            if current in TERMINAL_STATUSES:
                raise HTTPException(status_code=409, detail="terminal run cannot be canceled")

            now = _now_iso()
            _dequeue_run(conn, run_id)
            conn.execute(
                "UPDATE optimization_runs SET status = 'canceled', current_stage = 'canceled', finished_at = ?, updated_at = ? WHERE run_id = ?",
                (now, now, run_id),
            )
            _append_event(conn, run_id, "run_canceled", {"run_id": run_id, "status": "canceled"})
            _dispatch_next_run_if_enabled(conn)
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise

    return SimpleAckResponse(run_id=run_id, status="canceled")


@router.get("/queue", response_model=QueueResponse)
def list_queue():
    conn = _db()
    with _LOCK:
        rows = conn.execute(
            """
            SELECT q.run_id, q.position, q.priority, q.queued_at,
                   r.workspace_id, r.model_id, r.version, r.status
            FROM optimization_queue q
            JOIN optimization_runs r ON r.run_id = q.run_id
            ORDER BY q.position ASC
            """
        ).fetchall()

    items = [
        QueueItem(
            run_id=str(row["run_id"]),
            workspace_id=str(row["workspace_id"]),
            model_id=str(row["model_id"]),
            version=str(row["version"]),
            status=str(row["status"]),
            position=int(row["position"]),
            priority=int(row["priority"]),
            queued_at=str(row["queued_at"]),
        )
        for row in rows
    ]
    return QueueResponse(items=items)


@router.post("/queue/reorder", response_model=QueueResponse)
def reorder_queue(body: ReorderQueueRequest):
    run_id = (body.run_id or "").strip()
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id is required")

    conn = _db()
    with _LOCK:
        conn.execute("BEGIN IMMEDIATE")
        try:
            rows = conn.execute("SELECT run_id FROM optimization_queue ORDER BY position ASC").fetchall()
            run_ids = [str(row[0]) for row in rows]
            if run_id not in run_ids:
                raise HTTPException(status_code=409, detail="run is not in queued list")

            old_index = run_ids.index(run_id)
            new_index = max(0, min(len(run_ids) - 1, int(body.new_position) - 1))
            if old_index != new_index:
                run_ids.pop(old_index)
                run_ids.insert(new_index, run_id)

            now = _now_iso()
            for idx, rid in enumerate(run_ids, start=1):
                conn.execute(
                    "UPDATE optimization_queue SET position = ?, updated_at = ? WHERE run_id = ?",
                    (idx, now, rid),
                )

            _append_event(
                conn,
                run_id,
                "queue_reordered",
                {"run_id": run_id, "new_position": new_index + 1, "total": len(run_ids)},
            )
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise

    return list_queue()


@router.post("/runs/{run_id}/heartbeat", response_model=SimpleAckResponse)
def update_run_heartbeat(run_id: str, body: HeartbeatRequest):
    status_req = (body.status or "running").strip().lower()
    if status_req not in {"running", "completed", "failed"}:
        raise HTTPException(status_code=400, detail="status must be running/completed/failed")

    conn = _db()
    with _LOCK:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = _get_run_row(conn, run_id)
            if row is None:
                raise HTTPException(status_code=404, detail="run not found")

            current = str(row["status"] or "").lower()
            if current in TERMINAL_STATUSES:
                raise HTTPException(status_code=409, detail="terminal run cannot accept heartbeat")

            now = _now_iso()
            started_at = row["started_at"] or now

            if current == "queued":
                _dequeue_run(conn, run_id)
                current = "running"
                conn.execute(
                    "UPDATE optimization_runs SET status = 'running', started_at = ?, updated_at = ? WHERE run_id = ?",
                    (started_at, now, run_id),
                )
                _append_event(conn, run_id, "run_started", {"run_id": run_id, "status": "running", "started_at": started_at})

            next_status = "running"
            event_type = "run_progress"
            finished_at = ""
            error_text = ""

            if status_req == "failed":
                next_status = "failed"
                event_type = "run_failed"
                finished_at = now
                error_text = (body.error or body.message or "worker failed").strip()
            elif status_req == "completed":
                next_status = "completed"
                event_type = "run_completed"
                finished_at = now
            elif current == "pausing":
                next_status = "paused"
                event_type = "run_paused"

            checkpoint_path = (body.checkpoint_path or "").strip() or (row["checkpoint_path"] or "")
            conn.execute(
                """
                UPDATE optimization_runs
                SET status = ?,
                    progress = ?,
                    current_stage = ?,
                    best_kpi = ?,
                    message = ?,
                    checkpoint_path = ?,
                    error = ?,
                    updated_at = ?,
                    started_at = ?,
                    finished_at = CASE WHEN ? = '' THEN finished_at ELSE ? END
                WHERE run_id = ?
                """,
                (
                    next_status,
                    float(body.progress),
                    (body.current_stage or "").strip(),
                    body.best_kpi,
                    (body.message or "").strip(),
                    checkpoint_path,
                    error_text,
                    now,
                    started_at,
                    finished_at,
                    finished_at,
                    run_id,
                ),
            )
            if next_status in TERMINAL_STATUSES:
                _dequeue_run(conn, run_id)

            _append_event(
                conn,
                run_id,
                event_type,
                {
                    "run_id": run_id,
                    "status": next_status,
                    "progress": float(body.progress),
                    "current_stage": (body.current_stage or "").strip(),
                    "best_kpi": body.best_kpi,
                    "message": (body.message or "").strip(),
                    "checkpoint_path": checkpoint_path,
                    "error": error_text,
                },
            )
            _dispatch_next_run_if_enabled(conn)
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise

    return SimpleAckResponse(run_id=run_id, status=next_status)


@router.post("/runs/{run_id}/artifacts", response_model=SimpleAckResponse)
def upload_artifacts(run_id: str, body: ArtifactUploadRequest):
    conn = _db()
    with _LOCK:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = _get_run_row(conn, run_id)
            if row is None:
                raise HTTPException(status_code=404, detail="run not found")

            results_path = Path(str(row["results_path"] or "")).expanduser()
            for item in body.artifacts:
                relative_path = _safe_relative_path(item.relative_path)
                if not relative_path:
                    continue
                abs_path = str((results_path / relative_path).resolve())
                created_at = (item.created_at or "").strip() or _now_iso()
                conn.execute(
                    """
                    INSERT INTO optimization_artifacts
                    (run_id, artifact_type, relative_path, abs_path, created_at, meta_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        (item.type or "").strip(),
                        relative_path,
                        abs_path,
                        created_at,
                        json.dumps(item.meta or {}, ensure_ascii=False),
                    ),
                )

            _append_event(
                conn,
                run_id,
                "run_artifacts_updated",
                {"run_id": run_id, "count": len(body.artifacts)},
            )
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise

    row = _get_run_row(_db(), run_id)
    return SimpleAckResponse(run_id=run_id, status=str(row["status"]) if row else "unknown")


@router.get("/runs/{run_id}/events", response_model=RunEventsResponse)
def list_run_events(
    run_id: str,
    after_id: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=2000),
):
    conn = _db()
    with _LOCK:
        row = _get_run_row(conn, run_id)
        if row is None:
            raise HTTPException(status_code=404, detail="run not found")
        rows = conn.execute(
            """
            SELECT id, run_id, event_type, payload_json, created_at
            FROM optimization_events
            WHERE run_id = ? AND id > ?
            ORDER BY id ASC
            LIMIT ?
            """,
            (run_id, int(after_id), int(limit)),
        ).fetchall()

    items: List[RunEventItem] = []
    next_after_id = int(after_id)
    for row in rows:
        event_id = int(row["id"])
        payload_text = str(row["payload_json"] or "{}")
        try:
            payload_obj = json.loads(payload_text)
        except Exception:
            payload_obj = {"raw": payload_text}
        items.append(
            RunEventItem(
                id=event_id,
                run_id=str(row["run_id"]),
                event_type=str(row["event_type"]),
                payload=payload_obj if isinstance(payload_obj, dict) else {"value": payload_obj},
                created_at=str(row["created_at"] or ""),
            )
        )
        next_after_id = event_id
    return RunEventsResponse(items=items, next_after_id=next_after_id)


@router.get("/runs/{run_id}/artifacts", response_model=RunArtifactsResponse)
def list_run_artifacts(run_id: str):
    conn = _db()
    with _LOCK:
        row = _get_run_row(conn, run_id)
        if row is None:
            raise HTTPException(status_code=404, detail="run not found")
        rows = conn.execute(
            """
            SELECT id, run_id, artifact_type, relative_path, abs_path, created_at, meta_json
            FROM optimization_artifacts
            WHERE run_id = ?
            ORDER BY id ASC
            """,
            (run_id,),
        ).fetchall()

    items: List[RunArtifactItem] = []
    for row in rows:
        meta_text = str(row["meta_json"] or "{}")
        try:
            meta_obj = json.loads(meta_text)
        except Exception:
            meta_obj = {"raw": meta_text}
        items.append(
            RunArtifactItem(
                id=int(row["id"]),
                run_id=str(row["run_id"]),
                artifact_type=str(row["artifact_type"] or ""),
                relative_path=str(row["relative_path"] or ""),
                abs_path=str(row["abs_path"] or ""),
                created_at=str(row["created_at"] or ""),
                meta=meta_obj if isinstance(meta_obj, dict) else {"value": meta_obj},
            )
        )
    return RunArtifactsResponse(items=items)


@router.get("/runs/{run_id}/results/index", response_model=RunResultIndexResponse)
def list_run_result_files(
    run_id: str,
    prefix: str = Query(default=""),
    contains: str = Query(default=""),
    suffix: str = Query(default=""),
    limit: int = Query(default=1000, ge=1, le=20000),
):
    conn = _db()
    with _LOCK:
        results_root = _resolve_run_results_path(conn, run_id)

    prefix_norm = _safe_relative_path(prefix).strip()
    contains_norm = str(contains or "").strip().lower()
    suffixes = [token.strip().lower() for token in str(suffix or "").split(",") if token.strip()]

    files: List[ResultFileItem] = []
    for path in results_root.rglob("*"):
        if not path.is_file():
            continue
        rel = str(path.relative_to(results_root)).replace("\\", "/")
        rel_low = rel.lower()
        if prefix_norm and not rel.startswith(prefix_norm):
            continue
        if contains_norm and contains_norm not in rel_low:
            continue
        if suffixes and not any(rel_low.endswith(suf) for suf in suffixes):
            continue
        stat = path.stat()
        modified_at = datetime.fromtimestamp(stat.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        files.append(
            ResultFileItem(
                relative_path=rel,
                abs_path=str(path.resolve()),
                size=int(stat.st_size),
                modified_at=modified_at,
            )
        )
    files.sort(key=lambda item: item.modified_at, reverse=True)
    return RunResultIndexResponse(items=files[: int(limit)])


@router.get("/runs/{run_id}/results/json", response_model=RunResultJsonResponse)
def get_run_result_json(
    run_id: str,
    relative_path: str = Query(default=""),
    tail: int = Query(default=0, ge=0, le=5000),
):
    conn = _db()
    with _LOCK:
        results_root = _resolve_run_results_path(conn, run_id)

    file_path = _resolve_relative_file(results_root, relative_path)
    suffix = file_path.suffix.lower()

    if suffix == ".json":
        text = file_path.read_text(encoding="utf-8")
        try:
            data = json.loads(text)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"invalid json file: {exc}") from exc
        return RunResultJsonResponse(
            run_id=run_id,
            relative_path=str(file_path.relative_to(results_root)).replace("\\", "/"),
            data=data,
        )

    if suffix == ".jsonl":
        lines = file_path.read_text(encoding="utf-8").splitlines()
        if tail > 0 and len(lines) > tail:
            lines = lines[-tail:]
        parsed: List[Any] = []
        for line in lines:
            if not line.strip():
                continue
            try:
                parsed.append(json.loads(line))
            except Exception:
                parsed.append({"raw": line})
        return RunResultJsonResponse(
            run_id=run_id,
            relative_path=str(file_path.relative_to(results_root)).replace("\\", "/"),
            data=parsed,
        )

    raise HTTPException(status_code=400, detail="only .json or .jsonl file is supported")


@router.post("/runs/{run_id}/complete", response_model=SimpleAckResponse)
def mark_run_completed(run_id: str, body: MarkCompletedRequest):
    hb = HeartbeatRequest(
        progress=100.0,
        current_stage="completed",
        message="marked completed",
        checkpoint_path=body.checkpoint_path,
        status="completed",
    )
    return update_run_heartbeat(run_id, hb)


@router.post("/runs/{run_id}/fail", response_model=SimpleAckResponse)
def mark_run_failed(run_id: str, body: MarkFailedRequest):
    hb = HeartbeatRequest(
        progress=0.0,
        current_stage="failed",
        message=body.error or "failed",
        status="failed",
        error=body.error or "failed",
    )
    return update_run_heartbeat(run_id, hb)


def _format_sse(event_id: int, event_name: str, data: Dict[str, Any]) -> str:
    body = json.dumps(data, ensure_ascii=False)
    return f"id: {event_id}\nevent: {event_name}\ndata: {body}\n\n"


@router.get("/events/stream")
def stream_events(last_event_id: Optional[int] = Query(default=None, ge=0)):
    start_id = int(last_event_id or 0)

    def event_generator():
        nonlocal start_id
        heartbeat_at = time.time()
        while True:
            conn = _db()
            with _LOCK:
                rows = conn.execute(
                    "SELECT id, event_type, payload_json FROM optimization_events WHERE id > ? ORDER BY id ASC LIMIT 200",
                    (start_id,),
                ).fetchall()

            if rows:
                for row in rows:
                    event_id = int(row["id"])
                    payload_text = str(row["payload_json"] or "{}")
                    try:
                        payload = json.loads(payload_text)
                    except Exception:
                        payload = {"raw": payload_text}
                    event_name = str(row["event_type"] or "message")
                    yield _format_sse(event_id, event_name, payload)
                    start_id = event_id
                    heartbeat_at = time.time()
            else:
                now = time.time()
                if now - heartbeat_at >= 15:
                    yield ": keep-alive\n\n"
                    heartbeat_at = now
                time.sleep(1.0)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
