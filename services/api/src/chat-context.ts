import type { LlmMessage } from './model.service';

/**
 * Context window for one model call.
 *
 * Default budget is 10_000 estimated tokens. The estimator treats 2 Unicode
 * characters as 1 token, which is conservative for Chinese and keeps the
 * payload inside the 8k–12k token band the product asked for.
 * Tool results in the model payload are capped at 1_500 characters; the
 * database and invoke records keep the full text.
 * Older turns are folded into one system note ("会话摘要：…"). The newest
 * turns and the latest user turn stay verbatim. A tool call and its result
 * are never split.
 */
export const CONTEXT_TOKEN_BUDGET = 10_000;
export const TOOL_RESULT_CHAR_CAP = 1_500;
export const SUMMARY_CHAR_CAP = 1_200;
export const TOOL_TRUNCATED = '…（结果已截断，完整内容在调用记录）';
export const TOOL_INTERRUPTED = '（该次技能调用已中断，没有结果）';
export const TOOL_PENDING = '（该次技能调用尚未执行，等待用户确认）';

export type ToolCallDraft = {
  id: string;
  name: string;
  arguments: string;
  pending?: boolean;
};

export type TranscriptMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_name?: string;
  tool_calls?: ToolCallDraft[];
};

export function estimateTokens(text: string): number {
  const chars = Array.from(text || '').length;
  if (chars === 0) return 0;
  return Math.ceil(chars / 2);
}

export function assembleSystemPrompt(input: {
  base: string;
  name: string;
  skills: { name: string; summary: string }[];
  confirmMode: string;
  store?: { name: string; platform: string; marketplace?: string | null; connected?: boolean } | null;
  today: string;
}): string {
  const skills = input.skills.length
    ? input.skills.map((skill) => `- ${skill.name}：${skill.summary || '已启用'}`).join('\n')
    : '当前没有启用技能。不要假装调用了技能，也不要编造本应由技能返回的实时数据。';
  const confirm = input.confirmMode === 'manual'
    ? '技能确认：每次调用技能前需要用户确认。先说明要调用哪一项、用什么参数。'
    : '技能确认：已启用技能可以直接调用，不必先询问是否允许。';
  const store = describeStore(input.store);
  return [
    input.base.trim(),
    [
      '本轮运行信息',
      `助手：${input.name}`,
      `日期：${input.today}（Asia/Shanghai）。回答涉及“今天、本周、当季”时用这个日期。`,
      confirm,
      '已启用技能：',
      skills,
      store,
      '积分以人民币口径的整数积分计算。不要提及上游供应商品牌或原始接口名称。',
    ].join('\n'),
  ].join('\n\n');
}

export function buildModelContext(input: {
  system: string;
  history: TranscriptMessage[];
  budgetTokens?: number;
  toolCap?: number;
}): { messages: LlmMessage[]; summarized: boolean; droppedTurns: number } {
  const budget = input.budgetTokens ?? CONTEXT_TOKEN_BUDGET;
  const toolCap = input.toolCap ?? TOOL_RESULT_CHAR_CAP;
  const repaired = repairTranscript(input.history, toolCap);
  const turns = splitTurns(repaired);
  const latest = turns.length ? turns[turns.length - 1] : undefined;
  const older = turns.slice(0, -1);
  const systemTokens = estimateTokens(input.system);
  const latestTokens = latest ? turnTokens(latest) : 0;

  let keptOlder: TranscriptMessage[][] = [];
  let dropped: TranscriptMessage[][] = [];
  let acc = 0;
  const rev: TranscriptMessage[][] = [];
  for (let index = older.length - 1; index >= 0; index -= 1) {
    const cost = turnTokens(older[index]);
    if (systemTokens + latestTokens + acc + cost <= budget) {
      rev.push(older[index]);
      acc += cost;
    } else {
      dropped = older.slice(0, index + 1);
      break;
    }
  }
  keptOlder = rev.reverse();

  let summary = dropped.length ? summarizeTurns(dropped) : '';
  while (summary && systemTokens + estimateTokens(summary) + acc + latestTokens > budget && keptOlder.length) {
    const oldest = keptOlder.shift();
    if (!oldest) break;
    dropped = [...dropped, oldest];
    acc -= turnTokens(oldest);
    summary = summarizeTurns(dropped);
  }
  if (summary && systemTokens + estimateTokens(summary) + acc + latestTokens > budget) {
    const roomChars = Math.max(80, (budget - systemTokens - acc - latestTokens) * 2);
    summary = clip(summary, Math.min(SUMMARY_CHAR_CAP, roomChars));
  }

  const messages: LlmMessage[] = [{ role: 'system', content: input.system }];
  if (summary) messages.push({ role: 'system', content: summary });
  for (const turn of keptOlder) messages.push(...turn.map(toLlmMessage));
  if (latest) messages.push(...latest.map(toLlmMessage));
  return { messages, summarized: Boolean(summary), droppedTurns: dropped.length };
}

