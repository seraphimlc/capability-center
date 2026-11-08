import { Body, Controller, Get, Headers, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ulid } from 'ulid';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { WalletService } from './wallet.service';
import { FileService } from './file.service';
import { TaskService } from './task.service';
import { ModelService, readLlmRuntime } from './model.service';
import { AuditService, NotifyService, asJson, flag } from './support.service';
import { ApiException } from './errors';
import { AuthUser, CurrentUser, Roles, signAccess } from './auth.guard';
import { pageArgs, shanghaiParts } from './domain';
import { toInvoke } from './catalog.controller';

@Controller()
@Roles('ops', 'super_admin', 'tenant_admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly files: FileService,
    private readonly taskService: TaskService,
    private readonly models: ModelService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  @Get('api/admin/overview')
  async overview(@CurrentUser() user: AuthUser) {
    const [users, tools, runningTasks, invokes] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.tool.count({ where: { status: 'published' } }),
      this.prisma.asyncTask.count({ where: { status: { in: ['queued', 'running'] } } }),
      this.prisma.invokeRecord.count(),
    ]);
    const runtime = readLlmRuntime();
    const oss = await this.files.resolve();
    return {
      users,
      published_tools: tools,
      running_tasks: runningTasks,
      invokes,
      billing_strategy: await flag(this.prisma, 'billing_strategy', 'A'),
      maintenance: (await flag(this.prisma, 'maintenance_mode', 'false')) === 'true',
      llm: { provider: runtime.provider, has_key: Boolean(runtime.apiKey), model: runtime.provider === 'mock' ? null : runtime.model },
      oss: { provider: oss.provider, bucket: oss.bucket, prefix: oss.prefix, source: oss.source },
      actor: user.email,
    };
  }

  @Get('api/admin/users')
  async users(@Query('q') q = '') {
    const rows = await this.prisma.user.findMany({
      where: q ? { OR: [{ email: { contains: q } }, { displayName: { contains: q } }] } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const wallets = await this.prisma.wallet.findMany({ where: { userId: { in: rows.map((row) => row.id) } } });
    const map = new Map(wallets.map((row) => [row.userId, row]));
    return {
      items: rows.map((row) => ({
        id: row.id,
        email: row.email,
        display_name: row.displayName,
        role: row.role,
        status: row.status,
        tenant_id: row.tenantId,
        balance: map.get(row.id)?.balance ?? 0,
        created_at: row.createdAt.toISOString(),
      })),
    };
  }

  @Post('api/admin/users/:id/status')
  async userStatus(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: { status?: string }, @Req() req: Request) {
    assertOps(actor);
    if (!body.status || !['active', 'disabled'].includes(body.status)) throw new ApiException('VALIDATION_ERROR');
    await this.prisma.user.update({ where: { id }, data: { status: body.status } });
    if (body.status === 'disabled') {
      await this.prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.write({ tenantId: actor.tenantId, actorId: actor.id, action: 'user.status', targetType: 'user', targetId: id, detail: body, requestId: req.requestId });
    return { status: body.status };
  }

  @Post('api/admin/wallet/grant')
  async grant(
    @CurrentUser() actor: AuthUser,
    @Body() body: { user_id?: string; amount?: number; reason?: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    assertOps(actor);
    if (!idempotencyKey) throw new ApiException('VALIDATION_ERROR', '请提供 Idempotency-Key');
    if (!body.user_id || !body.reason?.trim()) throw new ApiException('VALIDATION_ERROR', '请填写用户和原因');
    const result = await this.wallet.grant({
      userId: body.user_id,
      amount: Number(body.amount),
      note: body.reason.trim(),
      bizId: idempotencyKey,
      actorId: actor.id,
      requestId: req.requestId,
    });
    await this.notify.push(body.user_id, '积分已到账', `管理员为你充值 ${body.amount} 积分。${body.reason.trim()}`);
    await this.audit.write({
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: 'wallet.grant',
      targetType: 'wallet',
      targetId: body.user_id,
      detail: { amount: body.amount, reason: body.reason },
      requestId: req.requestId,
    });
    return result;
  }

  @Post('api/admin/wallet/adjust')
  async adjust(
    @CurrentUser() actor: AuthUser,
    @Body() body: { user_id?: string; amount?: number; reason?: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    assertOps(actor);
    if (!idempotencyKey || !body.user_id || !body.reason) throw new ApiException('VALIDATION_ERROR');
    const result = await this.wallet.adjust({
      userId: body.user_id,
      amount: Number(body.amount),
      note: body.reason,
      bizId: idempotencyKey,
      requestId: req.requestId,
    });
    await this.audit.write({ tenantId: actor.tenantId, actorId: actor.id, action: 'wallet.adjust', targetType: 'wallet', targetId: body.user_id, detail: body, requestId: req.requestId });
    return result;
  }

  @Get('api/admin/ledger')
  async ledger(@Query('user_id') userId = '', @Query() query: Record<string, unknown>) {
    const { page, pageSize, skip } = pageArgs(query);
    const where: Prisma.LedgerEntryWhereInput = userId ? { userId } : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.count({ where }),
      this.prisma.ledgerEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        user_id: row.userId,
        type: row.type,
        amount: row.amount,
        balance_after: row.balanceAfter,
        biz_type: row.bizType,
        biz_id: row.bizId,
        note: row.note,
        created_at: row.createdAt.toISOString(),
      })),
      __page: { page, page_size: pageSize, total },
    };
  }

  @Get('api/admin/categories')
  async categories(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.category.findMany({ where: { tenantId: user.tenantId }, orderBy: { sort: 'asc' } });
    return { items: rows };
  }

  @Get('api/admin/tools')
  async tools() {
    const rows = await this.prisma.tool.findMany({ orderBy: { updatedAt: 'desc' } });
    return { items: rows.map((row) => ({ ...row, is_async: row.isAsync, schema_json: row.schemaJson, examples_json: row.examplesJson })) };
  }

  @Post('api/admin/tools')
  async createTool(@CurrentUser() actor: AuthUser, @Body() body: Record<string, unknown>, @Req() req: Request) {
    assertOps(actor);
    const tool = await this.prisma.tool.create({
      data: {
        id: ulid(),
        tenantId: actor.tenantId,
        key: String(body.key || '').trim(),
        name: String(body.name || '').trim(),
        summary: String(body.summary || '').slice(0, 500),
        descriptionMd: String(body.description_md || ''),
        categoryId: String(body.category_id),
        status: String(body.status || 'draft'),
        schemaJson: asJson(body.schema_json || { type: 'object', properties: {} }),
        examplesJson: asJson(body.examples_json || []),
        pricingCredits: Number(body.pricing_credits || 0),
        connectorId: String(body.connector_id),
        upstreamOp: String(body.upstream_op || 'run'),
        isAsync: Boolean(body.is_async),
        capability: String(body.capability || 'sync'),
      },
    });
    await this.audit.write({ tenantId: actor.tenantId, actorId: actor.id, action: 'tool.create', targetType: 'tool', targetId: tool.id, requestId: req.requestId });
    return { id: tool.id };
  }

  @Put('api/admin/tools/:id')
  async updateTool(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    assertOps(actor);
    await this.prisma.tool.update({
      where: { id },
      data: {
        name: body.name ? String(body.name) : undefined,
        summary: body.summary ? String(body.summary) : undefined,
        descriptionMd: body.description_md ? String(body.description_md) : undefined,
        status: body.status ? String(body.status) : undefined,
        pricingCredits: body.pricing_credits === undefined ? undefined : Number(body.pricing_credits),
        schemaJson: body.schema_json ? asJson(body.schema_json) : undefined,
        isAsync: body.is_async === undefined ? undefined : Boolean(body.is_async),
        capability: body.capability ? String(body.capability) : undefined,
        connectorId: body.connector_id ? String(body.connector_id) : undefined,
      },
    });
    await this.audit.write({ tenantId: actor.tenantId, actorId: actor.id, action: 'tool.update', targetType: 'tool', targetId: id, detail: { status: body.status }, requestId: req.requestId });
    return { id };
  }

  @Get('api/admin/agents')
  async agents() {
    const rows = await this.prisma.agent.findMany({ orderBy: { createdAt: 'desc' } });
    const items = [];
    for (const agent of rows) {
      const tools = await this.prisma.agentTool.findMany({ where: { agentId: agent.id } });
      items.push({ ...agent, tool_ids: tools.map((row) => row.toolId), suggestions: agent.suggestions });
    }
    return { items };
  }

  @Post('api/admin/agents')
  async createAgent(@CurrentUser() actor: AuthUser, @Body() body: Record<string, unknown>) {
    assertOps(actor);
    const agent = await this.prisma.agent.create({
      data: {
        id: ulid(),
        tenantId: actor.tenantId,
        key: String(body.key || '').trim(),
        name: String(body.name || '').trim(),
        summary: String(body.summary || ''),
        systemPrompt: String(body.system_prompt || '你是能力中心助手。'),
        status: String(body.status || 'draft'),
        primaryModelId: body.primary_model_id ? String(body.primary_model_id) : null,
        backupModelId: body.backup_model_id ? String(body.backup_model_id) : null,
        suggestions: asJson(body.suggestions || []),
        showThinkingDefault: Boolean(body.show_thinking_default),
      },
    });
    const toolIds = Array.isArray(body.tool_ids) ? (body.tool_ids as string[]) : [];
    if (toolIds.length) {
      await this.prisma.agentTool.createMany({ data: toolIds.map((toolId) => ({ agentId: agent.id, toolId })) });
    }
    return { id: agent.id };
  }

  @Put('api/admin/agents/:id')
  async updateAgent(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    assertOps(actor);
    await this.prisma.agent.update({
      where: { id },
      data: {
        name: body.name ? String(body.name) : undefined,
        summary: body.summary ? String(body.summary) : undefined,
        systemPrompt: body.system_prompt ? String(body.system_prompt) : undefined,
        status: body.status ? String(body.status) : undefined,
        primaryModelId: body.primary_model_id ? String(body.primary_model_id) : undefined,
        backupModelId: body.backup_model_id ? String(body.backup_model_id) : undefined,
        suggestions: body.suggestions ? asJson(body.suggestions) : undefined,
      },
    });
    if (Array.isArray(body.tool_ids)) {
      await this.prisma.agentTool.deleteMany({ where: { agentId: id } });
      const toolIds = body.tool_ids as string[];
      if (toolIds.length) await this.prisma.agentTool.createMany({ data: toolIds.map((toolId) => ({ agentId: id, toolId })) });
    }
    return { id };
  }

  @Get('api/admin/connectors')
  async connectors() {
    const rows = await this.prisma.connector.findMany({ orderBy: { createdAt: 'desc' } });
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        name: row.name,
        status: row.status,
        config: maskConfig(row.configEnc),
      })),
    };
  }

  @Post('api/admin/connectors')
  async createConnector(@CurrentUser() actor: AuthUser, @Body() body: { type?: string; name?: string; config?: unknown }) {
    assertOps(actor);
    const row = await this.prisma.connector.create({
      data: {
        id: ulid(),
        tenantId: actor.tenantId,
        type: body.type || 'builtin',
        name: body.name || '连接器',
        status: 'active',
        configEnc: JSON.stringify(body.config || {}),
      },
    });
    return { id: row.id };
  }

  @Post('api/admin/connectors/:id/probe')
  async probeConnector(@Param('id') id: string) {
    const row = await this.prisma.connector.findUnique({ where: { id } });
    if (!row) throw new ApiException('NOT_FOUND');
    if (row.type === 'builtin' || row.type === 'linkfox') return { ok: true, message: '演示探活通过，未连接真实外部供应商' };
    const cfg = JSON.parse(row.configEnc || '{}') as { baseUrl?: string };
    if (!cfg.baseUrl) throw new ApiException('CONNECTOR_UNAVAILABLE');
    const response = await fetch(cfg.baseUrl, { method: 'GET' }).catch(() => null);
    if (!response) throw new ApiException('CONNECTOR_UNAVAILABLE');
    return { ok: response.ok, status: response.status };
  }

  @Get('api/admin/models')
  async modelList() {
    const rows = await this.prisma.aiModel.findMany({ orderBy: { createdAt: 'asc' } });
    const runtime = readLlmRuntime();
    return {
      runtime: { provider: runtime.provider, has_key: Boolean(runtime.apiKey), base_url: runtime.baseUrl ? runtime.baseUrl.replace(/\/\/[^/]*@/, '//') : '', default_model: runtime.model },
      items: rows.map((row) => ({
        id: row.id,
        display_name: row.displayName,
        capability: row.capability,
        upstream_model: row.upstreamModel,
        status: row.status,
        timeout_ms: row.timeoutMs,
        max_tokens: row.maxTokens,
        price_credits: row.priceCredits,
      })),
    };
  }

  @Post('api/admin/models')
  async createModel(@CurrentUser() actor: AuthUser, @Body() body: Record<string, unknown>) {
    assertOps(actor);
    const row = await this.prisma.aiModel.create({
      data: {
        id: ulid(),
        tenantId: actor.tenantId,
        displayName: String(body.display_name || '未命名档'),
        capability: String(body.capability || 'chat'),
        upstreamModel: String(body.upstream_model || 'mock'),
        status: String(body.status || 'active'),
        timeoutMs: Number(body.timeout_ms || 60000),
        maxTokens: Number(body.max_tokens || 2048),
        priceCredits: Number(body.price_credits || 0),
      },
    });
    return { id: row.id };
  }

  @Put('api/admin/models/:id')
  async updateModel(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    await this.prisma.aiModel.update({
      where: { id },
      data: {
        displayName: body.display_name ? String(body.display_name) : undefined,
        upstreamModel: body.upstream_model ? String(body.upstream_model) : undefined,
        status: body.status ? String(body.status) : undefined,
        priceCredits: body.price_credits === undefined ? undefined : Number(body.price_credits),
        capability: body.capability ? String(body.capability) : undefined,
      },
    });
    return { id };
  }

  @Post('api/admin/models/:id/test')
  testModel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { prompt?: string }) {
    return this.models.testPrompt(id, body.prompt || '回复两个字：就绪', user.id, user.tenantId);
  }

  @Get('api/admin/oss')
  async oss(@CurrentUser() user: AuthUser) {
    const cfg = await this.files.resolve();
    const row = await this.prisma.ossConfig.findUnique({ where: { tenantId: user.tenantId } });
    return {
      provider: cfg.provider,
      endpoint: cfg.endpoint,
      public_endpoint: cfg.publicEndpoint,
      region: cfg.region,
      bucket: cfg.bucket,
      prefix: cfg.prefix,
      public_read: cfg.publicRead,
      signed_url_expires: cfg.signedUrlExpires,
      media_public_base: cfg.mediaPublicBase,
      force_path_style: cfg.forcePathStyle,
      source: cfg.source,
      access_key_id: mask(cfg.accessKeyId),
      has_secret: Boolean(row?.accessKeySecret || cfg.accessKeySecret),
    };
  }

  @Put('api/admin/oss')
  async saveOss(@CurrentUser() actor: AuthUser, @Body() body: Record<string, unknown>, @Req() req: Request) {
    if (actor.role !== 'super_admin' && actor.role !== 'ops') throw new ApiException('FORBIDDEN');
    const current = await this.prisma.ossConfig.findUnique({ where: { tenantId: actor.tenantId } });
    const secret = String(body.access_key_secret || '');
    const data = {
      provider: String(body.provider || 'minio'),
      endpoint: String(body.endpoint || ''),
      publicEndpoint: String(body.public_endpoint || body.endpoint || ''),
      region: String(body.region || 'us-east-1'),
      bucket: String(body.bucket || 'capability-center'),
      accessKeyId: String(body.access_key_id || current?.accessKeyId || ''),
      accessKeySecret: secret && !secret.includes('*') ? secret : current?.accessKeySecret || '',
      prefix: String(body.prefix || 'capability-center'),
      publicRead: Boolean(body.public_read),
      signedUrlExpires: Number(body.signed_url_expires || 3600),
      mediaPublicBase: body.media_public_base ? String(body.media_public_base) : null,
      forcePathStyle: body.force_path_style === undefined ? true : Boolean(body.force_path_style),
      status: 'active',
    };
    await this.prisma.ossConfig.upsert({
      where: { tenantId: actor.tenantId },
      update: data,
      create: { id: ulid(), tenantId: actor.tenantId, ...data },
    });
    await this.audit.write({ tenantId: actor.tenantId, actorId: actor.id, action: 'oss.update', targetType: 'oss', targetId: actor.tenantId, requestId: req.requestId });
    return { saved: true };
  }

  @Post('api/admin/oss/probe')
  async probeOss() {
    try {
      return await this.files.probe();
    } catch {
      throw new ApiException('OSS_NOT_CONFIGURED');
    }
  }

  @Get('api/admin/tasks')
  async taskList(@Query() query: Record<string, string>) {
    const { page, pageSize, skip } = pageArgs(query);
    const where: Prisma.AsyncTaskWhereInput = query.status ? { status: query.status } : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.asyncTask.count({ where }),
      this.prisma.asyncTask.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return { items: rows.map(toTask), __page: { page, page_size: pageSize, total } };
  }

  @Post('api/admin/tasks/:id/retry')
  async retry(@Param('id') id: string) {
    const task = await this.prisma.asyncTask.findUnique({ where: { id } });
    if (!task) throw new ApiException('TASK_NOT_FOUND');
    await this.prisma.asyncTask.update({ where: { id }, data: { status: 'queued', errorCode: null, progress: 0 } });
    if (task.invokeId) {
      await this.prisma.invokeRecord.update({ where: { id: task.invokeId }, data: { status: 'running', errorCode: null, finishedAt: null } });
    }
    await this.taskService.enqueue(id);
    return { id, status: 'queued' };
  }

  @Get('api/admin/audit')
  async auditList(@Query() query: Record<string, unknown>) {
    const { page, pageSize, skip } = pageArgs(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditEvent.count(),
      this.prisma.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        actor_id: row.actorId,
        action: row.action,
        target_type: row.targetType,
        target_id: row.targetId,
        detail: row.detail,
        request_id: row.requestId,
        created_at: row.createdAt.toISOString(),
      })),
      __page: { page, page_size: pageSize, total },
    };
  }

  @Get('api/admin/invokes')
  async invokes(@Query() query: Record<string, string>) {
    const { page, pageSize, skip } = pageArgs(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invokeRecord.count(),
      this.prisma.invokeRecord.findMany({ orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return { items: rows.map(toInvoke), __page: { page, page_size: pageSize, total } };
  }

  @Get('api/admin/keys')
  async keys() {
    const rows = await this.prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return {
      items: rows.map((row) => ({
        id: row.id,
        user_id: row.userId,
        name: row.name,
        env: row.env,
        prefix: row.keyPrefix,
        status: row.status,
        scopes: row.scopes,
        ip_allowlist: row.ipAllowlist,
        last_used_at: row.lastUsedAt?.toISOString() ?? null,
      })),
    };
  }

  @Post('api/admin/keys/:id/revoke')
  async revokeKey(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Req() req: Request) {
    assertOps(actor);
    await this.prisma.apiKey.update({ where: { id }, data: { status: 'revoked' } });
    await this.audit.write({ tenantId: actor.tenantId, actorId: actor.id, action: 'apikey.revoke', targetType: 'api_key', targetId: id, requestId: req.requestId });
    return { revoked: true };
  }

  @Get('api/admin/rate-limits')
  async limits() {
    const rows = await this.prisma.rateLimitRule.findMany();
    return { items: rows };
  }

  @Put('api/admin/rate-limits/:scope')
  async saveLimit(@Param('scope') scope: string, @Body() body: { limit?: number; window_sec?: number; enabled?: boolean }) {
    await this.prisma.rateLimitRule.upsert({
      where: { scope },
      update: { limit: Number(body.limit || 60), windowSec: Number(body.window_sec || 60), enabled: body.enabled !== false },
      create: { id: ulid(), scope, limit: Number(body.limit || 60), windowSec: Number(body.window_sec || 60), enabled: body.enabled !== false },
    });
    return { scope };
  }

  @Get('api/admin/settings/flags')
  async flags() {
    const rows = await this.prisma.featureFlag.findMany();
    return { items: rows };
  }

  @Put('api/admin/settings/flags/:key')
  async saveFlag(@CurrentUser() actor: AuthUser, @Param('key') key: string, @Body() body: { value?: string }, @Req() req: Request) {
    if (actor.role !== 'super_admin') throw new ApiException('FORBIDDEN');
    await this.prisma.featureFlag.upsert({ where: { key }, update: { value: String(body.value ?? '') }, create: { key, value: String(body.value ?? '') } });
    await this.audit.write({ tenantId: actor.tenantId, actorId: actor.id, action: 'flag.update', targetType: 'flag', targetId: key, detail: body, requestId: req.requestId });
    return { key, value: body.value };
  }

  @Get('api/admin/announcements')
  async announcements() {
    const rows = await this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
    return { items: rows };
  }

  @Post('api/admin/announcements')
  async createAnnouncement(@Body() body: { title?: string; body?: string }) {
    const row = await this.prisma.announcement.create({
      data: { id: ulid(), title: body.title || '公告', body: body.body || '', published: true },
    });
    return { id: row.id };
  }

  @Post('api/admin/reconciliation/runs')
  async reconcile() {
    const invokes = await this.prisma.invokeRecord.findMany({ where: { status: 'success' } });
    const ledgers = await this.prisma.ledgerEntry.findMany({ where: { bizType: 'invoke', type: 'consume' } });
    const ledgerMap = new Map(ledgers.map((row) => [row.bizId, row]));
    const diffs = invokes
      .filter((row) => (ledgerMap.get(row.id)?.amount ?? 0) !== -row.credits)
      .map((row) => ({ invoke_id: row.id, credits: row.credits, ledger: ledgerMap.get(row.id)?.amount ?? null }));
    return { success_invokes: invokes.length, ledger_rows: ledgers.length, diffs };
  }

  @Get('api/admin/adjustment-tickets')
  async tickets() {
    const rows = await this.prisma.adjustmentTicket.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return { items: rows };
  }

  @Post('api/admin/adjustment-tickets/:id/resolve')
  async resolveTicket(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: { action?: string; note?: string }, @Req() req: Request) {
    assertOps(actor);
    const ticket = await this.prisma.adjustmentTicket.findUnique({ where: { id } });
    if (!ticket || ticket.status !== 'open') throw new ApiException('ADJUSTMENT_NOT_ALLOWED');
    if (body.action === 'refund' && ticket.invokeId) {
      const invoke = await this.prisma.invokeRecord.findUnique({ where: { id: ticket.invokeId } });
      if (invoke && invoke.credits > 0) {
        await this.wallet.refund({ userId: ticket.userId, amount: invoke.credits, note: body.note || '调账退款', bizId: `refund-${ticket.id}`, requestId: req.requestId });
      }
    }
    await this.prisma.adjustmentTicket.update({ where: { id }, data: { status: body.action === 'reject' ? 'rejected' : 'resolved', resolution: body.note || body.action || '' } });
    return { id, status: body.action === 'reject' ? 'rejected' : 'resolved' };
  }

  @Post('api/admin/impersonate')
  async impersonate(@CurrentUser() actor: AuthUser, @Body() body: { user_id?: string; reason?: string }, @Req() req: Request) {
    if (actor.role !== 'super_admin') throw new ApiException('FORBIDDEN');
    if (!body.user_id || !body.reason?.trim()) throw new ApiException('VALIDATION_ERROR', '请填写对象和原因');
    const target = await this.prisma.user.findUnique({ where: { id: body.user_id } });
    if (!target) throw new ApiException('NOT_FOUND');
    const access = signAccess({
      sub: target.id,
      tid: target.tenantId,
      roles: ['end_user'],
      sid: actor.sid,
      typ: 'access',
      portal: 'www',
      imp: actor.id,
    });
    await this.audit.write({
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: 'impersonate.start',
      targetType: 'user',
      targetId: target.id,
      detail: { reason: body.reason, read_only: true },
      requestId: req.requestId,
    });
    return { access_token: access, expires_in: 900, read_only: true, user: { id: target.id, email: target.email } };
  }

  @Get('api/www/wallet')
  @Roles()
  async myWallet(@CurrentUser() user: AuthUser) {
    return this.wallet.snapshot(user.id);
  }

  @Get('api/www/wallet/ledger')
  @Roles()
  async myLedger(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    const { page, pageSize, skip } = pageArgs(query);
    const where = { userId: user.id };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.count({ where }),
      this.prisma.ledgerEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        amount: row.amount,
        balance_after: row.balanceAfter,
        note: row.note,
        biz_type: row.bizType,
        biz_id: row.bizId,
        created_at: row.createdAt.toISOString(),
      })),
      __page: { page, page_size: pageSize, total },
    };
  }

  @Get('api/www/bills')
  @Roles()
  async bills(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.ledgerEntry.findMany({ where: { userId: user.id } });
    const map = new Map<string, { period: string; grant: number; consume: number; adjust: number; refund: number }>();
    for (const row of rows) {
      const period = shanghaiParts(row.createdAt).period;
      const bucket = map.get(period) || { period, grant: 0, consume: 0, adjust: 0, refund: 0 };
      if (row.type === 'grant') bucket.grant += row.amount;
      else if (row.type === 'consume') bucket.consume += row.amount;
      else if (row.type === 'refund') bucket.refund += row.amount;
      else bucket.adjust += row.amount;
      map.set(period, bucket);
    }
    const items = [...map.values()].sort((a, b) => b.period.localeCompare(a.period));
    return { currency: 'CNY', timezone: 'Asia/Shanghai', items };
  }

  @Get('api/www/bills/:period')
  @Roles()
  async bill(@CurrentUser() user: AuthUser, @Param('period') period: string) {
    const all = await this.bills(user);
    const found = all.items.find((item) => item.period === period);
    if (!found) return { period, grant: 0, consume: 0, adjust: 0, refund: 0, currency: 'CNY' };
    return { ...found, currency: 'CNY', timezone: 'Asia/Shanghai' };
  }

  @Post('api/www/adjustment-tickets')
  @Roles()
  async openTicket(@CurrentUser() user: AuthUser, @Body() body: { invoke_id?: string; reason?: string }) {
    if (!body.reason?.trim()) throw new ApiException('VALIDATION_ERROR', '请填写原因');
    const row = await this.prisma.adjustmentTicket.create({
      data: { id: ulid(), tenantId: user.tenantId, userId: user.id, invokeId: body.invoke_id, reason: body.reason.trim(), status: 'open' },
    });
    return { id: row.id, status: row.status };
  }

  @Get('api/www/tasks')
  @Roles()
  async myTasks(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.asyncTask.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items: rows.map(toTask) };
  }

  @Get('api/www/tasks/:id')
  @Roles()
  async myTask(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const row = await this.prisma.asyncTask.findFirst({ where: { id, userId: user.id } });
    if (!row) throw new ApiException('TASK_NOT_FOUND');
    return toTask(row);
  }

  @Post('api/www/tasks/:id/cancel')
  @Roles()
  cancelTask(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.taskService.cancel(user.id, id);
  }
}

function assertOps(user: AuthUser) {
  if (!['ops', 'super_admin'].includes(user.role)) throw new ApiException('FORBIDDEN');
}

function mask(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskConfig(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.token === 'string') parsed.token = '***';
    return parsed;
  } catch {
    return {};
  }
}

function toTask(row: {
  id: string;
  type: string;
  status: string;
  progress: number;
  invokeId: string | null;
  result: Prisma.JsonValue | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    invoke_id: row.invokeId,
    result: row.result,
    error_code: row.errorCode,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
