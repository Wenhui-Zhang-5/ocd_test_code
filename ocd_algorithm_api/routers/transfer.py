import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _to_csv_name(value: str) -> str:
    if value.endswith(".csv"):
        return value
    return f"{value}.csv"


def _safe_token(value: str) -> str:
    chars = []
    for ch in value:
        if ch.isalnum() or ch in {"_", "-", "."}:
            chars.append(ch)
        else:
            chars.append("_")
    return "".join(chars)


def _wafer_folder_candidates(wafer_id: str) -> List[str]:
    base = [wafer_id, wafer_id.replace("-", "_"), wafer_id.replace("_", "-")]
    seen = set()
    out = []
    for item in base + [item.upper() for item in base] + [item.lower() for item in base]:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _resolve_source_spectrum_dir(source_root: Path, wafer_id: str) -> Optional[Path]:
    for candidate in _wafer_folder_candidates(wafer_id):
        wafer_root = source_root / candidate
        if not wafer_root.exists() or not wafer_root.is_dir():
            continue
        spectrum_dir = wafer_root / "spectrum"
        if spectrum_dir.exists() and spectrum_dir.is_dir():
            return spectrum_dir
        return wafer_root
    return None


class TransferSpectrumItem(BaseModel):
    wafer_id: str
    spectrum_csv: str


class TransferJobCreateRequest(BaseModel):
    model_id: str
    version: str
    wafer_ids: List[str] = Field(default_factory=list)
    source_root: str = Field(
        ...,
        description="Object-storage mounted root on server 242, e.g. /data/ocd_object_store",
    )
    target_root: str = Field(
        default="/data/ocd_spectra",
        description="Target root on server 58 mount",
    )
    precision_spectra: List[TransferSpectrumItem] = Field(default_factory=list)
    retries: int = Field(default=2, ge=0, le=10)


class TransferJobCreateResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "succeeded", "partial_failed", "failed"]


class TransferJobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "succeeded", "partial_failed", "failed"]
    model_id: str
    version: str
    source_root: str
    target_root: str
    target_folder: Optional[str] = None
    precision_folder: Optional[str] = None
    copied_wafers: List[str] = Field(default_factory=list)
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    total_files: int = 0
    copied_files: int = 0
    failed_files: int = 0
    retries: int = 0
    error: Optional[str] = None


class TransferJobLogsResponse(BaseModel):
    job_id: str
    logs: List[dict]


_JOBS: Dict[str, dict] = {}
_LOGS: Dict[str, List[dict]] = {}
_LOCK = threading.Lock()


def _append_log(job_id: str, level: str, message: str, **extra) -> None:
    row = {"time": _now_iso(), "level": level, "message": message, **extra}
    with _LOCK:
        _LOGS.setdefault(job_id, []).append(row)


def _set_job(job_id: str, **kwargs) -> None:
    with _LOCK:
        _JOBS[job_id].update(kwargs)


def _collect_full_wafer_tasks(job_id: str, source_root: Path, target_folder: Path, wafer_ids: List[str]):
    tasks = []
    precheck_failed = 0
    for wafer_id in sorted(set(wafer_ids)):
        src_dir = _resolve_source_spectrum_dir(source_root, wafer_id)
        if src_dir is None:
            precheck_failed += 1
            _append_log(job_id, "error", "Wafer folder not found", wafer_id=wafer_id)
            continue
        csv_files = sorted(src_dir.glob("*.csv"))
        if not csv_files:
            precheck_failed += 1
            _append_log(job_id, "error", "No csv files under wafer folder", wafer_id=wafer_id, source=str(src_dir))
            continue
        for src_file in csv_files:
            dst_file = target_folder / wafer_id / src_file.name
            tasks.append({"source": src_file, "target": dst_file, "kind": "wafer", "wafer_id": wafer_id})
    return tasks, precheck_failed


def _collect_precision_tasks(
    job_id: str,
    source_root: Path,
    precision_folder: Path,
    precision_spectra: List[dict],
):
    tasks = []
    precheck_failed = 0
    for item in precision_spectra:
        wafer_id = item["wafer_id"]
        src_dir = _resolve_source_spectrum_dir(source_root, wafer_id)
        if src_dir is None:
            precheck_failed += 1
            _append_log(job_id, "error", "Precision wafer folder not found", wafer_id=wafer_id)
            continue
        file_name = _to_csv_name(item["spectrum_csv"])
        src_file = src_dir / file_name
        if not src_file.exists():
            precheck_failed += 1
            _append_log(
                job_id,
                "error",
                "Precision spectrum file not found",
                wafer_id=wafer_id,
                spectrum_csv=file_name,
            )
            continue
        dst_file = precision_folder / wafer_id / file_name
        tasks.append({"source": src_file, "target": dst_file, "kind": "precision", "wafer_id": wafer_id})
    return tasks, precheck_failed


