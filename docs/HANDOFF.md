# 能力中心交接文档（HANDOFF）

更新时间：2026-11-08（Asia/Shanghai，对话发送 / 模型计费 / Mac 网关代理）

## 1. 仓库与运行入口

- GitHub：https://github.com/seraphimlc/capability-center
- 本机路径：`/Users/liuchang/Desktop/capability-center`
- 用户端：http://127.0.0.1:8888/
- 管理端：http://127.0.0.1:8889/
- API（容器内）：`api:4000`；经 nginx 反代到 8888/8889
- MinIO：9000/9001；MySQL：13306；Redis：16379

### 演示账号

| 角色 | 邮箱 | 密码 |
|------|------|------|
| 演示用户 | demo@visitworlds.me | Demo123456 |
| 运营 | ops@visitworlds.me | Ops123456 |
| 超管 | admin@visitworlds.me | Admin123456 |

> 密钥与 `.env` / `.secrets/` 不入库，勿在聊天复述 API Key。

## 2. 架构速览

- `apps/www`：用户端 Next.js（目录 / 店铺工作台 / 助手 / 调用）
- `apps/admin`：管理端
- `services/api`：NestJS + Prisma + MySQL；启动时 `prisma db push` + `node dist/seed.js`
- `packages/error-codes`、`packages/openapi`
- `deploy/nginx.conf`：8888→www，8889→admin
- 上游商业连接器类型 `linkfox`（白标展示，禁止前端暴露品牌）

## 3. 本地启动

```bash
cd /Users/liuchang/Desktop/capability-center
docker compose up -d
# 健康检查
docker compose ps
curl -s http://127.0.0.1:4000/healthz   # 若未暴露主机端口，用：
docker compose exec api wget -qO- http://127.0.0.1:4000/healthz
```

用户端：http://127.0.0.1:8888 。真实模型与 Docker Desktop TLS 桥见第 10 节。密钥只放本机 `.env`。

重建（若 Docker Hub/镜像站拉取 `node:22-alpine` 401，用本机已有镜像做增量构建）：

```bash
# 常规（镜像站正常时）
docker compose build www api && docker compose up -d www api

# 增量（推荐当前环境）
docker build -f /tmp/Dockerfile.www.incr -t capability-center-www:latest .
docker build -f /tmp/Dockerfile.api.incr -t capability-center-api:latest .
docker compose up -d www api
```

增量 Dockerfile 示例见下文「运维备注」。

## 4. 已完成功能（本轮收尾）

### UI

- 目录卡片：「调用」→「使用」；去掉「详情」按钮
- 排序下拉：`w-auto shrink-0`，不再被 `.field` 撑满
- 店铺工作台：能力列表「使用」；新增「本店助手」入口（按店铺 platform 过滤助手并开会话）
- 助手页：店铺助手显示「店铺助手」徽标

### 双入口 + 绑店

- 目录：8 类作业链；筛「需绑店 / 通用」
- 店铺管理 → 进入工作台：按平台过滤能力，调用默认绑当前店
- 需绑店未选店：`该能力需要选择已连接店铺`

### 目录能力整批重设计

- 模块：`services/api/src/tool-redesign.ts`
- 分类启发式：`services/api/src/tool-classify.ts`（增强 listing / analytics / creative 等）
- seed 启动时：`reclassifyAllTools` → `redesignAllTools`
- 白标：`domain.ts` 扩展 LinkFox / WallySmarter / Tsearch / skill.linkfox / 来源技能
- import 脚本不再写入「来源技能」元信息

**最近一次入库统计（323 tools）**

| 分类 | 数量 |
|------|------|
| selection-research | 41 |
| listing | 32 |
| creative-visual | 41 |
| store-ops | 68 |
| ads | 41 |
| analytics | 59 |
| compliance | 36 |
| general | 5 |
| **需绑店** | **139** |
| **通用** | **184** |
| 重命名 | 230 |
| 品牌泄漏抽样 | 0 |

### 平台店铺助手（8）

