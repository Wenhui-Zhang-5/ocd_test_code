import csv
import json
import math
import random
import sqlite3
import statistics
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from ocd_algorithm_api.config import OCD_BACKEND_DATA_DIR, OCD_CASE_ROOT, OCD_SPECTRUM_ROOT
except Exception:  # pragma: no cover
    from config import OCD_BACKEND_DATA_DIR, OCD_CASE_ROOT, OCD_SPECTRUM_ROOT

router = APIRouter()

SPECTRUM_ROOT = OCD_SPECTRUM_ROOT
SPECTRUM_DATA_DIR = OCD_BACKEND_DATA_DIR
SPECTRUM_DB_PATH = SPECTRUM_DATA_DIR / "spectrum_objects.sqlite3"
CASE_ROOT = OCD_CASE_ROOT
TOOLS = ["TOOL-A01", "TOOL-A02", "TOOL-B01", "TOOL-C01"]
RECIPES = ["RCP-ALD-01", "RCP-ALD-02", "RCP-ETCH-03", "RCP-CMP-01"]
LOTS = ["LOT-2401", "LOT-2402", "LOT-2403", "LOT-2404", "LOT-2405"]
FAKE_LOAD_DELAY_SECONDS = 3.0


class SpectrumRecord(BaseModel):
    id: str
    time: str
    tool: str
    recipeName: str
    lotId: str
    waferId: str
    spectrumFolder: str
    spectrumIds: List[str]


class SpectrumRecordsResponse(BaseModel):
    records: List[SpectrumRecord] = Field(default_factory=list)


class SpectrumFilterOptionsResponse(BaseModel):
    tool_options: List[str] = Field(default_factory=list)
    recipe_options: List[str] = Field(default_factory=list)
    lot_options: List[str] = Field(default_factory=list)
    wafer_options: List[str] = Field(default_factory=list)


class WaferInfoInput(BaseModel):
    tool: str
    recipe: str
    lot: str = ""
    wafer: str = ""
    file_path: str = ""
    # Backward compatible aliases during migration.
    lotid: Optional[str] = None
    waferid: Optional[str] = None
    path: Optional[str] = None
    record_id: Optional[str] = None
    spectrum_ids: List[str] = Field(default_factory=list)


class SpectrumLoadRequest(BaseModel):
    measure_pos: str = "T1"
    wafer_info_list: List[WaferInfoInput] = Field(default_factory=list)
    records: List[SpectrumRecord] = Field(default_factory=list)


class SpectrumSeries(BaseModel):
    wavelength: List[float] = Field(default_factory=list)
    n: List[float] = Field(default_factory=list)
    c: List[float] = Field(default_factory=list)
    s: List[float] = Field(default_factory=list)


class SpectrumSrSeries(BaseModel):
    wavelength: List[float] = Field(default_factory=list)
    te: List[float] = Field(default_factory=list)
    tm: List[float] = Field(default_factory=list)


class LoadedSpectrum(BaseModel):
    wafer_id: str
    spectrum_id: str
    source_path: str
    meta: Dict[str, str] = Field(default_factory=dict)
    se: SpectrumSeries
    sr: SpectrumSrSeries


class SpectrumLoadResponse(BaseModel):
    spectra: List[LoadedSpectrum] = Field(default_factory=list)


class SpectrumFilePayload(BaseModel):
    filename: str
    meta_info: Dict[str, str] = Field(default_factory=dict)
    se: SpectrumSeries
    sr: SpectrumSrSeries


class PrecisionSummaryPoint(BaseModel):
    point: str
    std: float


class PrecisionSummaryRequest(BaseModel):
    measure_pos: str = "T1"
    spec_type: str = "SE"
    min_wavelength: Union[float, str, None] = "default"
    max_wavelength: Union[float, str, None] = "default"
    wafer_info_list: List[WaferInfoInput] = Field(default_factory=list)
    records: List[SpectrumRecord] = Field(default_factory=list)


class PrecisionSummaryResponse(BaseModel):
    spec_type: str
    min_wavelength: Union[float, str]
    max_wavelength: Union[float, str]
    points: List[PrecisionSummaryPoint] = Field(default_factory=list)


class PrecisionPointCurve(BaseModel):
    point_id: str
    se: SpectrumSeries
    sr: SpectrumSrSeries


