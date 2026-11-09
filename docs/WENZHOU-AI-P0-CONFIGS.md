# 温州 AI：P0 三个工作流的配置草案

分支：`feature/wenzhou-ai-workbench`
状态：配置草案，不含业务代码。
范围：9 个工作流中的 3 个 P0——选品与市场分析、竞品洞察、合规初筛。
原则：一个工作流一个运行时，一个温州入口一份配置；表单按入口写，不做通用表单。

---

## 0. 公共约定

### 0.1 配置结构

每份配置包含：

```
key            工作流 key
mode           入口/模式（温州前台看到的场景）
label          前台名称
agent          归属专家（Agent）
input_schema   表单字段
steps          步骤（tool / model / conditional）
output         产物结构
fallback       失败/降级
acceptance     验收样例
```

### 0.2 步骤规则

- 步骤顺序执行；`required` 步骤失败 → 整次运行 `failed`，释放 hold，不扣费。
- `optional` 步骤失败 → 标记 `skipped`/`failed_optional`，继续后续步骤，报告注明。
- `conditional` 步骤只在输入满足条件时执行（如填了成本/售价才做利润测算）。
- 模型步骤只负责“基于工具结果写报告”，不允许编造工具没返回的数字。
- 模型调用失败时，用模板生成基础报告，不让整次运行失败。

### 0.3 P0 选工具的原则

- 不把工具的完整 schema 直接渲染成表单；每个入口只暴露 3–6 个业务字段。
- 底层可以用字段很多的大工具（如 `lf-sellersprite-product-search` 有 110 个字段），但表单只映射需要的字段。
- 不用需要 `taskId`、异步轮询、或 `x-fill-status` 为 `stub/schema_only/error` 的工具。
- LinkFox 需绑店的工具先不用；P0 三个工作流都不依赖店铺授权。
- 同一能力只调用一次；不在场景里直连上游。

### 0.4 产物

- `report.md`：报告源文件。
- `report.html`：PDF 的中间产物。
- `report.pdf`：**首批必需**；用 headless Chromium/HTML→PDF 生成，容器需装中文字体（Noto Sans CJK）。
- `run.json`：步骤、工具、入参、结果摘要、耗时、积分、错误。
- 产物写 `task_artifacts` + MinIO，按用户隔离。

---

## 1. 选品与市场分析 / mode：选品决策

### 1.1 基本信息

| 项 | 值 |
|---|---|
| key | `selection-analysis` |
| mode | `selection` |
| 前台名称 | 选品决策 |
| 归属专家 | 选品顾问（`buyer-assistant`） |
| 目标用户 | 业务员/选品人员，判断一个品类/关键词值不值得做 |
| 不做什么 | 不做采购下单、不做供应商谈判、不做实时销量承诺 |

### 1.2 输入表单

| 字段 | 类型 | 必填 | 默认 | 说明 | 映射 |
|---|---|---|---|---|---|
| 关键词 | string | 是 | — | 品类/产品词，如 `露营灯` | `lf-sellersprite-product-search.keyword`、`season-calendar.category` |
| 站点 | enum | 是 | US | US / EU / JP；SEA 暂不支持 | `lf-sellersprite-product-search.marketplace` |
| 类目 | string | 否 | 关键词 | 如 `露营`、`户外照明` | `season-calendar.category` |
| 目标售价 | number | 否 | — | 人民币，填了才做利润测算 | `profit-estimator.price` |
| 货本 | number | 否 | — | 人民币，填了才做利润测算 | `profit-estimator.cost` |
| 平台费率 | number | 否 | 15 | % | `profit-estimator.fee_rate` |
| 头程/配送 | number | 否 | 0 | 元 | `profit-estimator.shipping` |
| 广告占比 | number | 否 | 10 | % | `profit-estimator.ads` |
| 展示条数 | integer | 否 | 10 | 10–100（上游限制） | `lf-sellersprite-product-search.size` |
| Listing 文案 | textarea | 否 | — | 填了才做合规初筛 | `compliance-check.text` |

站点映射：

| 前台 | LinkFox marketplace | 说明 |
|---|---|---|
| US | US | |
| EU | DE | 先用德国站代表 EU；后续再加 UK/FR |
| JP | JP | |
| SEA | — | P0 不支持，表单直接提示换站点 |

### 1.3 步骤

