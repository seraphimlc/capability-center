import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { InvokeService } from './invoke.service';
import { ModelService, type LlmMessage, type LlmToolCall } from './model.service';
import { ApiException } from './errors';
import type { AuthUser } from './auth.guard';
import { JsonSchema, whitelabelText } from './domain';
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
  ) {}

  async begin(user: AuthUser, id: string) {
    const conversation = await this.owned(user, id);
    const locked = await this.redis.client.set(`lock:conv:${id}`, '1', 'EX', 180, 'NX');
    if (locked !== 'OK') throw new ApiException('CONFLICT', '会话正在生成，请稍后再试');
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
    this.runs.get(id)?.abort();
    await this.redis.client.set(`stop:${id}`, '1', 'EX', 30);
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
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: systemPrompt(agent.systemPrompt, agent.name, llmTools.map((tool) => tool.name)),
      },
      ...history.map(toLlm).filter((item): item is LlmMessage => Boolean(item)),
    ];
    if (input.attachments.length) {
      const last = messages[messages.length - 1];
      if (last?.role === 'user') last.content += `\n附件文件：${input.attachments.join(' ')}`;
    }
    let produced = '';
    let rounds = 0;
    let degraded = false;
    while (rounds < 8) {
      if (await this.stopped(conversation.id, input.signal)) {
        await this.saveAssistant(conversation.id, produced, 'stopped', null);
        input.send('done', { finish_reason: 'cancelled', version: await this.bump(conversation.id) });
        return;
      }
      const turn = await this.models.runTurn({
        messages,
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
      if (turn.degraded) {
        degraded = true;
        input.send('notice', { code: 'MODEL_DEGRADED', message: '已切换备用模型' });
      }
      if (turn.aborted || (await this.stopped(conversation.id, input.signal))) {
        await this.saveAssistant(conversation.id, produced || turn.text, 'stopped', null);
        input.send('done', { finish_reason: 'cancelled', version: await this.bump(conversation.id) });
        return;
      }
      if (!turn.toolCalls.length) {
        if ((produced || turn.text).trim()) {
          await this.saveAssistant(conversation.id, produced || turn.text, 'complete', null);
        }
        await this.maybeBillModel(input.user, agent.primaryModelId, userMessage.id, input.requestId);
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
        messages.push(assistantCall(turn.text, call));
        messages.push({ role: 'tool', tool_call_id: call.id, content: summary });
        produced = '';
        rounds += 1;
        continue;
      }
      const args = fillFiles(call.arguments, tool.schemaJson as JsonSchema, input.attachments);
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
      messages.push(assistantCall(turn.text, { ...call, arguments: args, raw: JSON.stringify(args) }));
      messages.push({ role: 'tool', tool_call_id: call.id, content: executed.event.summary });
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

  private async maybeBillModel(user: AuthUser, modelId: string | null, bizId: string, requestId: string) {
    const strategy = await flag(this.prisma, 'billing_strategy', 'A');
    if (strategy !== 'B' || !modelId) return;
    const model = await this.prisma.aiModel.findUnique({ where: { id: modelId } });
    if (!model || model.priceCredits <= 0) return;
    const { WalletService } = await import('./wallet.service');
    void WalletService;
    void user;
    void bizId;
    void requestId;
  }
}

function systemPrompt(base: string, name: string, tools: string[]): string {
  const skill = tools.length
    ? `你可以使用这些已启用技能：${tools.join('、')}。需要外部结果时调用技能，不要编造实时数据。`
    : '当前助手未绑定技能，仅支持对话。不要假装调用外部工具。';
  return `${base}\n你是「${name}」，服务于能力中心。${skill}\n使用简体中文。不要提及上游供应商名称。积分以人民币口径的整数积分计算。`;
}

function toLlm(row: { role: string; content: string; toolCallJson: Prisma.JsonValue | null }): LlmMessage | null {
  if (row.role === 'user') return { role: 'user', content: row.content };
  if (row.role === 'assistant') {
    const call = row.toolCallJson as { call_id?: string; tool_key?: string; args?: Record<string, unknown> } | null;
    if (call?.call_id && call.tool_key) {
      return {
        role: 'assistant',
        content: row.content,
        tool_calls: [{ id: call.call_id, name: call.tool_key, arguments: JSON.stringify(call.args || {}) }],
      };
    }
    return { role: 'assistant', content: row.content };
  }
  if (row.role === 'tool') {
    const call = row.toolCallJson as { call_id?: string } | null;
    return { role: 'tool', content: row.content, tool_call_id: call?.call_id };
  }
  return null;
}

function assistantCall(text: string, call: LlmToolCall): LlmMessage {
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
