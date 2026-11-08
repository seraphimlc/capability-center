import { Query, Body, Controller, Delete, Get, Headers, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ulid } from 'ulid';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { InvokeService } from './invoke.service';
import { FileService } from './file.service';
import { AgentService, toMessage } from './agent.service';
import { chatErrorMessage } from './chat-context';
import { StoreService } from './store.service';
import { KeyService } from './key.service';
import { WalletService } from './wallet.service';
import { ApiException, errorBody } from './errors';
import { AuthUser, CurrentUser, Public } from './auth.guard';
import { whitelabelValue } from './domain';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('healthz')
  async healthz() {
    await this.prisma.$queryRaw`SELECT 1`;
    const pong = await this.redis.client.ping();
    return { status: 'ok', redis: pong === 'PONG' ? 'up' : 'down', service: 'capability-center-api' };
  }
}

@Controller()
export class InvokeController {
  constructor(private readonly invoke: InvokeService) {}

  @Post('api/www/invokes')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: { tool_key?: string; input?: Record<string, unknown> },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.tool_key) throw new ApiException('VALIDATION_ERROR', '请选择能力', { field: 'tool_key' });
    const result = await this.invoke.create({
      user,
      toolKey: body.tool_key,
      payload: body.input || {},
      source: 'catalog',
      requestId: req.requestId || ulid(),
      idempotencyKey,
    });
    res.status(result.httpStatus);
    return result.payload;
  }

  @Post('api/www/invokes/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoke.cancel(user, id);
  }
}

@Controller()
export class FileController {
  constructor(private readonly files: FileService) {}

  @Post('api/www/files/presign')
  presign(@CurrentUser() user: AuthUser, @Body() body: { filename?: string; mime?: string; size?: number }) {
    return this.files.presign(user, body);
  }

  @Post('api/www/files/:id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.complete(user.id, id);
  }

  @Get('api/www/files/:id/download-url')
  download(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.downloadUrl(user.id, id);
  }

  @Get('api/www/storage/usage')
  usage(@CurrentUser() user: AuthUser) {
    return this.files.usage(user.id);
  }

  @Put('api/www/files/:id/raw')
  async putRaw(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    await this.files.writeRaw(user.id, id, Buffer.concat(chunks), String(req.headers['content-type'] || 'application/octet-stream'));
    res.status(204).end();
  }

  @Get('api/www/files/:id/raw')
  async getRaw(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const file = await this.files.readRaw(user.id, id);
    res.setHeader('Content-Type', file.mime);
    res.send(file.body);
  }
}