| # | 类型 | 工具/模型 | 输入 | 条件 | 失败处理 |
|---|---|---|---|---|---|
| 1 | tool | `lf-sellersprite-product-search` | `keyword, marketplace, page=1, size` | 必做 | 失败 → 整次 failed，不用演示数据顶替 |
| 2 | tool | `profit-estimator` | `price, cost, fee_rate, shipping, ads, currency=CNY` | 填了售价 + 货本 | 失败 → skipped |
| 3 | tool | `season-calendar` | `category, market` | 默认做（有类目/关键词） | 失败 → skipped，报告注明 |
| 4 | tool | `compliance-check` | `text, market` | 填了 Listing 文案 | 失败 → skipped |
| 5 | model | 报告生成 | 步骤 1–4 的结果 JSON | 必做 | 失败 → 模板报告，run 仍 succeeded |

### 1.4 报告结构

```
1. 结论：继续 / 观察 / 放弃（三选一）
2. 市场样本：`products[]` 前 N 条，标题、价格、月销量、BSR、评分、卖家、ASIN
3. 利润：售价、货本、平台费、头程、广告、毛利、毛利率、ROI、结论
4. 季节：12 个月建议动作
5. 合规：命中词、风险等级、建议
6. 下一步：3 条可执行动作
7. 数据说明：LinkFox 查询时间、数据可能滞后、哪些步骤跳过
```

### 1.5 降级与提示

- `lf-sellersprite-product-search` 是真实 LinkFox 数据；失败则整次 `failed`，**不用演示数据顶替**。
- SEA 暂不支持：表单校验直接提示，不发起运行。
- 没有填售价/货本：跳过利润，报告写“未提供成本，未做利润判断”，不估算。
- 没有 Listing 文案：跳过合规，报告写“未提供文案”。
- 所有数字只能引用工具结果；模型不得补全；报告标注数据可能滞后。

### 1.6 验收样例

输入：

```
关键词：露营灯
站点：US
类目：露营
目标售价：129
货本：45
平台费率：15
头程：12
广告：10
展示条数：10
Listing 文案：含 "100% waterproof" 的一段
```

期望：

- [ ] 5 个步骤状态可见，至少 3 个成功。
- [ ] 市场样本含标题、价格、月销量/BSR、评分等真实字段。
- [ ] 报告含结论、样本、利润、季节、合规、下一步、数据说明。
- [ ] 利润数字与 `profit-estimator` 输出一致。
- [ ] 合规命中 `100%`，提示“避免绝对化承诺”。
- [ ] 生成 PDF，中文不乱码。
- [ ] 选品工具失败时整次失败、不扣费；不能用演示数据假装成功。

---

## 2. 竞品洞察 / mode：单竞品/多竞品

### 2.1 基本信息

| 项 | 值 |
|---|---|
| key | `competitor-insight` |
| mode | `competitor` |
| 前台名称 | 竞品洞察 |
| 归属专家 | 选品顾问 / 运营助手 |
| 目标用户 | 运营/选品，找竞品标题里的高频词、卖点和缺口 |
| 不做什么 | 不做实时价格监控、不做自动改 Listing |

### 2.2 输入表单

| 字段 | 类型 | 必填 | 默认 | 说明 | 映射 |
|---|---|---|---|---|---|
| 搜索关键词 | string | 是 | — | 用亚马逊前台搜索抓竞品标题 | `lf-amazon-search.keyword` |
| 站点 | enum | 是 | US | P0 只支持 US → `amazon.com` | `lf-amazon-search.amazonDomain` |
| 抓取条数 | integer | 否 | 10 | 1–20 | 搜索结果截取 |
| 市场 | enum | 是 | US | US/EU/JP/SEA | `competitor-insight.market` |

> **竞品标题必须由搜索得到，不提供手填标题作为主路径。** 搜索失败即 `blocked`，不降级到手填。

### 2.3 步骤

| # | 类型 | 工具/模型 | 输入 | 条件 | 失败处理 |
|---|---|---|---|---|---|
| 1 | tool | `lf-amazon-search` | `keyword, amazonDomain=amazon.com, page=1, sort=relevanceblender` | 必做 | 失败 → 运行 `blocked`，不扣费 |
| 2 | transform | 取标题 | 从实际返回 `products[].title` 截取 N 条（已实测 `lf-amazon-search` 返回 `products` 数组） | 必做 | 无标题 → `blocked` |
| 3 | tool | `competitor-insight` | `titles, market` | 必做 | 失败 → 整次 `failed` |
| 4 | model | 报告生成 | 步骤 1–3 结果 JSON | 必做 | 失败 → 模板报告，run 仍 succeeded |

