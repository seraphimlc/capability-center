# 温州 AI：最小数据模型草案

分支：`feature/wenzhou-ai-workbench`
状态：设计草案，不含业务代码。
原则：**只加不破**；现有表能扩就扩，不能扩再加新表；所有企业数据带 `enterprise_id`。
命名：本文表名/字段名是平台通用名；前台可以按温州叫法显示“专家/场景/任务”，但**不改模型名**。

---

## 0. 先解决一个根本变化

现在的积分是**个人钱包**：

```
wallets.user_id @unique
credit_holds (user_id, invoke_id)
ledger_entries (user_id, biz_type, biz_id)
```

温州要求**单平台多企业、积分/套餐按企业**，所以目标模型是：

```
enterprise 1-1 credit_account（企业积分池）
enterprise 1-* enterprise_member（企业成员）
credit_account 1-* credit_hold / credit_ledger（企业账本）
member 可选 user_credit_limit（员工子额度）
```

现有个人钱包不立刻删，作为历史兼容；新代码统一走 `BillingService`，由它决定扣企业账户还是个人账户。业务代码不再直接调用 `WalletService`。

---

## 1. 企业与成员

### `enterprises`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | 平台租户（能力中心） |
| name | string | 企业名称 |
| code | string? | 企业编码，唯一 |
| status | string | active / suspended / deleted |
| contact_name | string? | 联系人 |
| contact_phone | string? | 联系电话 |
| created_by | string? | 平台运营 |
| created_at / updated_at | datetime | |

### `enterprise_members`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| enterprise_id | string | |
| user_id | string | 关联 `users` |
| role | string | enterprise_admin / member |
| status | string | active / disabled |
| monthly_credit_limit | int? | 员工月额度，空=不限 |
| created_at | datetime | |

唯一键：`(enterprise_id, user_id)`。

> 企业角色放 membership，不改 `users.role`。`users.role` 继续表示平台角色（super_admin / ops / end_user）。

---

## 2. 企业积分账户

### `credit_accounts`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| enterprise_id | string | 唯一 |
| balance | int | 企业积分余额 |
| currency | string | CNY |
| status | string | active / frozen |
| updated_at | datetime | |

### `enterprise_credit_holds`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| enterprise_id | string | |
| account_id | string | |
| user_id | string | 发起人，审计用 |
| hold_key | string | 唯一，场景/任务/调用级 |
| amount | int | 预留积分 |
| status | string | open / captured / released |
| expires_at | datetime? | 防止死锁 |
| created_at / updated_at | datetime | |

### `enterprise_credit_ledger`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| enterprise_id | string | |
| account_id | string | |
| user_id | string | 发起人 |
| type | string | grant / consume / adjust / refund |
| amount | int | 正负 |
| balance_after | int | |
| biz_type | string | scenario / invoke / model / package / adjust |
| biz_id | string | |
| note | string? | |
| request_id | string? | |
| created_at | datetime | |

唯一键：`(biz_type, biz_id)` 防重复记账。

### `user_credit_limits`（可选，第一版可空）

| 字段 | 类型 | 说明 |
|---|---|---|
| enterprise_id | string | |
| user_id | string | |
| period | string | yyyy-MM |
| monthly_limit | int | |
| used | int | |
| updated_at | datetime | |

> 第一版可以只用 `enterprise_members.monthly_credit_limit`，不单独建表；等要做员工额度看板再加。

### `BillingService` 契约

```
hold(enterpriseId, userId, holdKey, amount)
capture(enterpriseId, holdKey, bizType, bizId, amount, note)
release(enterpriseId, holdKey)
snapshot(enterpriseId, userId?)
grant(enterpriseId, amount, bizType, bizId, note)
```

所有扣费方（`InvokeService`、`AgentService`、场景任务、异步任务）只依赖这个接口，不直接操作表。

### 2.1 场景计费接线（关键）

场景是“一次任务一次扣费”，但内部步骤会调用工具和模型，不能每一步各扣一次再退款。建议：

- 场景 run 开始：按场景预估积分，在企业账户 hold 一次。
- 每个 step 调 `InvokeService` 时传 `billingContext = { enterpriseId, userId, runId, stepId }`，标记 `deferred`：**只记录本步实际成本，不单独 hold/capture**。
- 模型调用同理：`ModelService` 记录本步 token/成本，不单独扣。
- run 成功：按 `scenario_run_steps.credits` 合计 capture 一次，写一条账本 `biz_type=scenario, biz_id=runId`。
- run 失败/取消：release 全部 hold，不写 consume；已成功步骤只留记录，不扣费。
- 旧调用（没有 scenario context）：继续走个人 `WalletService`，保持兼容。
- **禁止同一笔同时写企业账本和个人账本。**

