import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_PROMPTS, PUBLISHED_AGENT_KEYS } from './agent-prompts';
import {
  CONTEXT_TOKEN_BUDGET,
  TOOL_INTERRUPTED,
  TOOL_RESULT_CHAR_CAP,
  TOOL_TRUNCATED,
  assembleSystemPrompt,
  buildModelContext,
  estimateTokens,
  type TranscriptMessage,
} from './chat-context';

const HEADINGS = ['角色与目标', '工作方式', '平台/领域专长', '输出格式', '硬边界', '店铺上下文'];

test('every published agent has a full operating brief', () => {
  assert.equal(PUBLISHED_AGENT_KEYS.length, 12);
  for (const key of PUBLISHED_AGENT_KEYS) {
    const text = AGENT_PROMPTS[key];
    const length = Array.from(text).length;
    assert.ok(length >= 400 && length <= 900, `${key} length ${length}`);
    for (const heading of HEADINGS) assert.ok(text.includes(heading), `${key} missing ${heading}`);
    assert.match(text, /不要以「作为 AI」/);
    assert.match(text, /LinkFox/);
    assert.match(text, /整数积分/);
  }
});

test('system prompt injects runtime facts', () => {
  const text = assembleSystemPrompt({
    base: '角色与目标\n选品。',
    name: '选品顾问',
    skills: [{ name: '选品简报', summary: '按关键词整理需求与价格带' }],
    confirmMode: 'manual',
    store: { name: '北美主店', platform: 'amazon', marketplace: 'US', connected: true },
    today: '2026-11-08',
  });
  assert.match(text, /选品顾问/);
  assert.match(text, /选品简报：按关键词整理需求与价格带/);
  assert.match(text, /每次调用技能前需要用户确认/);
  assert.match(text, /北美主店/);
  assert.match(text, /亚马逊/);
  assert.match(text, /2026-11-08/);
  assert.match(text, /整数积分/);
});

test('short history stays verbatim under the default budget', () => {
  const history: TranscriptMessage[] = [
    { role: 'user', content: '看一下露营灯' },
    { role: 'assistant', content: '先确认站点。' },
    { role: 'user', content: '美国站' },
  ];
  const built = buildModelContext({ system: '你是选品顾问', history });
  assert.equal(built.summarized, false);
  assert.equal(built.droppedTurns, 0);
  assert.equal(built.messages.filter((item) => item.role === 'user').length, 2);
  assert.ok(estimateTokens(built.messages.map((item) => item.content).join('')) < CONTEXT_TOKEN_BUDGET);
});

test('old turns collapse into a summary and the latest user turn remains', () => {
  const history: TranscriptMessage[] = [
    { role: 'user', content: `UNIQUE_OLD ${'甲'.repeat(8000)}` },
    { role: 'assistant', content: '旧结论是先看价格带。' },
    { role: 'user', content: 'LATEST 只问今天的动作' },
  ];
  const built = buildModelContext({ system: 'sys', history, budgetTokens: 200 });
  const users = built.messages.filter((item) => item.role === 'user').map((item) => item.content);
  assert.deepEqual(users, ['LATEST 只问今天的动作']);
  const summary = built.messages.find((item) => item.role === 'system' && item.content.startsWith('会话摘要'));
  assert.ok(summary);
  assert.match(summary.content, /UNIQUE_OLD/);
  assert.equal(built.summarized, true);
  assert.ok(built.droppedTurns >= 1);
});

test('tool call and result stay together or drop together', () => {
  const history: TranscriptMessage[] = [
    { role: 'user', content: `OLD ${'乙'.repeat(6000)}` },
    {
      role: 'assistant',
      content: '我来查。',
      tool_calls: [{ id: 'call_old', name: 'product-picker', arguments: '{"keyword":"lantern"}' }],
    },
    { role: 'tool', tool_call_id: 'call_old', tool_name: 'product-picker', content: '价格带 20-40' },
    { role: 'user', content: 'LATEST 继续' },
  ];
  const built = buildModelContext({ system: 'sys', history, budgetTokens: 180 });
  const raw = JSON.stringify(built.messages);
  assert.equal(raw.includes('call_old'), false);
  assert.equal(raw.includes('价格带 20-40'), false);
  assert.ok(built.messages.some((item) => item.role === 'user' && item.content === 'LATEST 继续'));
  assertPairs(built.messages);
});

