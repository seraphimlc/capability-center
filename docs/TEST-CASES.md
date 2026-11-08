# 测试用例

自动化入口：仓库根目录 `pnpm test`（编译 API 后跑 `node --test`）。下表「自动」列是对应用例名。浏览器项在 http://127.0.0.1:8888 手点，账号见 `docs/HANDOFF.md`。

## 对话输入

| 用例 | 期望 | 自动 |
|------|------|------|
| Enter | 发送，不插入换行 | `Enter sends and Shift+Enter inserts a newline` |
| Shift+Enter | 换行，不发送 | 同上 |
| 输入法组合中的 Enter（isComposing、keyCode 229、composition 锁） | 不发送 | `IME composition does not send on Enter` |
| 生成中再发送 | 先停当前回复，只保留最后一条未发出草稿，不排队 | `a new send replaces the unsent draft and stops an in-flight reply` |
| 页面接上这套规则 | 聊天页调用上述函数 | `chat page uses the shared composer rules` |

## 上下文

| 用例 | 期望 | 自动 |
|------|------|------|
| 短会话 | 原文进模型，不摘要 | `short history stays verbatim under the default budget` |
| 超预算 | 较早轮次收成「会话摘要」，最新用户消息还在 | `old turns collapse into a summary and the latest user turn remains` |
| 技能调用 | 调用和结果成对保留，或整轮丢掉 | `tool call and result stay together or drop together`、`a recent tool pair is kept intact` |
| 超长技能结果 | 模型侧截断并标明完整内容在调用记录 | `oversized tool results are truncated only in the model payload` |
| 中止后缺结果 | 补「已中断」，下一次请求不成坏消息 | `aborted tool calls are closed so the next turn is not poisoned` |

## 模型计费

| 用例 | 期望 | 自动 |
|------|------|------|
| 策略 A，标价 > 0 | 按次扣整数积分 | `strategy A charges a flat per-call price when the model is billable` |
| 策略 B | 每 1000 token 向上取整 | `strategy B bills integer credits per thousand tokens` |
| 余额不够预留 | 不能 hold | `short model credit hold is refused` |
| 流水 | `bizType` 为 `model`，走 capture，不是空实现 | `model billing writes a model ledger and is not a stub` |
| 积分不足 | SSE `INSUFFICIENT_CREDITS`，中文，无供应商品牌 | `chat errors stay in Chinese and drop vendor names` |

## 店铺

| 用例 | 期望 | 自动 |
|------|------|------|
| 1688 工作台 | 只含 `platforms_json` 里的 `alibaba1688`。`1688` 或空数组不算 | `store platform filter ignores empty platform lists` |
| 没有命中 | id 集为 `__none__`，不是全表 | 同上 `toolIdSet` |
| `/stores` | 一行两张卡片；进入工作台、校验、断开、删除；链到 `/stores/new`；列表上没有创建表单 | `stores list is cards and creation is a separate page` |
| `/stores/new` | 平台和凭证表单，保存后去 `/stores/{id}` | 同上 |

## 白标

| 用例 | 期望 | 自动 |
|------|------|------|
| 用户端和管理端源码里的可见文案 | 不含 LinkFox、xytoken、xyb2b、紫讯、WallySmarter、Tsearch | `user-visible app copy does not name upstream brands` |
| 助手提示词 | 12 个都在 400–900 字，并写明不要报出 LinkFox | `every published agent has a full operating brief` |

## 浏览器（:8888，未自动化）

1. 空会话能看到该助手的建议。Enter 发送，Shift+Enter 换行。生成中再 Enter 会停掉上一条再发。
2. 停止按钮只停止。结束后记录里有回复，逐字缓冲消失。
3. 从店铺工作台进入的会话带默认店铺。1688 店的能力列表里没有空平台的需绑店工具。
4. 未配置模型密钥时，页面提示本地演示。密钥只放 `.env`。
