# AI 工作台 P0 产品方案

状态：产品方案，不含业务代码。
目标：把 500 行/79 条里最核心的“专家、任务、场景、报告”做成能力中心可复用的产品模块，而不是客户定制页面。

## 1. P0 范围

### 做

- 专家中心：任务型专家、专家页、任务入口、反馈/统计基础
- 任务中心：统一任务、生命周期、重试/取消、产物、通知、成本
- 场景/工作流运行时：场景定义、步骤、输入/输出校验、运行、记录
- 报告中心：HTML→PDF、来源、免责声明、下载、归档
- 计费：复用个人钱包，run 级 hold/capture/release
- 管理端最小版：专家/场景发布、任务/运行查看、数据源状态

### 不做

- 企业/企业管理员/子账号
- 套餐/订单/支付
- 知识库/RAG
- AI 商品库/CRM/店铺/营销
- 自动化（定时/事件）
- 开放平台增强（文档/沙箱/Webhook）
- 可视化表单搭建器、拖拽场景编排器
- 多语言、品牌白标

## 2. 产品模型

| 概念 | 前台叫法 | 说明 |
|---|---|---|
| Agent | 专家 | 角色、提示词、技能、知识库（P1）、模型、输入/输出契约 |
| Scenario | 场景 | 一份代码/种子定义的步骤模板，不是用户拖拽出来的 |
| Task | 任务 | 用户提交的一次作业，用户可见 |
| Run | 运行 | 场景的执行实例；一个任务最多一个 run（P0） |
| Artifact | 产物 | 报告/图片/文件，关联 task |

规则：

- 用户提交一次 → 创建一个 `ai_task`。
- 如果任务执行场景 → 创建 1:1 的 `scenario_run`。
- 纯聊天不建 task；聊天里点“转任务”才建。
- 一个用户就是一个企业账号，任务/产物按 `user_id` 隔离。

## 3. 模块边界

### 3.1 专家中心

- 专家列表：只展示 published 的 agents，按 kind/场景筛选。
- 专家详情：角色、简介、可用技能、示例任务、最近使用。
- 专家任务：按专家自己的输入契约渲染专属表单（不做通用 schema 表单）。
- 专家对话：保留现有 SSE 对话；对话里可“转任务”。
- 反馈/统计：任务结果评分、成功/失败、耗时、积分；P0 只做基础。

### 3.2 任务中心

- 列表：状态、场景、专家、时间、积分；分页/筛选。
- 详情：输入、步骤、每步结果、产物、错误、耗时、积分。
- 操作：重试、取消、下载产物、查看调用记录。
- 通知：完成/失败写站内信；邮件后置。
- 成本：按步骤展示实际积分/模型成本。
- 模板/优先级/依赖/日志：P1，不在 P0 实现。

### 3.3 场景运行时

- 场景定义：代码/种子写入，`status=draft/published`，不做可视化编排。
- 步骤类型：`tool` / `model` / `approval`（P0 只用 tool + model）。
- 输入校验：按场景 schema 校验必填/类型/枚举。
- 条件/可选步骤：如商标步骤额度不足时 skipped。
- 运行：顺序执行、每步记录、失败释放、成功 capture。
- 输出校验：报告章节/必填字段/引用完整性。
- 运行记录：列表/详情/步骤/产物。
- 版本/灰度/对比：P1。

### 3.4 报告中心

- 模板：Markdown/HTML 模板，P0 用代码内置模板。
- PDF：HTML→PDF，headless Chromium，中文字体 Noto Sans CJK。
- 内容：结论、数据来源、免责声明、生成时间。
- 产物：`report.md` / `report.html` / `report.pdf`，存 MinIO。
- 下载/归档：按用户/任务隔离，默认保留 180 天。
- 分享/版本：P1。

### 3.5 计费

- 复用 `wallets` / `credit_holds` / `ledger_entries`。
- 场景 run 开始：`holdKey=scenario:{runId}`，按预估积分 hold。
- 步骤调用：`InvokeService` 带 `deferred` 上下文，只记录成本，不单独扣。
- run 成功：按步骤合计 capture 一次。
- run 失败/取消：release，不扣费。
- 旧调用：继续走原有 hold/capture，不受影响。

### 3.6 管理端

- 专家：列表、发布/下架、基础统计。
- 场景：列表、发布/下架、步骤查看、试跑。
- 任务/运行：列表、详情、失败原因。
- 数据源：状态、负责人、备注（P0 只展示，不接真实数据）。
- 不做用户/企业的复杂权限；平台运营统一管理。

## 4. 数据模型

复用/新增：