这样才符合“失败/取消不扣、重试算新任务”。

---

## 3. 数据源（Pending 的落点）

### `data_sources`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| key | string | customs_grand / buyers_grand / email_aliyun |
| name | string | 海关数据（格兰德） |
| category | string | customs / buyer / email / other |
| provider | string | 格兰德 / 阿里云 |
| mode | string | api / file / smtp |
| status | string | ready / pending / to_build |
| connector_id | string? | 关联 `connectors`，实际调用走这里 |
| config_enc | text | API key、文件路径、SMTP 配置等 |
| fields_json | json? | 字段映射说明 |
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
| rows | int | 导入/返回条数 |
| file_id | string? | 文件模式的上传文件 |
| error | text? | |
| started_at / finished_at | datetime | |

> 格兰德如果是文件：先导入 `data_source_syncs` + 本地快照表；如果是 API：同步记录只做审计。两种模式共用 `DataSourceAdapter`。

---

## 4. 专家（扩展现有 agents）

不新建专家表，直接给 `agents` 加字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| kind | string | chat / task / both，默认 both |
| input_schema_json | json? | 任务型专家入参 |
| output_schema_json | json? | 输出契约 |
| visibility | string | platform / enterprise，默认 platform |
| enterprise_id | string? | visibility=enterprise 时使用 |
| icon | string? | |
| sort | int | |

新增关联表：

### `agent_knowledge_bases`

| 字段 | 类型 |
|---|---|
| agent_id | string |
| knowledge_base_id | string |
| enabled | boolean |

> 技能继续用 `agent_tools`；MCP 继续用 `connectors` + `agent_tools`/后续 `agent_connectors`；先不扩。

---

## 5. 场景与运行

### `scenarios`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| key | string | selection-decision / competitor-insight / compliance-screening |
| name | string | |
| summary | string | |
| expert_id | string? | 归属专家 |
| input_schema_json | json | 场景入参 |
| output_schema_json | json | 产物契约 |
| status | string | draft / published / archived |
| visibility | string | platform / enterprise |
| enterprise_id | string? | |
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
| enterprise_id | string | |
| scenario_id | string | |
| user_id | string | |
| status | string | queued / running / awaiting_confirm / succeeded / failed / blocked / cancelled |
| input_json | json | |
| output_json | json? | |
| error_code | string? | |
| error_message | text? | |
| credits | int | 实扣 |
| task_id | string? | 关联 `ai_tasks` |
| started_at / finished_at | datetime? | |
| created_at | datetime | |

> `task_id` 可为空；为避免循环依赖，建议以 `ai_tasks.scenario_run_id` 为唯一关联，run 侧不重复维护。

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
| credits | int | 本步实际成本，run 汇总用 |
| error_code | string? | |
| started_at / finished_at | datetime? | |

---

## 6. 任务与产物

### `ai_tasks`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| enterprise_id | string | |
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
| id | string | ULID |
| task_id | string | |
| file_id | string | 关联 `file_objects` |
| kind | string | report / image / video / quote / export |
| name | string | |
| meta_json | json? | |
| created_at | datetime | |

> 现有 `async_tasks` 继续管工具级异步（视频任务等）；`ai_tasks` 管业务级任务，两者用 `task_id` 关联，不混用状态。

---

## 7. 知识库

### `knowledge_bases`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| enterprise_id | string? | 空=平台公共库 |
| key | string | compliance / product / support |
| name | string | |
| description | text? | |
| status | string | active / disabled |
| visibility | string | platform / enterprise |
| created_by | string? | |
| created_at / updated_at | datetime | |

### `knowledge_documents`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| kb_id | string | |
| title | string | |
| file_id | string? | 原文件 |
| mime | string? | |
| status | string | pending / parsing / ready / failed |
| version | int | |
| meta_json | json? | |

### `knowledge_chunks`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| document_id | string | |
| seq | int | |
| content | text | |
| token_count | int | |
| embedding_ref | string? | 外部向量库 ID；第一版可为空，用应用层关键词/余弦 |
| meta_json | json? | |

> 向量库选型（pgvector / Milvus / 云服务）先不锁；`embedding_ref` 留抽象，避免第一版被数据库绑死。

---

## 8. AI 应用

### `ai_products`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id / enterprise_id | string | |
| source | string | ai / store / manual |
| platform | string? | amazon / shopify / ... |
| store_id | string? | 关联 `shop_accounts` |
| external_id | string? | 平台商品 ID |
| title | string | |
| category | string? | |
| attributes_json | json? | |
| images_json | json? | |
| cost / price | decimal? | |
| currency | string | CNY |
| status | string | draft / ready / archived |
| created_by | string? | |
| created_at / updated_at | datetime | |

