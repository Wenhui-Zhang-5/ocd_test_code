# OCD Optimization Algorithm (Current Implementation)

Last Updated: 2026-03-15
Source of truth: `ocd_algorithm_api/ocd_auto_opt/pipeline/optimizer.py`

## 1. Scope

This document describes the **implemented** optimization pipeline behavior (not an abstract design).  
It covers:
- path parsing
- coupling/seed/fitting/precision/sensitivity/final regression
- acceptance rules
- persistence layout for frontend real-time reading

## 2. Key Rules Locked

- Primary key for a run context is still `model_id + version` case folder.
- No-coupling case is supported by default.
- Seed search uses **baseline spectrum only**.
- Seed Top-K is selected by **GOF descending only**.
- Precision pass rule is strict:
  - `LBH == 0`
  - every target CD meets its own precision threshold
- Final regression stage:
  - optimize baseline GOF step-by-step
  - GOF drop guard: reject step if `new_gof < prev_gof * 0.9`
  - KPI check starts only when `baseline_gof >= early_stop_gof` (default `0.99`)
  - first KPI-passed snapshot for a grid is accepted immediately
- Global early stop: stop all loops when valid solutions count reaches `top_n`.

## 3. Inputs and Path Resolution

Inputs:
- `recipe_schema.json`
- `model_json.json`

Resolved roots:
- case root: `.../model_{model_id}/version_{version}`
- data root: `.../data`
- results root: `.../Results`

Parsed spectrum path lists:
- `baseline_spec_paths`:
  - from `baselineWafer + baselineSpectrum`
  - path: `data/fitting_wafer/{wafer}/{spec_type}/{filename}`
- `regression_spec_paths`:
  - from `tem.rows[]`
  - path: `data/fitting_wafer/{wafer}/{spec_type}/{spectrum}`
- `precision_spec_paths`:
  - from `precision.selectedSpectra` (with worst/point filtering logic)
  - path: `data/precision_wafer/repeat_{i}/{precision_spec_type}/{filename}`

Validation:
- baseline path list must not be empty
- precision path list must not be empty

## 4. Coupling Entry

`expressions = coupling_candidates(coupling_expressions(schema))`

Current behavior:
- always includes a baseline branch `""`
- then appends valid coupling expressions

So when no coupling is configured:
- expressions = `[""]`
- pipeline runs once using original `base_model_json`

## 5. Stage A: Seed Search

Function: `search_material_seeds(...)`

### 5.1 Candidate Material Source

Per material (when floatable), seed files are read from case-local nk library only:
- `model_{id}/version_{ver}/nk_library/{material_name}/*.json`

### 5.2 Baseline Preprocess

- Load baseline csv
- Normalize channels
- Build wavelength grid from `model_json.content.proj_params.SEwavelength`
- Interpolate baseline onto that grid (`baseline_interp`)

### 5.3 Per Candidate Evaluation

For each material combination:
1. apply material values to model
2. set must-float CD flags
3. run HPC fitting with baseline path only (`specPath=[baseline]`)
4. sync vendor fields (`nominal/value` and `nominalNew/valueNew` consistency)
5. call `getSpectrum` for simulated spectrum
6. compare to baseline_interp and compute plain MSE
7. record GOF/Residual/Correlation/LBH/MSE/score

### 5.4 Ranking

- Top-K rule is `GOF` descending only.

### 5.5 Persisted Artifacts

Under `Results/seed_search/coupling_{xx}/`:
- `meta.json`
- `seed_XXX.json` (full candidate result + plot data + model snapshot)
- `candidates.jsonl`
- `latest.json`
- `top_seeds.json`

## 6. Stage B: Fitting (Baseline)

Function: `run_fitting(...)`

Input model: top seeds from Stage A.

Execution order:
- `iteration -> material_order -> executionStepsByMaterial[material]`

Rules:
- only `mustFloat` CDs float
- step accepted only if `new_gof > best_gof`
- else rollback (do not update current model)
- early stop when `best_gof >= early_stop_gof`

Persisted artifacts:
- `Results/fitting/coupling_{xx}/{seed_id}.events.jsonl`
- `Results/fitting/coupling_{xx}/{seed_id}.latest.json`
- `Results/fitting/coupling_{xx}/{seed_id}.summary.json`

