# AI 商业化 V1 交付范围（第一版）

状态：产品规划草案，不是报价。
输入：
- 卖家精灵 Agent / Skill / MCP / API 公开能力
- LinkFox 326 项能力
- 创界通合规能力
- 温州项目 AI 工作台功能清单（飞书 11.10）

## 0. 角色与产品关系

- **子文**：能力中心 + Web Agent + 温州 AI 工作台 + 温州 Skill，统一 owner。
- **海斌**：合规领域服务（创界通 MCP/工具），不单独交付温州 Skill。
- **建坤**：内容视觉领域服务（LinkFox / WorkBuddy），不单独交付温州 Skill。
- **李荔**：产品包、SKU、价格带、Delivery Kit。
- **晓琴**：PMO、交付、验收、经营数据。
- **刘畅**：平台架构、MCP 契约、项目架构评审。
- **开春**：不参与本项目。

> 温州 AI 工作台不是独立产品，是**能力中心 + Web Agent 的第一个完整实现**；温州的 Agent/Skill 配置统一由子文团队做，海斌/建坤只提供底层领域服务。


## 1. 卖家精灵能力盘点

### 1.1 Agent（站内 AI 分析）

卖家精灵的“Agent”目前是站内 AI 解读功能，不是可对外调用的 Agent API：

- 竞品运营拆解（Keepa）
- 市场洞察
- AI 找竞品
- Listing 诊断
- AI 拓产品
- 关键词需求洞察
- AI 评论分析 2.0
- 站内 AI 助手（GPT4）

结论：**可以借鉴它的分析框架，但不能把它的站内 Agent 当成我们的 Agent 运行时。**

### 1.2 Skill

卖家精灵没有独立的 Skill 市场/可安装 Skill 产品。它的能力入口是：

- 网页版工具
- 浏览器插件（v5.0.6）
- API
- MCP

结论：**Skill 要我们在 WorkBuddy/能力中心自己封装，卖家精灵只提供数据和工具。**

### 1.3 MCP：28 个工具，10 个 Amazon 站点

支持 Claude、Codex、ChatGPT、Coze、WorkBuddy、CodeBuddy 等客户端；WorkBuddy 已在支持列表里。

| 分组 | 工具 |
|---|---|
| ASIN | `asin_detail`、`asin_list`、`asin_prediction_sales`、`asin_sales_trend`、`asin_review_list`、`asin_review_list_extended`、`asin_related_list`、`asin_content_list`、`asin_coreKeyword_trend` |
| 广告 | `ads_insights_lookup` |
| 类目/市场 | `category_search`、`category_stats_list`、`category_report_detail`、`category_trend`、`category_top_list`、`category_demand_report`、`category_demand_trend`、`category_ai_feature_list` |
| BSR | `bsr_prediction_sales` |
| 关键词/流量 | `keyword_asin_list`、`keyword_batch_info`、`keyword_related_list`、`keyword_trend`、`keyword_aba_list`、`keyword_aba_trend`、`keyword_conversion_analysis`、`keyword_google_trend` |
| 历史趋势 | `keepa_trend` |

站点：US、JP、UK、DE、FR、IT、ES、CA、IN、MX。

### 1.4 API：45 个接口

- 认证：`secret-key` header。
- 限流：40 次/分钟。
- 单查询 TOP 2K 数据上限。
- 站点：9 大站点 + Amazon 数据。
- 覆盖：查竞品、选产品、类目、ASIN、销量预测、关键词、ABA、流量、选市场、评论、全球商标库。

结论：**卖家精灵是 Amazon 深数据源，不是多平台数据源，也不是合规数据源。**

## 2. 三家能力对比

