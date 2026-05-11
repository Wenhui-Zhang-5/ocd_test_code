# 半导体研发 Agent 数据服务项目开发方案（简约版）

## 1. 目标

本项目目标是为半导体研发 Agent / Skill 提供统一、受控、可管理的数据查询服务。

核心思想：

```text
Skill 不直接访问数据库
数据库访问由各个 Data Service 封装
每个 Data Service 自己暴露 API 和 OpenAPI
中央只登记服务，不管理具体实现
```

这样可以做到：

- 数据库连接信息不暴露给 Skill
- 不同同事可以分别负责不同服务
- 每个服务可以独立开发、独立部署、独立维护
- 每个服务都有自己的 OpenAPI 文档
- Skill 只通过 HTTP API 调用数据服务

---

## 2. 总体架构

```text
User / Agent
    ↓
Skill
    ↓
HTTP API Call
    ↓
Service Registry
    ↓
不同 Data Service
    ├── Yield Service
    ├── WAT Service
    ├── Sort Service
    ├── Metrology Service
    ├── Lot Service
    └── Defect Service
            ↓
      各自访问多个数据源
```

核心边界：

```text
Skill 不知道 SQL
Skill 不知道数据库地址
Skill 不知道数据库账号密码
Skill 不知道真实表结构
Skill 只知道服务地址和 API
```

---

## 3. Service 拆分原则

建议按业务数据域拆分 Service，而不是按数据库拆分。

推荐拆分：

```text
Yield Service
WAT Service
Sort Service
Metrology Service
Lot Service
Defect Service
```

不推荐：

```text
DB1 Service
DB2 Service
DB3 Service
```

原因是 Skill 和业务场景关心的是“业务能力”，不是底层数据库。

例如：

```text
良率分析可能需要访问 Yield DB、MES DB、Sort DB、Lot DB
但对外仍然只应该是 Yield Service
```

也就是说：

```text
一个 Service 可以访问多个数据源
但对外只暴露统一的业务 API
```

---

## 4. 每个 Service 的基本要求

每个 Data Service 应该具备：

```text
1. 一个独立服务地址和端口
2. 一组业务 API
3. 一个自动生成的 OpenAPI
4. 一个 /docs 页面
5. 一个 /health 接口
6. 一个 IP 白名单校验
7. 一个统一错误返回格式
8. 一个明确 Owner
```

例如：

```text
Yield Service
  Base URL: http://yield-service:8001
  Docs:     http://yield-service:8001/docs
  OpenAPI:  http://yield-service:8001/openapi.json
```

---

## 5. 单个 Service 的最简目录结构

以 `yield-service` 为例：

```text
yield-service/
├── app.py
├── data_sources/
│   ├── yield_db.py
│   ├── mes_db.py
│   ├── sort_db.py
│   └── lot_db.py
├── utils/
│   ├── mpp_helper.py
│   ├── oracle_helper.py
│   └── common.py
├── allowed_ips.txt
└── README.md
```

其中：

```text
app.py          对外 API 入口，负责组合 data_sources 中的查询函数
data_sources/   不同数据源的具体查询函数
utils/          数据库 helper 和通用工具函数
allowed_ips.txt IP 白名单
README.md       服务说明
```

本方案不设置 `service.py`。

每个开发者只需要：

```text
1. 在 data_sources/ 中写数据查询函数
2. 在 app.py 中把这些查询函数组合成 API
```

---

## 6. 每个文件的职责

### 6.1 app.py

`app.py` 是服务入口，也是 API 组合层。

主要负责：

- 定义 API
- 自动生成 OpenAPI
- 自动生成 `/docs`
- 做 IP 白名单校验
- 做统一错误处理
- 调用 `data_sources/` 里的查询函数
- 组合多个数据源的结果并返回

`app.py` 可以做轻量的数据组合，例如：

```text
调用 Yield DB 查询良率
调用 MES DB 查询 Lot 信息
调用 Sort DB 查询 Sort 汇总
最后组合成一个 API 返回结果
```

但不建议在 `app.py` 中写大量底层数据库连接代码。

---

### 6.2 data_sources/

`data_sources/` 用来放不同数据源的查询函数。

例如：

```text
data_sources/yield_db.py  查询 Yield DB
data_sources/mes_db.py    查询 MES DB
data_sources/sort_db.py   查询 Sort DB
data_sources/lot_db.py    查询 Lot DB
```

每个文件只负责一个数据源，避免所有查询逻辑混在一起。

推荐写法：

```text
一个数据源一个文件
一个业务查询一个函数
函数名清楚表达查询意图
```

例如：

```python
query_yield_trend()
query_yield_summary()
query_lot_info()
query_sort_summary()
```

---

### 6.3 utils/

`utils/` 用来放数据库 helper 和通用工具函数。