### 2.4 报告结构

```
1. 样本：几条标题、搜索关键词、站点、抓取时间
2. 高频词 Top 10（词、出现次数）
3. 卖点聚类：功能/场景/材质/人群
4. 缺口：没被覆盖的卖点
5. 建议：3 条可执行的 Listing/主图方向
6. 数据说明：搜索是否成功、样本是否完整、数据可能滞后
```

### 2.5 降级

- `lf-amazon-search` 失败 → 运行 `blocked`，不扣费，提示检查 LinkFox 密钥/额度后重试；**不切换到手填标题**。
- 搜索成功但标题少于 3 条 → 继续，报告注明“样本偏少”。
- 不调用 `lf-amazon-reviews-list`（需要 `taskId`，不适合 P0）；不调用 `lf-expert-amazon-competitor-monitor`（30+ 必填字段，异步）。
- 不做定时监控；监控归 Phase 2 自动化。

### 2.6 验收样例

输入：

```
搜索关键词：camping lantern
站点：US
抓取条数：10
市场：US
```

期望：

- [ ] 能通过 `lf-amazon-search` 拿到标题，步骤 1–2 有记录。
- [ ] 高频词、卖点聚类、缺口、建议四块齐全。
- [ ] 每条结论能对应到标题里的词。
- [ ] 不出现“销量/排名”等工具没返回的数字。
- [ ] 搜索失败时 `blocked`、不扣费，且没有手填兜底入口。
- [ ] 生成 PDF。

---

## 3. 合规初筛 / mode：文字/图片/商标

### 3.1 基本信息

| 项 | 值 |
|---|---|
| key | `compliance-screening` |
| mode | `compliance` |
| 前台名称 | 合规初筛 |
| 归属专家 | 合规专家 |
| 目标用户 | 上架前做文案/商标的初步风险扫描 |
| 不做什么 | 不做准入/关税/认证的正式结论，不替代律师 |

### 3.2 输入表单

| 字段 | 类型 | 必填 | 默认 | 说明 | 映射 |
|---|---|---|---|---|---|
| 商品名称 | string | 是 | — | 用于商标文字检测 | `lf-ruiguan-text-trademark-detection.productTitle` |
| Listing 文案 | textarea | 否 | 商品名 | 不填则用商品名 | `compliance-check.text` |
| 站点 | enum | 是 | US | US/EU/JP/SEA | `compliance-check.market` |
| 类目 | string | 否 | — | 用于尼斯分类 | `trademark-nice-class.category_name` |
| 商标名称 | string | 否 | 商品名 | 用于近似商标检索 | `trademark-similar-search.keyword` |
| 商标国家 | enum | 否 | US | US/EU/GB/CA/JP/VN | `trademark-similar-search.countries` |
| 商品图片 | file | 否 | — | P0 先不做图形检测 | 后续 `lf-ruiguan-trademark-graphic-detection` |

### 3.3 步骤

| # | 类型 | 工具/模型 | 输入 | 条件 | 失败处理 |
|---|---|---|---|---|---|
| 1 | tool | `compliance-check` | `text, market` | 必做 | 失败 → 整次 failed |
| 2 | tool | `lf-ruiguan-text-trademark-detection` | `productTitle, productText, limit=20, regions=US` | 有商品名 | 失败 → skipped |
| 3 | tool | `trademark-similar-search` | `keyword, countries, page_size=10` | 有商标名 + 额度可用 | 失败/额度不足 → skipped |
| 4 | tool | `trademark-nice-class` | `country_code, category_name, limit=10` | 有类目 | 失败 → skipped |
| 5 | model | 报告生成 | 步骤 1–4 结果 JSON | 必做 | 失败 → 模板报告，run 仍 succeeded |

### 3.4 报告结构

```
1. 结论：低风险 / 待人工核查 / 高风险
2. 文案风险：命中词、等级、建议
3. 文字商标：命中商标、持有人、风险等级
4. 近似商标：候选、状态、持有人、类别（有额度时）
5. 尼斯分类建议
6. 下一步：改文案/换词/查律师/补认证
7. 免责声明：不构成法律意见
8. 导出 PDF
```