| 维度 | 卖家精灵 | LinkFox | 创界通 |
|---|---|---|---|
| 定位 | Amazon 数据深挖 | 跨境多平台能力网关 | 出海合规平台 |
| 覆盖 | Amazon 10 站点 | 326 项，8 大类，多平台 + AIGC | 50+ 国家税务、3400 万 IP、300+ 官方信源 |
| 形态 | 网页/插件/API/MCP | 326 个工具 | 合规大脑 + MCP/Skill |
| 强项 | ASIN、类目、关键词、评论、ABA、Keepa | 选品/上架/视觉/店铺/广告/数据/合规/通用 | VAT/EPR、商标/专利、产品合规、报关 |
| 弱项 | 仅 Amazon；无合规 | 数据深度不如垂直厂商 | 非数据/内容平台 |
| V1 用法 | Amazon 选品/竞品数据 | 多平台补充、利润/季节、AIGC | 合规初筛、商标、报关 |

## 3. 温州 AI 工作台要求

- 8 类专家：总控、商品、获客、合规、数据洞察、行研、营销、定制
- 21 个场景，压成 9 个工作流 + 21 份配置
- 4 个 AI 应用：商品库、CRM、店铺中心、营销中心
- 8 项平台能力：任务、自动化、Skill/MCP、模型、审计、智能体、知识库、套餐
- **P0 只做 3 个**：选品、竞品、合规初筛

## 4. V1 交付范围

**V1 = 可交付的商业第一版，不是技术演示。**

- **6 个 Agent**：总控、选品、竞品/市场洞察、合规、商品内容、行研
- **5 条工作流**：选品、竞品、合规初筛、商品内容、行研
- **30–35 个 Skill**
- **1 套平台底座 + 报告中心 + 管理端**
- **1 个灯塔客户、10 个真实任务验收**

技术版 4 个 Agent / 15 个 Skill 只作为内部里程碑，不作为对外交付。

| # | 模块 | V1 内容 | 能力来源 | Owner | 验收 |
|---|---|---|---|---|---|
| 1 | 平台底座 | 登录、钱包、能力调用、审计、任务/场景运行、文件产物 | 能力中心 | 子文 | 一次任务可查步骤、积分、审计 |
| 2 | 总控专家 | 需求理解、专家推荐、发起任务 | 自研 | 子文 | 能路由到 5 个专家 |
| 3 | 选品决策 | 商品搜索、类目/市场、销量预测、利润、季节、报告 | 卖家精灵 MCP + LinkFox | 子文 | 输出选品报告 PDF |
| 4 | 竞品洞察 | ASIN 详情、流量词、评论、广告洞察、报告 | 卖家精灵 MCP | 子文 | 输出竞品报告 PDF |
| 5 | 合规初筛 | Listing 合规、商标/专利初筛、免责声明 | 创界通 + 创知汇 | 海斌 | 输出合规报告，商标失败可跳过 |
| 6 | 商品内容 | 标题/五点/详情/翻译/主图简报 | LinkFox | 建坤 | 输出 Listing 文案与主图简报 |
| 7 | 行研报告 | 市场调研、市场统计、机会报告 | LinkFox | 子文 | 输出行业/市场报告 PDF |
| 8 | 报告中心 | 模板、PDF、来源、免责、归档 | 自研 | 子文 | 中文 PDF 可下载 |
| 9 | 数据源适配 | 卖家精灵 MCP、创界通 MCP、LinkFox 工具 | 自研 Adapter | 子文 | 健康检查、失败不扣费 |
| 10 | 管理端最小版 | 专家/场景发布、任务/运行查看、数据源状态 | 自研 | 子文 | 能发布 5 个场景 |

### 4.1 Agent 清单

V1 交付基线是 **6 个 Agent**；技术版 4 个 Agent 只做内部里程碑。

