from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Tuple


@dataclass
class HPCRecord:
    index: int
    basis_values: Dict[str, float]
    gof: float
    residual: float
    correlation: float
    lbh: float
    raw: Dict[str, Any]


@dataclass
class HPCParsedResult:
    mats: List[Dict[str, Any]]
    records: List[HPCRecord]


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _field_aliases(headers: List[str]) -> Dict[str, str]:
    normalized = {str(h).strip().lower(): str(h) for h in headers}

    def pick(*keys: str) -> str:
        for key in keys:
            if key in normalized:
                return normalized[key]
        return ""

    return {
        "gof": pick("gof", "goodness_of_fit"),
        "residual": pick("residual", "res", "rmse"),
        "correlation": pick("correlation", "corr"),
        "lbh": pick("lbh"),
    }


def parse_hpc_result(result: Mapping[str, Any]) -> HPCParsedResult:
    mats = result.get("mat") if isinstance(result.get("mat"), list) else []
    data = result.get("data")
    if not isinstance(data, list) or not data:
        return HPCParsedResult(mats=[m for m in mats if isinstance(m, dict)], records=[])

    headers = [str(h) for h in data[0]]
    aliases = _field_aliases(headers)
    metric_headers = {v for v in aliases.values() if v}
    basis_headers = [h for h in headers if h not in metric_headers]

    records: List[HPCRecord] = []
    for idx, row in enumerate(data[1:]):
        if not isinstance(row, list):
            continue
        row_map = {headers[i]: row[i] for i in range(min(len(headers), len(row)))}
        basis_values = {name: _to_float(row_map.get(name)) for name in basis_headers}
        records.append(
            HPCRecord(
                index=idx,
                basis_values=basis_values,
                gof=_to_float(row_map.get(aliases["gof"]), default=0.0),
                residual=_to_float(row_map.get(aliases["residual"]), default=1e9),
                correlation=_to_float(row_map.get(aliases["correlation"]), default=0.0),
                lbh=_to_float(row_map.get(aliases["lbh"]), default=0.0),
                raw=row_map,
            )
        )

    filtered_mats = [item for item in mats if isinstance(item, dict)]
    return HPCParsedResult(mats=filtered_mats, records=records)


def record_score(record: HPCRecord) -> float:
    # Higher is better.
    return record.gof * 1000.0 + record.correlation * 100.0 - record.residual * 10.0 - record.lbh


def best_record(parsed: HPCParsedResult) -> Optional[Tuple[HPCRecord, Optional[Dict[str, Any]]]]:
    if not parsed.records:
        return None
    top = max(parsed.records, key=record_score)
    best_mat: Optional[Dict[str, Any]] = None
    if parsed.mats and 0 <= top.index < len(parsed.mats):
        best_mat = parsed.mats[top.index]
    return top, best_mat