@Controller()
export class AgentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentService,
  ) {}

  @Get('api/www/agents')
  async list(@CurrentUser() user: AuthUser, @Query('platform') platform = '') {
    const rows = await this.prisma.agent.findMany({ where: { tenantId: user.tenantId, status: 'published' }, orderBy: { createdAt: 'asc' } });
    const items = [];
    for (const agent of rows) {
      const count = await this.prisma.agentTool.count({ where: { agentId: agent.id } });
      const model = agent.primaryModelId ? await this.prisma.aiModel.findUnique({ where: { id: agent.primaryModelId } }) : null;
      const platforms = Array.isArray(agent.platformsJson)
        ? (agent.platformsJson as string[])
        : [];
      items.push({
        key: agent.key,
        name: agent.name,
        summary: agent.summary,
        suggestions: agent.suggestions,
        tool_count: count,
        unbound: count === 0,
        model_tier: model?.displayName || '标准对话',
        platforms,
        store_assistant: platforms.length > 0,
      });
    }
    const filtered = platform
      ? items.filter((item) => (item.platforms || []).includes(platform) || item.key.includes(platform.replace('_', '-')))
      : items;
    return { items: filtered };
  }

  @Get('api/www/agents/:agentKey')
  async one(@CurrentUser() user: AuthUser, @Param('agentKey') agentKey: string) {
    const agent = await this.prisma.agent.findFirst({ where: { tenantId: user.tenantId, key: agentKey, status: 'published' } });
    if (!agent) throw new ApiException('AGENT_NOT_PUBLISHED');
    const bindings = await this.prisma.agentTool.findMany({ where: { agentId: agent.id } });
    const tools = await this.prisma.tool.findMany({ where: { id: { in: bindings.map((row) => row.toolId) }, status: 'published' } });
    const model = agent.primaryModelId ? await this.prisma.aiModel.findUnique({ where: { id: agent.primaryModelId } }) : null;
    const platforms = Array.isArray(agent.platformsJson)
      ? (agent.platformsJson as string[])
      : [];
    return {
      key: agent.key,
      name: agent.name,
      summary: agent.summary,
      suggestions: agent.suggestions,
      unbound: tools.length === 0,
      model_tier: model?.displayName || '标准对话',
      platforms,
      store_assistant: platforms.length > 0,
      tools: tools.map((tool) => ({ key: tool.key, name: tool.name, summary: tool.summary, pricing_credits: tool.pricingCredits })),
    };
  }

  @Get('api/www/conversations')
  async conversations(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.conversation.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const agents = await this.prisma.agent.findMany({ where: { id: { in: rows.map((row) => row.agentId) } } });
    const map = new Map(agents.map((agent) => [agent.id, agent]));
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        version: row.version,
        agent_key: map.get(row.agentId)?.key,
        agent_name: map.get(row.agentId)?.name,
        confirm_mode: row.confirmMode,
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  }

  @Post('api/www/conversations')
  async create(@CurrentUser() user: AuthUser, @Body() body: { agent_key?: string; title?: string; store_id?: string }) {
    const agent = await this.prisma.agent.findFirst({
      where: { tenantId: user.tenantId, key: body.agent_key, status: 'published' },
    });
    if (!agent) throw new ApiException('AGENT_NOT_PUBLISHED');
    let storeId: string | undefined;
    if (body.store_id) {
      const shop = await this.prisma.shopAccount.findFirst({
        where: { id: body.store_id, userId: user.id, tenantId: user.tenantId },
      });
      if (!shop) throw new ApiException('VALIDATION_ERROR', '店铺不存在');
      storeId = shop.id;
    }
    const conversation = await this.prisma.conversation.create({
      data: {
        id: ulid(),
        tenantId: user.tenantId,
        userId: user.id,
        agentId: agent.id,
        title: (body.title || agent.name).slice(0, 80),
        confirmMode: 'auto',
        showThinking: agent.showThinkingDefault,
        storeId,
      },
    });
    const bindings = await this.prisma.agentTool.findMany({ where: { agentId: agent.id } });
    if (bindings.length) {
      await this.prisma.conversationSkill.createMany({
        data: bindings.map((row) => ({ conversationId: conversation.id, toolId: row.toolId, enabled: true })),
      });
    }
    return { id: conversation.id, version: conversation.version, title: conversation.title };
  }

  @Get('api/www/conversations/:id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const conversation = await this.agents.owned(user, id);
    const agent = await this.prisma.agent.findUnique({ where: { id: conversation.agentId } });
    const skills = await this.prisma.conversationSkill.findMany({ where: { conversationId: id } });
    const bindings = agent ? await this.prisma.agentTool.findMany({ where: { agentId: agent.id } }) : [];
    const tools = await this.prisma.tool.findMany({ where: { id: { in: bindings.map((row) => row.toolId) } } });
    const enabled = new Map(skills.map((row) => [row.toolId, row.enabled]));
    const model = agent?.primaryModelId ? await this.prisma.aiModel.findUnique({ where: { id: agent.primaryModelId } }) : null;
    const store = conversation.storeId
      ? await this.prisma.shopAccount.findFirst({ where: { id: conversation.storeId, userId: user.id } })
      : null;
    return {
      id: conversation.id,
      title: conversation.title,
      version: conversation.version,
      confirm_mode: conversation.confirmMode,
      show_thinking: conversation.showThinking,
      agent: agent
        ? {
            key: agent.key,
            name: agent.name,
            summary: agent.summary,
            suggestions: agent.suggestions,
            unbound: bindings.length === 0,
            model_tier: model?.displayName || '标准对话',
          }
        : null,
      store: store
        ? { id: store.id, name: store.name, platform: store.platform, marketplace: store.marketplace, status: store.status }
        : null,
      skills: tools.map((tool) => ({
        tool_id: tool.id,
        key: tool.key,
        name: tool.name,
        summary: tool.summary,
        pricing_credits: tool.pricingCredits,
        enabled: enabled.get(tool.id) !== false,
      })),
    };
  }

  @Get('api/www/conversations/:id/messages')
  async messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.agents.owned(user, id);
    const rows = await this.prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'asc' } });
    const conversation = await this.prisma.conversation.findUnique({ where: { id } });
    return { items: rows.map(toMessage), version: conversation?.version ?? 1 };
  }

  @Put('api/www/conversations/:id')
  async rename(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { title?: string; base_version?: number }) {
    await this.agents.owned(user, id);
    if (!body.title?.trim()) throw new ApiException('VALIDATION_ERROR', '请填写标题', { field: 'title' });
    const version = await this.agents.bumpPublic(id, body.base_version);
    await this.prisma.conversation.update({ where: { id }, data: { title: body.title.trim().slice(0, 80) } });
    return { title: body.title.trim(), version };
  }

  @Post('api/www/conversations/:id/delete')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.agents.owned(user, id);
    await this.prisma.conversation.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  @Put('api/www/conversations/:id/skills')
  async skills(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { enabled_tool_ids?: string[]; base_version?: number },
  ) {
    const conversation = await this.agents.owned(user, id);
    const bindings = await this.prisma.agentTool.findMany({ where: { agentId: conversation.agentId } });
    const allowed = new Set(bindings.map((row) => row.toolId));
    const enabled = new Set(body.enabled_tool_ids || []);
    for (const toolId of enabled) {
      if (!allowed.has(toolId)) throw new ApiException('VALIDATION_ERROR', '不能启用未绑定的技能');
    }
    await this.prisma.conversationSkill.deleteMany({ where: { conversationId: id } });
    if (bindings.length) {
      await this.prisma.conversationSkill.createMany({
        data: bindings.map((row) => ({ conversationId: id, toolId: row.toolId, enabled: enabled.has(row.toolId) })),
      });
    }
    const version = await this.agents.bumpPublic(id, body.base_version);
    return { version };
  }

  @Put('api/www/conversations/:id/settings')
  async settings(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { confirm_mode?: string; show_thinking?: boolean; base_version?: number },
  ) {
    await this.agents.owned(user, id);
    if (body.confirm_mode && !['auto', 'manual'].includes(body.confirm_mode)) {
      throw new ApiException('VALIDATION_ERROR', '确认模式不正确');
    }
    const version = await this.agents.bumpPublic(id, body.base_version);
    await this.prisma.conversation.update({
      where: { id },
      data: {
        confirmMode: body.confirm_mode,
        showThinking: body.show_thinking,
      },
    });
    return { version, confirm_mode: body.confirm_mode, show_thinking: body.show_thinking };
  }

  @Post('api/www/conversations/:id/chat')
  async chat(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { content?: string; attachments?: string[] },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    let opened = false;
    try {
      const handle = await this.agents.begin(user, id);
      opened = true;
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const abort = () => handle.controller.abort();
      req.on('close', abort);
      try {
        await this.agents.run({
          user,
          conversationId: id,
          content: body.content || '',
          attachments: Array.isArray(body.attachments) ? body.attachments : [],
          requestId: req.requestId || ulid(),
          signal: handle.controller.signal,
          send,
        });
      } catch (error) {
        const parsed = errorBody(error);
        send('error', {
          code: parsed.code,
          message: chatErrorMessage(parsed.code, parsed.message),
          request_id: req.requestId,
          ...(parsed.details ? { details: parsed.details } : {}),
        });
        send('done', { finish_reason: 'error' });
      } finally {
        req.off('close', abort);
        await this.agents.end(id);
        res.end();
      }
    } catch (error) {
      if (!opened && !res.headersSent) {
        const parsed = errorBody(error);
        res.status(parsed.status).json({
          ok: false,
          request_id: req.requestId,
          error: { code: parsed.code, message: parsed.message, retryable: parsed.retryable },
        });
      }
    }
  }

  @Post('api/www/conversations/:id/stop')
  stop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.stop(user, id);
  }

  @Post('api/www/conversations/:id/tool-confirm')
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { call_id?: string; decision?: string },
    @Req() req: Request,
  ) {
    return this.agents.confirm(user, id, body, req.requestId || ulid());
  }
}