例如：

```text
utils/mpp_helper.py
utils/oracle_helper.py
utils/common.py
```

推荐这里放：

- 数据库连接 helper
- 通用 query helper
- dataframe 处理工具
- 时间转换工具
- retry helper
- logging helper

例如：

```python
# utils/mpp_helper.py


import pandas as pd


def execute_mpp_sql(sql: str, params: dict | None = None) -> pd.DataFrame:
    """
    MPP 查询 helper。

    这里放最基础、可复用的 MPP 查询逻辑，例如：
    - 创建连接
    - 执行 SQL
    - 转换结果格式
    - 关闭连接

    返回值约定：
    - 返回 pandas DataFrame
    """

    # TODO:
    # conn = create_mpp_connection()
    # result = conn.execute(sql, params)
    # return pd.DataFrame(result)

    return pd.DataFrame()
```

当前阶段不建议额外维护单独的 SQL 文件目录。

如果 SQL 不复杂，可以直接写在 `data_sources/` 的函数中。

---

### 6.4 allowed_ips.txt

每个 Service 自己维护允许访问的 IP。

例如：

```text
127.0.0.1
10.10.1.20
10.10.1.21
192.168.0.100
```

如果请求来源 IP 不在白名单中，服务直接拒绝请求。

---

### 6.5 README.md

每个 Service 都需要一个简单 README。

建议包含：

```text
Service 名称
Owner
服务地址
端口
OpenAPI 地址
Docs 地址
主要 API 列表
依赖的数据源
```

---

## 7. 单个 Service 示例：Yield Service

下面给出一个完整的最小示例。

这个示例假设 Yield Service 需要访问三个数据源：

```text
Yield DB
MES DB
Sort DB
```

并对外提供一个 API：

```text
POST /yield/trend
```

这个 API 返回多个表格型 raw data：

```text
yield_trend_table
lot_info_table
sort_summary_table
```

每个 `data_sources/` 查询函数在服务内部可以返回 DataFrame 类型数据。

由于 HTTP API 不能直接返回 DataFrame 对象，因此在 `app.py` 中统一转换为 JSON records 格式返回。

Skill 开发人员拿到 raw data 后，可以根据需要再转换成 DataFrame 做后续分析。

---

## 8. app.py 示例

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from data_sources.yield_db import query_yield_trend
from data_sources.mes_db import query_lot_info
from data_sources.sort_db import query_sort_summary


app = FastAPI(
    title="Yield Service",
    version="1.0.0",
    description="Data service for yield-related queries"
)


class YieldTrendRequest(BaseModel):
    product_id: str
    date_range: list[str]
    aggregation: str = "daily"


def load_allowed_ips():
    try:
        with open("allowed_ips.txt", "r", encoding="utf-8") as f:
            return set(
                line.strip()
                for line in f.readlines()
                if line.strip() and not line.startswith("#")
            )
    except FileNotFoundError:
        return set()


ALLOWED_IPS = load_allowed_ips()


@app.middleware("http")
async def ip_check(request: Request, call_next):
    client_ip = request.client.host

    if client_ip not in ALLOWED_IPS:
        return JSONResponse(
            status_code=403,
            content={
                "status": "error",
                "error_code": "IP_NOT_ALLOWED",
                "message": "Your IP is not allowed to access this service.",
                "client_ip": client_ip
            }
        )

    return await call_next(request)


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(
        status_code=400,
        content={
            "status": "error",
            "error_code": "BAD_REQUEST",
            "message": str(exc)
        }
    )


@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "error_code": "INTERNAL_ERROR",
            "message": "Service failed to process the request. Please contact the service owner.",
            "detail": str(exc)
        }
    )


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "yield-service"
    }


@app.post("/yield/trend")
def yield_trend(req: YieldTrendRequest):
    if not req.product_id:
        raise ValueError("product_id is required")

    if len(req.date_range) != 2:
        raise ValueError("date_range should contain start_date and end_date")

        yield_df = query_yield_trend(
        product_id=req.product_id,
        date_range=req.date_range,
        aggregation=req.aggregation
    )

    lot_df = query_lot_info(
        product_id=req.product_id,
        date_range=req.date_range
    )

    sort_df = query_sort_summary(
        product_id=req.product_id,
        date_range=req.date_range
    )

    return {
        "status": "success",
        "data": {
            "yield_trend_table": yield_df.to_dict(orient="records"),
            "lot_info_table": lot_df.to_dict(orient="records"),
            "sort_summary_table": sort_df.to_dict(orient="records")
        },
        "metadata": {
            "service": "yield-service",
            "api": "yield_trend"
        }
    }
```

启动后自动生成：

```text
/health
/docs
/openapi.json
/yield/trend
```

---

## 9. data_sources 示例

### 9.1 data_sources/yield_db.py

```python
import pandas as pd
from utils.mpp_helper import execute_mpp_sql