| key | 名称 | 约绑定数 |
|-----|------|----------|
| amazon-store-assistant | 亚马逊店铺助手 | 36 |
| shopify-store-assistant | Shopify 店铺助手 | 16 |
| temu-store-assistant | Temu 店铺助手 | 23 |
| ebay-store-assistant | eBay 店铺助手 | 11 |
| shopee-store-assistant | Shopee 店铺助手 | 31 |
| tiktok-shop-assistant | TikTok Shop 店铺助手 | 35 |
| walmart-store-assistant | Walmart 店铺助手 | 20 |
| alibaba1688-store-assistant | 1688 采购助手 | 11 |

另有通用助手：选品顾问 / 内容工作室 / 运营助手 / 值班助手。  
Agent 表新增 `platforms_json`；`GET /api/www/agents?platform=amazon` 可过滤。

### Schema / 上游

- `data/linkfox-skills-enriched.json`：fill 约 ok 253 / stub 35 / schema_only 11 / error 1
- 已把 enriched 的 schema + upstream_path 同步回库（脚本逻辑见 `src/scripts/sync-linkfox-schema.ts`）
- stub / 无有效上游路径：invoke 返回 **degraded 说明性结果**（不装作成功打上游），文案清晰
- 内置工具（如 `text-insight`）可正常成功调用

## 5. 产品决策备忘

- 双入口：目录（通用发现）+ 店铺工作台（平台语境）
- 绑店：`tools.store_bound` + `platforms_json`
- 白标：用户可见文案禁止 LinkFox / WallySmarter / Tsearch / 来源技能等
- 单 bot 作业；币种展示 CNY
- 视觉风格本轮未大改

## 6. 关键路径

- 分类：`services/api/src/tool-classify.ts`
- 文案重设计：`services/api/src/tool-redesign.ts`
- Seed：`services/api/src/seed.ts`（含 `seedPlatformAgents`）
- 脚本：`services/api/src/scripts/{redesign-tools,seed-platform-agents,sync-linkfox-schema,import-linkfox-skills,reclassify-tools}.ts`
- Schema：`services/api/prisma/schema.prisma`
- 目录页：`apps/www/src/app/page.tsx`
- 店铺工作台：`apps/www/src/app/stores/[id]/page.tsx`
- 助手列表：`apps/www/src/app/agents/page.tsx`
- 调用：`services/api/src/invoke.service.ts`、`linkfox.client.ts`
- 对话页：`apps/www/src/app/chat/[id]/page.tsx`
- 对话与模型计费：`services/api/src/agent.service.ts`、`wallet.service.ts`、`model.service.ts`
- Mac 网关代理：`scripts/xy-llm-proxy.mjs`、`docker-compose.override.yml.example`

## 7. 运维备注

### 镜像站 401

当前环境 `docker.m.daocloud.io` 对 `node:22-alpine` 可能 401。增量构建模板：

```dockerfile
# www
FROM capability-center-www:latest
WORKDIR /app
COPY apps/www ./apps/www
RUN pnpm --filter @cc/www build
WORKDIR /app/apps/www
CMD ["pnpm", "start"]

# api
FROM capability-center-api:latest
WORKDIR /app
COPY packages ./packages
COPY services/api ./services/api
RUN pnpm --filter @cc/error-codes build && pnpm --filter @cc/api prisma:generate && pnpm --filter @cc/api build
WORKDIR /app/services/api
CMD ["sh", "docker-entrypoint.sh"]
```

### 手动脚本

`tsconfig` 已包含 `src/scripts`。重建 api 后：

```bash
docker compose cp data/linkfox-skills-enriched.json api:/tmp/linkfox-skills-enriched.json
docker compose exec -e LINKFOX_ENRICHED_JSON=/tmp/linkfox-skills-enriched.json api node dist/scripts/sync-linkfox-schema.js
docker compose exec api node dist/scripts/redesign-tools.js
docker compose exec api node dist/scripts/seed-platform-agents.js
```

## 8. 已知缺口 / 下一步建议

1. 部分 stub 工具 schema 仅有 `payload` 大包字段，表单体验一般 → 可按高频能力拆字段
2. 真实上游调用依赖 `LINKFOX_*` 密钥与额度；无密钥时 ok 工具会鉴权失败（预期）
3. listing 类已从 8 提到 ~32，仍可用业务规则继续微调分类
4. OSS bootstrap 在本地 MinIO 可能打印 “header … not implemented”（不影响主路径）
5. 通用助手 `platforms_json` 可能为 null，API 已按数组兜底；可统一写成 `[]`
6. Docker 全量 `compose build` 需先恢复可拉取的 node 基础镜像