Each event/summary contains frontend-ready payloads:
- `model_json`
- `nk_snapshot`
- `spectrum_fit` (measured/simulated/aligned/mse)

## 7. Stage C: Precision Check

Function: `precision_check(...)`

### 7.1 Cases

1. Baseline case: all non-mustFix CDs float
2. If baseline fails, run 1D fixed-maybe cases
3. Only if no 1D pass, run 2D fixed-maybe pairs

### 7.2 Pass Rule

A case passes only if:
- `LBH == 0`
- for each target CD: `precision_3sigma(cd) <= threshold(cd)`

### 7.3 Outputs

- `selected_case`
- `grid_fix_cds` (from selected fixed set)
- baseline/1D/2D summary tables

Persisted artifact:
- `Results/precision/coupling_{xx}/{seed_id}.summary.json`

## 8. Stage D: Sensitivity

Function: `sensitivity_analysis(...)`

Inputs:
- fitted model
- target CDs (from precision baseline case)

Process:
- generate baseline simulated spectrum
- for each target CD, create `-delta` and `+delta` model
- simulate minus/plus curves
- align baseline/minus/plus on common wavelength/channel
- compute per-CD sensitivity curves and aggregate total sensitivity
- generate interval weights

Persisted artifacts:
- `Results/sensitivity/coupling_{xx}/{seed_id}.json`
- `Results/sensitivity/coupling_{xx}/{seed_id}.events.jsonl`
- `Results/sensitivity/coupling_{xx}/{seed_id}.latest.json`

Stored fields include:
- baseline curve
- baseline vs plus/minus per-CD curves
- total sensitivity
- interval weights

## 9. Stage E: Final Regression Optimization

Core function (independent module):
- `core/final_regression.py::run_final_regression_stage_for_grid`

Called from optimizer for each grid combination.

### 9.1 Grid Loop

For each `grid_combo`:
1. apply fixed grid CD values to fitted model
2. run final regression stage with step events persisted

### 9.2 Iterative Step Rule

Inside final stage (`iteration -> material -> step`):
1. run baseline fitting once for this step
2. guard baseline GOF:
   - reject if `new_gof < prev_gof * 0.9`
3. if accepted, update current model
4. only when `current_gof >= early_stop_gof`, run KPI evaluator

### 9.3 KPI Evaluator (per accepted step after GOF gate)

Includes both:
- TM regression check (R2/slope/side-by-side for each target CD)
- precision re-check on precision spectra (LBH + per-target 3sigma)

Pass condition:
- regression passed for all target CDs
- precision passed (LBH=0 and every target within threshold)

If passed:
- return immediately as accepted grid result (no need to finish remaining steps)

If no pass after all steps/iterations:
- grid result rejected

### 9.4 Persisted Artifacts

Per grid:
- `Results/final_regression/coupling_{xx}/{seed_id}/grid_{idx}.events.jsonl`
- `Results/final_regression/coupling_{xx}/{seed_id}/grid_{idx}.latest.json`
- `Results/final_regression/coupling_{xx}/{seed_id}/grid_{idx}.summary.json`

Event payload includes:
- `kind`: init/step/kpi_check/completed
- model snapshots
- NK snapshots
- spectrum fit snapshots

## 10. Solution Collection and Global Stop

When a grid is accepted:
- append one `OptimizationSolution`

Solution payload includes:
- final `model_json`
- `grid_fix_values`
- regression metrics
- precision metrics (per-target map retained)
- sensitivity data references

Global stop:
- if `len(valid_solution_list) >= top_n`, pipeline exits immediately

Final output:
- `Results/optimization_result.json`

## 11. External API Contracts

### 11.1 get_result

`POST {base_url}/get_result/{model_id}`

Request keys used:
- `model_json`
- `server` (default `HPC`)
- `specPath`
- `num_of_node`

### 11.2 getSpectrum

`POST {base_url}/getSpectrum/{model_id}`

Request keys used:
- `model_json`
- `server` (default `HPC`)

Response parsed as CSV text.

## 12. Mock API for Integration Testing

Router:
- `ocd_algorithm_api/routers/mock_hpc.py`

Endpoints:
- `POST /get_result/{model_id}`
- `POST /getSpectrum/{model_id}`

Switch:
- `OCD_ENABLE_HPC_MOCK=1` (default enabled)

Purpose:
- validate pipeline flow and frontend rendering without real vendor engine.
