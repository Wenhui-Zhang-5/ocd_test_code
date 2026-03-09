这个文档的设计目标是：
	•	直接给 Codex / AI coding agent
	•	让它可以开始生成整个项目代码
	•	所有模块职责明确
	•	所有函数输入输出定义清晰
	•	所有 pipeline 顺序明确


⸻

Codex_Implementation_Prompt.md

⸻

OCD Auto Optimization System

Codex Implementation Prompt

You are implementing a Python system for automatic OCD model optimization.

The system interacts with an external HPC fitting engine and performs a structured optimization pipeline.

Your task is to implement the full optimization system following the specification below.

⸻

1. Programming Language

Use:

Python 3.10+

Required libraries:

numpy
pandas
requests
scipy
sklearn

Optional:

matplotlib (for debugging only)


⸻

2. Project Structure

Create the following project structure.

ocd_auto_opt/

api/
    run_hpc.py
    get_spectrum.py

core/
    coupling.py
    seed_search.py
    fitting.py
    precision_check.py
    sensitivity.py
    regression.py

utils/
    parse_hpc_result.py
    spectrum_utils.py
    model_utils.py

pipeline/
    optimizer.py

data/
    spectrum_data/
    material_library/


⸻

3. External APIs

⸻

3.1 runHPC API

Endpoint:

POST {base_url}/get_result/{model_id}


⸻

Request JSON

{
  "model_json": {...},
  "server": "HPC",
  "specPath": [list of spectrum paths],
  "num_of_node": [node list]
}


⸻

Response Structure

The response contains:

result['mat']
result['data']


⸻

result[‘mat’]

list of optimized model_json

Each item corresponds to one spectrum.

⸻

result[‘data’]

records = result['data']

Structure:

records[0] = headers
records[1:] = records_data


⸻

headers include

all basis CD values
GOF
Correlation
Residual
LBH

Example:

["CD_TOP","CD_BOTTOM","GOF","Correlation","Residual","LBH"]


⸻

records_data

Each row corresponds to one fitted spectrum.

Example:

[34.1,29.5,0.995,0.998,0.002,0]

You must parse:

GOF
Residual
Correlation
LBH
basis CD values


⸻

3.2 getSpectrum API

Endpoint:

POST {base_url}/getSpectrum/{model_id}


⸻

Response

Text spectrum.

Load using:

pd.read_csv(StringIO(result.text))


⸻

4. Spectrum Channel Types

The spectrum channel format depends on spec_type provided by the frontend.

Your code must handle different channel configurations.

⸻

SE

If:

spec_type = "SE"

Spectrum channels:

N
C
S

Data format:

wavelengths | N | C | S


⸻

SR

If:

spec_type = "SR"

Channels:

TE
TM

Data format:

wavelengths | TE | TM


⸻

Combine

If:

spec_type = "Combine"

Channels:

5 channels

Example:

wavelengths | ch1 | ch2 | ch3 | ch4 | ch5

Your implementation must not assume channel names.

Instead:

all columns except "wavelengths"
are spectral channels


⸻

5. Optimization Pipeline

The optimizer must execute the following pipeline.

Coupling Generation
        ↓
Seed Searching
        ↓
Spectrum Fitting
        ↓
Precision Check
        ↓
Sensitivity Analysis
        ↓
Final Regression Optimization


⸻

6. Coupling Module

File:

core/coupling.py

Function:

apply_coupling(model_json, coupling_expression)

Responsibilities:
	•	modify model_json
	•	move coupled parameters into constraint
	•	remove redundant basis parameters

⸻

7. Seed Searching Module

File:

core/seed_search.py

Goal:

find best material parameter combinations

Procedure:
	1.	load baseline spectrum
	2.	replace material parameters using library
	3.	float only mustFloat CDs
	4.	run HPC fitting
	5.	evaluate GOF or residual

Return:

topK seeds


⸻

8. Spectrum Fitting Module

File:

core/fitting.py

Optimization order:

materialOrder
↓
parameter steps

Acceptance rule:

if GOF improves → accept
else revert

Early stop:

GOF ≥ 0.99


⸻

9. Precision Check Module

File:

core/precision_check.py

Goal:

determine gridFix CDs

Procedure:

baseline case
1D fix test
2D fix test

Metrics:

LBH
precision = 3σ

Output:

gridFix CD list


⸻

10. Sensitivity Analysis Module

File:

core/sensitivity.py

Procedure:
	1.	simulate baseline spectrum
	2.	simulate CD +10nm
	3.	simulate CD -10nm

Compute sensitivity:

|baseline − minus|


⸻

Channel Processing

For each wavelength:

sensitivity = mean(abs(channel differences))

Use all channels dynamically.

⸻

Multiple Target CDs

If multiple CDs exist:

S_total(λ) = sum(S_cd(λ))


⸻

Interval Aggregation

Aggregate sensitivity by intervals.

Example:

190–200
200–210

Compute mean sensitivity per interval.

⸻

Weight Mapping

Normalize sensitivity into:

0.5 → 3.0

Output format:

[min,max,step,weight]

Example:

[190,200,1,0.8]


⸻

11. Final Regression Optimization

File:

core/regression.py

Search structure:

Coupling
  ↓
Seed
  ↓
GridFix Combination
  ↓
Fitting iteration


⸻

12. Baseline GOF Protection

During regression stage:

baseline_gof_new ≥ baseline_gof_prev × 0.9

Meaning:

≤10% degradation allowed

If exceeded:

rollback iteration


⸻

13. Regression Metrics

Compute regression:

TM_CD → OCD_CD

Metrics:

R²
Slope
Side-by-side


⸻

14. Precision Evaluation

Using precision spectra.

Procedure:

repeat fitting
compute CD distribution
precision = 3σ


⸻

15. KPI Conditions

Valid solution must satisfy:

R² ≥ threshold
Slope within range
Side-by-side ≤ limit
Precision ≤ limit


⸻

16. Early Stop Strategy

Global stopping rule:

stop when TopN solutions found

Example:

TopN = 5


⸻

17. Main Pipeline

File:

pipeline/optimizer.py

Main loop pseudocode:

for coupling in couplings:

    model = apply_coupling(base_model)

    seeds = search_material_seeds(model)

    for seed in seeds:

        fitted_model = run_fitting(seed)

        gridFixCD = precision_check(fitted_model)

        sensitivity_weights = sensitivity_analysis(fitted_model)

        for grid_combo in enumerate_grid(gridFixCD):

            model = apply_grid(grid_combo)

            optimized_model = iterative_fit(model)

            if baseline_gof_drop > 10%:
                revert()

            regression_metrics = compute_regression()

            precision = compute_precision()

            if KPI_satisfied:
                save_solution()

                if solution_count >= TopN:
                    stop()


⸻

18. Expected Output

The system should return:

valid_solution_list

Each solution contains:

model_json
gridFix values
regression metrics
precision metrics
spectrum data


⸻

End of Codex Prompt

