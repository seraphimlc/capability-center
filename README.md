# 能力中心

给业务用户使用的白标能力平台。用户端发现并调用能力，管理端充值、上架和审计。对话助手、点选调用、开放 API / MCP 扣的是同一个个人积分钱包。积分只按人民币口径记账。

本地用 Docker Compose 拉起 MySQL、Redis、MinIO（镜像 `bitnamilegacy/minio`，协议与 MinIO 相同）、API、用户端、管理端和 Nginx。不配置任何外部密钥也能完整演示：上游商业连接器是内置模拟，模型对话在没有密钥时走本地 SSE 模拟。

## 启动

```bash
docker compose up --build
```

第一次构建会安装依赖并编译三个 Node 服务，需要几分钟。看到 Nginx 和 API 健康后即可打开浏览器。

| 入口 | 浏览器地址 | 宿主机端口 → 容器端口 |
|---|---|---|
| 用户端 | http://localhost:8888 | `8888:80` |
| 管理端 | http://localhost:8889 | `8889:81` |
| 开放 API / MCP | http://localhost:8890 | `8890:82` |
| MinIO API | http://localhost:9000 | `9000:9000` |
| MinIO 控制台 | http://localhost:9001 | `9001:9001` |
| MySQL | 127.0.0.1:13306 | `13306:3306` |
| Redis | 127.0.0.1:16379 | `16379:6379` |

`docker compose ps` 里各服务应为 healthy。用户端页面上传走 8888，由 Nginx 转到 MinIO，不需要浏览器直连 9000。

概念上的生产域名是 `www.visitworlds.me`、`admin.visitworlds.me`、`api.visitworlds.me`。本机用上面的端口区分，Cookie 名称也分开（`cc_www_rt` / `cc_admin_rt`）。

## 演示账号

密码只用于本地种子，上线前务必改掉。

| 角色 | 邮箱 | 密码 | 说明 |
|---|---|---|---|
| 超管 | admin@visitworlds.me | Admin123456 | 管理端，可改系统开关 |
| 运营 | ops@visitworlds.me | Ops123456 | 管理端充值、上下架 |
| 终端用户 | demo@visitworlds.me | Demo123456 | 用户端，初始积分 **0** |

演示用 MCP / API 密钥（只在种子里创建一次，明文不进数据库，只存哈希）：

```text
ck_sandbox_demo01_capabilitycenterdevsecret
```

建议演示顺序：

1. 用户端用 `demo@visitworlds.me` 登录，余额是 0。打开「选品简报」点运行，会被积分不足拦住。
2. 管理端用 `ops@visitworlds.me` 登录，在「用户与充值」给演示用户充 200 并勾选确认。
3. 回到用户端再运行选品简报。成功后钱包流水和调用记录都能看到扣减。
4. 打开「选品顾问」发「帮我做一份露营灯的选品简报」。模拟流会吐字，并出现技能卡片。
5. 用上面的密钥请求 `POST http://localhost:8890/mcp`，方法 `tools/list` 和 `tools/call`。
6. 在调用抽屉或会话里上传一张图片，文件会进 MinIO 桶 `capability-center`。

## 模型网关

浏览器不持有模型密钥。API 按下面的顺序决定通道：

- `LLM_PROVIDER=mock`：强制本地模拟。
- `LLM_PROVIDER=xy` 或 `auto`，且设置了 `LLM_API_KEY` 或 `XY_API_KEY`：请求 OpenAI 兼容的 `POST /v1/chat/completions`（`stream: true`）。
- `LLM_PROVIDER=chathub`，或 auto 下没有 XY 密钥但有 ChatHub 密钥：走另一套兼容地址。
- 都没有密钥：本地模拟 SSE，Compose 默认为此。

```bash
# 启用真实 XY 网关后再启动（不要把密钥写进仓库）
export LLM_API_KEY=你的密钥
export LLM_BASE_URL=https://api.xytoken.xyb2b.com/v1
export LLM_MODEL=deepseek-v4.1-flash
docker compose up --build
```

也可使用同义变量 `XY_API_KEY`、`XY_BASE_URL`。ChatHub 临时通道使用 `CHATHUB_BASE_URL`、`CHATHUB_API_KEY`、`CHATHUB_MODEL`，和 XY 分开，不会共用别人的对象前缀。

Docker Desktop for Mac 上，容器直连网关可能 TLS 握手失败（OpenSSL unexpected EOF），宿主机却正常。先在宿主机跑 `node scripts/xy-llm-proxy.mjs`（监听 `:18765`），再把 `docker-compose.override.yml.example` 复制为 `docker-compose.override.yml`。密钥仍然只放 `.env`。