| Agent | 阶段 | 职责 | 主要 Skill | 数据源 | Owner |
|---|---|---|---|---|---|
| 总控专家 | V1 | 需求理解、专家推荐、发起任务 | 意图识别、专家路由、任务创建、追问 | 平台 | 子文 |
| 选品顾问 | V1 | 选品评分、市场/利润/季节、报告 | 商品搜索、类目统计、销量预测、BSR、关键词、利润、季节、报告 | 卖家精灵 + LinkFox | 子文 |
| 竞品/市场洞察 | V1 | 竞品拆解、流量/评论/广告、报告 | ASIN 详情、反查词、评论、广告洞察、关联流量、Keepa | 卖家精灵 | 子文 |
| 合规顾问 | V1 | Listing 合规、商标/专利初筛、免责 | 合规检查、近似商标、商标详情、尼斯分类、专利/TRO | 创界通 + 创知汇 | 海斌 |
| 商品内容专家 | V1 | 标题/五点/详情/翻译/主图简报 | Listing 文案、标题优化、刊登翻译、主图简报、图片理解 | LinkFox | 建坤 |
| 行研专家 | V1 | 行业/市场/趋势报告 | 市场调研、市场统计、机会报告、关键词趋势、Google Trends | LinkFox | 子文 |
| 店铺运营专家 | P1 | 流量、Listing 健康、广告、定价 | 店铺流量、Listing 健康、广告报表、店铺定价、库存 | LinkFox + 店铺授权 | 子文 |
| 内容视觉专家 | P1 | 商品图/场景图/短视频/素材 | 图片生成、商品套图、服装套图、视频生成、图片理解 | LinkFox AIGC + Linkiebuy | 建坤 |
| 营销推广专家 | P1 | 广告/社媒/邮件/评论回复 | 广告文案、社媒内容、邮件、评论回复 | LinkFox | 建坤 |
| GEO 优化专家 | P1 | 品牌 AI 搜索可见度诊断 | 网页搜索、引用分析、GEO 建议 | WorkBuddy / 搜索 | 建坤 |
| 获客/外贸客户开发 | P2 | 海关/采购商/画像/相似客户 | 海关检索、采购商筛选、画像、相似客户、邮件 | 格兰德（Pending） | 子文 |
| 定制专家 | P1 | 项目专属流程/角色 | 平台配置、模型/知识库/Skill 组合 | 平台 | 子文 |

### 4.2 Skill 清单（V1 约 30–35 个）

| 域 | V1 必选 Skill | 来源 |
|---|---|---|
| 选品 | `asin_list`、`category_stats_list`、`asin_prediction_sales`、`bsr_prediction_sales`、`keyword_related_list`、`keyword_aba_list`、利润测算、季节日历 | 卖家精灵 + LinkFox |
| 竞品 | `asin_detail`、`keyword_asin_list`、`asin_review_list`、`ads_insights_lookup`、`asin_related_list`、`asin_content_list`、`keepa_trend` | 卖家精灵 |
| 合规 | Listing 合规检查、近似商标、商标详情、尼斯分类、专利/TRO、免责声明 | 创界通 + 创知汇 |
| 商品内容 | Listing 文案、标题优化、刊登翻译、主图简报、图片理解 | LinkFox |
| 行研 | 市场调研、市场统计、机会报告、关键词趋势、Google Trends | LinkFox |
| 报告/平台 | 报告模板、PDF 生成、来源标注、归档、任务、通知、积分 | 自建 |

> 技术版只做前 3 行 + 报告/任务，约 15 个 Skill；V1 交付版再加商品内容、行研，约 30–35 个。

### V1 不做

- 商品图/短视频/内容视觉（P1；商品文案和行研在 V1）
- 经营诊断（P1）
- 海关获客/采购商/邮件/报价（Pending）
- 知识库/RAG（P1）
- AI 商品库/CRM/店铺/营销中心（P1/P2）
- 自动化、开放平台、WorkBuddy 市场上架
- 21 个场景全量
- 多平台全量（V1 先 Amazon，其他平台用 LinkFox 补）

## 5. V1 关键决策

1. **卖家精灵和 LinkFox 谁是 Amazon 主数据源？**
   - 方案 A：卖家精灵 MCP 做主，LinkFox 补多平台/利润/季节/AIGC；
   - 方案 B：LinkFox 做主（它已有 `lf-sellersprite-*`），卖家精灵只做深度补充。
   - 先确认 LinkFox 合同是否已包含卖家精灵数据，避免重复采购。