class PrecisionPointPlotRequest(BaseModel):
    measure_pos: str = "T1"
    spec_type: str = "SE"
    point_ids: List[str] = Field(default_factory=list)
    wafer_info_list: List[WaferInfoInput] = Field(default_factory=list)
    records: List[SpectrumRecord] = Field(default_factory=list)


class PrecisionPointPlotResponse(BaseModel):
    spec_type: str
    points: List[PrecisionPointCurve] = Field(default_factory=list)


class CopyWaferInfo(BaseModel):
    tool: str = ""
    recipe: str = ""
    lot: str = ""
    wafer: str = ""
    file_path: str = ""
    record_id: str = ""


class SpectrumCopyRequest(BaseModel):
    model_id: str
    version: str
    spec_type: str
    fitting_measure_pos: str
    fitting_wafer_ids: List[str]
    fitting_wafer_info_list: List[CopyWaferInfo]
    precision_measure_pos: str
    precision_wafer_ids: List[str]
    precision_wafer_info_list: List[CopyWaferInfo]


class SpectrumCopyResponse(BaseModel):
    transfer_id: str
    source_server: str = "242"
    target_server: str = "58"
    target_root: str
    target_folder: str
    precision_folder: str
    copy_mode: str = "full-wafer"
    fitting_measure_pos: str
    precision_measure_pos: str
    spec_type: str
    copied_wafers: List[str] = Field(default_factory=list)
    copied_precision_wafers: List[str] = Field(default_factory=list)
    status: str = "succeeded"
    copied_at: str
    request_payload: Dict[str, Union[str, List[Dict[str, str]], List[str]]] = Field(default_factory=dict)


class StartOptimizationRequest(BaseModel):
    model_id: str
    version: str
    recipe_schema: Dict[str, Any] = Field(default_factory=dict)


class StartOptimizationResponse(BaseModel):
    ok: bool = True
    model_id: str
    version: str
    case_root: str
    recipe_json_dir: str
    schema_path: str
    model_json_path: str
    status: str = "ready"