流式响应经 Nginx 关闭缓冲（`proxy_buffering off`，读超时 3600 秒）。用量以最终 chunk 里的 `usage` 为准。模型 `priceCredits > 0` 时对话会扣整数积分：策略 A（默认，flag 缺失也一样）按每次完成的模型调用扣标价；策略 B 按每 1000 token 向上取整。标价为 0 不扣。技能调用仍只在成功时扣价。

用户界面只显示白标档名（标准对话、深度推理等）。上游模型 ID 只在管理端模型页出现。

## 温州 AI（feature 分支）

温州项目的 AI 场景、专家、数据模型和第一批开工清单在 `feature/wenzhou-ai-workbench` 分支上整理：

- [交接说明](docs/WENZHOU-AI-HANDOFF.md)
- [场景与能力地图](docs/WENZHOU-AI-SCENARIO-MAP.md)
- [最小数据模型草案](docs/WENZHOU-AI-DATA-MODEL.md)
- [第一批开工 Checklist](docs/WENZHOU-AI-PHASE1-CHECKLIST.md)

## 商标能力（试点）

合规风控下有 3 个商标初筛能力：近似商标检索、美国商标详情、尼斯分类查询。数据来自远程 MCP，走平台级 OAuth 账号，接入细节见 [docs/TRADEMARK.md](docs/TRADEMARK.md)。

```bash
# 授权后把 token 写进 .env（不要提交），再重启 api
docker compose up -d api
# 改了名称/schema/标价后重跑导入
docker compose exec api node dist/scripts/import-trademark-tools.js
```

## 对象存储

默认 `OSS_PROVIDER=minio`，Compose 已带 MinIO，无需阿里云密钥。

对象键格式：

```text
{OSS_PREFIX}/{env}/{tenant}/{user}/{yyyy}/{mm}/{dd}/{ulid}.{ext}
```

默认前缀是 `capability-center`。也可以改成 `visitworlds`。不要使用 `xingma-stall` 或 `learn/`。

上传流程：`POST /api/www/files/presign` → 浏览器 `PUT` 到签名地址 → `POST /api/www/files/{id}/complete`。

以后切到阿里云 OSS 时，在启动环境里覆盖这些变量（真实 AK/SK 只放环境，不提交）：

```bash
export OSS_PROVIDER=aliyun
export OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
export OSS_PUBLIC_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
export OSS_REGION=oss-cn-hangzhou
export OSS_BUCKET=你的桶
export OSS_ACCESS_KEY_ID=你的AK
export OSS_ACCESS_KEY_SECRET=你的SK
export OSS_PREFIX=capability-center
export OSS_FORCE_PATH_STYLE=false
export OSS_SIGNED_URL_EXPIRES=3600
export OSS_PUBLIC_READ=false
export MEDIA_PUBLIC_BASE=   # 可选 CDN
```

`OSS_ENDPOINT` 给服务端访问（Compose 里是 `http://minio:9000`）。`OSS_PUBLIC_ENDPOINT` 给浏览器签名，主机必须和实际上传时的 Host 一致，否则签名失效。Compose 把签名地址指到 `http://localhost:8888`，由用户端 Nginx 把 `/{bucket}/` 转到 MinIO，这样上传和页面同源，不依赖浏览器跨域。管理端「对象存储」页可以改配置并探活；密钥留空表示不修改。

`OSS_PROVIDER=mock` 时文件落在 API 容器本地目录，仅用于存储不可用时的兜底。

## 本地不使用 Docker 时

需要本机 MySQL 8、Redis、Node 22 和 pnpm 10。

```bash
cp .env.example .env
pnpm install
pnpm --filter @cc/error-codes build
pnpm --filter @cc/api prisma:generate
# 按 .env 准备 DATABASE_URL 后
pnpm --filter @cc/api exec prisma db push
pnpm --filter @cc/api exec node dist/seed.js   # 先 pnpm --filter @cc/api build
pnpm dev:api
pnpm dev:www
pnpm dev:admin
```

开发时 Next 会把 `/api` 反代到 `API_PROXY_TARGET`（默认 `http://127.0.0.1:4000`）。

## 仓库结构

- `apps/www` 用户端 Next.js
- `apps/admin` 管理端 Next.js
- `services/api` NestJS。身份、目录、调用、钱包、模型、文件、任务、开放平台、通知、审计分模块，M1 合成一个进程
- `packages/error-codes` 错误码
- `packages/openapi/openapi.yaml` 契约骨架
- `deploy/nginx.conf` 反代与 SSE

钱包扣费是预留再捕获：调用开始时冻结可用余额，成功才记消费流水，失败或取消会释放预留。异步短视频任务同样在成功后才扣。