export function repairTranscript(items: TranscriptMessage[], toolCap = TOOL_RESULT_CHAR_CAP): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  const open: ToolCallDraft[] = [];
  const closeOpen = () => {
    for (const call of open) {
      out.push({
        role: 'tool',
        tool_call_id: call.id,
        content: call.pending ? TOOL_PENDING : TOOL_INTERRUPTED,
      });
    }
    open.length = 0;
  };
  for (const item of items) {
    if (item.role === 'tool') {
      const id = item.tool_call_id;
      const match = id ? open.findIndex((call) => call.id === id) : -1;
      if (match >= 0) {
        out.push(capTool(item, toolCap));
        open.splice(match, 1);
        continue;
      }
      if (id) {
        closeOpen();
        out.push({
          role: 'assistant',
          content: '',
          tool_calls: [{ id, name: item.tool_name || 'skill', arguments: '{}' }],
        });
        out.push(capTool(item, toolCap));
      }
      continue;
    }
    if (item.role === 'user') {
      closeOpen();
      out.push({ role: 'user', content: item.content });
      continue;
    }
    closeOpen();
    if (item.tool_calls?.length) {
      open.push(...item.tool_calls);
      out.push({
        role: 'assistant',
        content: item.content,
        tool_calls: item.tool_calls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          pending: call.pending,
        })),
      });
      continue;
    }
    out.push({ role: 'assistant', content: item.content });
  }
  closeOpen();
  return out;
}

function capTool(item: TranscriptMessage, toolCap: number): TranscriptMessage {
  return {
    role: 'tool',
    tool_call_id: item.tool_call_id,
    content: clip(item.content, toolCap, `\n${TOOL_TRUNCATED}`),
  };
}

function splitTurns(items: TranscriptMessage[]): TranscriptMessage[][] {
  const turns: TranscriptMessage[][] = [];
  let current: TranscriptMessage[] = [];
  for (const item of items) {
    if (item.role === 'user' && current.length) {
      turns.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) turns.push(current);
  return turns;
}

function turnTokens(turn: TranscriptMessage[]): number {
  return turn.reduce((sum, item) => sum + estimateTokens(messageText(item)), 0);
}

function messageText(item: TranscriptMessage): string {
  const calls = (item.tool_calls || []).map((call) => `${call.name} ${call.arguments}`).join('\n');
  return `${item.content}${calls ? `\n${calls}` : ''}`;
}

export function summarizeTurns(turns: TranscriptMessage[][]): string {
  const lines = ['会话摘要：更早的对话已折叠，完整记录仍在会话里。'];
  for (const turn of turns) {
    const user = turn.find((item) => item.role === 'user');
    const assistants = turn.filter((item) => item.role === 'assistant' && item.content.trim());
    const answer = assistants.length ? assistants[assistants.length - 1].content : '';
    const tools = new Set<string>();
    for (const item of turn) {
      for (const call of item.tool_calls || []) if (call.name) tools.add(call.name);
      if (item.role === 'tool' && item.tool_name) tools.add(item.tool_name);
    }
    const userBit = clip(user?.content || '（无用户原文）', 80);
    const answerBit = answer ? `；回复要点：${clip(answer, 80)}` : '';
    const toolBit = tools.size ? `；用过技能：${[...tools].join('、')}` : '';
    lines.push(`- 用户：${userBit}${answerBit}${toolBit}`);
  }
  return clip(lines.join('\n'), SUMMARY_CHAR_CAP, '\n…（摘要已截断）');
}

function toLlmMessage(item: TranscriptMessage): LlmMessage {
  if (item.role === 'assistant' && item.tool_calls?.length) {
    return {
      role: 'assistant',
      content: item.content,
      tool_calls: item.tool_calls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
    };
  }
  if (item.role === 'tool') {
    return { role: 'tool', content: item.content, tool_call_id: item.tool_call_id };
  }
  return { role: item.role, content: item.content };
}

function describeStore(store: { name: string; platform: string; marketplace?: string | null; connected?: boolean } | null | undefined): string {
  if (!store) return '默认店铺：未绑定。需要店铺数据时，先问用户是哪一家已连接店铺。';
  const platform = PLATFORM_LABEL[store.platform] || store.platform;
  const market = store.marketplace ? `，站点 ${store.marketplace}` : '';
  const link = store.connected === false ? '该店铺尚未连接，需绑店的技能可能失败，先提醒用户完成连接。' : '未要求更换时，回答和技能都默认这家店；更换前先问用户。';
  return `默认店铺：「${store.name}」（${platform}${market}）。${link}`;
}

const PLATFORM_LABEL: Record<string, string> = {
  amazon: '亚马逊',
  shopify: 'Shopify',
  temu: 'Temu',
  ebay: 'eBay',
  shopee: 'Shopee',
  tiktok_shop: 'TikTok Shop',
  walmart: 'Walmart',
  alibaba1688: '1688',
};

function clip(value: string, maxChars: number, suffix = ''): string {
  const chars = Array.from(value || '');
  if (chars.length <= maxChars) return value || '';
  const keep = Math.max(0, maxChars - Array.from(suffix).length);
  return chars.slice(0, keep).join('') + suffix;
}
