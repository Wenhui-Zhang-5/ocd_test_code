# Optimization Algorithm Detailed Logic (2026-03)

Source code baseline:
- `ocd_algorithm_api/ocd_auto_opt/pipeline/optimizer.py`
- `ocd_algorithm_api/ocd_auto_opt/core/*.py`

This document describes the **implemented** algorithm flow and stage-level rules.

## 1. Inputs and Core Config

Primary inputs:
- `recipe_schema.json`
- `model_json.json`
- optional HPC endpoints (`get_result` / `getSpectrum`)

Main runtime config object:
- `OptimizerConfig`
  - `model_id`
  - `recipe_schema`
  - `base_model_json`
  - `hpc_client`
  - `spectrum_client`
  - `top_n`
  - `seed_top_k`
  - `max_grid_combos`

## 2. Path Resolution and Spectrum Lists

The optimizer resolves case root as:
- `OCD_CASE_ROOT/model_{model_id}/version_{version}`

Then derives:
- `data_root = case_root/data`
- `results_root = case_root/Results`

Three spectrum lists are parsed before stage execution:

1. `baseline_spec_paths`
- from `baselineWafer` + `baselineSpectrum`
- location: `data/fitting_wafer/{wafer}/{spec_type}/{filename}`

2. `regression_spec_paths`
- from `tem.rows`
- location: `data/fitting_wafer/{wafer}/{spec_type}/{spectrum}`

3. `precision_spec_paths`
- from `precision.selectedSpectra` plus point/repeat logic
- location: `data/precision_wafer/repeat_{i}/{precision_spec_type}/{filename}`

Validation:
- baseline list must exist
- precision list must exist

## 3. Coupling Branch Generation

Flow:
- parse expressions from `cdStrategy.schemes[].expression`
- generate candidates via `coupling_candidates(...)`

Behavior:
- always includes baseline branch `""`
- then valid coupling expressions

So if there is no coupling config, the pipeline still runs once on original model.

## 4. Stage A: Seed Search

Function:
- `core/seed_search.py::search_material_seeds`

### 4.1 Candidate source

For each floatable material, candidates are loaded from case-local NK library only:
- `model_{id}/version_{ver}/nk_library/{material_name}/*.json`

### 4.2 Baseline preprocessing

- read baseline spectrum csv
- normalize channels
- build wavelength grid from `proj_params.SEwavelength`
- interpolate baseline to this grid

### 4.3 Candidate evaluation loop

Per material combination:
1. apply material values to model json
2. apply must-float CD flags
3. call `get_result` with baseline-only spec path
4. parse best record (`GOF/Residual/Correlation/LBH`)
5. call `getSpectrum` using optimized model
6. align baseline(sim grid) vs simulated and compute plain MSE
7. build candidate row

### 4.4 Ranking rule

Top-K selection is by:
- `GOF` descending

### 4.5 Persisted files

`Results/seed_search/coupling_{xx}/`
- `meta.json`
- `seed_XXX.json`
- `candidates.jsonl`
- `latest.json`
- `top_seeds.json`

## 5. Stage B: Baseline Fitting

Function:
- `core/fitting.py::run_fitting`

Execution order:
- `iteration -> material_order -> executionStepsByMaterial[material]`

Acceptance rule:
- accept step only when `new_gof > best_gof`
- otherwise rollback to previous accepted model

Stop condition:
- early stop when `best_gof >= early_stop_gof` (default `0.99`)

Output:
- best model per seed
- step history

Persisted files:
- `Results/fitting/coupling_{xx}/{seed_id}.events.jsonl`
- `Results/fitting/coupling_{xx}/{seed_id}.latest.json`
- `Results/fitting/coupling_{xx}/{seed_id}.summary.json`

Each record includes model snapshot, NK snapshot, and fitted spectrum payload.

## 6. Stage C: Precision Check

Function:
- `core/precision_check.py::precision_check`

Input model:
- fitted model from Stage B

Case strategy:
1. baseline case (all non-mustFix float)
2. if baseline fails -> 1D fixed-maybe cases
3. if no 1D pass -> 2D fixed-maybe cases

