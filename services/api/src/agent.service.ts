import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { InvokeService } from './invoke.service';
import { ModelService, type LlmMessage, type LlmToolCall, type LlmTurn } from './model.service';
import { WalletService } from './wallet.service';
import { ApiException } from './errors';
import type { AuthUser } from './auth.guard';
import { JsonSchema, modelHoldAmount, modelTurnCredits, shanghaiParts, whitelabelText } from './domain';
import { assembleSystemPrompt, buildModelContext, type TranscriptMessage } from './chat-context';
import { asJson, flag } from './support.service';

type Send = (event: string, data: unknown) => void;

@Injectable()
export class AgentService {
  private readonly runs = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly invoke: InvokeService,
    private readonly models: ModelService,
    private readonly wallet: WalletService,
  ) {}

  async begin(user: AuthUser, id: string) {
    const conversation = await this.owned(user, id);
    const acquired = await this.acquireConversation(id);
    if (!acquired) throw new ApiException('CONFLICT', '会话正在生成，请稍后再试');
    const controller = new AbortController();
    this.runs.set(id, controller);
    await this.redis.client.del(`stop:${id}`);
    return { conversation, controller };
  }

  async end(id: string): Promise<void> {
    this.runs.delete(id);
    await this.redis.client.del(`lock:conv:${id}`);
  }

  async stop(user: AuthUser, id: string) {
    await this.owned(user, id);
    // Flag first so a replacement turn waits out this one instead of inheriting the stop.
    await this.redis.client.set(`stop:${id}`, '1', 'EX', 30);
    this.runs.get(id)?.abort();
    return { stopping: true };
  }

  async run(input: {
    user: AuthUser;
    conversationId: string;
    content: string;
    attachments: string[];
    requestId: string;
    signal: AbortSignal;
    send: Send;
  }): Promise<void> {
    const conversation = await this.owned(input.user, input.conversationId);
    const content = input.content.trim();
    if (!content && input.attachments.length === 0) throw new ApiException('MESSAGE_EMPTY');
    if (isBlocked(content)) throw new ApiException('CONTENT_BLOCKED');
    const agent = await this.prisma.agent.findUnique({ where: { id: conversation.agentId } });
    if (!agent || agent.status !== 'published') throw new ApiException('AGENT_NOT_PUBLISHED');
    const userMessage = await this.prisma.message.create({
      data: {
        id: ulid(),
        conversationId: conversation.id,
        role: 'user',
        content: content || '（附件）',
        status: 'complete',
        toolCallJson: input.attachments.length ? asJson({ attachments: input.attachments }) : undefined,
      },
    });
    input.send('meta', { user_message_id: userMessage.id, assistant_message_id: null, version: conversation.version });
    const enabled = await this.enabledTools(conversation.id, agent.id);
    const llmTools = enabled.map((tool) => ({
      key: tool.key,
      name: tool.name,
      summary: tool.summary,
      schema: tool.schemaJson as JsonSchema,
    }));
    const history = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    const transcript: TranscriptMessage[] = [];
    for (const row of history) {
      const item = toTranscript(row);
      if (item) transcript.push(item);
    }
    const lastUser = transcript[transcript.length - 1];
    if (input.attachments.length && lastUser?.role === 'user') {
      lastUser.content += `\n附件文件：${input.attachments.join(' ')}`;
    }
    const today = shanghaiParts();
    const store = await this.conversationStore(input.user.id, conversation.storeId);
    const system = assembleSystemPrompt({
      base: agent.systemPrompt,
      name: agent.name,
      skills: llmTools.map((tool) => ({ name: tool.name, summary: tool.summary })),
      confirmMode: conversation.confirmMode,
      store,
      today: `${today.y}-${today.m}-${today.d}`,
    });
    const modelMessages = () => buildModelContext({ system, history: transcript }).messages;
    let produced = '';
    let rounds = 0;
    let degraded = false;
    while (rounds < 8) {
      if (await this.stopped(conversation.id, input.signal)) {
        await this.saveAssistant(conversation.id, produced, 'stopped', null);
        input.send('done', { finish_reason: 'cancelled', version: await this.bump(conversation.id) });
        return;
      }
      const bizId = `${userMessage.id}:${rounds}`;
      const windowed = modelMessages();
      const reservation = await this.reserveModelTurn(input.user, agent, bizId, windowed);
      let turn: LlmTurn;
      try {
        turn = await this.models.runTurn({
          messages: windowed,
          tools: llmTools,
          primaryModelId: agent.primaryModelId,
          backupModelId: agent.backupModelId,
          showThinking: conversation.showThinking,
          signal: input.signal,
          onDelta: (chunk) => {
            if (chunk.type === 'text') produced += chunk.text;
            input.send(chunk.type === 'thinking' ? 'thinking' : 'delta', { text: chunk.text });
          },
          userId: input.user.id,
          tenantId: input.user.tenantId,
        });
      } catch (error) {
        await this.releaseModelHold(reservation.holdKey);
        throw error;
      }
      if (turn.degraded) {
        degraded = true;
        input.send('notice', { code: 'MODEL_DEGRADED', message: '已切换备用模型' });
      }
      if (turn.aborted || (await this.stopped(conversation.id, input.signal))) {
        await this.releaseModelHold(reservation.holdKey);
        await this.saveAssistant(conversation.id, produced || turn.text, 'stopped', null);
        input.send('done', { finish_reason: 'cancelled', version: await this.bump(conversation.id) });
        return;
      }
      await this.maybeBillModel(input.user, turn.modelId, bizId, input.requestId, turn.usage, reservation.holdKey);
      if (!turn.toolCalls.length) {
        if ((produced || turn.text).trim()) {
          await this.saveAssistant(conversation.id, produced || turn.text, 'complete', null);
        }
        input.send('done', {
          finish_reason: 'stop',
          version: await this.bump(conversation.id),
          display_name: turn.displayName,
          degraded,
        });
        return;
      }
      const call = turn.toolCalls[0];
      const tool = enabled.find((item) => item.key === call.name);
      if (!tool) {
        const summary = '当前会话未启用该技能';
        input.send('tool_call', card(call, null));
        input.send('tool_result', { call_id: call.id, ok: false, code: 'TOOL_NOT_ALLOWED_IN_SESSION', summary });
        transcript.push(assistantCall(turn.text, call));
        transcript.push({ role: 'tool', tool_call_id: call.id, tool_name: call.name, content: summary });
        produced = '';
        rounds += 1;
        continue;
      }
      const args = fillFiles(call.arguments, tool.schemaJson as JsonSchema, input.attachments);
      const wantsStore = tool.storeBound || Boolean((tool.schemaJson as JsonSchema).properties?.store_id);
      if (conversation.storeId && wantsStore && (args.store_id === undefined || args.store_id === '')) {
        args.store_id = conversation.storeId;
      }
      if (conversation.confirmMode === 'manual') {
        await this.saveAssistant(conversation.id, produced || turn.text, 'awaiting_confirm', {
          call_id: call.id,
          tool_key: tool.key,
          tool_name: tool.name,
          args,
        });
        input.send('tool_confirm_required', { call_id: call.id, tool_key: tool.key, tool_name: tool.name, args });
        input.send('done', { finish_reason: 'awaiting_confirm', version: await this.bump(conversation.id) });
        return;
      }
      if (produced.trim()) {
        await this.saveAssistant(conversation.id, produced, 'complete', null);
        produced = '';
      }
      const executed = await this.execTool(input, conversation.id, tool, call.id, args);
      input.send('tool_call', { call_id: call.id, tool_key: tool.key, tool_name: tool.name, args });
      input.send('tool_result', executed.event);
      transcript.push(assistantCall(turn.text, { ...call, arguments: args, raw: JSON.stringify(args) }));
      transcript.push({ role: 'tool', tool_call_id: call.id, tool_name: tool.key, content: executed.event.summary });
      if (!executed.event.ok && executed.event.code === 'INSUFFICIENT_CREDITS') {
        await this.saveAssistant(conversation.id, `${produced}\n积分不足，技能未执行。`.trim(), 'complete', null);
        input.send('done', { finish_reason: 'error', version: await this.bump(conversation.id) });
        return;
      }
      rounds += 1;
      if (rounds >= 8) {
        input.send('notice', { code: 'MAX_TOOL_ROUNDS', message: '本轮工具调用次数已达上限' });
        await this.saveAssistant(conversation.id, produced, 'complete', null);
        input.send('done', { finish_reason: 'length', version: await this.bump(conversation.id) });
        return;
      }
    }
  }

  async confirm(user: AuthUser, conversationId: string, body: { call_id?: string; decision?: string }, requestId: string) {
    const conversation = await this.owned(user, conversationId);
    const pending = await this.prisma.message.findFirst({
      where: { conversationId, status: 'awaiting_confirm' },
      orderBy: { createdAt: 'desc' },
    });
    const call = pending?.toolCallJson as { call_id?: string; tool_key?: string; args?: Record<string, unknown>; tool_name?: string } | null;
    if (!pending || !call?.call_id || call.call_id !== body.call_id) throw new ApiException('CONFLICT', '没有待确认的技能调用');
    if (body.decision === 'reject') {
      await this.prisma.message.update({
        where: { id: pending.id },
        data: { status: 'complete', content: `${pending.content}\n已拒绝本次技能调用。`.trim() },
      });
      const note = await this.prisma.message.create({
        data: {
          id: ulid(),
          conversationId,
          role: 'assistant',
          content: '好的，已取消这次技能调用，不会扣减积分。',
          status: 'complete',
        },
      });
      return { messages: [toMessage(pending), toMessage(note)], version: await this.bump(conversationId) };
    }
    const tool = await this.prisma.tool.findFirst({ where: { tenantId: user.tenantId, key: call.tool_key, status: 'published' } });
    if (!tool) throw new ApiException('TOOL_NOT_PUBLISHED');
    const enabled = await this.prisma.conversationSkill.findUnique({
      where: { conversationId_toolId: { conversationId, toolId: tool.id } },
    });
    if (!enabled?.enabled) throw new ApiException('TOOL_NOT_ALLOWED_IN_SESSION');
    let summary = '技能已执行';
    let ok = true;
    let code: string | undefined;
    let invokeId: string | undefined;
    try {
      const result = await this.invoke.create({
        user,
        toolKey: tool.key,
        payload: call.args || {},
        source: 'agent',
        requestId,
        conversationId,
        idempotencyKey: `confirm-${call.call_id}`,
      });
      invokeId = result.payload.invoke.id;
      summary = JSON.stringify(result.payload.invoke.output ?? result.payload.invoke.status).slice(0, 800);
    } catch (error) {
      ok = false;
      code = error instanceof ApiException ? (error.getResponse() as { code: string }).code : 'UPSTREAM_ERROR';
      summary = whitelabelText(error instanceof ApiException ? (error.getResponse() as { message: string }).message : '能力执行失败，请稍后重试');
    }
    await this.prisma.message.update({ where: { id: pending.id }, data: { status: 'complete' } });
    const toolMessage = await this.prisma.message.create({
      data: {
        id: ulid(),
        conversationId,
        role: 'tool',
        content: summary,
        status: ok ? 'complete' : 'failed',
        toolCallJson: asJson({ call_id: call.call_id, tool_key: tool.key, invoke_id: invokeId, ok }),
      },
    });
    const follow = ok
      ? `技能「${tool.name}」已完成。${summary.slice(0, 280)}`
      : `技能「${tool.name}」没有完成：${summary}`;
    const assistant = await this.prisma.message.create({
      data: { id: ulid(), conversationId, role: 'assistant', content: follow, status: 'complete' },
    });
    return {
      ok,
      code,
      invoke_id: invokeId,
      messages: [toMessage(toolMessage), toMessage(assistant)],
      version: await this.bump(conversation.id),
    };
  }

  private async execTool(
    input: { user: AuthUser; requestId: string; send: Send },
    conversationId: string,
    tool: { key: string; name: string },
    callId: string,
    args: Record<string, unknown>,
  ) {
    try {
      const result = await this.invoke.create({
        user: input.user,
        toolKey: tool.key,
        payload: args,
        source: 'agent',
        requestId: input.requestId,
        conversationId,
        idempotencyKey: `agent-${callId}`,
      });
      const summary = JSON.stringify(result.payload.invoke.output ?? { status: result.payload.invoke.status }).slice(0, 800);
      await this.prisma.message.create({
        data: {
          id: ulid(),
          conversationId,
          role: 'tool',
          content: summary,
          status: 'complete',
          toolCallJson: asJson({ call_id: callId, tool_key: tool.key, invoke_id: result.payload.invoke.id, task_id: result.payload.invoke.task_id }),
        },
      });
      return {
        event: {
          call_id: callId,
          ok: true,
          summary,
          invoke_id: result.payload.invoke.id,
          task_id: result.payload.invoke.task_id,
          status: result.payload.invoke.status,
        },
      };
    } catch (error) {
      const code = error instanceof ApiException ? (error.getResponse() as { code: string }).code : 'UPSTREAM_ERROR';
      const summary = whitelabelText(
        error instanceof ApiException ? (error.getResponse() as { message: string }).message : '能力执行失败，请稍后重试',
      );
      await this.prisma.message.create({
        data: {
          id: ulid(),
          conversationId,
          role: 'tool',
          content: summary,
          status: 'failed',
          toolCallJson: asJson({ call_id: callId, tool_key: tool.key, ok: false, code }),
        },
      });
      return { event: { call_id: callId, ok: false, code, summary } };
    }
  }

  private async enabledTools(conversationId: string, agentId: string) {
    const skills = await this.prisma.conversationSkill.findMany({ where: { conversationId, enabled: true } });
    const bindings = await this.prisma.agentTool.findMany({ where: { agentId } });
    const allowed = new Set(bindings.map((row) => row.toolId));
    const ids = skills.map((row) => row.toolId).filter((id) => allowed.has(id));
    if (!ids.length) return [];
    return this.prisma.tool.findMany({ where: { id: { in: ids }, status: 'published' } });
  }

  private async saveAssistant(conversationId: string, content: string, status: string, toolCall: unknown) {
    await this.prisma.message.create({
      data: {
        id: ulid(),
        conversationId,
        role: 'assistant',
        content: content || (status === 'stopped' ? '（已停止）' : ''),
        status,
        toolCallJson: toolCall ? asJson(toolCall) : undefined,
      },
    });
  }

  private async bump(id: string, base?: number): Promise<number> {
    if (base === undefined) {
      const row = await this.prisma.conversation.update({ where: { id }, data: { version: { increment: 1 } } });
      return row.version;
    }
    const updated = await this.prisma.conversation.updateMany({
      where: { id, version: base },
      data: { version: { increment: 1 } },
    });
    if (!updated.count) throw new ApiException('CONFLICT_VERSION');
    const row = await this.prisma.conversation.findUnique({ where: { id } });
    return row?.version ?? base + 1;
  }

  async owned(user: AuthUser, id: string) {
    const row = await this.prisma.conversation.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!row) throw new ApiException('CONVERSATION_NOT_FOUND');
    return row;
  }

  async bumpPublic(id: string, base?: number) {
    return this.bump(id, base);
  }

  private async stopped(id: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return true;
    return (await this.redis.client.get(`stop:${id}`)) === '1';
  }

  /**
   * Bill one completed model call.
   *
   * Default (flag `billing_strategy` missing or `A`): when `priceCredits > 0`,
   * capture that many CNY integer credits once per completed call. Strategy `B`
   * charges `priceCredits` per 1,000 tokens (rounded up) from `LlmTurn.usage`,
   * and falls back to one unit when usage is missing. A zero price is free.
   * The pre-call hold is released on abort or error. Ledger `bizType` is
   * `model`; tool invokes stay `invoke`.
   */
  private async maybeBillModel(
    _user: AuthUser,
    modelId: string | null,
    bizId: string,
    requestId: string,
    usage: LlmTurn['usage'],
    holdKey: string,
  ) {
    try {
      const strategy = await flag(this.prisma, 'billing_strategy', 'A');
      if (!modelId) {
        await this.releaseModelHold(holdKey);
        return;
      }
      const model = await this.prisma.aiModel.findUnique({ where: { id: modelId } });
      const amount = modelTurnCredits(strategy, model?.priceCredits ?? 0, usage);
      if (!holdKey || amount <= 0) {
        await this.releaseModelHold(holdKey);
        return;
      }
      const tokens = usage?.total_tokens || (usage ? usage.prompt_tokens + usage.completion_tokens : 0);
      await this.wallet.captureKeyed({
        holdKey,
        amount,
        bizType: 'model',
        bizId,
        requestId,
        note: tokens > 0 ? `对话模型扣减 ${tokens} tokens` : '对话模型扣减',
      });
    } catch (error) {
      await this.releaseModelHold(holdKey);
      throw error;
    }
  }

  private async reserveModelTurn(
    user: AuthUser,
    agent: { primaryModelId: string | null; backupModelId: string | null },
    bizId: string,
    messages: LlmMessage[],
  ): Promise<{ holdKey: string }> {
    const strategy = await flag(this.prisma, 'billing_strategy', 'A');
    const primary = agent.primaryModelId
      ? await this.prisma.aiModel.findFirst({ where: { id: agent.primaryModelId, status: 'active' } })
      : await this.prisma.aiModel.findFirst({
          where: { tenantId: user.tenantId, capability: 'chat', status: 'active' },
        });
    const backup = agent.backupModelId
      ? await this.prisma.aiModel.findFirst({ where: { id: agent.backupModelId, status: 'active' } })
      : null;
    const promptChars = messages.reduce((sum, message) => sum + (message.content?.length || 0), 0);
    const estimate = Math.max(
      modelHoldAmount(strategy, primary?.priceCredits ?? 0, primary?.maxTokens, promptChars),
      modelHoldAmount(strategy, backup?.priceCredits ?? 0, backup?.maxTokens, promptChars),
    );
    if (estimate <= 0) return { holdKey: '' };
    const holdKey = `model:${bizId}`;
    await this.wallet.holdKeyed(user.id, holdKey, estimate);
    return { holdKey };
  }

  private async releaseModelHold(holdKey: string): Promise<void> {
    await this.wallet.releaseKeyed(holdKey);
  }

  private async conversationStore(userId: string, storeId: string | null) {
    if (!storeId) return null;
    const shop = await this.prisma.shopAccount.findFirst({
      where: { id: storeId, userId },
    });
    if (!shop) return null;
    return {
      name: shop.name,
      platform: shop.platform,
      marketplace: shop.marketplace,
      connected: shop.status === 'connected',
    };
  }

  private async acquireConversation(id: string): Promise<boolean> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const locked = await this.redis.client.set(`lock:conv:${id}`, '1', 'EX', 180, 'NX');
      if (locked === 'OK') return true;
      const stopping = (await this.redis.client.get(`stop:${id}`)) === '1';
      if (!stopping) return false;
      await delay(100);
    }
    return false;
  }
}