def _normalize_iso_utc(value: str) -> str:
    txt = (value or "").strip()
    if not txt:
        return ""
    try:
        dt = datetime.fromisoformat(txt.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return txt


def _normalize_time_bound(value: str, *, is_end: bool) -> str:
    txt = (value or "").strip()
    if not txt:
        return ""
    # Accept compact date format: YYYYMMDD
    if len(txt) == 8 and txt.isdigit():
        year = int(txt[0:4])
        month = int(txt[4:6])
        day = int(txt[6:8])
        try:
            bound = datetime(year, month, day, tzinfo=timezone.utc)
            if is_end:
                bound = bound + timedelta(hours=23, minutes=59, seconds=59)
            return bound.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            return txt
    return _normalize_iso_utc(txt)


def _list_wafer_dirs(root: Path) -> List[Path]:
    if not root.exists() or not root.is_dir():
        return []
    out: List[Path] = []
    for child in sorted(root.iterdir()):
        if child.is_dir() and child.name.lower().startswith("wafer"):
            out.append(child)
    return out


def _list_spectrum_ids(wafer_dir: Path) -> List[str]:
    spectrum_dir = wafer_dir / "spectrum"
    if not spectrum_dir.exists() or not spectrum_dir.is_dir():
        return []
    return [file_path.stem for file_path in sorted(spectrum_dir.glob("*.csv"))]


def _build_fake_rows() -> List[Tuple]:
    rng = random.Random(42)
    wafer_dirs = _list_wafer_dirs(SPECTRUM_ROOT)
    now = datetime.now(timezone.utc)
    rows: List[Tuple] = []
    counter = 1

    if not wafer_dirs:
        wafer_ids = [f"WAFER-{i:04d}" for i in range(1, 501)]
        for wafer_id in wafer_ids:
            recent_time = (now - timedelta(days=rng.randint(0, 6), minutes=rng.randint(0, 1440))).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
            spectrum_ids = [f"SPEC_{i:04d}" for i in range(1, 21)]
            folder = str((SPECTRUM_ROOT / wafer_id.replace("-", "_") / "spectrum").resolve())
            rows.append(
                (
                    f"OBJ-{counter:06d}",
                    recent_time,
                    TOOLS[rng.randrange(len(TOOLS))],
                    RECIPES[rng.randrange(len(RECIPES))],
                    LOTS[rng.randrange(len(LOTS))],
                    wafer_id,
                    folder,
                    json.dumps(spectrum_ids),
                )
            )
            counter += 1
        return rows

    for wafer_dir in wafer_dirs:
        wafer_id = wafer_dir.name.replace("_", "-").upper()
        spectrum_ids = _list_spectrum_ids(wafer_dir)
        if not spectrum_ids:
            continue
        folder = str((wafer_dir / "spectrum").resolve())

        recent_dt = now - timedelta(days=rng.randint(0, 6), minutes=rng.randint(0, 1439))
        rows.append(
            (
                f"OBJ-{counter:06d}",
                recent_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                TOOLS[rng.randrange(len(TOOLS))],
                RECIPES[rng.randrange(len(RECIPES))],
                LOTS[rng.randrange(len(LOTS))],
                wafer_id,
                folder,
                json.dumps(spectrum_ids),
            )
        )
        counter += 1

        if rng.random() < 0.35:
            hist_dt = now - timedelta(days=rng.randint(8, 179), minutes=rng.randint(0, 1439))
            rows.append(
                (
                    f"OBJ-{counter:06d}",
                    hist_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    TOOLS[rng.randrange(len(TOOLS))],
                    RECIPES[rng.randrange(len(RECIPES))],
                    LOTS[rng.randrange(len(LOTS))],
                    wafer_id,
                    folder,
                    json.dumps(spectrum_ids),
                )
            )
            counter += 1

    rows.sort(key=lambda row: row[1], reverse=True)
    return rows


def _init_db() -> sqlite3.Connection:
    SPECTRUM_DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(SPECTRUM_DB_PATH), check_same_thread=False)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS spectrum_objects (
          id TEXT PRIMARY KEY,
          time TEXT NOT NULL,
          tool TEXT NOT NULL,
          recipe_name TEXT NOT NULL,
          lot_id TEXT NOT NULL,
          wafer_id TEXT NOT NULL,
          spectrum_folder TEXT NOT NULL,
          spectrum_ids_json TEXT NOT NULL
        )
        """
    )
    count = conn.execute("SELECT COUNT(1) FROM spectrum_objects").fetchone()[0]
    if count == 0:
        rows = _build_fake_rows()
        if rows:
            conn.executemany(
                """
                INSERT INTO spectrum_objects
                (id, time, tool, recipe_name, lot_id, wafer_id, spectrum_folder, spectrum_ids_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
    conn.commit()
    return conn


_DB = _init_db()


def _row_to_record(row: Tuple) -> SpectrumRecord:
    return SpectrumRecord(
        id=row[0],
        time=row[1],
        tool=row[2],
        recipeName=row[3],
        lotId=row[4],
        waferId=row[5],
        spectrumFolder=row[6],
        spectrumIds=json.loads(row[7] or "[]"),
    )


def _query_records(
    start: Optional[str],
    end: Optional[str],
    tool: Optional[str],
    recipe_name: Optional[str],
    lot_id: Optional[str],
    wafer_ids: Optional[str],
) -> List[SpectrumRecord]:
    sql = """
    SELECT id, time, tool, recipe_name, lot_id, wafer_id, spectrum_folder, spectrum_ids_json
    FROM spectrum_objects
    WHERE 1=1
    """
    args: List[str] = []

    if start:
        sql += " AND time >= ?"
        args.append(_normalize_time_bound(start, is_end=False))
    if end:
        sql += " AND time <= ?"
        args.append(_normalize_time_bound(end, is_end=True))
    if tool:
        sql += " AND tool = ?"
        args.append(tool)
    if recipe_name:
        sql += " AND recipe_name = ?"
        args.append(recipe_name)
    if lot_id:
        sql += " AND lot_id = ?"
        args.append(lot_id)
    if wafer_ids:
        wafer_list = [w.strip() for w in wafer_ids.split(",") if w.strip()]
        if wafer_list:
            placeholders = ",".join(["?"] * len(wafer_list))
            sql += f" AND wafer_id IN ({placeholders})"
            args.extend(wafer_list)

    sql += " ORDER BY time DESC"
    rows = _DB.execute(sql, args).fetchall()
    return [_row_to_record(row) for row in rows]


def _fetch_record_by_id(record_id: str) -> Optional[SpectrumRecord]:
    row = _DB.execute(
        """
        SELECT id, time, tool, recipe_name, lot_id, wafer_id, spectrum_folder, spectrum_ids_json
        FROM spectrum_objects WHERE id = ?
        """,
        (record_id,),
    ).fetchone()
    if not row:
        return None
    return _row_to_record(row)


def _fetch_record_by_fields(
    tool: str,
    recipe: str,
    lot: str,
    wafer: str,
    file_path: str,
) -> Optional[SpectrumRecord]:
    row = _DB.execute(
        """
        SELECT id, time, tool, recipe_name, lot_id, wafer_id, spectrum_folder, spectrum_ids_json
        FROM spectrum_objects
        WHERE tool = ? AND recipe_name = ? AND lot_id = ? AND wafer_id = ? AND spectrum_folder = ?
        ORDER BY time DESC
        LIMIT 1
        """,
        (tool, recipe, lot, wafer, file_path),
    ).fetchone()
    if not row:
        return None
    return _row_to_record(row)


def _parse_float(value: str) -> Optional[float]:
    try:
        return float(value)
    except Exception:
        return None


def _pick_col(headers: List[str], aliases: List[str]) -> Optional[str]:
    header_map = {h.strip().lower(): h for h in headers}
    for key in aliases:
        if key in header_map:
            return header_map[key]
    return None


def _parse_spectrum_csv(path: Path):
    meta: Dict[str, str] = {}
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    known_headers = {
        "wavelength",
        "wl",
        "lambda",
        "wlen",
        "n",
        "c",
        "s",
        "testn",
        "testc",
        "tests",
        "se_n",
        "se_c",
        "se_s",
        "te",
        "tm",
        "sr_te",
        "sr_tm",
    }

    data_start = 0
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped == "#":
            data_start = idx + 1
            break
        parts = [p.strip() for p in line.split(",")]
        lower_parts = [p.lower() for p in parts if p]
        if lower_parts and (
            lower_parts[0] in known_headers or any(token in known_headers for token in lower_parts)
        ):
            data_start = idx
            break
        if len(parts) >= 2 and not _parse_float(parts[0]):
            meta[parts[0]] = ",".join(parts[1:]).strip()
            data_start = idx + 1

    csv_block = "\n".join(lines[data_start:]).strip()
    if not csv_block:
        return meta, [], [], [], [], [], []

    reader = csv.DictReader(csv_block.splitlines())
    headers = reader.fieldnames or []

    wl_col = _pick_col(headers, ["wavelength", "wl", "lambda", "wlen"])
    n_col = _pick_col(headers, ["n", "testn", "se_n", "sen"])
    c_col = _pick_col(headers, ["c", "testc", "se_c", "sec"])
    s_col = _pick_col(headers, ["s", "tests", "se_s", "ses"])
    te_col = _pick_col(headers, ["te", "sr_te", "tm_te"])
    tm_col = _pick_col(headers, ["tm", "sr_tm", "te_tm"])

    wavelength: List[float] = []
    n_values: List[float] = []
    c_values: List[float] = []
    s_values: List[float] = []
    te_values: List[float] = []
    tm_values: List[float] = []

    for row in reader:
        if wl_col:
            wl = _parse_float(row.get(wl_col, ""))
            if wl is not None:
                wavelength.append(wl)
        if n_col:
            v = _parse_float(row.get(n_col, ""))
            if v is not None:
                n_values.append(v)
        if c_col:
            v = _parse_float(row.get(c_col, ""))
            if v is not None:
                c_values.append(v)
        if s_col:
            v = _parse_float(row.get(s_col, ""))
            if v is not None:
                s_values.append(v)
        if te_col:
            v = _parse_float(row.get(te_col, ""))
            if v is not None:
                te_values.append(v)
        if tm_col:
            v = _parse_float(row.get(tm_col, ""))
            if v is not None:
                tm_values.append(v)

    return meta, wavelength, n_values, c_values, s_values, te_values, tm_values


def _resolve_rows_from_payload(
    wafer_info_list: List[WaferInfoInput], records: List[SpectrumRecord]
) -> List[SpectrumRecord]:
    selected_rows: List[SpectrumRecord] = []
    for info in wafer_info_list:
        record = None
        if info.record_id:
            record = _fetch_record_by_id(info.record_id)
        if record is None:
            lot = (info.lot or info.lotid or "").strip()
            wafer = (info.wafer or info.waferid or "").strip()
            file_path = (info.file_path or info.path or "").strip()
            record = _fetch_record_by_fields(
                tool=info.tool,
                recipe=info.recipe,
                lot=lot,
                wafer=wafer,
                file_path=file_path,
            )
        if record is None:
            continue
        if info.spectrum_ids:
            record = SpectrumRecord(
                id=record.id,
                time=record.time,
                tool=record.tool,
                recipeName=record.recipeName,
                lotId=record.lotId,
                waferId=record.waferId,
                spectrumFolder=record.spectrumFolder,
                spectrumIds=info.spectrum_ids,
            )
        selected_rows.append(record)

    selected_rows.extend(records)
    deduped: Dict[str, SpectrumRecord] = {}
    for row in selected_rows:
        key = f"{row.id}::{row.spectrumFolder}"
        deduped[key] = row
    return list(deduped.values())


def _resolve_wavelength(value: Union[float, str, None]) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, str) and value.strip().lower() == "default":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _channel_slice(
    wavelength: List[float], values: List[float], wl_min: Optional[float], wl_max: Optional[float]
) -> List[float]:
    if not wavelength or not values:
        return []
    size = min(len(wavelength), len(values))
    out: List[float] = []
    for idx in range(size):
        wl = wavelength[idx]
        if wl_min is not None and wl < wl_min:
            continue
        if wl_max is not None and wl > wl_max:
            continue
        out.append(values[idx])
    return out