@Controller()
export class OpenController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invokes: InvokeService,
    private readonly wallets: WalletService,
    private readonly keys: KeyService,
  ) {}

  @Get('v1/tools')
  async tools(@CurrentUser() user: AuthUser) {
    await this.scope(user, 'tools:read');
    const rows = await this.prisma.tool.findMany({
      where: { tenantId: user.tenantId, status: 'published' },
      orderBy: { name: 'asc' },
    });
    return {
      items: rows.map((tool) => ({
        key: tool.key,
        name: tool.name,
        summary: tool.summary,
        pricing_credits: tool.pricingCredits,
        schema: whitelabelValue(tool.schemaJson),
        async: tool.isAsync,
      })),
    };
  }

  @Post('v1/invokes')
  async createInvoke(
    @CurrentUser() user: AuthUser,
    @Body() body: { tool_key?: string; input?: Record<string, unknown> },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.scope(user, 'tools:invoke');
    if (!body.tool_key) throw new ApiException('VALIDATION_ERROR', '请选择能力');
    const result = await this.invokes.create({
      user,
      toolKey: body.tool_key,
      payload: body.input || {},
      source: 'api',
      requestId: req.requestId || ulid(),
      idempotencyKey,
    });
    res.status(result.httpStatus);
    return result.payload;
  }

  @Get('v1/invokes/:id')
  async invokeOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.scope(user, 'tools:read');
    const row = await this.prisma.invokeRecord.findFirst({ where: { id, userId: user.id } });
    if (!row) throw new ApiException('NOT_FOUND');
    return whitelabelValue({
      id: row.id,
      tool_key: row.toolKey,
      status: row.status,
      output: row.outputJson,
      error_code: row.errorCode,
      credits: row.credits,
      task_id: row.taskId,
    });
  }

  @Get('v1/wallet')
  async walletView(@CurrentUser() user: AuthUser) {
    await this.scope(user, 'wallet:read');
    return this.wallets.snapshot(user.id);
  }

  @Get('api/www/open/keys')
  async listKeys(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.apiKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    return { items: rows.map(maskKey), mcp: mcpSnippet() };
  }

  @Post('api/www/open/keys')
  async createKey(
    @CurrentUser() user: AuthUser,
    @Body() body: { name?: string; env?: string; scopes?: string[]; ip_allowlist?: string[] },
    @Req() req: Request,
  ) {
    const env = body.env === 'prod' ? 'prod' : 'sandbox';
    const secret = ulid().replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
    const publicId = ulid().replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase();
    const token = `ck_${env}_${publicId}_${secret}`;
    const scopes = body.scopes?.length ? body.scopes : ['tools:read', 'tools:invoke', 'wallet:read'];
    await this.prisma.apiKey.create({
      data: {
        id: ulid(),
        userId: user.id,
        tenantId: user.tenantId,
        name: (body.name || '默认密钥').slice(0, 40),
        env,
        keyPrefix: publicId,
        keyHash: this.keys.hashSecret(secret),
        scopes,
        ipAllowlist: body.ip_allowlist || [],
        status: 'active',
      },
    });
    return { token, env, scopes, mcp: mcpSnippet(), shown_once: true };
  }

  @Post('api/www/open/keys/:id/revoke')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.apiKey.updateMany({ where: { id, userId: user.id }, data: { status: 'revoked' } });
    return { revoked: true };
  }

  @Post('mcp')
  async mcp(@CurrentUser() user: AuthUser, @Body() body: { id?: unknown; method?: string; params?: Record<string, unknown> }, @Req() req: Request, @Res() res: Response) {
    const session = req.header('mcp-session-id') || ulid();
    res.setHeader('Mcp-Session-Id', session);
    const id = body?.id;
    if (id === undefined || id === null) {
      res.status(202).end();
      return;
    }
    try {
      const result = await this.rpc(String(body.method || ''), body.params || {}, user, req.requestId || ulid());
      res.json({ jsonrpc: '2.0', id, result });
    } catch (error) {
      const parsed = errorBody(error);
      res.status(200).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: parsed.message, data: { code: parsed.code, request_id: req.requestId } },
      });
    }
  }

  private async rpc(method: string, params: Record<string, unknown>, user: AuthUser, requestId: string) {
    if (method === 'initialize') {
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: '能力中心', version: '0.1.0' },
      };
    }
    if (method === 'ping') return {};
    if (method === 'tools/list') {
      await this.scope(user, 'tools:read');
      const rows = await this.prisma.tool.findMany({ where: { tenantId: user.tenantId, status: 'published' } });
      return {
        tools: rows.map((tool) => ({
          name: tool.key,
          description: `${tool.name}。${tool.summary}。每次成功调用消耗 ${tool.pricingCredits} 积分。`,
          inputSchema: whitelabelValue(tool.schemaJson),
        })),
      };
    }
    if (method === 'tools/call') {
      await this.scope(user, 'tools:invoke');
      const name = String(params.name || '');
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
      try {
        const result = await this.invokes.create({
          user,
          toolKey: name,
          payload: args,
          source: 'mcp',
          requestId,
          idempotencyKey: typeof params.idempotency_key === 'string' ? params.idempotency_key : undefined,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result.payload.invoke.output ?? { status: result.payload.invoke.status }) }],
          isError: false,
          structuredContent: result.payload.invoke,
        };
      } catch (error) {
        const parsed = errorBody(error);
        return { content: [{ type: 'text', text: parsed.message }], isError: true };
      }
    }
    throw new ApiException('NOT_FOUND', '不支持的方法');
  }

  private async scope(user: AuthUser, scope: string) {
    if (user.role !== 'integration') return;
    const key = await this.prisma.apiKey.findUnique({ where: { id: user.sid } });
    this.keys.assertScope(user, scope, key?.scopes ?? []);
  }
}