function toTranscript(row: {
  role: string;
  content: string;
  status: string;
  toolCallJson: Prisma.JsonValue | null;
}): TranscriptMessage | null {
  if (row.role === 'user') return { role: 'user', content: row.content };
  if (row.role === 'assistant') {
    const call = row.toolCallJson as { call_id?: string; tool_key?: string; args?: Record<string, unknown> } | null;
    if (call?.call_id && call.tool_key) {
      return {
        role: 'assistant',
        content: row.content,
        tool_calls: [{
          id: call.call_id,
          name: call.tool_key,
          arguments: JSON.stringify(call.args || {}),
          pending: row.status === 'awaiting_confirm',
        }],
      };
    }
    return { role: 'assistant', content: row.content };
  }
  if (row.role === 'tool') {
    const call = row.toolCallJson as { call_id?: string; tool_key?: string } | null;
    return { role: 'tool', content: row.content, tool_call_id: call?.call_id, tool_name: call?.tool_key };
  }
  return null;
}

function assistantCall(text: string, call: LlmToolCall): TranscriptMessage {
  return {
    role: 'assistant',
    content: text,
    tool_calls: [{ id: call.id, name: call.name, arguments: call.raw || JSON.stringify(call.arguments) }],
  };
}

function card(call: LlmToolCall, name: string | null) {
  return { call_id: call.id, tool_key: call.name, tool_name: name, args: call.arguments };
}

function fillFiles(args: Record<string, unknown>, schema: JsonSchema, attachments: string[]): Record<string, unknown> {
  const next = { ...args };
  const props = schema.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    if ((prop.format === 'file' || prop['x-file']) && !next[key] && attachments[0]) next[key] = attachments[0];
  }
  return next;
}

function isBlocked(content: string): boolean {
  return content.includes('[[blocked]]');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toMessage(row: {
  id: string;
  role: string;
  content: string;
  status: string;
  toolCallJson: Prisma.JsonValue | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    tool_call: row.toolCallJson,
    created_at: row.createdAt.toISOString(),
  };
}