Pass rule (strict):
- `LBH == 0`
- every target CD meets its own threshold (`target_precision_thresholds`)

Output:
- `baseline_case`
- `selected_case`
- `one_d_fix_table`
- `two_d_fix_table`
- `grid_fix_cds` (used by final regression)

Persisted file:
- `Results/precision/coupling_{xx}/{seed_id}.summary.json`

## 7. Stage D: Sensitivity

Function:
- `core/sensitivity.py::sensitivity_analysis`

Process:
1. generate/obtain baseline simulated spectrum
2. for each target CD, make `-delta` and `+delta` models
3. simulate minus/plus curves
4. align baseline/minus/plus on common wavelengths/channels
5. compute per-CD sensitivity curves
6. aggregate total sensitivity and interval weights

Output includes:
- baseline curve
- per-CD baseline/plus/minus curves
- total sensitivity
- intervals (weight windows)

Persisted files:
- `Results/sensitivity/coupling_{xx}/{seed_id}.json`
- `Results/sensitivity/coupling_{xx}/{seed_id}.events.jsonl`
- `Results/sensitivity/coupling_{xx}/{seed_id}.latest.json`

## 8. Stage E: Final Regression Optimization

Core module:
- `core/final_regression.py::run_final_regression_stage_for_grid`

This stage is called from optimizer for each `grid_combo`.

### 8.1 Grid-level loop

For each grid combination:
1. apply grid-fixed CD values to fitted model
2. execute final regression iterative stage

### 8.2 Iterative acceptance rule

Inside final stage (iteration/material/step):
1. run one baseline fit for candidate step
2. baseline GOF guard:
   - reject step if `new_gof < prev_gof * 0.9`
3. accepted step updates current model
4. KPI check is only triggered when `baseline_gof >= early_stop_gof`

### 8.3 KPI evaluator composition

KPI evaluator includes two checks:

1. TM regression check (`_evaluate_tm_regression`)
- run fitting on regression spectra
- build per-target regression metrics
- check `R2/slope/side-by-side` per target CD

2. precision target check (`_evaluate_precision_targets`)
- run fitting on precision spectra
- compute per-target 3sigma
- enforce per-target threshold + LBH rule

Pass condition:
- regression passed and precision passed

If passed:
- this grid returns accepted immediately

If no pass after all iterations:
- grid rejected

### 8.4 Persisted files (per grid)

- `Results/final_regression/coupling_{xx}/{seed_id}/grid_{idx}.events.jsonl`
- `Results/final_regression/coupling_{xx}/{seed_id}/grid_{idx}.latest.json`
- `Results/final_regression/coupling_{xx}/{seed_id}/grid_{idx}.summary.json`

Event kinds include:
- `init`
- `step`
- `kpi_check`
- `completed`

## 9. Solution Collection and Global Early Stop

When a grid is accepted, optimizer creates one `OptimizationSolution` containing:
- `model_json`
- `grid_fix_values`
- regression metrics
- precision metrics (including per-target maps)
- sensitivity payload

Global stop:
- stop full optimization once `len(valid_solution_list) >= top_n`

Final output file:
- `Results/optimization_result.json`

## 10. Real-time Visibility for Frontend

The pipeline persists process artifacts continuously, not only final summary.

Frontend can read:
- stage snapshots (`*.summary.json`, `latest.json`)
- event streams (`*.events.jsonl`)

This supports trace/ranking pages with near-real-time updates.

## 11. External Interface Expectations

HPC fitting API request keys:
- `model_json`
- `server` (default `HPC`)
- `specPath`
- `num_of_node`

Spectrum API request keys:
- `model_json`
- `server` (default `HPC`)

Mock support:
- `routers/mock_hpc.py`
- endpoints: `/get_result/{model_id}`, `/getSpectrum/{model_id}`
- switch: `OCD_ENABLE_HPC_MOCK=1`

## 12. Known Behavioral Constraints

- seed search currently uses case-local NK folder as primary source.
- precision path assembly depends on `selectedSpectra + selectedRows/points/worstPointId`.
- final regression currently accepts first KPI-passed snapshot per grid.
- no-coupling is always valid due to baseline branch injection.