def query_yield_trend(product_id: str, date_range: list[str], aggregation: str) -> pd.DataFrame:
    """
    查询 Yield DB 中的良率趋势。

    返回值约定：
    - 返回 pandas DataFrame
    - 每一行是一条 raw data record
    - 不在 data_sources 层做复杂业务分析
    """

    # Example:
    # sql = """
    # SELECT date, product_id, yield
    # FROM yield_table
    # WHERE product_id = :product_id
    #   AND date BETWEEN :start_date AND :end_date
    # """
    # return execute_mpp_sql(
    #     sql,
    #     params={
    #         "product_id": product_id,
    #         "start_date": date_range[0],
    #         "end_date": date_range[1]
    #     }
    # )

    return pd.DataFrame([
        {
            "date": date_range[0],
            "product_id": product_id,
            "yield": 0.92,
            "aggregation": aggregation
        },
        {
            "date": date_range[1],
            "product_id": product_id,
            "yield": 0.91,
            "aggregation": aggregation
        }
    ])
```

---

### 9.2 data_sources/mes_db.py

```python
import pandas as pd
from utils.oracle_helper import execute_oracle_sql


def query_lot_info(product_id: str, date_range: list[str]) -> pd.DataFrame:
    """
    查询 MES DB 中的 Lot 信息。

    返回值约定：
    - 返回 pandas DataFrame
    - 每一行是一个 Lot 相关 record
    """

    # Example:
    # sql = """
    # SELECT lot_id, product_id, start_time
    # FROM mes_lot_table
    # WHERE product_id = :product_id
    #   AND start_time BETWEEN :start_date AND :end_date
    # """
    # return execute_oracle_sql(
    #     sql,
    #     params={
    #         "product_id": product_id,
    #         "start_date": date_range[0],
    #         "end_date": date_range[1]
    #     }
    # )

    return pd.DataFrame([
        {
            "lot_id": "LOT001",
            "product_id": product_id,
            "start_date": date_range[0]
        },
        {
            "lot_id": "LOT002",
            "product_id": product_id,
            "start_date": date_range[1]
        }
    ])
```

---

### 9.3 data_sources/sort_db.py

```python
import pandas as pd
from utils.mpp_helper import execute_mpp_sql


def query_sort_summary(product_id: str, date_range: list[str]) -> pd.DataFrame:
    """
    查询 Sort DB 中的 Sort 汇总数据。

    返回值约定：
    - 返回 pandas DataFrame
    - 即使只有一行，也保持表格结构
    """

    # Example:
    # sql = """
    # SELECT product_id, bin1_ratio, fail_ratio
    # FROM sort_summary_table
    # WHERE product_id = :product_id
    #   AND test_date BETWEEN :start_date AND :end_date
    # """
    # return execute_mpp_sql(
    #     sql,
    #     params={
    #         "product_id": product_id,
    #         "start_date": date_range[0],
    #         "end_date": date_range[1]
    #     }
    # )

    return pd.DataFrame([
        {
            "product_id": product_id,
            "bin1_ratio": 0.88,
            "bin_fail_ratio": 0.12
        }
    ])
```

---

## 10. utils 示例

### 10.1 utils/mpp_helper.py

```python
def execute_mpp_sql(sql: str, params: dict | None = None):
    """
    MPP 查询 helper。

    这里放最基础、可复用的 MPP 查询逻辑，例如：
    - 创建连接
    - 执行 SQL
    - 转换结果格式
    - 关闭连接

    当前示例返回空列表。
    """

    # TODO:
    # conn = create_mpp_connection()
    # result = conn.execute(sql, params)
    # return convert_to_list_of_dict(result)

    return []
```

---

### 10.2 utils/oracle_helper.py

```python
import pandas as pd


def execute_oracle_sql(sql: str, params: dict | None = None) -> pd.DataFrame:
    """
    Oracle 查询 helper。

    这里放最基础、可复用的 Oracle 查询逻辑。

    返回值约定：
    - 返回 pandas DataFrame
    """

    # TODO:
    # conn = create_oracle_connection()
    # result = conn.execute(sql, params)
    # return pd.DataFrame(result)

    return pd.DataFrame()
```

---

### 10.3 utils/common.py

```python
def normalize_date_range(date_range: list[str]):
    """
    简单检查和标准化 date_range。
    """

    if len(date_range) != 2:
        raise ValueError("date_range should contain start_date and end_date")

    return date_range
```

---

## 11. allowed_ips.txt 示例

```text
127.0.0.1
10.10.1.20
10.10.1.21
```

---

## 12. README.md 示例

```text
# Yield Service

Owner: Alice
Port: 8001
Base URL: http://yield-service:8001
Docs: http://yield-service:8001/docs
OpenAPI: http://yield-service:8001/openapi.json