def _spectrum_feature_for_precision(
    wl: List[float],
    se_n: List[float],
    se_c: List[float],
    se_s: List[float],
    sr_te: List[float],
    sr_tm: List[float],
    spec_type: str,
    wl_min: Optional[float],
    wl_max: Optional[float],
) -> Optional[float]:
    mode = (spec_type or "SE").upper()
    channels: List[List[float]] = []
    if mode == "SR":
        channels.extend(
            [
                _channel_slice(wl, sr_te, wl_min, wl_max),
                _channel_slice(wl, sr_tm, wl_min, wl_max),
            ]
        )
    elif mode == "COMBINE":
        channels.extend(
            [
                _channel_slice(wl, se_n, wl_min, wl_max),
                _channel_slice(wl, se_c, wl_min, wl_max),
                _channel_slice(wl, se_s, wl_min, wl_max),
                _channel_slice(wl, sr_te, wl_min, wl_max),
                _channel_slice(wl, sr_tm, wl_min, wl_max),
            ]
        )
    else:
        channels.extend(
            [
                _channel_slice(wl, se_n, wl_min, wl_max),
                _channel_slice(wl, se_c, wl_min, wl_max),
                _channel_slice(wl, se_s, wl_min, wl_max),
            ]
        )

    valid = [series for series in channels if len(series) >= 2]
    if not valid:
        return None

    channel_stds = []
    for series in valid:
        try:
            channel_stds.append(statistics.pstdev(series))
        except Exception:
            continue
    if not channel_stds:
        return None
    return sum(channel_stds) / len(channel_stds)


