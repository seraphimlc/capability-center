# 温州 AI：最小数据模型草案（用户即企业版）

分支：`feature/wenzhou-ai-workbench`
状态：设计草案，不含业务代码。
原则：**用户即企业，积分即个人钱包；只加不破。**

---

## 0. 结论：不建企业层

- 一个 `users` 记录就是一个企业账号；不建 `enterprises`、`enterprise_members`。
- 不做企业管理员、子账号、部门、企业钱包。
- 平台运营在管理端管理用户和积分。
- 所有业务数据按 `user_id` 隔离；`tenant_id` 保留为平台租户，不作为企业边界。
- 第一批不做套餐；管理端直接充值/调账。以后需要再加“按用户的套餐”。

这样比企业/成员/企业钱包少一层模型，也少一套权限和页面。

---

## 1. 积分：复用现有钱包

现有表已经够用：

- `wallets`：`user_id @unique`，余额
- `credit_holds`：`invoke_id` 唯一，可存任意 holdKey
- `ledger_entries`：`(biz_type, biz_id)` 唯一

场景运行直接复用：

```
holdKey = scenario:{runId}
credit_holds.invoke_id = holdKey
ledger_entries.biz_type = 'scenario'
ledger_entries.biz_id = runId
```

流程：

1. 场景 run 开始：按预估积分 `WalletService.hold(userId, 'scenario:'+runId, amount)`。
2. 每个步骤调 `InvokeService` 时带 `billingContext = { userId, runId, deferred: true }`，只记录本步成本，不单独 hold/capture。
3. run 成功：按步骤成本合计 `captureByInvoke('scenario:'+runId)`，写一条 `biz_type=scenario` 流水。
4. run 失败/取消：`releaseByInvoke('scenario:'+runId)`，不扣费。
5. 旧调用（没有 scenario context）：继续走原有 `InvokeService` 的 hold/capture，不变。

**不新建积分表，不做 BillingService 新体系。** 只在 `InvokeService` 加一个 deferred 分支。

---

## 2. 数据源（Pending 落点）

### `data_sources`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | 平台租户 |
| key | string | customs_grand / buyers_grand / email_aliyun |
| name | string | 海关数据（格兰德） |
| category | string | customs / buyer / email / other |
| provider | string | 格兰德 / 阿里云 |
| mode | string | api / file / smtp |
| status | string | ready / pending / to_build |
| connector_id | string? | 关联 `connectors` |
| config_enc | text | API key、文件路径、SMTP 配置 |
| fields_json | json? | 字段映射 |
| coverage_json | json? | 国家/地区、时间范围、数据量 |
| contract_ref | string? | 合同/订单号 |
| owner | string? | 负责人 |
| last_sync_at | datetime? | |
| notes | text? | |
| created_at / updated_at | datetime | |

### `data_source_syncs`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| data_source_id | string | |
| mode | string | api / file |
| status | string | running / succeeded / failed |
| rows | int | |
| file_id | string? | 文件模式 |
| error | text? | |
| started_at / finished_at | datetime | |

数据源是平台级，由平台运营管理；不属于某个用户。

---

## 3. 专家（扩展现有 agents）

不新建专家表，给 `agents` 加字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| kind | string | chat / task / both，默认 both |
| input_schema_json | json? | 任务型专家入参 |
| output_schema_json | json? | 输出契约 |
| icon | string? | |
| sort | int | |

新增 `agent_knowledge_bases`：

| 字段 | 类型 |
|---|---|
| agent_id | string |
| knowledge_base_id | string |
| enabled | boolean |

技能继续用 `agent_tools`；MCP 继续用 `connectors`。第一批专家都由平台运营配置，用户不能自建。

---

## 4. 场景与运行

### `scenarios`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| key | string | selection-analysis / competitor-insight / compliance-screening |
| name | string | |
| summary | string | |
| agent_id | string? | 归属专家 |
| input_schema_json | json | 场景入参 |
| output_schema_json | json | 产物契约 |
| status | string | draft / published / archived |
| version | int | |
| created_by | string? | |
| created_at / updated_at | datetime | |

### `scenario_steps`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| scenario_id | string | |
| sort | int | |
| type | string | tool / model / data / approval |
| ref_key | string | 工具 key / 模型 key / 数据源 key |
| name | string | |
| input_mapping_json | json? | 上游结果 → 入参 |
| output_mapping_json | json? | 结果 → 上下文 |
| condition_json | json? | 条件执行 |
| optional | boolean | |
| timeout_sec | int | |

> 第一版场景定义用代码/种子写入，不做可视化编排器。

### `scenario_dependencies`

| 字段 | 类型 | 说明 |
|---|---|---|
| scenario_id | string | |
| data_source_id | string | |
| required | boolean | |
| note | string? | |

### `scenario_runs`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| user_id | string | 发起人，也是积分归属 |
| scenario_id | string | |
| status | string | queued / running / awaiting_confirm / succeeded / failed / blocked / cancelled |
| input_json | json | |
| output_json | json? | |
| error_code | string? | |
| error_message | text? | |
| credits | int | 实扣 |
| task_id | string? | 可选，建议以 `ai_tasks.scenario_run_id` 为准 |
| started_at / finished_at | datetime? | |
| created_at | datetime | |

