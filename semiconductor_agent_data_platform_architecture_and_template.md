# 半导体研发 Agent 平台：数据服务层与 Skill 开发架构方案（Draft v1）

## 1. 项目背景

当前希望构建一个面向半导体研发场景的 Agent 平台，用于：

- 良率分析
- WAT 数据分析
- Sort 数据分析
- Metrology/Inline 数据分析
- Wafer/Lot 异常分析
- 工艺问题辅助分析

平台需要支持：

- 数据权限控制
- 数据访问审计
- Skill 扩展开发
- 多人协作开发
- Agent 自动调用 Tool
- 后续可扩展到更多数据源

其中最核心的问题是：

> Skill 不允许直接访问数据库。

所有数据库访问能力必须统一收敛到 Data Service Layer（数据服务层）中。

---

# 2. 核心设计原则

## 2.1 Skill 不允许直接访问数据库

Skill 中禁止出现：

- SQL
- 数据库连接
- ORM
- Spark SQL
- pandas.read_sql
- DB URL
- Username / Password

Skill 只能调用：

```python
from sdk import get_wat_data
```

即：

```text
Skill 只拥有“调用数据能力”的能力。
Skill 不拥有“访问数据库”的能力。
```

---

## 2.2 数据访问统一服务化

所有数据库访问统一由 Data Service 提供。

例如：

```text
POST /api/wat/query
POST /api/yield/trend
POST /api/sort/bin
```

Data Service 负责：

- 数据库查询
- SQL 管理
- 权限校验
- 审计日志
- 数据脱敏
- Cache
- 限流
- 错误处理

---

## 2.3 Skill 只调用“业务能力”

Skill 不关心：

- 数据来自哪个数据库
- SQL 如何实现
- 表结构如何设计
- 是否做了 join

Skill 只关心：

```python
get_yield_trend(...)
get_wat_data(...)
```

即：

```text
Skill 调用的是 Capability（能力）
而不是 Database（数据库）
```

---

# 3. 推荐整体架构

```text
┌────────────────────┐
│       User         │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│    Agent / Chat    │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│     Skill Layer    │
│  (业务逻辑分析层)    │
└─────────┬──────────┘
          │ SDK Call
          ▼
┌────────────────────┐
│   Data Tool SDK    │
└─────────┬──────────┘
          │ HTTP/RPC
          ▼
┌────────────────────┐
│   Data Service     │
│  权限/审计/SQL层     │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Databases / MES    │
│ Yield/WAT/Sort DB  │
└────────────────────┘
```

---

# 4. 推荐 Repository 结构

建议拆成两个 Repo：

---

## 4.1 Data Platform Repo

负责：

- 数据访问
- API
- Schema
- SDK
- 权限
- Tool Registry

推荐结构：

```text
data-platform/
├── registry/
│   ├── yield/
│   │   ├── get_yield_trend.yaml
│   │   └── get_yield_summary.yaml
│   │
│   ├── wat/
│   │   ├── get_wat_data.yaml
│   │   └── get_wat_statistics.yaml
│
├── sdk/
│   ├── yield_client.py
│   ├── wat_client.py
│
├── service/
│   ├── yield_service.py
│   ├── wat_service.py
│
├── sql/
│   ├── yield/
│   ├── wat/
│
├── docs/
│   └── tool_catalog.md
│
└── gateway/
```

---

## 4.2 Skill Repo

负责：

- 业务分析逻辑
- Agent Skill
- Prompt
- Workflow

推荐结构：

```text
skills/
├── yield_analysis/
│   ├── analyze_yield_skill.py
│
├── wat_analysis/
│   ├── analyze_wat_skill.py
│
├── sort_analysis/
│   ├── analyze_sort_skill.py
│
└── common/
```

Skill Repo 内：

```text
禁止出现数据库访问代码
```

---

# 5. Tool Registry（最关键模块）

## 5.1 核心思想

每个 Tool 都必须有一个 Schema 文件。

例如：

```text
registry/wat/get_wat_data.yaml
```

Schema 的作用：

- 给 Skill 开发者看
- 给 Agent 看
- 给自动文档生成器看
- 给参数校验器看

但：

```text
Schema 不包含数据库实现
```

---

## 5.2 示例 Tool Schema

```yaml
name: get_wat_data

category: wat

description: 获取 WAT 数据

required_inputs:
  - product_id
  - date_range

optional_inputs:
  - lot_id
  - wafer_id
  - test_items

permissions:
  - WAT_READ

returns:
  - wafer_id
  - test_item
  - value
  - timestamp

examples:
  - product_id: P123
    date_range:
      - 2026-01-01
      - 2026-01-31
```

---

# 6. Skill 开发方式

## 6.1 Skill 不直接调用数据库

