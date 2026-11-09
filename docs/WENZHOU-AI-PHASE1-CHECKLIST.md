# 温州 AI：第一批（选品 / 竞品 / 合规初筛）开工 Checklist

分支：`feature/wenzhou-ai-workbench`
状态：开工前准备清单，不含业务代码。
第一批不依赖格兰德数据、阿里云邮件、CRM 和知识库 RAG；只验证“专家 → 场景 → 任务 → 计费 → 审计 → 产物”这条主链路。

> 文档里的“专家/场景/任务”是前台叫法；代码和表里仍是 Agent / Scenario / Run，不做模型改名。

第一批对应 9 个工作流里的 3 个 P0：选品与市场分析、竞品洞察、合规初筛。具体配置见 [P0 配置草案](WENZHOU-AI-P0-CONFIGS.md)；其余 6 个工作流见 [场景与能力地图](WENZHOU-AI-SCENARIO-MAP.md) 的 1.2。

---

## 0. 范围

### 做

- 3 个场景：选品决策、竞品洞察、合规初筛。
- 企业 + 企业积分账户 + 员工子额度（最小版）。
- 专家/场景/任务/运行步骤/产物。
- 场景运行 API + 任务页 + 场景卡片。
- 管理端：场景列表/发布、数据源状态、运行记录（最小版）。
- 审计链路：场景运行 → 步骤 → 调用/模型 → 积分 → 审计。

### 不做

- 海关/采购商/邮件/相似客户（Pending）。
- 报价单、CRM、AI 商品库完整版、营销中心。
- 知识库 RAG（合规初筛先用现有合规工具 + 提示词）。
- 自动化/定时任务。
- 套餐支付、发票、退款。
- 多语言、品牌白标。

---

## 1. 公共底座 Checklist

### 1.1 数据模型

- [ ] `enterprises`、`enterprise_members`
- [ ] `credit_accounts`、`enterprise_credit_holds`、`enterprise_credit_ledger`
- [ ] `data_sources`（先建表和状态，不接真实数据）
- [ ] `scenarios`、`scenario_steps`、`scenario_dependencies`、`scenario_runs`、`scenario_run_steps`
- [ ] `ai_tasks`、`task_artifacts`
- [ ] `agents` 扩展字段：`kind`、`input_schema_json`、`output_schema_json`、`visibility`、`enterprise_id`
- [ ] 现有表加可空列：`invoke_records.enterprise_id`、`scenario_run_id`；`model_call_logs.enterprise_id`、`scenario_run_id`、`task_id`；`audit_events.enterprise_id`、`scenario_run_id`

### 1.2 计费

- [ ] `BillingService`：`hold` / `capture` / `release` / `snapshot` / `grant`
- [ ] 场景运行开始前按预估积分 hold，成功后 capture，失败/取消 release
- [ ] 每个步骤调 `InvokeService` / 模型时传 `billingContext`，标记 deferred：只记录本步成本，不单独 hold/capture
- [ ] run 成功后按步骤成本合计 capture 一次；失败/取消 release 全部，不扣费
- [ ] 账本 `biz_type=scenario`、`biz_id=run_id`；`(biz_type,biz_id)` 唯一防重复
- [ ] 禁止同一笔同时写企业账本和个人账本
- [ ] 场景本身不加价，按步骤实际调用/模型成本累加
- [ ] 企业余额不足：运行前阻断，返回 `INSUFFICIENT_CREDITS`，不建运行记录或标记 failed

### 1.3 运行引擎

- [ ] 场景定义可代码/种子写入，不做可视化编排器
- [ ] 步骤类型：`tool` / `model` / `approval`（第一批只用 tool + model）
- [ ] 步骤输入映射：场景输入 → 工具入参；上游结果 → 下一步入参
- [ ] 任一步失败：整次运行 failed，释放 hold，不扣费；已成功步骤保留记录
- [ ] 可选步骤失败：标记 skipped，不阻断整次运行（如商标可选）
- [ ] 运行状态：queued / running / awaiting_confirm / succeeded / failed / blocked / cancelled
- [ ] 不支持并发重跑同一 run；重跑算新 run