### `scenario_run_steps`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| run_id | string | |
| step_id | string | |
| sort | int | |
| status | string | pending / running / succeeded / failed / skipped / blocked |
| input_json | json? | |
| output_json | json? | |
| invoke_id | string? | 关联调用记录 |
| model_call_id | string? | |
| artifact_file_id | string? | |
| credits | int | 本步成本，run 汇总用 |
| error_code | string? | |
| started_at / finished_at | datetime? | |

---

## 5. 任务与产物

### `ai_tasks`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| user_id | string | |
| type | string | scenario / automation / chat |
| scenario_run_id | string? | |
| status | string | queued / running / succeeded / failed / blocked / cancelled |
| progress | int | 0–100 |
| input_json | json | |
| result_json | json? | |
| error_code | string? | |
| credits | int | |
| started_at / finished_at | datetime? | |
| created_at | datetime | |

### `task_artifacts`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| task_id | string | |
| file_id | string | 关联 `file_objects` |
| kind | string | report_md / report_html / report_pdf / image / video / quote |
| name | string | |
| meta_json | json? | |
| created_at | datetime | |

> 现有 `async_tasks` 继续管工具级异步；`ai_tasks` 管业务级任务，两者用 `task_id` 关联，不混用状态。

---

## 6. 知识库

### `knowledge_bases`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| key | string | compliance / product / support |
| name | string | |
| description | text? | |
| status | string | active / disabled |
| created_by | string? | |
| created_at / updated_at | datetime | |

平台级公共库，第一批不做用户自建库。

### `knowledge_documents`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| kb_id | string | |
| title | string | |
| file_id | string? | |
| mime | string? | |
| status | string | pending / parsing / ready / failed |
| version | int | |
| meta_json | json? | |

### `knowledge_chunks`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| document_id | string | |
| seq | int | |
| content | text | |
| token_count | int | |
| embedding_ref | string? | 外部向量库 ID；第一版可为空 |
| meta_json | json? | |

> 向量库选型先不锁；`embedding_ref` 留抽象。

---

## 7. AI 应用（温州业务层，不进核心）

这些是温州业务数据，不是能力中心核心；第一批不做，列在这里只为了不重复设计。

| 表 | 说明 |
|---|---|
| `ai_products` | AI 商品库，`tenant_id` + `user_id` |
| `crm_customers` | 客户，`tenant_id` + `user_id` |
| `crm_contacts` | 联系人 |
| `marketing_assets` | 营销素材，`tenant_id` + `user_id` |

都按 `user_id` 归属，不引入企业层。

---

## 8. 套餐

第一批不做套餐：

- 管理端直接给用户充值/调账。
- 积分消耗看现有钱包流水。
- 以后真需要，再加 `subscription_plans` + `user_subscriptions`，按用户购买；不现在设计。

---

## 9. 自动化

### `automation_rules`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| user_id | string | 归属用户 |
| name | string | |
| trigger_type | string | schedule / event |
| trigger_config_json | json | cron 或事件名 |
| scenario_id | string | |
| enabled | boolean | |
| created_by | string? | |
| created_at / updated_at | datetime | |

### `automation_runs`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| rule_id | string | |
| status | string | queued / running / succeeded / failed |
| scheduled_at | datetime | |
| started_at / finished_at | datetime? | |
| task_id | string? | |
| error | text? | |

---

## 10. 审计扩展

现有表只加 `scenario_run_id`（可空）：

- `invoke_records`：`scenario_run_id`
- `model_call_logs`：`scenario_run_id`、`task_id`
- `audit_events`：`scenario_run_id`

不加 `enterprise_id`；`file_objects` 已有 `userId`，不重复加。

这样一笔场景任务能串起：
`scenario_run → scenario_run_steps → invoke_records / model_call_logs → ledger_entries → audit_events`。

---

## 11. 关系草图

```
users 1-1 wallets 1-* credit_holds / ledger_entries
users 1-* scenario_runs 1-* scenario_run_steps
scenarios 1-* scenario_runs
scenario_runs 1-1 ai_tasks 1-* task_artifacts
agents 1-* scenarios
agents 1-* agent_knowledge_bases *-1 knowledge_bases
users 1-* ai_products / crm_customers / marketing_assets
```

---

## 12. 迁移顺序

1. 扩 `agents`：`kind`、输入/输出 schema、icon、sort。
2. 建 `data_sources`、`data_source_syncs`。
3. 建 `scenarios`、`scenario_steps`、`scenario_dependencies`、`scenario_runs`、`scenario_run_steps`。
4. 建 `ai_tasks`、`task_artifacts`。
5. 给 `invoke_records` / `model_call_logs` / `audit_events` 加 `scenario_run_id`。
6. 建知识库表；AI 应用表等 Phase 2/3 再建。
7. 不迁移钱包、不加企业表。
8. 种子：3 个 P0 场景、1 个演示用户、适量积分。

---

## 13. 还没锁的

1. `InvokeService` 的 deferred 计费分支——需要小改现有扣费逻辑。
2. 向量库选型（pgvector / Milvus / 云服务）。
3. `async_tasks` 与 `ai_tasks` 的边界——先分开。
4. PDF 渲染方案（headless Chromium + 中文字体）。
5. 以后要不要按用户的套餐——先不做。
