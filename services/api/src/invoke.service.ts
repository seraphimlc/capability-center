import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from './prisma.service';
import { WalletService } from './wallet.service';
import { TaskService } from './task.service';
import { AuditService, NotifyService, RateLimitService, asJson, flag } from './support.service';
import { ApiException } from './errors';
import { publishedTool, toInvoke } from './catalog.controller';
import type { AuthUser } from './auth.guard';
import {
  JsonSchema,
  hashBody,
  isBlockedText,
  validateInput,
  whitelabelText,
  whitelabelValue,
} from './domain';
import { linkfoxCall } from './linkfox.client';
import { McpService } from './mcp.service';
import { StoreService } from './store.service';

@Injectable()
export class InvokeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly tasks: TaskService,
    private readonly rate: RateLimitService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly stores: StoreService,
    private readonly mcp: McpService,
  ) {}

  async create(input: {
    user: AuthUser;
    toolKey: string;
    payload: Record<string, unknown>;
    source: 'catalog' | 'agent' | 'api' | 'mcp';
    requestId: string;
    idempotencyKey?: string;
    conversationId?: string;
    messageId?: string;
  }): Promise<{ httpStatus: number; payload: { invoke: ReturnType<typeof toInvoke> } }> {
    if ((await flag(this.prisma, 'maintenance_mode')) === 'true') throw new ApiException('MAINTENANCE');
    await this.rate.hit(input.source === 'mcp' || input.source === 'api' ? 'open_invoke' : 'user_invoke', input.user.id);
    const tool = await publishedTool(this.prisma, input.user.tenantId, input.toolKey);
    const raw = { ...(input.payload || {}) };
    const storeId = typeof raw.store_id === 'string' ? raw.store_id : undefined;
    if (tool.storeBound && !storeId) {
      throw new ApiException('VALIDATION_ERROR', '该能力需要选择已连接店铺');
    }
    const store = await this.stores.resolveForInvoke(input.user, storeId);
    const body: Record<string, unknown> = { ...raw };
    if (store) {
      body.__store = {
        store_id: store.store_id,
        platform: store.platform,
        name: store.name,
        marketplace: store.marketplace,
        external_store_id: store.external_store_id,
      };
      body.__store_credentials = store.credentials;
      // Convenience aliases for common shop tools when caller omitted them
      for (const [k, v] of Object.entries(store.credentials)) {
        if (body[k] === undefined || body[k] === '') body[k] = v;
      }
      if (!body.store_id) body.store_id = store.store_id;
      if (!body.platform) body.platform = store.platform;
    }
    if (isBlockedText(JSON.stringify(body))) throw new ApiException('CONTENT_BLOCKED');
    const schema = tool.schemaJson as JsonSchema;
    // Validate user-facing fields only (ignore injected store secrets)
    const forSchema = { ...body };
    delete (forSchema as any).__store;
    delete (forSchema as any).__store_credentials;
    const invalid = validateInput(schema, forSchema);
    if (invalid) throw new ApiException('SCHEMA_INVALID', `参数不符合要求：${invalid}`, { field: invalid });
    await this.assertFiles(input.user.id, schema, body);
    const idemKey = input.idempotencyKey?.trim();
    if (idemKey) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { userId_scope_key: { userId: input.user.id, scope: 'invoke', key: idemKey } },
      });
      if (existing) {
        if (existing.bodyHash !== hashBody({ tool_key: input.toolKey, input: body })) {
          throw new ApiException('IDEMPOTENCY_CONFLICT');
        }
        return {
          httpStatus: existing.status,
          payload: existing.response as { invoke: ReturnType<typeof toInvoke> },
        };
      }
    }
    const cost = tool.pricingCredits;
    if (cost > 0) {
      try {
        await this.wallet.preview(input.user.id, cost);
      } catch (error) {
        if (error instanceof ApiException) {
          await this.prisma.invokeRecord.create({
            data: {
              id: ulid(),
              tenantId: input.user.tenantId,
              userId: input.user.id,
              toolId: tool.id,
              toolKey: tool.key,
              source: input.source,
              status: 'failed',
              inputJson: asJson(body),
              errorCode: 'INSUFFICIENT_CREDITS',
              credits: 0,
              requestId: input.requestId,
              conversationId: input.conversationId,
              finishedAt: new Date(),
            },
          });
        }
        throw error;
      }
    }
    const invokeId = ulid();
    await this.prisma.invokeRecord.create({
      data: {
        id: invokeId,
        tenantId: input.user.tenantId,
        userId: input.user.id,
        toolId: tool.id,
        toolKey: tool.key,
        source: input.source,
        status: 'running',
        inputJson: asJson(body),
        credits: 0,
        requestId: input.requestId,
        conversationId: input.conversationId,
        messageId: input.messageId,
      },
    });
    try {
      if (cost > 0) await this.wallet.hold(input.user.id, invokeId, cost);
      if (tool.isAsync || tool.capability === 'video_gen') {
        const taskId = await this.tasks.createAndEnqueue({
          tenantId: input.user.tenantId,
          userId: input.user.id,
          type: tool.capability === 'video_gen' ? 'video_gen' : 'async',
          invokeId,
          payload: { tool_key: tool.key, input: body },
        });
        const updated = await this.prisma.invokeRecord.update({
          where: { id: invokeId },
          data: { taskId, status: 'running' },
        });
        const payload = { invoke: toInvoke(updated) };
        await this.remember(input.user.id, idemKey, body, input.toolKey, 202, payload);
        return { httpStatus: 202, payload };
      }
      const output = whitelabelValue(await this.execute(tool.connectorId, tool, body));
      const captured = cost > 0 ? await this.wallet.captureByInvoke(invokeId, input.requestId) : { captured: true, amount: 0 };
      if (!captured.captured) throw new ApiException('INVOKE_CANCELLED');
      const updated = await this.prisma.invokeRecord.update({
        where: { id: invokeId },
        data: {
          status: 'success',
          outputJson: asJson(output),
          credits: captured.amount,
          finishedAt: new Date(),
        },
      });
      await this.prisma.recentTool.upsert({
        where: { userId_toolId: { userId: input.user.id, toolId: tool.id } },
        update: { usedAt: new Date() },
        create: { userId: input.user.id, toolId: tool.id, usedAt: new Date() },
      });
      await this.prisma.outboxEvent.create({
        data: { id: ulid(), type: 'InvokeSucceeded', payload: asJson({ invoke_id: invokeId }), status: 'sent' },
      });
      await this.audit.write({
        tenantId: input.user.tenantId,
        actorId: input.user.id,
        action: 'invoke.success',
        targetType: 'invoke',
        targetId: invokeId,
        detail: { tool_key: tool.key, credits: captured.amount, source: input.source },
        requestId: input.requestId,
      });
      const payload = { invoke: toInvoke(updated) };
      await this.remember(input.user.id, idemKey, body, input.toolKey, 200, payload);
      return { httpStatus: 200, payload };
    } catch (error) {
      await this.wallet.releaseByInvoke(invokeId);
      const code = error instanceof ApiException ? (error.getResponse() as { code: string }).code : 'UPSTREAM_ERROR';
      await this.prisma.invokeRecord.update({
        where: { id: invokeId },
        data: { status: code === 'INVOKE_CANCELLED' ? 'cancelled' : 'failed', errorCode: code, finishedAt: new Date() },
      });
      throw error;
    }
  }

  async cancel(user: AuthUser, id: string) {
    const row = await this.prisma.invokeRecord.findFirst({ where: { id, userId: user.id } });
    if (!row) throw new ApiException('NOT_FOUND');
    if (row.status === 'success') return { late: true, invoke: toInvoke(row) };
    if (row.status !== 'running') return { late: false, invoke: toInvoke(row) };
    await this.prisma.invokeRecord.update({
      where: { id },
      data: { status: 'cancelled', errorCode: 'INVOKE_CANCELLED', finishedAt: new Date() },
    });
    await this.wallet.releaseByInvoke(id);
    if (row.taskId) {
      await this.prisma.asyncTask.updateMany({
        where: { id: row.taskId, status: { in: ['pending', 'queued', 'running'] } },
        data: { status: 'cancelled', errorCode: 'INVOKE_CANCELLED' },
      });
    }
    const fresh = await this.prisma.invokeRecord.findUnique({ where: { id } });
    return { late: false, invoke: toInvoke(fresh!) };
  }

  private async remember(
    userId: string,
    key: string | undefined,
    body: Record<string, unknown>,
    toolKey: string,
    status: number,
    payload: unknown,
  ) {
    if (!key) return;
    await this.prisma.idempotencyRecord.create({
      data: {
        id: ulid(),
        userId,
        scope: 'invoke',
        key,
        bodyHash: hashBody({ tool_key: toolKey, input: body }),
        response: asJson(payload),
        status,
      },
    }).catch(() => undefined);
  }

  private async assertFiles(userId: string, schema: JsonSchema, input: Record<string, unknown>) {
    const props = schema.properties ?? {};
    for (const [key, prop] of Object.entries(props)) {
      if (prop.format !== 'file' && !prop['x-file']) continue;
      const fileId = input[key];
      if (!fileId) continue;
      const file = await this.prisma.fileObject.findFirst({ where: { id: String(fileId), userId } });
      if (!file) throw new ApiException('FILE_NOT_FOUND');
      if (file.status !== 'ready') throw new ApiException('FILE_NOT_READY');
    }
  }

  private async execute(
    connectorId: string,
    tool: { key: string; name: string; upstreamOp: string; capability: string; schemaJson?: unknown },
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const connector = await this.prisma.connector.findUnique({ where: { id: connectorId } });
    if (!connector || connector.status !== 'active') throw new ApiException('CONNECTOR_UNAVAILABLE');
    if (input.simulate === 'fail') throw new ApiException('UPSTREAM_ERROR');
    if (input.simulate === 'brand') {
      const raw = 'LinkFox gateway rejected request from 紫讯';
      console.error('redacted upstream', whitelabelText(raw));
      throw new ApiException('UPSTREAM_ERROR');
    }
    if (connector.type === 'http') {
      const cfg = JSON.parse(connector.configEnc || '{}') as { baseUrl?: string; token?: string };
      if (!cfg.baseUrl) throw new ApiException('CONNECTOR_UNAVAILABLE');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(cfg.baseUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
          },
          body: JSON.stringify({ operation: tool.upstreamOp, input }),
          signal: controller.signal,
        });
        if (!response.ok) throw new ApiException('UPSTREAM_ERROR');
        return whitelabelValue(await response.json());
      } catch (error) {
        if (error instanceof ApiException) throw error;
        throw new ApiException('CONNECTOR_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
      }
    }
    if (connector.type === 'mcp') {
      // Only forward declared parameters; never leak internal store fields upstream.
      const props = (tool.schemaJson as JsonSchema)?.properties ?? {};
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (key.startsWith('__') || key === 'simulate' || key === 'store_id' || key === 'platform') continue;
        if (!(key in props)) continue;
        if (value === '' || value === null || value === undefined) continue;
        payload[key] = value;
      }
      return this.mcp.call(connector.id, tool.upstreamOp, payload);
    }
    if (connector.type === 'linkfox') {
      const op = (tool.upstreamOp || '').trim();
      const fill = String((tool.schemaJson as any)?.['x-fill-status'] || '');
      if (!op || op === 'run' || op === 'mcp/any-tool') {
        if (fill === 'stub' || fill === 'error' || fill === 'schema_only' || !op || op === 'run') {
          return {
            ok: false,
            degraded: true,
            message: '该能力上游参数仍在精修，当前返回说明性结果，未扣真实上游额度。',
            tool_key: tool.key,
            tool_name: tool.name,
            echo_input: Object.fromEntries(
              Object.entries(input).filter(([k]) => !k.startsWith('__') && k !== 'simulate'),
            ),
            next_steps: ['补充必填参数后再试', '或换用同分类下已标注可调用的能力'],
          };
        }
        throw new ApiException('CONNECTOR_UNAVAILABLE', '该能力尚未绑定上游路径');
      }
      if (fill === 'stub' || fill === 'error') {
        return {
          ok: false,
          degraded: true,
          message: '该能力上游仍在对接中，已降级为说明性结果。',
          tool_key: tool.key,
          tool_name: tool.name,
          upstream_bound: true,
          echo_input: Object.fromEntries(
            Object.entries(input).filter(([k]) => !k.startsWith('__') && k !== 'simulate'),
          ),
        };
      }
      const payload = { ...input };
      delete (payload as any).simulate;
      return linkfoxCall(op, payload as Record<string, unknown>);
    }
    return runBuiltin(tool.key, tool.capability, input);
  }
}