### 1.4 API

建议端点（最终以代码为准）：

```
GET    /api/www/ai/scenarios
GET    /api/www/ai/scenarios/:key
POST   /api/www/ai/scenarios/:key/runs
GET    /api/www/ai/runs/:id
POST   /api/www/ai/runs/:id/cancel
GET    /api/www/ai/runs
GET    /api/www/ai/tasks
GET    /api/www/ai/tasks/:id
GET    /api/www/ai/tasks/:id/artifacts
```

管理端：

```
GET    /api/admin/ai/scenarios
PUT    /api/admin/ai/scenarios/:id        # 发布/下架、改名称/说明
GET    /api/admin/ai/runs
GET    /api/admin/ai/data-sources
PUT    /api/admin/ai/data-sources/:id     # 状态、负责人、备注
```

### 1.5 前端

- [ ] `/ai`：场景卡片 + 最近任务
- [ ] `/ai/scenarios/[key]`：每个场景一个专属表单，不做通用表单
- [ ] `/ai/runs/[id]`：步骤状态、每步输入/输出、积分、错误、产物下载
- [ ] `/ai/tasks`：任务列表
- [ ] 复用现有 Shell、`api`、`Field`、结果组件风格
- [ ] 待接入数据源的步骤显示“待接入”，不可运行

### 1.6 管理端

- [ ] 场景列表：状态、步骤数、依赖数据源、发布/下架
- [ ] 运行记录：企业、用户、场景、状态、积分、耗时
- [ ] 数据源：海关/采购商/邮件状态为 pending，负责人/备注
- [ ] 专家列表：把“助手”文案改为“专家”（先只改文案和导航）

### 1.7 审计与隔离

- [ ] 每个步骤写 `scenario_run_steps`，关联 `invoke_id` / `model_call_id`
- [ ] `invoke_records` / `model_call_logs` / `audit_events` 带 `scenario_run_id`
- [ ] 企业隔离：所有查询带 `enterprise_id`；平台运营代查只读
- [ ] 运行产物写 `task_artifacts` + MinIO，按企业/任务隔离

---

## 2. 场景 1：选品决策

### 输入

- 关键词（必填）
- 站点（默认 US）
- 成本、目标售价（可选）
- 类目（可选）
- 结果数量（默认 5）

### 步骤

```
1. 选品简报（product-picker）
2. 竞品关键词洞察（competitor-insight，可选）
3. 利润测算（profit-estimator，有成本/售价时）
4. 季节选品日历（season-calendar）
5. Listing 合规检查（compliance-check，可选）
6. 生成选品报告（model）
```

### 复用能力

`product-picker`、`competitor-insight`、`profit-estimator`、`season-calendar`、`compliance-check`。全部为非绑店工具，第一批不需要店铺授权。

### 产物

- 选品报告（Markdown/HTML，存 MinIO）
- 步骤明细（每步工具、入参、结果摘要、耗时、积分）
- 评分/结论（模型生成，标注“基于工具结果”）

### 验收

- [ ] 用样例输入完整跑通，状态 `succeeded`
- [ ] 至少 4 个步骤有 invoke 记录
- [ ] 报告可下载，内容引用工具结果而非编造
- [ ] 积分按步骤实际扣减，账本可追溯
- [ ] 任一步失败时整次运行 failed，hold 释放，不扣费
- [ ] 企业 A 看不到企业 B 的运行和产物

---

## 3. 场景 2：竞品洞察

### 输入

- 关键词 / ASIN / 竞品标题（至少一个）
- 站点（默认 US）
- 结果数量（默认 10）
- 店铺（可选；部分工具需绑店）

### 步骤

```
1. 竞品关键词洞察（competitor-insight）
2. 选品数据竞品查询（lf-sellersprite-competitor-lookup，可选）
3. 亚马逊商品评论（lf-amazon-reviews-list，可选）
4. 监控亚马逊竞品动态（lf-expert-amazon-competitor-monitor，需绑店，可选）
5. 生成竞品报告（model）
```

