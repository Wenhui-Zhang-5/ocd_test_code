from __future__ import annotations

from dataclasses import dataclass
from io import StringIO
from typing import Any, Dict

import pandas as pd
import requests


class SpectrumAPIError(RuntimeError):
    """Raised when spectrum API request fails."""


@dataclass
class SpectrumClient:
    base_url: str
    timeout_seconds: float = 120.0

    def get_spectrum(
        self,
        *,
        model_id: str,
        model_json: Dict[str, Any],
        server: str = "HPC",
    ) -> pd.DataFrame:
        endpoint = f"{self.base_url.rstrip('/')}/getSpectrum/{model_id}"
        payload: Dict[str, Any] = {"model_json": model_json, "server": server}

        try:
            response = requests.post(endpoint, json=payload, timeout=self.timeout_seconds)
        except requests.RequestException as exc:
            raise SpectrumAPIError(f"getSpectrum request failed: {exc}") from exc

        if response.status_code >= 400:
            raise SpectrumAPIError(f"getSpectrum failed with status={response.status_code}: {response.text[:500]}")

        try:
            return pd.read_csv(StringIO(response.text))
        except Exception as exc:  # noqa: BLE001
            raise SpectrumAPIError(f"failed to parse spectrum csv: {exc}") from exc