function runBuiltin(key: string, capability: string, input: Record<string, unknown>): unknown {
  if (key === 'product-picker') {
    const keyword = String(input.keyword || '样本');
    const market = String(input.market || 'US');
    const limit = Math.min(8, Number(input.limit || 3));
    return {
      keyword,
      market,
      items: Array.from({ length: limit }, (_, index) => ({
        title: `${keyword} 趋势样本 ${index + 1}`,
        market,
        score: 92 - index * 7,
        note: '内置演示数据；接上游后可改用「亚马逊前台搜索」拿实时结果',
      })),
    };
  }
  if (key === 'text-insight') {
    const text = String(input.text || '');
    const len = text.length;
    return {
      summary: `关于「${text.slice(0, 80)}」：目标较明确，建议补上人群、价格带和交付形式。`,
      points: ['受众是谁', '核心卖点', '可能的风险'],
      metrics: { chars: len, sentences: Math.max(1, text.split(/[。.!？?]/).filter(Boolean).length) },
      next_actions: ['用选品简报或亚马逊搜索验证供给', '用利润测算粗算毛利', '用合规检查扫一遍文案'],
    };
  }
  if (key === 'image-caption') {
    return {
      caption: '已接收图片。演示识图：画面主体清楚，适合作为商品主图描述的底稿。',
      file_id: input.file_id || null,
      suggestions: ['补白底主图', '补使用场景图', '补尺寸对比图'],
    };
  }
  if (key === 'competitor-insight') {
    const lines = String(input.titles || '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bag = new Map<string, number>();
    for (const line of lines) {
      for (const tok of line.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff+]+/).filter((t) => t.length > 2)) {
        bag.set(tok, (bag.get(tok) || 0) + 1);
      }
    }
    const top = [...bag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([term, count]) => ({ term, count }));
    return {
      market: input.market || 'US',
      title_count: lines.length,
      top_terms: top,
      selling_point_clusters: top.slice(0, 5).map((row) => row.term),
      gaps: ['差异化材质/尺寸未出现', '场景词覆盖不足', '可补认证/配件组合'],
      note: '基于粘贴标题的本地词频；实时竞品请用亚马逊前台搜索',
    };
  }
  if (key === 'season-calendar') {
    const category = String(input.category || '通用');
    const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
    const plan = months.map((m, i) => ({
      month: m,
      action: i % 4 === 0 ? '备货' : i % 4 === 1 ? '上架优化' : i % 4 === 2 ? '投放加码' : '清库存观察',
      note: `${category} · 建议动作`,
    }));
    return { category, market: input.market || 'US', calendar: plan };
  }
  if (key === 'profit-estimator') {
    const price = Number(input.price || 0);
    const cost = Number(input.cost || 0);
    const feeRate = Number(input.fee_rate ?? 15) / 100;
    const shipping = Number(input.shipping || 0);
    const ads = Number(input.ads ?? 10) / 100;
    const fee = price * feeRate;
    const adCost = price * ads;
    const gross = price - cost - fee - shipping - adCost;
    const margin = price > 0 ? gross / price : 0;
    const roi = cost > 0 ? gross / cost : 0;
    return {
      currency: 'CNY',
      price,
      cost,
      fee: Number(fee.toFixed(2)),
      shipping,
      ads: Number(adCost.toFixed(2)),
      gross_profit: Number(gross.toFixed(2)),
      margin_rate: Number((margin * 100).toFixed(2)),
      roi: Number((roi * 100).toFixed(2)),
      verdict: gross >= 0 ? (margin >= 0.2 ? '可做' : '勉强可做') : '不建议',
    };
  }
  if (key === 'store-traffic') {
    const days = Number(input.days || 7);
    const base = 800 + String(input.store_name || '').length * 17;
    return {
      store_name: input.store_name,
      days,
      market: input.market || 'US',
      visitors: base * days,
      orders: Math.round(base * days * 0.032),
      conversion_rate: 3.2,
      sources: [
        { name: '自然搜索', share: 42 },
        { name: '广告', share: 33 },
        { name: '关联推荐', share: 15 },
        { name: '其他', share: 10 },
      ],
      note: '演示结构数据，便于验收报表展示',
    };
  }
  if (key === 'listing-health') {
    const title = String(input.title || '');
    const bullets = String(input.bullets || '').split(/\n+/).filter(Boolean);
    const scores = {
      title: Math.min(100, 40 + Math.min(40, title.length / 2) + (/\d/.test(title) ? 10 : 0)),
      bullets: Math.min(100, bullets.length * 18),
      main_image: input.has_main_image === false ? 20 : 90,
      a_plus: input.has_a_plus ? 90 : 35,
    };
    const overall = Math.round((scores.title + scores.bullets + scores.main_image + scores.a_plus) / 4);
    return {
      overall,
      scores,
      gaps: [
        bullets.length < 5 ? '五点不足 5 条' : null,
        input.has_a_plus ? null : '缺少 A+',
        title.length < 80 ? '标题偏短，可补核心属性词' : null,
      ].filter(Boolean),
      priority_fixes: ['补全五点', '加强主图信息密度', '补 A+ 模块'],
    };
  }
  if (key === 'listing-copy') {
    const product = String(input.product || '商品');
    const points = String(input.selling_points || '')
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const lang = String(input.language || 'zh');
    if (lang === 'en') {
      return {
        title: `${product} — ${points.slice(0, 3).join(' / ')}`.slice(0, 180),
        bullets: points.slice(0, 5).map((p) => `${p}: built for ${input.audience || 'everyday use'}`),
        short_description: `Meet ${product}. Highlights: ${points.join(', ')}.`,
      };
    }
    return {
      title: `${product}｜${points.slice(0, 3).join('·')}`.slice(0, 60),
      bullets: points.slice(0, 5).map((p, i) => `${i + 1}. ${p}，适合${input.audience || '目标用户'}`),
      short_description: `${product}主打${points.join('、')}，可直接作为详情页骨架。`,
    };
  }
  if (key === 'title-optimizer') {
    const title = String(input.title || '');
    const keyword = String(input.keyword || '').trim();
    const cleaned = title
      .replace(/\b(new|hot|best seller|sale)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const base = keyword && !cleaned.toLowerCase().includes(keyword.toLowerCase()) ? `${keyword} ${cleaned}` : cleaned;
    return {
      market: input.market || 'US',
      variants: [
        base.slice(0, 180),
        `${base}`.split(' ').slice(0, 12).join(' '),
        keyword ? `${keyword} | ${cleaned.split(' ').slice(0, 10).join(' ')}` : cleaned.slice(0, 140),
      ],
      removed: ['堆砌促销词', '重复属性'],
    };
  }
  if (key === 'ad-copy') {
    const product = String(input.product || '商品');
    const offer = String(input.offer || '');
    return {
      goal: input.goal || '转化',
      headlines: [`${product} 热卖中`, `${product} ${offer}`.trim(), `今天就入手 ${product}`],
      descriptions: [`关注核心卖点，立即查看详情。${offer}`, `适合想快速决策的买家，支持便捷下单。`],
      match_types: ['广泛', '词组', '精确'],
    };
  }
  if (key === 'faq-reply') {
    const q = String(input.question || '');
    const tone = String(input.tone || '礼貌');
    const policy = String(input.policy || '');
    const lead = tone === '简洁' ? '收到。' : tone === '补偿' ? '非常抱歉给您带来不便。' : '感谢您的反馈。';
    return {
      reply: `${lead}${q.includes('少') || q.includes('丢') ? '我们可为您安排补发或退款方案。' : '我们已记录问题，将尽快协助处理。'}${policy ? ` 店铺政策：${policy}` : ''}`,
      alternatives: ['可以的，请提供订单号。', '已为您备注优先处理。'],
    };
  }
  if (key === 'translate-listing') {
    const text = String(input.text || '');
    const target = String(input.target || 'en');
    const keep = String(input.keep_terms || '')
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (target === 'zh') {
      return { target, title: text.slice(0, 40), body: text, keep_terms: keep, note: '演示翻译：请人工核对专有名词' };
    }
    const mapped = text
      .replace(/便携/g, 'portable')
      .replace(/露营灯/g, 'camping lantern')
      .replace(/防水/g, 'waterproof')
      .replace(/快充/g, 'fast charging')
      .replace(/三档亮度/g, '3 brightness modes');
    return {
      target,
      title: mapped.slice(0, 180),
      bullets: mapped.split(/[，,。]/).map((s) => s.trim()).filter(Boolean).slice(0, 5),
      keep_terms: keep,
      note: '演示翻译骨架；正式场景可接上游多语能力',
    };
  }
  if (key === 'main-image-brief') {
    const product = String(input.product || '商品');
    const points = String(input.selling_points || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const count = Number(input.count || 5);
    const style = String(input.style || '白底');
    return {
      product,
      style,
      shots: Array.from({ length: count }, (_, i) => ({
        index: i + 1,
        frame: i === 0 ? '主图特写' : i === 1 ? '卖点标注' : i === 2 ? '场景使用' : i === 3 ? '尺寸对比' : '细节特写',
        prompt: `${style} product photo of ${product}, highlight ${points[i % Math.max(1, points.length)] || 'quality'}, ecommerce`,
      })),
    };
  }
  if (key === 'keyword-rank') {
    const keyword = String(input.keyword || '');
    let h = 0;
    for (const ch of keyword) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const organic = (h % 40) + 1;
    return {
      keyword,
      market: input.market || 'US',
      asin: input.asin || null,
      organic_rank_range: [organic, organic + 5],
      sponsored_rank_range: [Math.max(1, organic - 3), organic + 2],
      note: '稳定演示区间，便于对比优化前后',
    };
  }
  if (key === 'compliance-check') {
    const text = String(input.text || '');
    const rules = [
      { term: '100%', level: 'high', tip: '避免绝对化承诺' },
      { term: 'cure', level: 'high', tip: '医疗功效宣称风险' },
      { term: 'guaranteed', level: 'medium', tip: '效果保证类措辞' },
      { term: 'best seller', level: 'low', tip: '排名类表述需可证实' },
      { term: 'free shipping forever', level: 'medium', tip: '永久承诺难兑现' },
      { term: '国家级', level: 'high', tip: '中文绝对化用语' },
      { term: '最好', level: 'medium', tip: '最高级用语' },
    ];
    const hits = rules.filter((r) => text.toLowerCase().includes(r.term.toLowerCase()));
    return {
      market: input.market || 'US',
      passed: hits.length === 0,
      hits,
      suggestion: hits.length ? '改写命中语句并保留可证实卖点' : '未命中内置规则，仍建议人工复核',
    };
  }
  if (key === 'review-digest') {
    const reviews = String(input.reviews || '');
    const lines = reviews.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const neg = lines.filter((l) => /松|差|坏|灰|慢|贵|假/.test(l));
    const pos = lines.filter((l) => /好|亮|续航|不错|喜欢|快/.test(l));
    return {
      product: input.product || '',
      review_count: lines.length,
      positives: pos.slice(0, 8),
      negatives: neg.slice(0, 8),
      product_fixes: neg.length ? ['加强结构件质检', '改进包装防尘', '说明书补充常见问题'] : ['保持当前品质并收集更多评价'],
      support_actions: ['差评 24h 内响应', '引导补充图文好评'],
    };
  }
  return { echo: input, capability, note: '内置演示连接器已执行' };
}

void NotifyService;
