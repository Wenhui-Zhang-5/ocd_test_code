# OCD Recipe Pre-Optimization API Contract (v2)

## 1. Spectrum Analysis

### 1.1 Query object-storage records
- `POST /api/spectrum/records/query`
- Request:
```json
{
  "timeRange": { "start": "2026-02-01T00:00:00Z", "end": "2026-02-21T00:00:00Z" },
  "toolId": "Tool-A01",
  "recipeName": "Gate Stack",
  "waferIds": ["WAFER-0001", "WAFER-0042"]
}
```
- Response:
```json
{
  "records": [
    {
      "recordId": "OBJ-0001",
      "time": "2026-02-20T10:00:00Z",
      "toolId": "Tool-A01",
      "recipeName": "Gate Stack",
      "waferId": "WAFER-0001",
      "spectrumFolder": "/mnt/object/WAFER_0001/spectrum",
      "spectrumCsvs": ["SPEC_0001.csv", "SPEC_0002.csv"]
    }
  ]
}
```

### 1.2 Copy selected spectra from server 242 to 58
- `POST /api/spectrum/transfer-to-58`
- Request:
```json
{
  "workspaceId": "WKS-0001",
  "modelId": "MODEL_122345",
  "version": "v1.0",
  "waferIds": ["WAFER-0001", "WAFER-0042"],
  "removedSpectra": [
    { "waferId": "WAFER-0001", "spectrumCsv": "SPEC_0019.csv" }
  ],
  "precisionSpectra": [
    { "waferId": "WAFER-0001", "spectrumCsv": "SPEC_0004.csv" }
  ]
}
```
- Response:
```json
{
  "transferId": "XFER-1740112233445",
  "sourceServer": "242",
  "targetServer": "58",
  "targetRoot": "/data/ocd_spectra",
  "targetFolder": "model_id_MODEL_122345_version_v1.0",
  "precisionFolder": "model_id_MODEL_122345_version_v1.0/precision",
  "copyMode": "full-wafer",
  "copiedWafers": ["WAFER-0001", "WAFER-0042"],
  "status": "done",
  "copiedAt": "2026-02-21T10:20:33.445Z"
}
```

### 1.3 Save spectrum-analysis schema fragment
- `PUT /api/recipes/{recipeId}/schema/spectrum-analysis`
- Request:
```json
{
  "spectrumSelection": {
    "timeRange": { "start": "2026-02-01T00:00:00Z", "end": "2026-02-21T00:00:00Z" },
    "toolId": "Tool-A01",
    "recipeName": "Gate Stack",
    "waferIds": ["WAFER-0001"],
    "removedSpectra": [
      { "waferId": "WAFER-0001", "spectrumCsv": "SPEC_0019.csv" }
    ]
  },
  "spectrumTransfer": {
    "transferId": "XFER-1740112233445",
    "targetFolder": "model_id_MODEL_122345_version_v1.0",
    "status": "done",
    "copiedAt": "2026-02-21T10:20:33.445Z"
  }
}
```

## 2. Precision

### 2.1 Save precision summary fragment
- `PUT /api/recipes/{recipeId}/schema/precision`
- Request:
```json
{
  "timeRange": { "start": "2026-02-01T00:00:00Z", "end": "2026-02-21T00:00:00Z" },
  "tool": "Tool-A01",
  "recipeName": "Gate Stack",
  "wafers": ["WAFER-0001"],
  "worstPointId": "P-17"
}
```

## 3. Pre-Recipe and Recipe Build

### 3.1 Save merged schema fragment
- `PUT /api/recipes/{recipeId}/schema`
- Request:
```json
{
  "preRecipe": { "...": "recipe setup + model + TEM/KPI" },
  "recipeBuild": { "...": "starting point + cd strategy + fitting strategy" }
}
```

### 3.2 Read full schema
- `GET /api/recipes/{recipeId}/schema`
- Response: full merged schema, same shape as `recipe_schema_pre_optimization_v2.example.json`.

### 3.3 Fitting strategy execution storage for algorithm
- Frontend UI can still be `mode = column/row/custom`.
- Algorithm-facing storage should use model-json naming for each target (`material/model/name`):
- Algorithm should consume only step order and `targets` order.
```json
{
  "fittingStrategy": {
    "executionStepsByMaterial": {
      "Si_HO": [
        {
          "name": "Step 1",
          "targets": [
            { "material": "Si_HO", "model": "HarmonicsOSC-1", "name": "Amp" },
            { "material": "Si_HO", "model": "HarmonicsOSC-2", "name": "Amp" }
          ]
        }
      ]
    }
  }
}
```

## 4. Backend implementation notes
- Frontend should never construct physical storage paths for server 58.
- Backend resolves destination path using `modelId + version` naming rule.
- Store only business fields in schema for spectrum-analysis: wafer and removed spectrum CSV list.
- Transfer should copy full wafer folders based on confirmed wafer IDs.
- Outlier-removed spectra are for record only; they do not change copy scope.
- Transfer logs should be stored separately (`transfer_log` table/collection) and linked by `transferId`.
