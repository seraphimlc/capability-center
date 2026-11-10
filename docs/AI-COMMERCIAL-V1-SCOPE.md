# AI 商业化 V1 交付范围（第一版）

状态：产品规划草案，不是报价。
输入：
- 卖家精灵 Agent / Skill / MCP / API 公开能力
- LinkFox 326 项能力
- 创界通合规能力
- 温州项目 AI 工作台功能清单（飞书 11.10）

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

V1 不是 21 个场景，也不是 326 项能力全上。V1 只交付：

| # | 模块 | V1 内容 | 能力来源 | Owner | 验收 |
|---|---|---|---|---|---|
| 1 | 平台底座 | 登录、钱包、能力调用、审计、任务/场景运行、文件产物 | 能力中心 | 子文 | 一次任务可查步骤、积分、审计 |
| 2 | 总控专家 | 需求理解、专家推荐、发起任务 | 自研 | 子文 | 能路由到选品/竞品/合规 |
| 3 | 选品决策 | 商品搜索、类目/市场、销量预测、利润、季节、报告 | 卖家精灵 MCP + LinkFox | 子文 | 输出选品报告 PDF |
| 4 | 竞品洞察 | ASIN 详情、流量词、评论、广告洞察、报告 | 卖家精灵 MCP | 子文 | 输出竞品报告 PDF |
| 5 | 合规初筛 | Listing 合规、商标/专利初筛、免责声明 | 创界通 + 创知汇 | 海斌 | 输出合规报告，商标失败可跳过 |
| 6 | 报告中心 | 模板、PDF、来源、免责、归档 | 自研 | 子文 | 中文 PDF 可下载 |
| 7 | 数据源适配 | 卖家精灵 MCP、创界通 MCP、LinkFox 工具 | 自研 Adapter | 子文 | 健康检查、失败不扣费 |
| 8 | 管理端最小版 | 专家/场景发布、任务/运行查看、数据源状态 | 自研 | 子文 | 能发布 3 个场景 |

### V1 不做

- 商品描述/商品图/营销内容（P1）
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

## 6. V1 验收标准

- 3 个 P0 工作流端到端跑通：选品、竞品、合规初筛；
- 1 个灯塔客户、10 个真实任务；
- 每个任务有步骤、调用记录、积分、审计、产物；
- 报告 PDF 中文不乱码，含来源和免责声明；
- 失败/取消释放积分，不双扣；
- 数据源失败有明确错误，不静默成功；
- 用户 A 看不到用户 B 的任务和产物。

## 7. 参考

- [卖家精灵 MCP](https://www.sellersprite.com/v3/mcp)
- [卖家精灵 API](https://open.sellersprite.com/api)
- [创界通](https://cjtglobal.com/events/20250522?promteCode=u2dptmd5bn)
- [创界通合规大脑 Agent 2.0](https://www.zgeo.com.cn/news/chuangjietong-compliance-brain-agent-2-launch)
- [WorkBuddy 文档](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar)
- [温州功能点拆分 11.10](https://xingyun.feishu.cn/wiki/Nuuxw1HhPipKlrklPPecDgHTnjc)