function maskKey(row: { id: string; name: string; env: string; keyPrefix: string; status: string; scopes: unknown; ipAllowlist: unknown; lastUsedAt: Date | null; createdAt: Date }) {
  return {
    id: row.id,
    name: row.name,
    env: row.env,
    prefix: `ck_${row.env}_${row.keyPrefix}_`,
    status: row.status,
    scopes: row.scopes,
    ip_allowlist: row.ipAllowlist,
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function mcpSnippet() {
  return {
    url: '/mcp',
    transport: 'streamableHttp',
    note: '在请求头加入 Authorization: Bearer <你的密钥>。密钥只在创建时完整显示。',
  };
}


@Controller()
export class StoreController {
  constructor(private readonly stores: StoreService) {}

  @Get('api/www/shops/platforms')
  platforms() {
    return { items: this.stores.platforms() };
  }

  @Get('api/www/shops')
  list(@CurrentUser() user: AuthUser) {
    return this.stores.list(user);
  }

  @Get('api/www/shops/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stores.get(user, id);
  }

  @Post('api/www/shops')
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: { platform?: string; name?: string; credentials?: Record<string, string>; marketplace?: string; external_store_id?: string },
  ) {
    return this.stores.create(user, {
      platform: String(body.platform || ''),
      name: String(body.name || ''),
      credentials: body.credentials || {},
      marketplace: body.marketplace,
      external_store_id: body.external_store_id,
    });
  }

  @Put('api/www/shops/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { name?: string; credentials?: Record<string, string>; marketplace?: string; status?: string },
  ) {
    return this.stores.update(user, id, body);
  }

  @Post('api/www/shops/:id/probe')
  probe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stores.probe(user, id);
  }

  @Post('api/www/shops/:id/disconnect')
  disconnect(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stores.disconnect(user, id);
  }

  @Delete('api/www/shops/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stores.remove(user, id);
  }
}
