# OCD Project Architecture (2026-03)

## 1. Overall Topology

This project is split into three main parts:

1. `ocd_master` (frontend, React + Vite)
2. `ocd_algorithm_api` (backend, FastAPI)
3. `ocd_master_58` (case data and run results filesystem root)

At runtime, frontend calls backend HTTP APIs; backend reads/writes case files under `ocd_master_58` and optional SQLite metadata under `ocd_algorithm_api/data`.

## 2. Repo Layout

- `ocd_master/`
  - `src/` UI pages, components, data adapters
  - `docs/` product and implementation docs
- `ocd_algorithm_api/`
  - `api_server.py` FastAPI entrypoint
  - `routers/` REST route modules
  - `ocd_auto_opt/` optimization engine package
  - `config.py` environment/path configuration
  - `data/` backend-local sqlite/cache
- `ocd_master_58/`
  - `model_{id}/version_{ver}/recipe_json/*.json`
  - `model_{id}/version_{ver}/data/...`
  - `model_{id}/version_{ver}/Results/...`

## 3. Frontend Architecture (`ocd_master`)

### 3.1 App shell and routing

- Entry: `src/main.jsx`
- Main route composition: `src/app.jsx`
- Route metadata (nav + breadcrumb): `src/data/routes.js`

Routing style is hash-based with workspace-scoped pages:
- Spectrum Analysis
- Pre-Recipe
- Recipe Build
- Run Monitor
- Results

### 3.2 Frontend data access layers

- `src/data/mockApi.js`
  - workspace/read-write mock and local state behaviors
- `src/data/optimizationApi.js`
  - real optimization API adapter (`/api/optimization/...`)
  - SSE subscription (`/api/optimization/events/stream`)
- `src/data/optimizationView.js`
  - view-specific transformations (ranking rows from result files)

### 3.3 Run Monitor rendering pipeline

- Trace page: `src/pages/workspace/run_monitor/Trace.jsx`
  - reads result file index + JSON snapshots/events
  - stage tabs: `seed_search / fitting / precision / sensitivity / final_regression`
- Ranking page: `src/pages/workspace/run_monitor/Ranking.jsx`
  - builds ranking from `final_regression/*.summary.json`
  - displays spectrum/regression/NK charts

## 4. Backend Architecture (`ocd_algorithm_api`)

### 4.1 API server and routers

- Entry: `api_server.py`
- Routers:
  - `routers/spectrum.py`
  - `routers/optimization.py`
  - `routers/mock_hpc.py`
  - `routers/nk_library.py`
  - `routers/model.py`
  - `routers/transfer.py`
  - `routers/workspace_cache.py`
  - `routers/recipe_hub.py`
  - `routers/outlier.py`

### 4.2 Core path/config

From `config.py`:
- `OCD_CASE_ROOT` default -> `<project>/ocd_master_58`
- `OCD_BACKEND_DATA_DIR` default -> `ocd_algorithm_api/data`
- `OCD_SPECTRUM_ROOT` default -> `ocd_master/spectrum_data`
- `OCD_NK_LIBRARY_DIR` default -> `<project>/nk_library`

### 4.3 Optimization queue subsystem

Module: `routers/optimization.py`

Persistence (SQLite):
- DB file: `ocd_algorithm_api/data/optimization_queue.sqlite3`
- tables:
  - `optimization_runs`
  - `optimization_queue`
  - `optimization_events`
  - `optimization_artifacts`

Capabilities:
- create/list/get run
- pause/resume/cancel
- queue reorder
- heartbeat and artifact upsert
- event stream (SSE)
- result file index and JSON fetch

### 4.4 Compatibility entrypoint

`POST /api/spectrum/start-optimization` in `routers/spectrum.py`:
- writes `recipe_schema.json` and `model_json.json` to case folder
- internally calls `create_run_internal(...)`
- returns `run_id`, `queue_position`, and `results_dir`

## 5. Optimization Engine Package (`ocd_auto_opt`)

### 5.1 Internal layering

- `api/`
  - `run_hpc.py`: wrapper for `/get_result/{model_id}`
  - `get_spectrum.py`: wrapper for `/getSpectrum/{model_id}`
- `core/`
  - `coupling.py`
  - `seed_search.py`
  - `fitting.py`
  - `precision_check.py`
  - `sensitivity.py`
  - `final_regression.py`
  - `regression.py`
- `utils/`
  - `model_utils.py`
  - `spectrum_utils.py`
  - `parse_hpc_result.py`
- `pipeline/optimizer.py`
  - orchestrator (`OCDOptimizer`) and `run_case_pipeline`

### 5.2 Orchestration pattern

`optimizer.run()` orchestrates in order:
1. path/config parse
2. coupling loop
3. seed search
4. fitting
5. precision check
6. sensitivity
7. final regression (per grid)
8. collect solutions and stop by `top_n`

## 6. Runtime Data Contract and Filesystem

### 6.1 Case folder structure

Per model-version:
- `recipe_json/recipe_schema.json`
- `recipe_json/model_json.json`
- `data/...` (fitting/precision input spectra)
- `Results/...` (all generated process artifacts)

### 6.2 Result artifact hierarchy (important for frontend)

Under `Results/`:
- `seed_search/coupling_xx/...`
- `fitting/coupling_xx/...`
- `precision/coupling_xx/...`
- `sensitivity/coupling_xx/...`
- `final_regression/coupling_xx/{seed_id}/grid_xxx...`
- `optimization_result.json`

Frontend trace/ranking pages read these files through backend result-index APIs.

## 7. External Vendor-Engine Integration

Primary APIs expected:
- `POST /get_result/{model_id}`
- `POST /getSpectrum/{model_id}`

For integration testing without real engine:
- `routers/mock_hpc.py` provides mock implementations
- enabled by env: `OCD_ENABLE_HPC_MOCK=1`

## 8. Current Separation of Responsibilities

- Frontend: interaction, visualization, stage monitoring, ranking
- Backend routers: lifecycle, queue/event/artifact indexing, compatibility APIs
- `ocd_auto_opt`: algorithm execution logic and process artifact production
- `ocd_master_58`: source-of-truth filesystem for case input/output

## 9. Important Notes

- `ocd_auto_opt/data` placeholder was removed; runtime data is not stored there.
- No-coupling scenario is valid and runs as baseline branch automatically.
- Real-time UX depends on event stream + incremental result files, not on one-shot final output only.
