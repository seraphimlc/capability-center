# 温州 AI：交接说明

更新时间：2026-11-09
分支：`feature/wenzhou-ai-workbench`
状态：**只完成设计和能力接入，P0 业务代码还没开始写。** 后续同事可以直接在这条分支上继续。

---

## 0. 接手先看

按这个顺序读：

1. 本文
2. [场景与能力地图](WENZHOU-AI-SCENARIO-MAP.md)
3. [P0 三个工作流的配置草案](WENZHOU-AI-P0-CONFIGS.md)
4. [最小数据模型草案](WENZHOU-AI-DATA-MODEL.md)
5. [第一批开工 Checklist](WENZHOU-AI-PHASE1-CHECKLIST.md)
6. [报价表 AI 部分分析](WENZHOU-AI-QUOTE-ANALYSIS.md)（只作背景，价格/Token 不是本轮重点）

一句话：**能力中心是 AI 能力底座，温州项目是长在上面的业务层。** 21 个场景压成 9 个工作流 + 21 份配置；第一批只做选品、竞品、合规初筛。

---

## 1. 已完成

### 1.1 代码

- 商标能力已接入：3 个工具（近似商标、美国商标详情、尼斯分类），
  `mcp` 连接器、专属表单、结果组件、白标、审计掩码。
- 代码提交：`9fc904a feat: 商标 MCP 能力接入与专属表单`
- 当前 Docker 栈可运行，商标 3 个能力已在目录「合规风控」下。

### 1.2 设计文档

- 场景组合、21 场景覆盖、9 工作流、P0/P1/P2。
- P0 三个工作流的输入、步骤、降级、报告、验收样例。
- 数据模型简化为“用户即企业”，复用个人钱包。
- 第一批 Checklist。

### 1.3 已验证的真实依赖

| 依赖 | 状态 | 证据 |
|---|---|---|
| LinkFox 选品 `lf-sellersprite-product-search` | ✅ 200 | 返回 `products[]`，含标题/价格/月销量/BSR/评分/ASIN/卖家；`size` 必须 10–100 |
| LinkFox 竞品 `lf-amazon-search` | ✅ 200 | 返回 `products[]`，含标题/价格/评分/ASIN/图片 |
| xytoken 文本模型 | ✅ 200 | provider=xy，`deepseek-v4.1-flash`，测试返回“模型就绪” |
| 创知汇商标 | ✅ 代码通，额度不足 | 近似/详情/尼斯可用过；额度已耗尽，需充值 |

> 密钥只在本地 `.env`，**没有进仓库**。交接时由负责人单独给，不要写进文档或聊天。

---

## 2. 已定决策

| 主题 | 决定 |
|---|---|
| 品牌 / 多语言 | 品牌先叫「能力中心」；不做多语言 |
| 模型 | 文本走 xytoken；图片/视频先用 LinkFox AIGC |
| 前台文案 | 专家/场景/任务跟温州叫法；模型层仍是 Agent / Scenario / Run，不改表名/字段/API |
| 用户模型 | **一个用户就是一个企业账号**；不做企业管理员、子账号、部门 |
| 积分 | 复用现有个人钱包 `wallets`；按 `user_id` 扣；不做企业钱包/员工额度 |
| 套餐 | 第一批不做；管理端直接充值/调账；以后按用户加 |
| 外部能力 | 优先 LinkFox、创知汇等现有能力；自建放后面 |
| 海关/采购商 | 格兰德数据，API 或文件待确认，状态 Pending |
| 邮件 | 阿里云邮件，未申请，状态 Pending |
| 相似客户 | Pending，依赖客户数据/CRM |
| 场景组合 | 21 个场景 → 9 个工作流 + 21 份配置 |
| 第一批 | 选品决策、竞品洞察、合规初筛 |
| 报告 | 首批交付 PDF（HTML→PDF，中文字体） |
| 管理端 | 能力和专家工作台优先，场景工作台随后（范围仍待讨论） |
| 交付 | 内部复用，不单独交付平台源码 |