## 9. 本轮验证摘要

- www/api healthy；目录包内「使用」×4、「详情」×0、「调用」×0
- 12 助手可见；`platform=amazon` 返回亚马逊店铺助手
- 绑店校验生效；builtin 调用 success；stub 调用 degraded 说明性结果
- 品牌泄漏抽样 0

## 10. 对话发送、模型计费、真实模型

### 输入框

- Enter 发送，Shift+Enter 换行。
- 中文输入法组合过程中不发送（`isComposing`、`keyCode === 229`，以及 composition 结束当拍的 Enter）。
- 生成中的状态是「正在生成…」。再按 Enter、点发送，或点建议芯片：先 `POST /api/www/conversations/:id/stop` 停掉当前回复，再发送这一条。不把下一条排到上一条自然结束之后。
- 「停止生成」只停止，不会把输入框里还没发出的草稿当成新消息。
- 回复仍是 SSE：`delta` / `thinking` / 工具事件。没有改成整包请求响应。
- 未配置密钥时 `ModelService` 走本地 mock，mock 仍按片吐字。

### 模型计费

聊天每次完成的模型调用都走 `maybeBillModel`（工具多轮里每一次成功的模型调用各记一笔；中止或失败释放预留，不扣）。

- 积分是人民币口径的整数。流水 `bizType=model`，备注「对话模型扣减」。技能调用仍是 `bizType=invoke`，预留 / 成功实扣 / 失败释放不变。
- 默认策略 A（`billing_strategy` 为 A 或缺失）：模型 `priceCredits > 0` 时，按该标价扣一次。为 0 不扣。种子数据里的对话模型标价是 0，要在管理端模型页改成大于 0 才会看到扣减。
- 策略 B：`priceCredits` 是每 1000 token 的积分，按 `usage.total_tokens` 向上取整。没有 usage 时按 1 个单位。调用前按提示词长度和 `maxTokens` 预留，完成后按实际用量实扣。
- 积分不够时，SSE 的 `error` 事件带 `code=INSUFFICIENT_CREDITS`（以及需要 / 可用积分）。

### 真实模型与 Docker Desktop

浏览器不持有模型密钥。API 在 `LLM_API_KEY` 或 `XY_API_KEY` 有值时，经 `ModelService.runTurn` 以 `stream: true` 请求 OpenAI 兼容的 `/v1/chat/completions`。密钥只放本机 `.env`，不要写进仓库、`docker-compose.override.yml` 或聊天记录。

Docker Desktop for Mac 上，容器直连 `api.xytoken.xyb2b.com` 会 TLS 握手失败（OpenSSL unexpected EOF），宿主机 curl / Node 正常。用宿主机代理把容器里的 HTTP 转到上游 HTTPS：

```bash
node scripts/xy-llm-proxy.mjs
cp docker-compose.override.yml.example docker-compose.override.yml
# .env 中填写 LLM_API_KEY 或 XY_API_KEY，不要写进 override
docker compose up -d
```

代理默认听 `0.0.0.0:18765`。override 只做两件事：给 `api` 加上 `host.docker.internal:host-gateway`，并把 `LLM_BASE_URL` / `XY_BASE_URL` 设为 `http://host.docker.internal:18765/v1`。`docker-compose.override.yml` 已 gitignore。不用 Mac Docker 时不要复制这份 override，否则会去连一个没启动的代理。

### 怎样本地确认

```bash
docker compose up -d
# http://127.0.0.1:8888 用 demo@visitworlds.me 打开一个助手会话
```

1. Enter 发出消息；Shift+Enter 只换行；生成过程中能看到「正在生成…」。
2. 上一条还在吐字时再 Enter：上一条停止，新消息马上开始，不会等上一条说完。
3. 只点「停止生成」时，当前回复停止，输入框里的草稿还在。
4. 管理端把对话模型的积分标价改成大于 0，再发一条。钱包流水是 `model` 扣减。再成功调用一个收费技能，流水仍是 `invoke`。
5. 要走真实模型：按上面的顺序先起代理，再在 `.env` 放密钥，然后重建 / 重启 api。不放密钥时会话仍是 mock 流式回复。
