# Spectrum API + Frontend Logic

## 1. 目标
这份文档说明当前 `Spectrum`/`Precision` 页面如何通过 Python API 完成：
- 对象存储记录查询（Time -> Tool -> Recipe -> Lot -> Wafer）。
- 选中记录后导入光谱。
- 前端绘图与缓存保存。

对应代码：
- 后端：`ocd_algorithm_api/routers/spectrum.py`
- 前端 Spectrum：`ocd_master/src/pages/pre_recipe/Spectrum.jsx`
- 前端 Precision：`ocd_master/src/pages/pre_recipe/Precision.jsx`

---

## 2. 后端 API 设计

### 2.1 `GET /api/spectrum/records`
用途：查询对象存储记录表（fake SQL 表），返回可供用户勾选导入的记录行。

查询参数：
- `start`：ISO 时间
- `end`：ISO 时间
- `tool`：机台
- `recipe_name`：配方名
- `lot_id`：lot
- `wafer_ids`：逗号分隔的 wafer 列表（可选）

返回结构：
```json
{
  "records": [
    {
      "id": "OBJ-000001",
      "time": "2026-02-24T08:20:00Z",
      "tool": "TOOL-A01",
      "recipeName": "RCP-ALD-01",
      "lotId": "LOT-2401",
      "waferId": "WAFER-0001",
      "spectrumFolder": "/abs/path/.../WAFER_0001/spectrum",
      "spectrumIds": ["SPEC_0001", "SPEC_0002"]
    }
  ]
}
```

后端实现要点：
- 使用内存 `SQLite` 表 `spectrum_objects`。
- 启动时自动 fake 数据，并确保最近 7 天有记录，避免默认时间窗无数据。
- SQL 条件拼接后统一 `ORDER BY time DESC`。

### 2.2 `POST /api/spectrum/load`
用途：根据前端选中的记录批量读取 CSV，返回光谱 JSON。

请求结构：
```json
{
  "records": [
    {
      "id": "OBJ-000001",
      "time": "2026-02-24T08:20:00Z",
      "tool": "TOOL-A01",
      "recipeName": "RCP-ALD-01",
      "lotId": "LOT-2401",
      "waferId": "WAFER-0001",
      "spectrumFolder": "/abs/path/.../WAFER_0001/spectrum",
      "spectrumIds": ["SPEC_0001", "SPEC_0002"]
    }
  ]
}
```

返回结构：
```json
{
  "spectra": [
    {
      "wafer_id": "WAFER-0001",
      "spectrum_id": "SPEC_0001",
      "source_path": "/abs/path/.../SPEC_0001.csv",
      "meta": {},
      "se": {
        "wavelength": [190.0, 190.8],
        "n": [1.23, 1.24],
        "c": [0.11, 0.12],
        "s": [0.21, 0.22]
      },
      "sr": {
        "wavelength": [],
        "te": [],
        "tm": []
      }
    }
  ]
}
```

CSV 解析兼容：
- 纯数据格式：`Wavelength,N,C,S`
- 带 meta 格式：上半段 `key,value`，`#` 分隔，下半段数据列

---

## 3. 前端 Spectrum 逻辑

### 3.1 输入筛选与级联
- 页面初始默认时间：最近 7 天。
- `timeStart/timeEnd` 改变后，自动请求：
  - `GET /api/spectrum/records?start=...&end=...`
- Tool/Recipe/Lot/Wafer 下拉选项来自本次返回的 `records` 前端去重。
- 级联规则：
  - 先按 Time 取 records。
  - Tool 基于 Time 结果。
  - Recipe 基于 Time+Tool 结果。
  - Lot 基于 Time+Tool+Recipe 结果。
  - Wafer 基于 Time+Tool+Recipe+Lot 结果。

### 3.2 Confirm 才显示记录表
- 筛选项变化时，`Object Storage Records` 会自动收起。
- 只有点击 `Confirm` 后才显示记录表。
- 这条规则已应用在 `Spectrum` 和 `Precision`。

### 3.3 Import Data
- 用户在 `Object Storage Records` 勾选行后点击 `Import Data`。
- 前端先做校验：
  - 同一 `waferId` 不能同时导入多行（防止同片 wafer 多次采样冲突）。
- 校验通过后调用：
  - `POST /api/spectrum/load`
- 返回数据转为前端缓存结构：
  - `spectraStore[waferId][spectrumId] = { se, sr, path }`
  - `selectedSpectrumTable = [{waferId, spectrumId, path}]`

### 3.4 Plot 模式
`Spectrum Plot` 支持 3 个 checkbox 模式：
- `SE`：绘制 `N/C/S`
- `SR`：绘制 `TE/TM`
- `Combine`：`N/C/S + TE/TM`

说明：
- 当前如果后端 `sr` 为空，`SR/Combine` 的 TE/TM 子图会为空（预期行为）。

### 3.5 保存
点击页面底部 Save（或 Save&Next）会把关键信息写入 schema：
- 当前筛选条件
- 选中对象记录行
- 导入后的 `selectedSpectra`
- 被移除 outlier 列表（如果有）

---

## 4. 前端 Precision 逻辑

`Precision` 已改成和 `Spectrum` 同一 API 链路：
- 同样查询 `GET /api/spectrum/records`
- 同样导入 `POST /api/spectrum/load`
- 同样遵守 `Confirm` 后才显示记录表

差异点：
- Precision 导入后主要用于 Precision summary / worst point 计算与后续 schema 保存。

---

## 5. 联调与排错

### 5.1 必要前提
- `ocd_algorithm_api` 服务启动在 `http://localhost:8001`
- `ocd_master` 前端启动

### 5.2 快速检查
1. 打开 Spectrum 页面，默认最近 7 天应有 records。
2. 选条件后点 `Confirm`，应出现 `Object Storage Records`。
3. 勾选一行后点 `Import Data`，应能画出曲线。

### 5.3 常见问题
- 问题：`Import Data` 后无图。
- 原因：CSV 解析未识别表头或后端未重启。
- 检查：
  - 后端是否已重启并加载最新 `spectrum.py`
  - 浏览器 Network 中 `/api/spectrum/load` 是否返回 `se.n/c/s` 非空

---

## 6. 后续建议
- 将 `SPECTRUM_API_BASE` 抽到统一配置（如 `.env`），避免硬编码 `localhost:8001`。
- 将 fake SQLite 替换成真实对象存储元数据表时，前端无需改动。
- 如果 SR 后续上线，优先保证 `sr.wavelength/te/tm` 长度一致，减少前端分支判断。
