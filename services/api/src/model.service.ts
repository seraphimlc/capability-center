import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from './prisma.service';
import { ApiException } from './errors';
import { JsonSchema, whitelabelText } from './domain';
import { asJson } from './support.service';

export type LlmRuntime = {
  provider: 'xy' | 'chathub' | 'mock';
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type LlmTool = {
  key: string;
  name: string;
  summary: string;
  schema: JsonSchema;
};

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string; arguments: string }[];
};

export type LlmToolCall = { id: string; name: string; arguments: Record<string, unknown>; raw: string };

export type LlmTurn = {
  text: string;
  thinking: string;
  toolCalls: LlmToolCall[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  provider: string;
  degraded: boolean;
  aborted: boolean;
  displayName: string;
  modelId: string | null;
};

export function readLlmRuntime(): LlmRuntime {
  const mode = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  const xyKey = process.env.LLM_API_KEY || process.env.XY_API_KEY || '';
  const xyBase = (process.env.LLM_BASE_URL || process.env.XY_BASE_URL || 'https://api.xytoken.xyb2b.com/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'deepseek-v4.1-flash';
  const chathubKey = process.env.CHATHUB_API_KEY || '';
  const chathubBase = (process.env.CHATHUB_BASE_URL || '').replace(/\/$/, '');
  const chathubModel = process.env.CHATHUB_MODEL || model;
  if (mode === 'mock') return { provider: 'mock', baseUrl: '', apiKey: '', model };
  if (mode === 'chathub') {
    if (!chathubKey || !chathubBase) return { provider: 'mock', baseUrl: '', apiKey: '', model: chathubModel };
    return { provider: 'chathub', baseUrl: chathubBase, apiKey: chathubKey, model: chathubModel };
  }
  if (mode === 'xy') {
    if (!xyKey) return { provider: 'mock', baseUrl: xyBase, apiKey: '', model };
    return { provider: 'xy', baseUrl: xyBase, apiKey: xyKey, model };
  }
  if (xyKey) return { provider: 'xy', baseUrl: xyBase, apiKey: xyKey, model };
  if (chathubKey && chathubBase) return { provider: 'chathub', baseUrl: chathubBase, apiKey: chathubKey, model: chathubModel };
  return { provider: 'mock', baseUrl: xyBase, apiKey: '', model };
}

@Injectable()
export class ModelService {
  constructor(private readonly prisma: PrismaService) {}

  runtime(): LlmRuntime {
    return readLlmRuntime();
  }

  async runTurn(input: {
    messages: LlmMessage[];
    tools: LlmTool[];
    primaryModelId?: string | null;
    backupModelId?: string | null;
    showThinking: boolean;
    signal: AbortSignal;
    onDelta: (chunk: { type: 'text' | 'thinking'; text: string }) => void;
    userId: string;
    tenantId: string;
  }): Promise<LlmTurn> {
    const runtime = readLlmRuntime();
    const primary = input.primaryModelId
      ? await this.prisma.aiModel.findFirst({ where: { id: input.primaryModelId, status: 'active' } })
      : await this.prisma.aiModel.findFirst({ where: { capability: 'chat', status: 'active' } });
    const backup = input.backupModelId
      ? await this.prisma.aiModel.findFirst({ where: { id: input.backupModelId, status: 'active' } })
      : null;
    if (runtime.provider === 'mock') {
      const turn = await this.mockTurn(
        input.messages,
        input.tools,
        input.showThinking,
        input.signal,
        input.onDelta,
        primary?.displayName || '标准对话',
      );
      return { ...turn, modelId: primary?.id ?? null };
    }
    try {
      return await this.remoteTurn(runtime, primary, input, false);
    } catch (error) {
      if (input.signal.aborted) {
        return emptyTurn(runtime.provider, primary?.displayName || '标准对话', true, primary?.id ?? null);
      }
      if (backup && backup.id !== primary?.id) {
        try {
          const turn = await this.remoteTurn(runtime, backup, input, true);
          return turn;
        } catch (backupError) {
          if (input.signal.aborted) return emptyTurn(runtime.provider, backup.displayName, true, backup.id);
          console.error('model backup failed', whitelabelText(backupError instanceof Error ? backupError.message : 'error'));
        }
      }
      console.error('model failed', whitelabelText(error instanceof Error ? error.message : 'error'));
      throw new ApiException('MODEL_UNAVAILABLE');
    }
  }

  async testPrompt(modelId: string, prompt: string, userId: string, tenantId: string) {
    const started = Date.now();
    const turn = await this.runTurn({
      messages: [
        { role: 'system', content: '你是能力中心的模型连通性探针。用简体中文，不超过 30 个字。' },
        { role: 'user', content: prompt || '回复：就绪' },
      ],
      tools: [],
      primaryModelId: modelId,
      showThinking: false,
      signal: AbortSignal.timeout(30000),
      onDelta: () => undefined,
      userId,
      tenantId,
    });
    return {
      text: turn.text,
      provider: turn.provider,
      display_name: turn.displayName,
      usage: turn.usage,
      latency_ms: Date.now() - started,
      degraded: turn.degraded,
    };
  }

  private async remoteTurn(
    runtime: LlmRuntime,
    model: { id: string; upstreamModel: string; timeoutMs: number; displayName: string } | null,
    input: {
      messages: LlmMessage[];
      tools: LlmTool[];
      showThinking: boolean;
      signal: AbortSignal;
      onDelta: (chunk: { type: 'text' | 'thinking'; text: string }) => void;
      userId: string;
      tenantId: string;
    },
    degraded: boolean,
  ): Promise<LlmTurn> {
    const modelId = upstreamOf(model, runtime);
    const started = Date.now();
    const timeout = AbortSignal.timeout(model?.timeoutMs || 60000);
    const signal = AbortSignal.any([input.signal, timeout]);
    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${runtime.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        stream: true,
        messages: input.messages.map(toOpenAI),
        ...(input.tools.length
          ? {
              tools: input.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.key,
                  description: tool.summary,
                  parameters: tool.schema,
                },
              })),
            }
          : {}),
      }),
      signal,
    });
    if (!response.ok || !response.body) throw new ApiException('MODEL_UNAVAILABLE');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let thinking = '';
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let usage: LlmTurn['usage'] = null;
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        let json: {
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
          choices?: Array<{ delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
        };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.usage && (json.usage.total_tokens || json.usage.completion_tokens || json.usage.prompt_tokens)) {
          usage = {
            prompt_tokens: json.usage.prompt_tokens || 0,
            completion_tokens: json.usage.completion_tokens || 0,
            total_tokens: json.usage.total_tokens || 0,
          };
        }
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.reasoning_content) {
          thinking += delta.reasoning_content;
          if (input.showThinking) input.onDelta({ type: 'thinking', text: delta.reasoning_content });
        }
        if (delta.content) {
          text += delta.content;
          input.onDelta({ type: 'text', text: delta.content });
        }
        for (const call of delta.tool_calls || []) {
          const index = call.index ?? 0;
          const acc = calls.get(index) || { id: '', name: '', arguments: '' };
          if (call.id) acc.id = call.id;
          if (call.function?.name) acc.name += call.function.name;
          if (call.function?.arguments) acc.arguments += call.function.arguments;
          calls.set(index, acc);
        }
      }
    }
    const toolCalls: LlmToolCall[] = [...calls.values()]
      .filter((call) => call.name)
      .map((call) => ({
        id: call.id || `call_${ulid()}`,
        name: call.name,
        raw: call.arguments || '{}',
        arguments: parseArgs(call.arguments || '{}'),
      }));
    await this.prisma.modelCallLog.create({
      data: {
        id: ulid(),
        tenantId: input.tenantId,
        userId: input.userId,
        modelId: model?.id,
        provider: runtime.provider,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        latencyMs: Date.now() - started,
        status: signal.aborted ? 'aborted' : 'ok',
      },
    });
    return {
      text,
      thinking,
      toolCalls,
      usage,
      provider: runtime.provider,
      degraded,
      aborted: input.signal.aborted,
      displayName: model?.displayName || '标准对话',
      modelId: model?.id ?? null,
    };
  }

  private async mockTurn(
    messages: LlmMessage[],
    tools: LlmTool[],
    showThinking: boolean,
    signal: AbortSignal,
    onDelta: (chunk: { type: 'text' | 'thinking'; text: string }) => void,
    displayName: string,
  ): Promise<LlmTurn> {
    const decision = decideMock(messages, tools);
    if (showThinking) {
      const thought = '先看本会话已启用的技能，再决定是直接回答还是调用。';
      onDelta({ type: 'thinking', text: thought });
    }
    let text = '';
    for (const piece of chunkText(decision.text, 12)) {
      if (signal.aborted) break;
      text += piece;
      onDelta({ type: 'text', text: piece });
      await sleep(25);
    }
    const toolCalls = decision.tool && !signal.aborted ? [decision.tool] : [];
    return {
      text,
      thinking: '',
      toolCalls,
      usage: { prompt_tokens: 32, completion_tokens: text.length, total_tokens: 32 + text.length },
      provider: 'mock',
      degraded: false,
      aborted: signal.aborted,
      displayName,
      modelId: null,
    };
  }
}