def _transform_series(
    series: List[float], *, rng: random.Random, scale: float, wobble: float, noise: float
) -> List[float]:
    if not series:
        return []
    length = max(1, len(series) - 1)
    out: List[float] = []
    for idx, value in enumerate(series):
        phase = (idx / length) * math.pi * 2
        v = value * scale + (wobble * math.sin(phase)) + ((rng.random() - 0.5) * noise)
        out.append(round(v, 6))
    return out


def _build_precision_point_curves(
    rows: List[SpectrumRecord], point_ids: List[str], spec_type: str
) -> List[PrecisionPointCurve]:
    source_bank = []
    for row in rows:
        folder = Path(row.spectrumFolder)
        for spectrum_id in row.spectrumIds:
            file_path = folder / f"{spectrum_id}.csv"
            if not file_path.exists() or not file_path.is_file():
                continue
            _, wl, n_vals, c_vals, s_vals, te_vals, tm_vals = _parse_spectrum_csv(file_path)
            if not wl:
                continue
            source_bank.append(
                {
                    "wl": wl,
                    "n": n_vals,
                    "c": c_vals,
                    "s": s_vals,
                    "te": te_vals,
                    "tm": tm_vals,
                }
            )
    if not source_bank:
        return []

    out: List[PrecisionPointCurve] = []
    for idx, point_id in enumerate(point_ids):
        seeded = random.Random(f"{spec_type}:{point_id}:{idx}")
        source = source_bank[seeded.randrange(len(source_bank))]
        rank = idx + 1
        scale = 0.985 + rank * 0.004
        wobble = 0.002 + rank * 0.0003
        noise = 0.0015 + rank * 0.00015
        wl = source["wl"]

        out.append(
            PrecisionPointCurve(
                point_id=point_id,
                se=SpectrumSeries(
                    wavelength=wl,
                    n=_transform_series(source["n"], rng=seeded, scale=scale, wobble=wobble, noise=noise),
                    c=_transform_series(
                        source["c"], rng=seeded, scale=scale * 0.998, wobble=wobble * 0.95, noise=noise
                    ),
                    s=_transform_series(
                        source["s"], rng=seeded, scale=scale * 1.002, wobble=wobble * 1.05, noise=noise
                    ),
                ),
                sr=SpectrumSrSeries(
                    wavelength=wl if source["te"] or source["tm"] else [],
                    te=_transform_series(
                        source["te"], rng=seeded, scale=scale * 0.997, wobble=wobble * 0.9, noise=noise
                    ),
                    tm=_transform_series(
                        source["tm"], rng=seeded, scale=scale * 1.003, wobble=wobble * 1.1, noise=noise
                    ),
                ),
            )
        )
    return out