### 3.5 降级

- 商标额度不足/上游失败：步骤 2–4 标 `skipped`，报告注明“商标检索未完成”，不影响文案合规结论。
- 没有类目：跳过尼斯分类。
- 没有图片：跳过图形检测；报告注明“未做图形商标检测”。
- 合规初筛只覆盖文案绝对化用语、部分商标风险；**不覆盖准入、关税、认证**，报告必须写清边界。

### 3.6 验收样例

输入：

```
商品名称：CAMPING 露营灯
Listing 文案：100% waterproof, best seller, cure your night, guaranteed quality
站点：US
类目：露营灯
商标名称：CAMPING
```

期望：

- [ ] 文案命中 `100%`、`best seller`、`cure`、`guaranteed`，带等级和建议。
- [ ] 商标步骤成功时显示候选；额度不足时显示“未完成”，不阻断。
- [ ] 报告含免责声明和“不覆盖准入/关税/认证”的边界说明。
- [ ] 生成 PDF，中文不乱码。
- [ ] 未成功步骤不扣积分。

---

## 4. 公共运行逻辑

1. 创建 `scenario_run`：校验输入 → 检查数据源依赖（P0 无 Pending）→ 估算积分 → 复用 `WalletService`，按 `scenario:{runId}` hold。
2. 顺序执行步骤：每步写 `scenario_run_steps`，记录入参、输出摘要、invoke/model id、耗时、成本。
3. 任一步 required 失败 → 整次 `failed`，释放 hold；已成功步骤保留记录，不扣费。
4. 全部 required 成功 → 生成报告 → capture → `succeeded`。
5. 可选步骤失败 → 记录 `skipped`，不阻断。
6. 报告写入 `task_artifacts`，关联 `ai_tasks`。
7. 审计：run → steps → invoke/model → ledger/audit 可串。

---

## 5. 已定与剩余风险

### 已定

1. **选品换真实 LinkFox 数据**：用 `lf-sellersprite-product-search`，表单只暴露 keyword / marketplace / size / page；不再用 `product-picker` 演示数据。**需要 LinkFox 密钥/额度。**
2. **竞品不接受手填兜底**：主路径用 `lf-amazon-search` 抓标题；失败即 `blocked`，不提供手填标题作为主路径。**需要 LinkFox 密钥/额度。**
3. **合规边界**：只做文案 + 商标初筛，不做准入/关税/认证；业务已接受。
4. **报告 PDF**：首批必需；HTML→PDF，容器装中文字体。
5. **商标额度**：先跳过；充值后再验收商标步骤。
6. **积分预估**：固定上限预估，成功后按实际成本 capture。

### 剩余风险

- **LinkFox 密钥（已解决）**：2026-11-09 把密钥补进 `.env` 后重启 api，实测：
  - `lf-sellersprite-product-search`：200，`products[]` 10 条，字段含标题/价格/月销量/BSR/评分/卖家/ASIN；`size` 必须 10–100。
  - `lf-amazon-search`：200，`products[]` 60 条，字段含标题/价格/评分/ASIN/图片；`products[].title` 可直接用于竞品词频。
  - 密钥只放 `.env`，不要入库、不要提交。
- **LinkFox 额度**：当前可用，但额度/鉴权仍可能失败；失败时 blocked/failed，不降级到演示数据。
- **模型密钥（已配置并验证）**：`LLM_API_KEY` 已配置，`LLM_PROVIDER=xy`、`LLM_BASE_URL=https://api.xytoken.xyb2b.com/v1`、`LLM_MODEL=deepseek-v4.1-flash`；模型测试返回 provider=xy、文本“模型就绪”、约 2.4 秒。密钥只在 `.env`。
- **字段映射**：两个 LinkFox 工具返回结构以实际为准，适配层需要按真实响应做映射。
- **PDF 渲染**：需要中文字体、分页、表格样式；首批先保证不乱码、可下载。
- **数据时效**：LinkFox 数据可能滞后，报告必须标注查询时间和“仅供参考”。
- **竞品搜索覆盖**：P0 只支持 US；EU/JP 的站点映射和搜索可用性后续再验。
