# 商标能力（MCP 接入）

用户端「合规风控」下的商标初筛能力，数据来自远程 MCP 服务，经 API 的 `mcp` 连接器调用。当前是平台级单账号试点，尚未做每用户 OAuth。

## 已接入的能力

| tool key | 名称 | 上游工具 | 积分 | 状态 |
|---|---|---|---|---|
| `trademark-similar-search` | 近似商标检索 | 近似商标查询 | 20 | 可用 |
| `trademark-detail` | 美国商标详情 | 商标详情查询 | 10 | 可用 |
| `trademark-nice-class` | 尼斯分类查询 | 尼斯分类查询 | 5 | 可用 |

上游另有「美国商标律师风险评估」「商标持有人趋势查询」两个工具，实测分别返回额度用尽和上游 400（`requestId` 为空），因此**没有导入**，等对方修复后再加。

## 代码位置

- `services/api/src/mcp.service.ts`：MCP Streamable HTTP 客户端，负责 `tools/call`、90 秒超时、401 刷新 token、错误白标。
- `services/api/src/trademark-tools.ts`：3 个能力的名称、简介、schema、示例、标价。白标从这里开始，不要写上供应商名。
- `services/api/src/scripts/import-trademark-tools.ts`：建连接器、建分类、upsert 工具；容器启动时自动执行一次。
- `apps/www/src/tools/`：每个能力一个专属表单和一个结果组件，`registry.tsx` 是白名单。
  - `trademark-similar/form.tsx` + `result.tsx`
  - `trademark-detail/form.tsx` + `result.tsx`
  - `trademark-class/form.tsx` + `result.tsx`
  - `runner.tsx`：页面壳（价格、加载态、错误、结果），不解释 schema。

目录页和能力详情页会优先判断 `hasToolForm(key)`：有专属表单走 `ToolRunner`，没有才回退到旧的通用调用抽屉（历史能力仍在使用，后续按“一能力一表单”逐步替换）。

## 配置

在仓库根目录 `.env`（已 gitignore）中放：

```bash
TRADEMARK_MCP_URL=https://ipunique.com/mcp
TRADEMARK_MCP_TOKEN=<access_token>
TRADEMARK_MCP_REFRESH_TOKEN=<refresh_token>
TRADEMARK_MCP_CLIENT_ID=<oauth_client_id>
TRADEMARK_MCP_TOKEN_URL=https://ipunique.com/api/oauth/token
TRADEMARK_MCP_RESOURCE=https://ipunique.com/mcp
```

`docker-compose.yml` 只做 `${...:-}` 透传，不把密钥写进仓库。容器启动时 `import-trademark-tools.ts` 会把这些值合并进 `connectors.config_enc`；之后 token 刷新会直接更新这个连接器配置。

连接器里已经有 access token 时，启动不会用 `.env` 的旧值覆盖刷新后的 token。重新授权并换了新 token 时，临时加 `TRADEMARK_MCP_FORCE=1` 重启一次 api，让 `.env` 覆盖数据库；确认生效后去掉这个变量。

手动重跑导入（改了名称、标价或 schema 时）：

```bash
docker compose exec api node dist/scripts/import-trademark-tools.js
```

## OAuth 与刷新

- 上游使用 OAuth 2.1 Authorization Code + PKCE（S256）和 Dynamic Client Registration。授权必须由账号本人在浏览器完成。
- access token 有效期约 7 天，响应里有 refresh token。API 调用遇到 401 会用 refresh token 刷新一次，并把新 token 写回连接器；刷新失败会返回“授权已失效，请联系管理员重新授权”。
- 重新授权时需要重新走一遍 DCR + 浏览器授权，把新的 `TRADEMARK_MCP_TOKEN` / `TRADEMARK_MCP_REFRESH_TOKEN` / `TRADEMARK_MCP_CLIENT_ID` 写进 `.env`，再 `docker compose up -d api`。

## 已知限制

1. **平台级单账号**：所有用户共用这一个上游账号。正式上线前必须改成每用户 OAuth，否则额度、审计和授权条款都有问题。
2. **token 明文存 DB**：`connectors.config_enc` 目前是明文 JSON（和店铺凭证一致）。这是试点折中，生产要接 KMS/加密。
3. **延迟 5–20 秒**：近似商标 30 条可能超过 20 秒，接口超时设了 90 秒；页面有加载态和计时。
4. **结果体量大**：单条商标记录 80+ 字段，30 条响应接近 300KB。结果组件只展示关键列，完整内容在调用记录。
5. **不构成法律意见**：所有页面和提示词都带免责声明。
6. **额度不可控**：上游按工具计额度，律师工具已经用尽。需要和供应商确认套餐与计费。

## 排查

```bash
docker compose logs api --tail 100 | grep -i mcp
docker compose exec api node dist/scripts/import-trademark-tools.js
curl -s http://127.0.0.1:8888/api/www/tools/trademark-similar-search -H "authorization: Bearer <token>"
```

常见错误：

| 现象 | 原因 |
|---|---|
| `商标数据服务尚未授权` | `.env` 没有 token，或连接器配置被清空 |
| `商标数据服务授权已失效` | refresh token 也过期，需要重新授权 |
| `商标数据服务额度不足` | 上游额度用完 |
| `商标数据服务响应超时` | 查询条数太多或上游变慢，先降到 10 条 |
| `没有查到候选记录` | 该关键词在当前国家/分类下确实没有结果，不代表可注册 |