完整决策见 [场景地图第 10 节](WENZHOU-AI-SCENARIO-MAP.md#10-已定决策)。

---

## 3. 场景组合

| # | 工作流 | 覆盖温州场景 | 优先级 |
|---|---|---|---|
| 1 | 选品与市场分析 | 选品、行研、爆款、品类/市场机会 | **P0** |
| 2 | 竞品洞察 | 竞品 | **P0** |
| 3 | 合规初筛 | 合规 | **P0** |
| 4 | 商品内容生产 | 商品描述、智能打标 | P1（Phase 2） |
| 5 | 视觉素材生产 | 商品图/场景图 | P1（Phase 2） |
| 6 | 客户洞察与获客 | 海关、采购商、画像、相似客户 | P1（Phase 3，等格兰德） |
| 7 | 询盘报价与触达 | 需求解析、邮件、定价、报价单 | P1（Phase 3，等邮件） |
| 8 | 经营诊断 | 经营数据诊断 | P1（Phase 2） |
| 9 | 营销内容与社媒 | 营销内容、社媒、评论互动 | P2 |

规则：

- 工作流是运行时（步骤、数据、计费、审计）；配置是温州入口（表单、提示词、模板、能力）。
- 新增场景 = 新增配置，不新增流程；只有全新作业模式才新增工作流。
- 行研保留独立入口，共用工作流 1；报价单是工作流 7 的最后一步；相似客户并入工作流 6；评论互动并入工作流 9。

---

## 4. P0 三个工作流

详见 [P0 配置草案](WENZHOU-AI-P0-CONFIGS.md)。

### 4.1 选品决策

- 输入：关键词、站点、类目、售价/货本、费率/头程/广告、展示条数、Listing 文案。
- 步骤：`lf-sellersprite-product-search` → `profit-estimator` → `season-calendar` → `compliance-check` → 模型报告 → PDF。
- 站点映射：US→US、EU→DE、JP→JP；SEA 暂不支持。
- 展示条数：10–100（上游限制）。
- 选品工具失败 → 整次 failed，不降级到演示数据。

### 4.2 竞品洞察

- 输入：搜索关键词、站点（P0 只支持 US）、抓取条数。
- 步骤：`lf-amazon-search` → 取 `products[].title` → `competitor-insight` → 模型报告 → PDF。
- **不接受手填标题作为主路径**；搜索失败 → blocked、不扣费。

### 4.3 合规初筛

- 输入：商品名、Listing 文案、站点、类目、商标名。
- 步骤：`compliance-check` → 文字商标检测（可选）→ 近似商标（可选，额度不足跳过）→ 尼斯分类（可选）→ 报告 → PDF。
- 边界：只做文案 + 商标初筛，不做准入/关税/认证，不替代律师。

---

## 5. 数据模型（用户即企业）

详细字段见 [数据模型草案](WENZHOU-AI-DATA-MODEL.md)。

核心：

- **不建** `enterprises`、`enterprise_members`、企业钱包、企业订阅。
- **复用** `wallets`、`credit_holds`、`ledger_entries`。
- 场景运行：`holdKey = scenario:{runId}`；run 成功 capture，失败/取消 release。
- 新表：`data_sources`、`scenario*`、`ai_tasks`、`task_artifacts`、知识库。
- `agents` 扩 `kind` / 输入输出 schema / icon / sort。
- 现有 `invoke_records` / `model_call_logs` / `audit_events` 加 `scenario_run_id`。
- 所有业务数据按 `user_id` 隔离。

---

## 6. 代码现状

- 分支：`feature/wenzhou-ai-workbench`
- 已包含：商标 MCP 接入 + 全部设计文档。
- 未包含：P0 业务代码（场景表、运行引擎、Billing deferred、API、页面、PDF）。
- 运行：`docker compose ps` 应全部 healthy；api/www 已用当前分支代码构建过。
- 测试：`pnpm test` 在容器内需要把 `apps/` 挂载进去才能过（`surface-ui.test.js` 要读前端源码）；完整仓库环境下 26/26 通过。

---

## 7. 下一步（按顺序）

### 7.1 P0 代码

1. Prisma：`data_sources`、`data_source_syncs`、`scenarios`、`scenario_steps`、`scenario_dependencies`、`scenario_runs`、`scenario_run_steps`、`ai_tasks`、`task_artifacts`。
2. `agents` 扩 `kind` / `input_schema_json` / `output_schema_json` / `icon` / `sort`。
3. `invoke_records` / `model_call_logs` / `audit_events` 加 `scenario_run_id`。
4. `InvokeService` 加 `billingContext` + deferred 分支；场景 run 级 `WalletService` hold/capture/release。
5. 场景运行引擎（步骤、条件、失败、重试、取消）。
6. 3 个 P0 场景定义（代码/种子）。
7. API + 任务页 + 3 个专属表单 + 报告/PDF。
8. 管理端最小版（场景发布、运行记录、数据源状态）。

### 7.2 后续

- P1/P2 六个工作流配置。
- 管理端能力/专家/场景工作台。
- 格兰德海关/采购商接入；阿里云邮件接入；CRM/客户数据。
- 知识库/RAG、AI 商品库、营销中心、自动化。

---

## 8. 讨论未完成（交接给下一轮）

这些还没有定，接手同事需要继续和产品/业务确认：

| # | 议题 | 当前倾向 |
|---|---|---|
| A | P0 用户旅程与第一屏 | 任务优先；首页是任务工作台，专家和场景是入口/过滤器 |
| B | 专家体系 | 温州 8 个专家 vs 现有 12 个助手；先做平台预置，不开放用户自建 |
| C | 管理端 Phase 1 范围 | 先做场景发布、运行记录、数据源状态；能力/专家编辑器随后 |
| D | P1/P2 六个工作流配置 | 按 9 工作流表逐个补输入/输出/验收 |
| E | 场景运行规则 | required 失败整次失败、optional 跳过、模型失败模板兜底；重试/取消/通知待细定 |
| F | AI 应用/知识库/自动化边界 | 商品库、CRM、营销中心先轻量新建；知识库先合规/商品/客服 |
| G | Pending 数据源细节 | 格兰德 API/文件、字段、频率；阿里云邮件申请；相似客户数据归属 |

---

## 9. 已知风险 / 阻塞

1. **商标额度**：创知汇工具额度已耗尽，合规场景的商标步骤先跳过；充值后再验收。
2. **格兰德数据**：只有采购记录，接口形态、字段、更新频率未确认；Phase 3 才用。
3. **阿里云邮件**：未申请；邮件场景保持 Pending。
4. **PDF 渲染**：方案已定（headless Chromium + Noto Sans CJK），代码未做；容器需装字体。
5. **密钥**：LinkFox、xytoken 只在本地 `.env`，未入库；两个 key 都在聊天里出现过，建议轮换。交接时由负责人单独提供。
6. **LinkFox 参数**：`lf-sellersprite-product-search` 的 `size` 必须 10–100；`lf-amazon-search` 返回 `products[]`。
7. **未跑通 P0 端到端**：三个工具/模型分别验证过，但场景运行引擎还没写。

---

## 10. 文件地图

| 内容 | 位置 |
|---|---|
| 场景/能力/9 工作流/决策 | `docs/WENZHOU-AI-SCENARIO-MAP.md` |
| P0 三个工作流配置 | `docs/WENZHOU-AI-P0-CONFIGS.md` |
| 数据模型（用户即企业） | `docs/WENZHOU-AI-DATA-MODEL.md` |
| 第一批 Checklist | `docs/WENZHOU-AI-PHASE1-CHECKLIST.md` |
| 报价表 AI 分析（背景） | `docs/WENZHOU-AI-QUOTE-ANALYSIS.md` |
| 商标能力接入 | `docs/TRADEMARK.md` |
| 商标后端 | `services/api/src/mcp.service.ts`、`trademark-tools.ts` |
| 商标前端 | `apps/www/src/tools/` |
| 现有能力目录 | `services/api/src/catalog.controller.ts`、`apps/www/src/app/page.tsx` |
| 现有调用/计费 | `services/api/src/invoke.service.ts`、`wallet.service.ts` |
| 现有专家/对话 | `services/api/src/agent.service.ts`、`apps/www/src/app/agents/` |
| 现有模型网关 | `services/api/src/model.service.ts` |

---

## 11. 接手第一步

```bash
git switch feature/wenzhou-ai-workbench
git pull

# 复制并填写环境变量（不要提交）
cp .env.example .env
# 必填：LLM_API_KEY 或 XY_API_KEY；LINKFOX_API_KEY；商标相关 token

docker compose up -d
docker compose ps
```

然后按第 0 节顺序读文档，从第 7.1 节的 P0 代码第 1 步开始。