test('a recent tool pair is kept intact', () => {
  const history: TranscriptMessage[] = [
    { role: 'user', content: '查露营灯' },
    {
      role: 'assistant',
      content: '调用选品。',
      tool_calls: [{ id: 'call_new', name: 'product-picker', arguments: '{}' }],
    },
    { role: 'tool', tool_call_id: 'call_new', tool_name: 'product-picker', content: '有 12 个候选' },
  ];
  const built = buildModelContext({ system: 'sys', history, budgetTokens: 5000 });
  const call = built.messages.find((item) => item.role === 'assistant' && item.tool_calls?.length);
  const result = built.messages.find((item) => item.role === 'tool');
  assert.equal(call?.tool_calls?.[0].id, 'call_new');
  assert.equal(result?.tool_call_id, 'call_new');
  assert.match(result?.content || '', /12 个候选/);
  assertPairs(built.messages);
});

test('oversized tool results are truncated only in the model payload', () => {
  const history: TranscriptMessage[] = [
    { role: 'user', content: '看结果' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_big', name: 'traffic', arguments: '{}' }],
    },
    { role: 'tool', tool_call_id: 'call_big', content: '数'.repeat(TOOL_RESULT_CHAR_CAP + 400) },
  ];
  const built = buildModelContext({ system: 'sys', history });
  const result = built.messages.find((item) => item.role === 'tool');
  assert.match(result?.content || '', /结果已截断/);
  assert.ok(Array.from(result?.content || '').length <= TOOL_RESULT_CHAR_CAP + TOOL_TRUNCATED.length + 1);
  assert.equal((result?.content || '').includes('数'.repeat(TOOL_RESULT_CHAR_CAP + 400)), false);
});

test('aborted tool calls are closed so the next turn is not poisoned', () => {
  const history: TranscriptMessage[] = [
    {
      role: 'assistant',
      content: '准备调用',
      tool_calls: [{ id: 'call_stop', name: 'traffic', arguments: '{}' }],
    },
    { role: 'user', content: '先停，改问别的' },
  ];
  const built = buildModelContext({ system: 'sys', history });
  const tool = built.messages.find((item) => item.tool_call_id === 'call_stop');
  assert.equal(tool?.content, TOOL_INTERRUPTED);
  const toolIndex = built.messages.findIndex((item) => item.tool_call_id === 'call_stop');
  const userIndex = built.messages.findIndex((item) => item.role === 'user');
  assert.ok(toolIndex >= 0 && toolIndex < userIndex);
  assertPairs(built.messages);
});

test('orphan tool results are wrapped instead of sent alone', () => {
  const history: TranscriptMessage[] = [
    { role: 'tool', tool_call_id: 'call_orphan', tool_name: 'profit', content: '毛利 18' },
    { role: 'user', content: '基于这个毛利给建议' },
  ];
  const built = buildModelContext({ system: 'sys', history });
  assertPairs(built.messages);
  assert.match(JSON.stringify(built.messages), /毛利 18/);
});

function assertPairs(messages: { role: string; tool_calls?: { id: string }[]; tool_call_id?: string }[]) {
  const open: string[] = [];
  for (const message of messages) {
    if (message.role === 'user' || (message.role === 'assistant' && !message.tool_calls?.length)) {
      assert.equal(open.length, 0);
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      assert.equal(open.length, 0);
      open.push(...message.tool_calls.map((call) => call.id));
    }
    if (message.role === 'tool') {
      const index = open.indexOf(message.tool_call_id || '');
      assert.notEqual(index, -1);
      open.splice(index, 1);
    }
  }
  assert.equal(open.length, 0);
}