@router.get("/spectrum/records", response_model=SpectrumRecordsResponse)
def list_spectrum_records(
    start: Optional[str] = None,
    end: Optional[str] = None,
    tool: Optional[str] = None,
    recipe_name: Optional[str] = None,
    lot_id: Optional[str] = None,
    wafer_ids: Optional[str] = None,
):
    records = _query_records(start, end, tool, recipe_name, lot_id, wafer_ids)
    return SpectrumRecordsResponse(records=records)


@router.get("/spectrum/filter-options", response_model=SpectrumFilterOptionsResponse)
def list_spectrum_filter_options(
    start: Optional[str] = None,
    end: Optional[str] = None,
    tool: Optional[str] = None,
    recipe: Optional[str] = None,
    lot: Optional[str] = None,
):
    records = _query_records(start, end, None, None, None, None)

    tool_options = sorted({row.tool for row in records if row.tool})
    recipe_options = sorted(
        {
            row.recipeName
            for row in records
            if row.recipeName and (not tool or row.tool == tool)
        }
    )
    lot_options = sorted(
        {
            row.lotId
            for row in records
            if row.lotId
            and (not tool or row.tool == tool)
            and (not recipe or row.recipeName == recipe)
        }
    )
    wafer_options = sorted(
        {
            row.waferId
            for row in records
            if row.waferId
            and (not tool or row.tool == tool)
            and (not recipe or row.recipeName == recipe)
            and (not lot or row.lotId == lot)
        }
    )

    return SpectrumFilterOptionsResponse(
        tool_options=tool_options,
        recipe_options=recipe_options,
        lot_options=lot_options,
        wafer_options=wafer_options,
    )


