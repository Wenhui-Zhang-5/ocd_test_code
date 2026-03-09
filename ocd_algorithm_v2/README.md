# OCD Algorithm API

FastAPI microservice for algorithm endpoints (outlier detection, etc.).

## Run
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn api_server:app --reload --port 8001
```

### Run With `.env`
You can copy `.env.example` to `.env` and run:
```bash
uvicorn api_server:app --reload --port 8001 --env-file .env
```

Path-related env vars:
- `OCD_FRONTEND_DIR`
- `OCD_BACKEND_DATA_DIR`
- `OCD_SPECTRUM_ROOT`
- `OCD_NK_LIBRARY_DIR`
- `OCD_CASE_ROOT`

## Endpoint
`POST /api/outlier-detect`
`GET /api/nk/index`
`GET /api/nk/libraries`
`GET /api/nk/materials?library=...`
`GET /api/nk/models?library=...&material=...`
`POST /api/nk/curve`
`POST /api/transfer/jobs`
`GET /api/transfer/jobs/{job_id}`
`GET /api/transfer/jobs/{job_id}/logs`
`POST /api/optimization/runs`
`GET /api/optimization/runs`
`GET /api/optimization/runs/{run_id}`
`POST /api/optimization/runs/{run_id}/pause`
`POST /api/optimization/runs/{run_id}/resume`
`POST /api/optimization/runs/{run_id}/cancel`
`POST /api/optimization/runs/{run_id}/heartbeat`
`POST /api/optimization/runs/{run_id}/artifacts`
`GET /api/optimization/queue`
`POST /api/optimization/queue/reorder`
`GET /api/optimization/events/stream`
`GET /api/spectrum/records`
`POST /api/spectrum/load`

Request example:
```json
{
  "threshold": 2.5,
  "spectra": [
    {
      "wafer_id": "WAFER_0001",
      "spectrum_id": "SPEC_0001",
      "n": [1.0, 1.1, 1.05],
      "c": [0.2, 0.21, 0.19],
      "s": [0.05, 0.055, 0.052]
    }
  ]
}
```

Response:
```json
{
  "outliers": [
    { "wafer_id": "WAFER_0001", "spectrum_id": "SPEC_0007", "score": 2.83 }
  ],
  "threshold": 2.5,
  "total": 120
}
```

Notes:
- The algorithm groups spectra by `wafer_id` and computes robust z-scores of RMSE from the per-wafer median curve.
- By default, `n`, `c`, and `s` channels are used when available.
- Methods supported: `zscore` (default), `isolation_forest`, `lof`.

## Transfer Service

Create transfer job example:

```bash
curl -X POST http://localhost:8001/api/transfer/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "model_id":"MODEL_122345",
    "version":"v1.0",
    "wafer_ids":["WAFER-0001","WAFER-0042"],
    "source_root":"/Users/wenhuizhang/Projects/Gradio/ocd_master/spectrum_data",
    "target_root":"/tmp/ocd_spectra_58",
    "precision_spectra":[{"wafer_id":"WAFER-0001","spectrum_csv":"SPEC_0004.csv"}],
    "retries":2
  }'
```

Then poll:

```bash
curl http://localhost:8001/api/transfer/jobs/<job_id>
curl http://localhost:8001/api/transfer/jobs/<job_id>/logs
```

## Spectrum Object Records Persistence

- Spectrum object records are now stored in a file-based SQLite DB:
  - `ocd_algorithm_api/data/spectrum_objects.sqlite3`
- On first startup (or when DB is empty), fake records are generated and inserted once.
- On subsequent restarts, API reads the same saved records and does not regenerate.
- If you want a new fake dataset, delete the DB file and restart API.