function upstreamOf(model: { upstreamModel: string } | null, runtime: LlmRuntime): string {
  const id = model?.upstreamModel || '';
  if (!id || id.startsWith('mock')) return runtime.model;
  return id;
}

function toOpenAI(message: LlmMessage): Record<string, unknown> {
  if (message.role === 'assistant' && message.tool_calls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.tool_calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.tool_call_id, content: message.content };
  }
  return { role: message.role, content: message.content };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

function decideMock(messages: LlmMessage[], tools: LlmTool[]): { text: string; tool: LlmToolCall | null } {
  const last = messages[messages.length - 1];
  if (last?.role === 'tool') {
    return { text: `技能已执行。摘要：${last.content.slice(0, 500)}`, tool: null };
  }
  const user = [...messages].reverse().find((message) => message.role === 'user');
  const content = user?.content || '';
  const tool = pickTool(content, tools);
  if (!tool) {
    return { text: '我在。可以直接对话，也可以点名一项已启用的技能，例如选品、识图或生成短视频分镜。', tool: null };
  }
  const args = synthesize(tool, content);
  return {
    text: `我来调用「${tool.name}」。`,
    tool: { id: `call_${ulid()}`, name: tool.key, arguments: args, raw: JSON.stringify(args) },
  };
}

function pickTool(content: string, tools: LlmTool[]): LlmTool | null {
  const text = content.toLowerCase();
  for (const tool of tools) {
    const hints = tool.schema['x-hints'];
    const hinted = Array.isArray(hints) && hints.some((hint) => content.includes(String(hint)));
    if (hinted || content.includes(tool.name) || text.includes(tool.key)) return tool;
  }
  if (content.includes('调用') && tools.length === 1) return tools[0];
  return null;
}

function synthesize(tool: LlmTool, content: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const props = tool.schema.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop.format === 'file' || prop['x-file']) {
      const matched = content.match(/file_[A-Za-z0-9]+/);
      args[key] = matched?.[0] || '';
      continue;
    }
    if (prop.enum?.length) {
      args[key] = prop.enum[0];
      continue;
    }
    if (prop.type === 'integer' || prop.type === 'number') {
      args[key] = typeof prop.default === 'number' ? prop.default : 3;
      continue;
    }
    if (prop.type === 'boolean') {
      args[key] = Boolean(prop.default);
      continue;
    }
    args[key] = typeof prop.default === 'string' ? prop.default : content.slice(0, 200);
  }
  return args;
}

function chunkText(value: string, size: number): string[] {
  const parts: string[] = [];
  for (let index = 0; index < value.length; index += size) parts.push(value.slice(index, index + size));
  return parts.length ? parts : [''];
}

function emptyTurn(provider: string, displayName: string, aborted: boolean, modelId: string | null = null): LlmTurn {
  return {
    text: '',
    thinking: '',
    toolCalls: [],
    usage: null,
    provider,
    degraded: false,
    aborted,
    displayName,
    modelId,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void asJson;