- 扩 `agents`：`kind`、`input_schema_json`、`output_schema_json`、`icon`、`sort`。
- 新增 `scenarios`、`scenario_steps`、`scenario_dependencies`。
- 新增 `scenario_runs`、`scenario_run_steps`。
- 新增 `ai_tasks`、`task_artifacts`。
- 现有 `invoke_records` / `model_call_logs` / `audit_events` 加 `scenario_run_id`。
- 不建企业表、企业钱包、套餐表。

完整字段见 [数据模型](WENZHOU-AI-DATA-MODEL.md)。

## 5. API 草案

用户端：

```
GET    /api/www/ai/experts
GET    /api/www/ai/experts/:key
POST   /api/www/ai/experts/:key/tasks
GET    /api/www/ai/tasks
GET    /api/www/ai/tasks/:id
POST   /api/www/ai/tasks/:id/retry
POST   /api/www/ai/tasks/:id/cancel
GET    /api/www/ai/tasks/:id/artifacts
GET    /api/www/ai/scenarios
GET    /api/www/ai/scenarios/:key
POST   /api/www/ai/scenarios/:key/runs
GET    /api/www/ai/runs/:id
POST   /api/www/ai/runs/:id/cancel
```

管理端：

```
GET/PUT /api/admin/ai/experts
GET/PUT /api/admin/ai/scenarios
GET     /api/admin/ai/tasks
GET     /api/admin/ai/runs
GET/PUT /api/admin/ai/data-sources
```

## 6. 页面

- `/ai`：工作台首页（任务输入 + 最近任务 + 专家/场景入口）
- `/ai/experts/[key]`：专家页（对话/任务/示例/统计）
- `/ai/tasks`：任务列表
- `/ai/tasks/[id]`：任务详情（步骤/产物/错误/积分）
- `/ai/scenarios/[key]`：场景表单/运行
- `/ai/runs/[id]`：运行详情（可并入任务详情）
- 管理端：`/admin/ai/experts`、`/admin/ai/scenarios`、`/admin/ai/runs`、`/admin/ai/data-sources`

## 7. 状态机

`ai_task` / `scenario_run`：

```
queued → running → awaiting_confirm → succeeded
                  ↘ failed
                  ↘ blocked
                  ↘ cancelled
```

`scenario_run_steps`：

```
pending → running → succeeded
                  ↘ failed
                  ↘ skipped
                  ↘ blocked
```

规则：

- required 步骤失败 → run failed，释放 hold，不扣费。
- optional 步骤失败 → skipped，继续。
- run 失败/取消 → task 同步 failed/cancelled。
- 重试算新 task/run，不复用旧 run。

## 8. 验收标准（P0）

### 专家任务

- 专家页能提交任务，生成 `ai_task`。
- 任务详情能看到步骤、每步结果、产物、积分。
- 失败时有明确错误码/提示。

### 任务中心

- 列表能按状态/场景/时间筛选。
- 重试/取消生效；取消释放积分。
- 产物可下载；用户 A 看不到用户 B 的任务。

### 场景运行时

- 选品/竞品/合规三个 P0 场景能跑通。
- 可选步骤失败不阻断整次运行。
- 输入校验失败有字段级提示。
- 运行记录能串到 invoke/model/ledger/audit。

### 报告

- 生成 PDF，中文不乱码。
- 含来源标注、免责声明、生成时间。
- 报告可下载、归档。

### 计费

- run 级 hold，成功 capture 一次，失败 release。
- 不出现同一笔双扣。
- 积分不足运行前阻断。

## 9. 依赖与风险

| 项 | 状态 | 影响 |
|---|---|---|
| xytoken 模型 | 已配置 | 报告/对话依赖 |
| LinkFox 选品/竞品 | 已验证 | 选品/竞品场景依赖 |
| 商标额度 | 不足 | 合规场景商标步骤可选 |
| PDF 渲染 | 未实现 | 需 headless Chromium + 中文字体 |
| 格兰德/邮件 | Pending | P0 不用 |
| 知识库 | 未建 | P1 再做 |

## 10. 开工顺序

1. 数据模型/迁移：agents 扩展、scenarios、runs、tasks、artifacts。
2. `WalletService` 复用 + deferred 计费。
3. 任务/场景运行时。
4. 三个 P0 场景定义。
5. API。
6. 专家页、任务页、场景页。
7. 报告/PDF。
8. 管理端最小版。
9. 验收用例 + 演示数据。

## 11. 待定

1. `ai_tasks` 和 `scenario_runs` 是否合并（P0 先分开）。
2. 产物保留期是否 180 天。
3. 任务通知只站内信，还是首批加邮件。
4. 专家聊天历史是否单独建表，还是复用 `messages`。
5. PDF 渲染放 API 进程还是独立 worker。