2. **合规初筛用创界通还是自建？**
   - 用创界通合规大脑 + 创知汇；团队 A 做 Skill 适配，不自建合规知识库。
3. **报关专家放哪？**
   - 放创界通；V1 不单独做，随合规包/外综服包提供。
4. **V1 先 Amazon 还是多平台？**
   - 先 Amazon 跑通闭环；多平台用 LinkFox，后续扩展。

## 6. V1 交付物与验收

### 6.1 交付物

1. **可部署软件**：API、Web、管理端、Docker Compose、数据库迁移、种子数据。
2. **6 个 Agent + 5 条工作流 + 30–35 个 Skill** 的配置与清单。
3. **5 套报告模板**：选品、竞品、合规、商品内容、行研。
4. **文档**：安装部署、用户手册、管理员手册、数据源配置、验收记录。
5. **灯塔交付**：客户开通、培训、10 个真实任务、验收报告。

### 6.2 建议节奏（按团队投入调整）

| 里程碑 | 内容 | 产出 |
|---|---|---|
| M1（W1–W3） | 平台底座 + 数据适配 + 选品/竞品/合规 | 3 条 P0 工作流跑通 |
| M2（W4–W5） | 商品内容 + 行研 + 报告/管理端 | 5 条工作流、PDF |
| M3（W6） | 集成、性能、失败路径、灯塔试运行 | 10 个任务、问题清单 |
| M4（W7–W8） | 验收、文档、培训、交接 | 验收报告、可交付版本 |

### 6.3 验收标准

- 5 条工作流端到端跑通：选品、竞品、合规初筛、商品内容、行研；
- 1 个灯塔客户、10 个真实任务；
- 每个任务有步骤、调用记录、积分、审计、产物；
- 报告 PDF 中文不乱码，含来源和免责声明；
- 失败/取消释放积分，不双扣；
- 数据源失败有明确错误，不静默成功；
- 用户 A 看不到用户 B 的任务和产物；
- 6 个 Agent 均可在专家页选择并成功发起任务。

## 7. 自建 / 外采与任务分工

### 7.1 先定什么必须自建

| 必须自建 | 直接外采/集成 | 不碰 |
|---|---|---|
| 任务/场景运行时、计费、审计、报告 PDF、数据适配、管理端 | 卖家精灵 MCP/API、LinkFox、创界通 MCP、模型、WorkBuddy | 数据平台、模型、浏览器引擎、RPA、合规知识库 |
| 选品/竞品/合规/商品内容/行研 Agent 的编排、提示词、报告模板 | 浏览器/RPA 运行时（政企 Web Agent） | 通用 Agent 市场、第二个 WorkBuddy |
| 产品包、Delivery Kit、验收标准 | 对象存储、邮件/短信等基础设施 | 21 套定制流程 |

原则：**差异化在“编排 + 场景 + 交付”，不在“数据 + 模型 + 浏览器”。**

### 7.2 任务分工

