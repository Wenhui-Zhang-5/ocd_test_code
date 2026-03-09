from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests


class HPCAPIError(RuntimeError):
    """Raised when HPC API request fails."""


@dataclass
class HPCClient:
    base_url: str
    timeout_seconds: float = 120.0

    def run_hpc(
        self,
        *,
        model_id: str,
        model_json: Dict[str, Any],
        spec_paths: List[str],
        num_of_node: Optional[List[int]] = None,
        server: str = "HPC",
    ) -> Dict[str, Any]:
        payload = {
            "model_json": model_json,
            "server": server,
            "specPath": spec_paths,
            "num_of_node": num_of_node or [1],
        }
        endpoint = f"{self.base_url.rstrip('/')}/get_result/{model_id}"
        try:
            response = requests.post(endpoint, json=payload, timeout=self.timeout_seconds)
        except requests.RequestException as exc:
            raise HPCAPIError(f"runHPC request failed: {exc}") from exc

        if response.status_code >= 400:
            raise HPCAPIError(f"runHPC failed with status={response.status_code}: {response.text[:500]}")

        try:
            data = response.json()
        except ValueError as exc:
            raise HPCAPIError("runHPC returned non-JSON body") from exc

        if not isinstance(data, dict):
            raise HPCAPIError("runHPC response must be JSON object")
        if "data" not in data:
            raise HPCAPIError("runHPC response missing 'data'")
        return data
