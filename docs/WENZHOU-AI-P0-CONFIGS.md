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

- 只用 schema 简单、能直接给业务用户填的工具。
- 不用字段超过 20 个、需要 `taskId`、或 `x-fill-status` 为 `stub/schema_only/error` 的工具。
- LinkFox 需绑店的工具先不用；P0 三个工作流都不依赖店铺授权。
- 同一能力只调用一次；不在场景里直连上游。

### 0.4 产物

- `report.md`：给人读的报告。
- `report.html`：可选，后续做 PDF。
- `run.json`：步骤、工具、入参、结果摘要、耗时、积分、错误。
- 产物写 `task_artifacts` + MinIO，按企业隔离。

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
| 关键词 | string | 是 | — | 品类/产品词，如 `露营灯` | `product-picker.keyword`、`season-calendar.category` |
| 站点 | enum | 是 | US | US / EU / JP / SEA | `market` |
| 类目 | string | 否 | 关键词 | 如 `露营`、`户外照明` | `season-calendar.category` |
| 目标售价 | number | 否 | — | 人民币，填了才做利润测算 | `profit-estimator.price` |
| 货本 | number | 否 | — | 人民币，填了才做利润测算 | `profit-estimator.cost` |
| 平台费率 | number | 否 | 15 | % | `profit-estimator.fee_rate` |
| 头程/配送 | number | 否 | 0 | 元 | `profit-estimator.shipping` |
| 广告占比 | number | 否 | 10 | % | `profit-estimator.ads` |
| 展示条数 | integer | 否 | 5 | 1–8 | `product-picker.limit` |
| 竞品标题 | textarea | 否 | — | 每行一条，填了才做竞品洞察 | `competitor-insight.titles` |
| Listing 文案 | textarea | 否 | — | 填了才做合规初筛 | `compliance-check.text` |

### 1.3 步骤

| # | 类型 | 工具/模型 | 输入 | 条件 | 失败处理 |
|---|---|---|---|---|---|
| 1 | tool | `product-picker` | `keyword, market, limit` | 必做 | 失败 → 整次 failed |
| 2 | tool | `competitor-insight` | `titles, market` | 填了竞品标题 | 失败 → skipped，报告注明 |
| 3 | tool | `profit-estimator` | `price, cost, fee_rate, shipping, ads, currency=CNY` | 填了售价 + 货本 | 失败 → skipped |
| 4 | tool | `season-calendar` | `category, market` | 默认做（有类目/关键词） | 失败 → skipped，报告注明 |
| 5 | tool | `compliance-check` | `text, market` | 填了 Listing 文案 | 失败 → skipped |
| 6 | model | 报告生成 | 步骤 1–5 的结果 JSON | 必做 | 失败 → 模板报告，run 仍 succeeded |

### 1.4 报告结构

```
1. 结论：继续 / 观察 / 放弃（三选一）
2. 选品样本：前 N 条，标题、市场、评分、备注
3. 利润：售价、货本、平台费、头程、广告、毛利、毛利率、ROI、结论
4. 季节：12 个月建议动作
5. 竞品：高频词、卖点聚类、缺口
6. 合规：命中词、风险等级、建议
7. 下一步：3 条可执行动作
8. 数据说明：哪些步骤成功、哪些跳过、哪些是演示数据
```

### 1.5 降级与提示