正确方式：

```python
from sdk.wat_client import get_wat_data


def analyze_wat_skill(product_id, date_range):

    data = get_wat_data(
        product_id=product_id,
        date_range=date_range
    )

    result = analyze(data)

    return result
```

错误方式：

```python
import sqlalchemy

engine = create_engine(...)

pd.read_sql(...)
```

---

## 6.2 Skill 只做业务逻辑

Skill 负责：

- 数据分析
- 数据关联
- 异常检测
- Prompt
- Agent Workflow

Data Service 负责：

- SQL
- 权限
- DB
- Join
- Cache
- 审计

---

# 7. SDK 设计建议

SDK 是 Skill 唯一允许的数据访问入口。

例如：

```python
from sdk.wat_client import get_wat_data
```

SDK 内部负责：

- HTTP 调用
- Token
- Retry
- Trace ID
- Error Handle
- Request Format

Skill 开发者不需要接触：

- API URL
- Header
- Auth
- Token

---

# 8. Data Service 示例

## 8.1 API 示例

```text
POST /api/wat/query
```

Request:

```json
{
  "product_id": "P123",
  "date_range": ["2026-01-01", "2026-01-31"]
}
```

Response:

```json
{
  "status": "success",
  "trace_id": "abc-123",
  "data": []
}
```

---

## 8.2 Service 内部实现

```python
# wat_service.py


def query_wat_data(product_id, date_range):

    sql = load_sql("wat/query_wat.sql")

    result = execute_sql(sql)

    return result
```

注意：

```text
只有 Data Service 能接触 SQL
```

---

# 9. 权限控制建议

建议权限统一放在 Data Service。

权限类型：

```text
产品权限
数据类型权限
字段权限
时间范围权限
导出权限
```

例如：

```text
P123 -> allowed
P999 -> denied
```

Skill 不负责权限。

---

# 10. 审计日志建议

所有 Tool 调用都记录：

```text
user_id
skill_id
api_name
request_time
source_ip
product_id
row_count
trace_id
```

方便：

- 安全审计
- 问题追踪
- 数据治理

---

# 11. 自动文档系统（推荐）

建议根据 registry/*.yaml 自动生成内部文档网站。

推荐：

- mkdocs
- docusaurus
- 内部 portal

最终效果：

```text
Tool Catalog
├── Yield
├── WAT
├── Sort
├── Inline
```

点击后可查看：

- 参数
- 示例
- 返回字段
- 权限

---

# 12. 推荐开发顺序（非常重要）

建议不要一开始做太重的平台。

推荐阶段：

---

## Phase 1

目标：

```text
统一数据访问方式
```

完成：

- Data Service
- SDK
- YAML Registry
- 3~5 个核心 Tool

推荐优先：

- get_yield_trend
- get_wat_data
- get_sort_bin_distribution

---

## Phase 2

目标：

```text
支持 Skill 开发
```

完成：

- Skill Template
- Tool 文档
- 自动参数校验
- Agent Tool Routing

---

## Phase 3

目标：

```text
平台化
```

完成：

- Tool Portal
- 权限系统
- Tool Discovery
- Tool Metrics
- Trace System
- Cache Layer

---

# 13. Skill Template（推荐模板）

## 13.1 Skill 示例

```python
# analyze_wat_skill.py

from sdk.wat_client import get_wat_data


class AnalyzeWatSkill:

    name = "analyze_wat"

    description = "分析 WAT 异常趋势"

    required_inputs = [
        "product_id",
        "date_range"
    ]

    optional_inputs = [
        "lot_id",
        "test_items"
    ]

    def run(self, product_id, date_range, **kwargs):

        data = get_wat_data(
            product_id=product_id,
            date_range=date_range,
            lot_id=kwargs.get("lot_id")
        )

        result = self.analyze(data)

        return result

    def analyze(self, data):

        return {
            "summary": "WAT item VTH has abnormal drift"
        }
```

---

# 14. Tool SDK Template

```python
# wat_client.py

import requests

BASE_URL = "http://data-service/api"


def get_wat_data(product_id, date_range, lot_id=None):

    payload = {
        "product_id": product_id,
        "date_range": date_range,
        "lot_id": lot_id
    }

    response = requests.post(
        f"{BASE_URL}/wat/query",
        json=payload
    )

    return response.json()
```

---

# 15. 最终核心思想（重要）

整个系统最重要的边界：

```text
Skill 不直接访问数据库
```

而是：

```text
Skill
  ↓
SDK
  ↓
Data Service
  ↓
Database
```

因此：

```text
数据库能力被收敛
数据权限被统一管理
Skill 被安全隔离
```

这是整个 Agent 平台长期可扩展、可治理、可审计的核心基础。