| # | 工作包 | Owner | 配合 | 类型 | 阶段 | 交付物 |
|---|---|---|---|---|---|---|
| 1 | 平台底座：任务/场景、钱包、审计、文件 | 子文 | 刘畅 | 自建 | V1 | 可跑通的运行时 |
| 2 | 数据适配层：卖家精灵/LinkFox/创界通 | 子文 | 海斌、建坤 | 自建 Adapter | V1 | 统一 MCP/HTTP 适配、健康检查、错误码 |
| 3 | 选品 Agent + 报告 | 子文 | 李荔 | 自建编排 | V1 | 选品场景、提示词、PDF |
| 4 | 竞品 Agent + 报告 | 子文 | 李荔 | 自建编排 | V1 | 竞品场景、提示词、PDF |
| 5 | 合规 Agent + 商标 Skill（报关随创界通） | 子文 | 海斌 | 自建编排 | V1 | 温州合规 Agent、创界通 MCP/工具、合规报告 |
| 6 | 商品内容 Agent | 子文 | 建坤、李荔 | 自建编排 | V1 | 温州商品内容 Agent、Listing 文案/主图简报 |
| 7 | 行研 Agent + 报告 | 子文 | 李荔 | 自建编排 | V1 | 行业/市场报告 PDF |
| 8 | 报告中心：模板/PDF/来源/免责 | 子文 | 李荔 | 自建 | V1 | 5 套 PDF 模板、归档 |
| 9 | 管理端最小版 | 子文 | 晓琴 | 自建 | V1 | 6 个专家/5 个场景发布 |
| 10 | 产品包、SKU、价格带、Delivery Kit | 李荔 | A/B/C | 产品 | V1 | 5 个包的一页纸、报价卡 |
| 11 | 交付与验收：灯塔客户、验收、风险 | 晓琴 | A/B/C | 交付 | V1 | 1 个客户、10 个任务验收 |
| 12 | 架构/合同：MCP 契约、安全、集成评审 | 刘畅 | 子文、海斌、建坤 | 架构 | V1 | 服务契约、评审结论 |
| 13 | WorkBuddy 企业级解决方案包 | 建坤 | 李荔、晓琴 | 渠道 | P1 | Bundle、Demo、销售包 |
| 14 | 内容视觉服务：生图/生视频 | 建坤 | 子文 | 自建服务 | P1 | 内容视觉 MCP/服务 |
| 15 | Web Agent / 政企 Web Runtime 适配 | 子文 | 刘畅、RPA 厂商 | 集成 | P2 | Web Runtime Adapter、3 个 Web Skill |

> 温州工作台的 Agent/Skill 配置统一由子文；海斌只交付创界通合规 MCP/工具，建坤只交付内容领域服务；他们不单独交付温州 Skill。

### 7.3 关键路径

- **子文是唯一关键路径**：平台 + 6 个 Agent/温州 Skill + 选品/竞品/行研/商品内容/合规 + 报告 + 管理端 + Web Agent；这是 V1 最大风险。
- **海斌并行**：只交付创界通合规 MCP/工具，V1 等接口，不等平台。
- **建坤并行**：只交付内容领域服务；WorkBuddy 企业包和内容视觉放 P1。
- **李荔并行**：V1 包定义、SKU、Delivery Kit 不等代码。
- **晓琴并行**：灯塔客户、验收标准、数据授权。

### 7.4 V1 人员最低配置

- 子文团队：2 后端 + 1 前端 + 1 AI/Agent + 1 测试；否则 6 个 Agent/5 条工作流交付不了。
- 海斌：1 个创界通接口人。
- 建坤：1 个内容服务接口人。
- 李荔：1 产品经理。
- 晓琴：1 PMO/交付。
- 刘畅：架构评审，不驻场。

如果子文团队低于这个配置，V1 只能砍回 **4 个 Agent / 3 条工作流**，不能对外承诺 6 个 Agent。

### 7.5 统一契约

- 每个服务：`service.yaml` + MCP tool manifest；
- 每个包：`package.yaml` + one-pager + acceptance；
- 所有调用走能力中心：鉴权、计费、审计、任务/产物；
- 服务团队不建第二套账号/钱包/审计；
- 平台不替服务团队写领域逻辑。

## 8. 参考

- [卖家精灵 MCP](https://www.sellersprite.com/v3/mcp)
- [卖家精灵 API](https://open.sellersprite.com/api)
- [创界通](https://cjtglobal.com/events/20250522?promteCode=u2dptmd5bn)
- [创界通合规大脑 Agent 2.0](https://www.zgeo.com.cn/news/chuangjietong-compliance-brain-agent-2-launch)
- [WorkBuddy 文档](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar)
- [温州功能点拆分 11.10](https://xingyun.feishu.cn/wiki/Nuuxw1HhPipKlrklPPecDgHTnjc)