@router.post("/spectrum/get_spectra", response_model=Dict[str, Dict[str, SpectrumFilePayload]])
@router.post("/spectrum/load", response_model=Dict[str, Dict[str, SpectrumFilePayload]])
def load_spectrum_payload(payload: SpectrumLoadRequest):
    # Dev-only throttle to make frontend cache-hit/miss behavior visible in testing.
    if FAKE_LOAD_DELAY_SECONDS > 0:
        time.sleep(FAKE_LOAD_DELAY_SECONDS)

    selected_rows = _resolve_rows_from_payload(payload.wafer_info_list, payload.records)

    out: Dict[str, Dict[str, SpectrumFilePayload]] = {}
    for row in selected_rows:
        folder = Path(row.spectrumFolder)
        for spectrum_id in row.spectrumIds:
            file_path = folder / f"{spectrum_id}.csv"
            if not file_path.exists() or not file_path.is_file():
                continue
            meta, wl, n_vals, c_vals, s_vals, te_vals, tm_vals = _parse_spectrum_csv(file_path)
            if payload.measure_pos:
                meta.setdefault("measure_pos", payload.measure_pos)
            if row.waferId not in out:
                out[row.waferId] = {}
            out[row.waferId][spectrum_id] = SpectrumFilePayload(
                filename=file_path.name,
                meta_info=meta,
                se=SpectrumSeries(wavelength=wl, n=n_vals, c=c_vals, s=s_vals),
                sr=SpectrumSrSeries(wavelength=wl if te_vals or tm_vals else [], te=te_vals, tm=tm_vals),
            )
    return out


@router.post("/spectrum/precision-summary", response_model=PrecisionSummaryResponse)
def calculate_precision_summary(payload: PrecisionSummaryRequest):
    rows = _resolve_rows_from_payload(payload.wafer_info_list, payload.records)
    wl_min = _resolve_wavelength(payload.min_wavelength)
    wl_max = _resolve_wavelength(payload.max_wavelength)
    spec_type = (payload.spec_type or "SE").upper()

    feature_values: List[float] = []
    for row in rows:
        folder = Path(row.spectrumFolder)
        for spectrum_id in row.spectrumIds:
            file_path = folder / f"{spectrum_id}.csv"
            if not file_path.exists() or not file_path.is_file():
                continue
            _, wl, n_vals, c_vals, s_vals, te_vals, tm_vals = _parse_spectrum_csv(file_path)
            feature = _spectrum_feature_for_precision(
                wl=wl,
                se_n=n_vals,
                se_c=c_vals,
                se_s=s_vals,
                sr_te=te_vals,
                sr_tm=tm_vals,
                spec_type=spec_type,
                wl_min=wl_min,
                wl_max=wl_max,
            )
            if feature is not None:
                feature_values.append(feature)

    if len(feature_values) >= 2:
        base_std = statistics.pstdev(feature_values)
    else:
        base_std = 0.08

    seed_text = f"{spec_type}:{wl_min}:{wl_max}:{len(feature_values)}"
    rng = random.Random(seed_text)
    points: List[PrecisionSummaryPoint] = []
    for idx in range(17):
        scale = 1.0 + idx * 0.045
        jitter = 0.95 + rng.random() * 0.12
        std_val = max(0.01, min(0.99, base_std * scale * jitter))
        points.append(PrecisionSummaryPoint(point=f"P-{idx + 1:02d}", std=round(std_val, 4)))

    return PrecisionSummaryResponse(
        spec_type=spec_type,
        min_wavelength=payload.min_wavelength if payload.min_wavelength is not None else "default",
        max_wavelength=payload.max_wavelength if payload.max_wavelength is not None else "default",
        points=points,
    )


@router.post("/spectrum/precision-point-plot", response_model=PrecisionPointPlotResponse)
def load_precision_point_plot(payload: PrecisionPointPlotRequest):
    rows = _resolve_rows_from_payload(payload.wafer_info_list, payload.records)
    points = payload.point_ids or []
    if not points:
        return PrecisionPointPlotResponse(spec_type=(payload.spec_type or "SE").upper(), points=[])
    curves = _build_precision_point_curves(rows, points, payload.spec_type or "SE")
    return PrecisionPointPlotResponse(spec_type=(payload.spec_type or "SE").upper(), points=curves)