### `crm_customers`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id / enterprise_id | string | |
| name | string | |
| country | string? | |
| website | string? | |
| source | string | grand / manual / inquiry |
| tags_json | json? | |
| owner_user_id | string? | |
| status | string | active / archived |
| created_at / updated_at | datetime | |

### `crm_contacts`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| customer_id | string | |
| name | string? | |
| title | string? | |
| email | string? | |
| phone | string? | |
| linkedin | string? | |
| consent_status | string | unknown / opted_in / opted_out |
| source | string? | |

### `marketing_assets`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id / enterprise_id | string | |
| type | string | image / video / copy / email / poster |
| channel | string? | facebook / instagram / linkedin / tiktok / email |
| title | string? | |
| content | text? | |
| file_id | string? | |
| status | string | draft / ready / archived |
| created_by | string? | |
| created_at | datetime | |

---

## 9. 套餐与权益（先不做支付）

### `subscription_plans`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id | string | |
| key | string | |
| name | string | |
| credits_per_period | int | 每周期积分 |
| period | string | month |
| features_json | json? | 专家/场景/知识库权限 |
| status | string | active / archived |

### `enterprise_subscriptions`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id / enterprise_id | string | |
| plan_id | string | |
| status | string | active / expired / cancelled |
| started_at | datetime | |
| expires_at | datetime | |
| credits_per_period | int | |
| auto_renew | boolean | 先 false |

### `entitlements`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| enterprise_id | string | |
| feature_key | string | expert / scenario / kb / api |
| quota | int? | 空=不限 |
| used | int | |
| period | string? | |

### `credit_grants`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| enterprise_id | string | |
| amount | int | |
| source | string | package / admin / refund |
| biz_id | string | |
| expires_at | datetime? | |
| created_at | datetime | |

> 支付、发票、退款先不做；套餐由平台运营代开。

---

## 10. 自动化

### `automation_rules`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | ULID |
| tenant_id / enterprise_id | string | |
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

## 11. 审计字段扩展

以下现有表加**可空列**，不改变旧语义：

- `invoke_records`：`enterprise_id`、`scenario_run_id`
- `model_call_logs`：`enterprise_id`、`scenario_run_id`、`task_id`
- `audit_events`：`enterprise_id`、`scenario_run_id`
- `file_objects`：`enterprise_id`

这样一笔场景任务能串起：`scenario_run → scenario_run_steps → invoke_records / model_call_logs → credit_ledger → audit_events`。

---

## 12. 关系草图

```
enterprises 1-1 credit_accounts 1-* enterprise_credit_ledger
enterprises 1-* enterprise_members *-1 users
enterprises 1-* scenarios 1-* scenario_steps
scenarios 1-* scenario_runs 1-* scenario_run_steps
scenario_runs 1-1 ai_tasks 1-* task_artifacts
agents 1-* agent_knowledge_bases *-1 knowledge_bases
knowledge_bases 1-* knowledge_documents 1-* knowledge_chunks
enterprises 1-* ai_products / crm_customers / marketing_assets
```

---

## 13. 迁移顺序

1. 建企业、成员、企业积分账户、账本、预留（新表，不动旧钱包）。
2. 给现有审计/调用/模型表加可空列。
3. 建 `data_sources`、`scenario_*`、`ai_tasks`、`task_artifacts`。
4. 建专家扩展字段、知识库、AI 应用表。
5. 建套餐/权益/自动化表。
6. 引入 `BillingService`，新场景走企业账户；旧调用保持个人钱包，双轨运行。
7. 数据回填：把试点企业、成员、积分账户、数据源、场景种子写进去。

---

## 14. 这个草案里还没锁的

1. 向量库选型（pgvector / Milvus / 云服务）——先留 `embedding_ref`，第一版可用关键词检索。
2. `async_tasks` 与 `ai_tasks` 是否需要合并——先分开，边界清楚。
3. 旧个人钱包何时停用——等企业账户跑稳后再切，避免一次性改所有扣费。
4. 格兰德数据是 API 还是文件——两种都支持，先按文件导入 + 适配器封装。
5. 员工额度是否单独建表——第一版先用 membership 字段。
6. `data_sources.config_enc` 第一版沿用现有 `config_enc` 明文 JSON，生产前要加密/KMS。
7. 场景 run 的预估积分算法——第一版可以用步骤历史均值或固定上限，后续再校准。