### 注意

- `lf-expert-amazon-competitor-monitor`、部分 LinkFox 工具是需绑店工具；没有店铺时跳过，不阻断。
- 先只做“单次洞察”，不做定时监控；定时监控归自动化阶段。

### 验收

- [ ] 无店铺也能跑通（跳过绑店步骤）
- [ ] 有店铺时能带上店铺上下文
- [ ] 报告包含价格/评论/差距/建议，引用工具结果
- [ ] 可选步骤失败不阻断整次运行
- [ ] 积分/审计/隔离同上

---

## 4. 场景 3：合规初筛

### 输入

- 商品名称（必填）
- 类目（可选）
- 目标国家（默认 US）
- Listing 文案（可选）
- 商品图片（可选）
- 商标名称（可选）

### 步骤

```
1. Listing 合规检查（compliance-check）
2. 近似商标检索（trademark-similar-search，可选）
3. 尼斯分类查询（trademark-nice-class，可选）
4. 生成合规报告（model）
```

### 注意

- 商标能力当前上游额度不足：可作为**可选步骤**，失败标记 skipped，不阻断整次合规初筛。
- 合规知识库/RAG 不在第一批；先用 `compliance-check` + 模型 + 固定免责声明。
- 报告必须写“不构成法律意见”。

### 验收

- [ ] 无商标额度也能完成基础合规初筛
- [ ] 商标步骤成功时结果进入报告；失败时报告注明“商标检索未完成”
- [ ] 报告含风险项、建议、免责声明
- [ ] 不扣未成功步骤的积分
- [ ] 企业隔离/审计同上

---

## 5. 开工顺序

1. **数据模型 + 迁移**（企业、积分账户、场景、任务、产物、审计列）。
2. **BillingService**（企业账户、hold/capture/release、账本）。
3. **场景/任务运行引擎**（定义、步骤、状态、错误、重试边界）。
4. **3 个场景定义**（代码/种子；先跑 mock 工具）。
5. **API**（运行、查询、取消、任务、产物）。
6. **前端**（场景卡片、3 个专属表单、运行详情、任务列表）。
7. **管理端最小版**（场景发布、运行记录、数据源状态、专家文案）。
8. **联调与演示**（样例数据、失败路径、企业隔离、审计链路）。

---

## 6. Definition of Done

- [ ] 一个演示企业、两个员工账号（管理员/成员）。
- [ ] 3 个场景 published，均有专属表单。
- [ ] 3 个场景各跑成功 1 次，报告可下载。
- [ ] 失败路径：任一步失败 → run failed → hold released → 不扣费。
- [ ] 积分：企业账户扣减、员工发起人记录、账本可查。
- [ ] 审计：run → steps → invoke/model → ledger/audit 可串联。
- [ ] 隔离：企业 A 无法看到企业 B 的任务/产物/账单。
- [ ] 管理端能发布/下架场景，能看运行记录。
- [ ] 不依赖格兰德、阿里云邮件、知识库。

---

## 7. 依赖与风险

| 项 | 状态 | 影响 |
|---|---|---|
| LinkFox 密钥/额度 | 已配置，部分上游可能鉴权失败 | 场景步骤需可选/降级，不能整单失败 |
| 商标上游额度 | 已耗尽 | 合规场景商标步骤设为可选 |
| 店铺授权 | 只有演示店铺 | 竞品绑店步骤先跳过或用手动店铺 |
| 模型 xytoken | 已配置 | 报告生成依赖模型，需超时/备用 |
| 格兰德数据 | Pending | 第一批不用 |
| 阿里云邮件 | 未申请 | 第一批不用 |
| 知识库 | 未建 | 合规报告先用固定规则+模型 |

---

## 8. 明确不在第一批

- 海关获客、采购商获客、采购商画像、相似客户扩量
- 自动邮件触达
- 自动报价单
- AI 商品库完整版、CRM、营销中心
- 定时/事件自动化
- 套餐支付、发票
- 多语言、品牌白标
- 可视化场景编排器