def _copy_file_with_retry(job_id: str, source: Path, target: Path, retries: int) -> bool:
    target.parent.mkdir(parents=True, exist_ok=True)
    last_error = None
    for attempt in range(retries + 1):
        try:
            # Copy raw bytes to preserve exact CSV content.
            with source.open("rb") as src_fp, target.open("wb") as dst_fp:
                shutil.copyfileobj(src_fp, dst_fp)
            _append_log(
                job_id,
                "info",
                "File copied",
                source=str(source),
                target=str(target),
                bytes=source.stat().st_size,
                attempt=attempt + 1,
            )
            return True
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            _append_log(
                job_id,
                "warn",
                "Copy failed, retrying",
                source=str(source),
                target=str(target),
                attempt=attempt + 1,
                error=last_error,
            )
    _append_log(
        job_id,
        "error",
        "Copy failed after retries",
        source=str(source),
        target=str(target),
        error=last_error,
    )
    return False


def _run_transfer_job(job_id: str, payload: dict) -> None:
    try:
        _set_job(job_id, status="running", started_at=_now_iso())
        source_root = Path(payload["source_root"])
        target_root = Path(payload["target_root"])
        model_id = payload["model_id"]
        version = payload["version"]
        retries = int(payload.get("retries", 2))

        safe_model = _safe_token(model_id)
        safe_version = _safe_token(version)
        folder_name = f"model_id_{safe_model}_version_{safe_version}"
        target_folder = target_root / folder_name
        precision_folder = target_folder / "precision"

        wafer_ids = payload.get("wafer_ids", [])
        precision_spectra = payload.get("precision_spectra", [])

        full_tasks, full_failed = _collect_full_wafer_tasks(job_id, source_root, target_folder, wafer_ids)
        precision_tasks, precision_failed = _collect_precision_tasks(
            job_id, source_root, precision_folder, precision_spectra
        )
        tasks = full_tasks + precision_tasks
        failed_files = full_failed + precision_failed

        _set_job(
            job_id,
            target_folder=str(target_folder),
            precision_folder=str(precision_folder),
            copied_wafers=sorted(set(wafer_ids)),
            total_files=len(tasks),
            failed_files=failed_files,
        )

        copied_files = 0
        for task in tasks:
            ok = _copy_file_with_retry(job_id, task["source"], task["target"], retries)
            if ok:
                copied_files += 1
                _set_job(job_id, copied_files=copied_files)
            else:
                failed_files += 1
                _set_job(job_id, failed_files=failed_files)

        if failed_files == 0:
            final_status = "succeeded"
        elif copied_files > 0:
            final_status = "partial_failed"
        else:
            final_status = "failed"
        _set_job(job_id, status=final_status, finished_at=_now_iso(), copied_files=copied_files, failed_files=failed_files)
        _append_log(job_id, "info", "Job finished", status=final_status, copied_files=copied_files, failed_files=failed_files)
    except Exception as exc:  # noqa: BLE001
        _set_job(job_id, status="failed", finished_at=_now_iso(), error=str(exc))
        _append_log(job_id, "error", "Job crashed", error=str(exc))


@router.post("/transfer/jobs", response_model=TransferJobCreateResponse)
def create_transfer_job(payload: TransferJobCreateRequest, background_tasks: BackgroundTasks):
    source_root = Path(payload.source_root)
    if not source_root.exists() or not source_root.is_dir():
        raise HTTPException(status_code=400, detail=f"source_root not found: {payload.source_root}")

    job_id = f"JOB-{uuid.uuid4().hex[:12]}"
    job = {
        "job_id": job_id,
        "status": "queued",
        "model_id": payload.model_id,
        "version": payload.version,
        "source_root": payload.source_root,
        "target_root": payload.target_root,
        "target_folder": None,
        "precision_folder": None,
        "copied_wafers": [],
        "created_at": _now_iso(),
        "started_at": None,
        "finished_at": None,
        "total_files": 0,
        "copied_files": 0,
        "failed_files": 0,
        "retries": payload.retries,
        "error": None,
    }
    with _LOCK:
        _JOBS[job_id] = job
        _LOGS[job_id] = []
    _append_log(job_id, "info", "Job queued")
    background_tasks.add_task(_run_transfer_job, job_id, payload.model_dump())
    return TransferJobCreateResponse(job_id=job_id, status="queued")


@router.get("/transfer/jobs/{job_id}", response_model=TransferJobStatusResponse)
def get_transfer_job(job_id: str):
    with _LOCK:
        job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return TransferJobStatusResponse(**job)


@router.get("/transfer/jobs/{job_id}/logs", response_model=TransferJobLogsResponse)
def get_transfer_job_logs(job_id: str):
    with _LOCK:
        logs = _LOGS.get(job_id)
    if logs is None:
        raise HTTPException(status_code=404, detail="job not found")
    return TransferJobLogsResponse(job_id=job_id, logs=logs)