@router.post("/spectrum/move-to-58", response_model=SpectrumCopyResponse)
@router.post("/spectrum/copy-to-58", response_model=SpectrumCopyResponse)
def copy_spectrum_to_58(payload: SpectrumCopyRequest):
    model_id = (payload.model_id or "").strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")

    spec_type = (payload.spec_type or "SE").strip().upper()
    if spec_type not in {"SE", "SR", "COMBINE"}:
        raise HTTPException(status_code=400, detail="spec_type must be SE/SR/Combine")

    copied_wafers = sorted({w.strip() for w in payload.fitting_wafer_ids if w and w.strip()})
    copied_precision_wafers = sorted(
        {w.strip() for w in payload.precision_wafer_ids if w and w.strip()}
    )

    if not copied_wafers:
        raise HTTPException(status_code=400, detail="No fitting wafer selected")
    if not copied_precision_wafers:
        raise HTTPException(status_code=400, detail="No precision wafer selected")

    if not payload.fitting_wafer_info_list:
        raise HTTPException(status_code=400, detail="fitting_wafer_info_list is required")
    if not payload.precision_wafer_info_list:
        raise HTTPException(status_code=400, detail="precision_wafer_info_list is required")

    safe_model = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in model_id)
    safe_version = "".join(
        ch if ch.isalnum() or ch in {"_", "-", "."} else "_" for ch in (payload.version or "v0")
    )
    case_dir = CASE_ROOT / f"model_{safe_model}" / f"version_{safe_version}"
    data_dir = case_dir / "data"
    fitting_dir = data_dir / "fitting"
    precision_dir = data_dir / "precision"
    recipe_json_dir = case_dir / "recipe_json"
    results_dir = case_dir / "results"
    for folder in [data_dir, fitting_dir, precision_dir, recipe_json_dir, results_dir]:
        folder.mkdir(parents=True, exist_ok=True)

    target_root = str(CASE_ROOT)
    target_folder = str(data_dir.relative_to(CASE_ROOT))
    precision_folder = str(precision_dir.relative_to(CASE_ROOT))

    request_payload = {
        "model_id": model_id,
        "version": payload.version or "v0",
        "spec_type": spec_type,
        "fitting_measure_pos": payload.fitting_measure_pos or "T1",
        "fitting_wafer_ids": copied_wafers,
        "fitting_wafer_info_list": [item.model_dump() for item in payload.fitting_wafer_info_list],
        "precision_measure_pos": payload.precision_measure_pos or "T1",
        "precision_wafer_ids": copied_precision_wafers,
        "precision_wafer_info_list": [item.model_dump() for item in payload.precision_wafer_info_list],
    }

    return SpectrumCopyResponse(
        transfer_id=f"XFER-{int(time.time() * 1000)}",
        source_server="242",
        target_server="58",
        target_root=target_root,
        target_folder=target_folder,
        precision_folder=precision_folder,
        copy_mode="full-wafer",
        fitting_measure_pos=request_payload["fitting_measure_pos"],
        precision_measure_pos=request_payload["precision_measure_pos"],
        spec_type=spec_type,
        copied_wafers=copied_wafers,
        copied_precision_wafers=copied_precision_wafers,
        status="succeeded",
        copied_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        request_payload=request_payload,
    )


@router.post("/spectrum/start-optimization", response_model=StartOptimizationResponse)
def start_optimization(payload: StartOptimizationRequest):
    model_id = (payload.model_id or "").strip()
    version = (payload.version or "").strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")
    if not version:
        raise HTTPException(status_code=400, detail="version is required")
    if not isinstance(payload.recipe_schema, dict) or not payload.recipe_schema:
        raise HTTPException(status_code=400, detail="recipe_schema is required")

    safe_model = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in model_id)
    safe_version = "".join(ch if ch.isalnum() or ch in {"_", "-", "."} else "_" for ch in version)
    case_dir = CASE_ROOT / f"model_{safe_model}" / f"version_{safe_version}"
    recipe_json_dir = case_dir / "recipe_json"
    results_dir = case_dir / "results"
    recipe_json_dir.mkdir(parents=True, exist_ok=True)
    results_dir.mkdir(parents=True, exist_ok=True)

    schema_path = recipe_json_dir / "recipe_schema.json"
    model_json_path = recipe_json_dir / "model_json.json"

    schema_path.write_text(
        json.dumps(payload.recipe_schema, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    model_json = payload.recipe_schema.get("model", {}).get("modelJson")
    if isinstance(model_json, dict):
        model_json_path.write_text(json.dumps(model_json, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        model_json_path.write_text("{}", encoding="utf-8")

    return StartOptimizationResponse(
        ok=True,
        model_id=model_id,
        version=version,
        case_root=str(case_dir),
        recipe_json_dir=str(recipe_json_dir),
        schema_path=str(schema_path),
        model_json_path=str(model_json_path),
        status="ready",
    )