- `product-picker` 是内置演示数据；报告必须标“样本为演示数据，不代表实时市场”。
- 没有填售价/货本：跳过利润，报告写“未提供成本，未做利润判断”，不估算。
- 没有竞品标题：跳过竞品，报告写“未提供竞品标题”。
- 没有 Listing 文案：跳过合规，报告写“未提供文案”。
- 所有数字只能引用工具结果；模型不得补全。

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
展示条数：5
竞品标题：5 行
Listing 文案：含 "100% waterproof" 的一段
```

期望：

- [ ] 6 个步骤状态可见，至少 4 个成功。
- [ ] 报告含结论、样本、利润、季节、竞品、合规、下一步。
- [ ] 利润数字与 `profit-estimator` 输出一致。
- [ ] 合规命中 `100%`，提示“避免绝对化承诺”。
- [ ] 报告标注演示数据/跳过步骤。
- [ ] 运行成功才扣积分；任一步 required 失败则不扣。

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
| 竞品标题 | textarea | 二选一 | — | 每行一条，最直接 | `competitor-insight.titles` |
| 搜索关键词 | string | 二选一 | — | 用亚马逊前台搜索抓标题 | `amazon-search.keyword` |
| 站点 | enum | 是 | US | 目前只映射 US → `amazon.com` | `amazon-search.amazonDomain` |
| 抓取条数 | integer | 否 | 10 | 1–20 | 搜索结果截取 |
| 市场 | enum | 是 | US | US/EU/JP/SEA | `competitor-insight.market` |

> 竞品标题和搜索关键词至少填一个。填了标题就不再调搜索；只填关键词时先搜再取标题。

### 2.3 步骤

| # | 类型 | 工具/模型 | 输入 | 条件 | 失败处理 |
|---|---|---|---|---|---|
| 1 | tool | `amazon-search` | `keyword, amazonDomain=amazon.com, page=1, sort=relevanceblender, includeSellerSpriteData=false` | 只填关键词、没填标题 | 失败 → 运行 blocked，提示“请手填竞品标题或稍后重试” |
| 2 | transform | 取标题 | `amazon-search.items[].title` 截取 N 条 | 步骤 1 成功 | 无标题 → blocked |
| 3 | tool | `competitor-insight` | `titles, market` | 必做 | 失败 → 整次 failed |
| 4 | model | 报告生成 | 步骤 1–3 结果 JSON | 必做 | 失败 → 模板报告，run 仍 succeeded |

### 2.4 报告结构

```
1. 样本：几条标题、来源（手填/搜索）
2. 高频词 Top 10（词、出现次数）
3. 卖点聚类：功能/场景/材质/人群
4. 缺口：没被覆盖的卖点
5. 建议：3 条可执行的 Listing/主图方向
6. 数据说明：搜索是否成功、样本是否完整
```

### 2.5 降级

- `amazon-search` 失败且没有手填标题 → 运行 `blocked`，不扣费，提示用户手填。
- 搜索成功但标题少于 3 条 → 继续，报告注明“样本偏少”。
- 不调用 `lf-amazon-reviews-list`（需要 `taskId`，不适合 P0）；不调用 `lf-expert-amazon-competitor-monitor`（30+ 必填字段，异步）。
- 不做定时监控；监控归 Phase 2 自动化。

### 2.6 验收样例

输入：手填 5 条竞品标题（含 `camping lantern`、`rechargeable`、`waterproof`、`3 modes` 等）。

期望：

- [ ] 高频词、卖点聚类、缺口、建议四块齐全。
- [ ] 每条结论能对应到标题里的词。
- [ ] 不出现“销量/排名”等工具没返回的数字。
- [ ] 搜索模式失败时能 blocked 并提示，不扣费。

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
- [ ] 未成功步骤不扣积分。

---

## 4. 公共运行逻辑

1. 创建 `scenario_run`：校验输入 → 检查数据源依赖（P0 无 Pending）→ 估算积分 → hold。
2. 顺序执行步骤：每步写 `scenario_run_steps`，记录入参、输出摘要、invoke/model id、耗时、成本。
3. 任一步 required 失败 → 整次 `failed`，释放 hold；已成功步骤保留记录，不扣费。
4. 全部 required 成功 → 生成报告 → capture → `succeeded`。
5. 可选步骤失败 → 记录 `skipped`，不阻断。
6. 报告写入 `task_artifacts`，关联 `ai_tasks`。
7. 审计：run → steps → invoke/model → ledger/audit 可串。

---

## 5. 这批配置还没定的

1. **选品的真实数据源**：P0 用的 `product-picker` 是内置演示数据；试点是否要换成 LinkFox 真实选品工具？换哪个、字段怎么裁？
2. **竞品搜索的稳定性**：`amazon-search` 需要 LinkFox 密钥/额度；不可用时是否只允许手填标题？
3. **合规边界**：P0 只做文案 + 商标，不做准入/关税；业务是否接受这个“初筛”定位？
4. **报告格式**：P0 先 Markdown/HTML，PDF 是否首批需要？
5. **商标额度**：当前额度耗尽；需要充值后才能验收商标步骤。
6. **积分预估**：按步骤历史均值还是固定上限？第一版可以固定上限，成功后按实际成本 capture。