## APIs

- GET /health
- POST /yield/trend

## Data Sources

- Yield DB
- MES DB
- Sort DB

## Notes

This service provides yield-related query APIs.
Database details are internal to this service and should not be exposed to Skill developers.
```

---

## 13. 错误返回规范

建议保持简单，只定义三类错误。

### 13.1 IP 不允许

```json
{
  "status": "error",
  "error_code": "IP_NOT_ALLOWED",
  "message": "Your IP is not allowed to access this service.",
  "client_ip": "10.10.1.99"
}
```

### 13.2 请求参数错误

```json
{
  "status": "error",
  "error_code": "BAD_REQUEST",
  "message": "product_id is required"
}
```

### 13.3 服务内部错误

```json
{
  "status": "error",
  "error_code": "INTERNAL_ERROR",
  "message": "Service failed to process the request. Please contact the service owner.",
  "detail": "error detail"
}
```

---

## 14. Service Registry

虽然每个 Service 独立开发，但需要一个中央 Registry 记录当前有哪些服务。

推荐结构：

```text
service-registry/
├── services.yaml
└── README.md
```

`services.yaml` 示例：

```yaml
services:
  - name: yield-service
    domain: yield
    owner: Alice
    base_url: http://yield-service:8001
    openapi_url: http://yield-service:8001/openapi.json
    docs_url: http://yield-service:8001/docs
    status: active

  - name: wat-service
    domain: wat
    owner: Bob
    base_url: http://wat-service:8002
    openapi_url: http://wat-service:8002/openapi.json
    docs_url: http://wat-service:8002/docs
    status: active
```

Registry 只负责登记服务信息，不负责具体实现。

---

## 15. Skill 调用方式

Skill 直接通过 HTTP API 调用对应 Service。

示例：

```python
import requests


def analyze_yield(product_id, date_range):
    response = requests.post(
        "http://yield-service:8001/yield/trend",
        json={
            "product_id": product_id,
            "date_range": date_range,
            "aggregation": "daily"
        }
    )

    result = response.json()

    if result["status"] != "success":
        return {
            "summary": "Data query failed",
            "reason": result.get("message")
        }

        raw_data = result["data"]

    # Skill 开发人员可以按需转成 DataFrame
    # yield_df = pd.DataFrame(raw_data["yield_trend_table"])
    # lot_df = pd.DataFrame(raw_data["lot_info_table"])
    # sort_df = pd.DataFrame(raw_data["sort_summary_table"])

    return {
        "summary": "Yield analysis completed",
        "raw_data": raw_data
    }
```

---

## 16. 开发流程

### Step 1：确定服务边界

先确定要做哪些 Service：

```text
Yield Service
WAT Service
Sort Service
Metrology Service
Lot Service
```

---

### Step 2：每个 Owner 建立自己的 Service

每个 Service 至少包含：

```text
app.py
data_sources/
utils/
allowed_ips.txt
README.md
```

---

### Step 3：实现 data_sources 查询函数

每个 Owner 在 `data_sources/` 下实现自己的查询函数。

例如：

```text
data_sources/yield_db.py
data_sources/mes_db.py
data_sources/sort_db.py
```

---

### Step 4：在 app.py 中组合 API

在 `app.py` 中定义 API endpoint，并调用 `data_sources/` 中的函数。

例如：

```text
POST /yield/trend
```

内部调用：

```text
query_yield_trend()
query_lot_info()
query_sort_summary()
```

---

### Step 5：确认 OpenAPI 自动生成

每个 Service 都需要能访问：

```text
/docs
/openapi.json
```

---

### Step 6：登记到 Service Registry

服务上线后，把信息登记到：

```text
service-registry/services.yaml
```

---

### Step 7：Skill 通过 HTTP 调用 Service

Skill 根据业务需要调用一个或多个 Service。

例如一个良率异常分析 Skill 可能调用：

```text
Yield Service
WAT Service
Sort Service
```

但 Skill 仍然不直接访问数据库。

---

## 17. 最终总结

推荐最终形态：

```text
多个 Data Service
+ 每个 Service 一个 OpenAPI
+ 每个 Service 自己管理多个数据源
+ 每个 Service 自己维护 IP 白名单
+ 中央 Service Registry 只做登记
+ Skill 直接通过 HTTP 调用 Service
```

单个 Service 的推荐结构：

```text
service-name/
├── app.py
├── data_sources/
├── utils/
├── allowed_ips.txt
└── README.md
```

最重要的原则：

```text
数据库访问留在 Service 内部
查询函数放在 data_sources/
通用 helper 放在 utils/
API 组合放在 app.py
Skill 只调用 API
OpenAPI 负责描述 API
Registry 负责发现 Service
```

