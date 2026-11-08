import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSafePrefix,
  canHold,
  containsBannedBrand,
  modelHoldAmount,
  modelTurnCredits,
  whitelabelText,
  whitelabelValue,
} from './domain';
import { matchesStorePlatform, toolIdSet } from './tool-classify';

test('hold math does not oversell', () => {
  assert.equal(canHold(100, 40, 60), true);
  assert.equal(canHold(100, 40, 61), false);
  assert.equal(canHold(0, 0, 1), false);
  assert.equal(canHold(10, 0, 0), true);
});

test('whitelabel strips upstream brands', () => {
  const raw = 'LinkFox 与 紫讯 以及 https://api.xytoken.xyb2b.com/v1 不可见';
  const cleaned = whitelabelText(raw);
  assert.equal(containsBannedBrand(cleaned), false);
  assert.match(cleaned, /上游服务/);
});

test('whitelabel drops branded keys', () => {
  const cleaned = whitelabelValue({
    ok: true,
    vendor_trace: 'LinkFox internal',
    upstream_model: 'deepseek-v4.1-flash',
  }) as Record<string, unknown>;
  assert.equal(cleaned.upstream_model, undefined);
  assert.equal(containsBannedBrand(JSON.stringify(cleaned)), false);
});

test('strategy A charges a flat per-call price when the model is billable', () => {
  assert.equal(modelTurnCredits('A', 3, { total_tokens: 50 }), 3);
  assert.equal(modelTurnCredits(undefined, 3, null), 3);
  assert.equal(modelTurnCredits('', 4, { total_tokens: 9000 }), 4);
  assert.equal(modelTurnCredits('A', 0, { total_tokens: 9000 }), 0);
  assert.equal(modelTurnCredits('A', 2.9, { total_tokens: 1 }), 2);
  assert.equal(modelHoldAmount('A', 3, 2048, 8000), 3);
});

test('strategy B bills integer credits per thousand tokens', () => {
  assert.equal(modelTurnCredits('B', 2, { total_tokens: 1 }), 2);
  assert.equal(modelTurnCredits('b', 2, { total_tokens: 1000 }), 2);
  assert.equal(modelTurnCredits('B', 2, { total_tokens: 1001 }), 4);
  assert.equal(modelTurnCredits('B', 2, { prompt_tokens: 800, completion_tokens: 300 }), 4);
  assert.equal(modelTurnCredits('B', 2, null), 2);
  assert.equal(modelTurnCredits('B', 0, { total_tokens: 5000 }), 0);
  assert.equal(modelHoldAmount('B', 2, 2048, 0), 6);
  assert.equal(modelHoldAmount('B', 2, 2048, 1500), 8);
});

test('store platform filter ignores empty platform lists', () => {
  assert.equal(matchesStorePlatform(['alibaba1688'], 'alibaba1688'), true);
  assert.equal(matchesStorePlatform(['amazon', 'shopify'], 'alibaba1688'), false);
  assert.equal(matchesStorePlatform([], 'alibaba1688'), false);
  assert.equal(matchesStorePlatform(null, 'amazon'), false);
  assert.deepEqual(toolIdSet([]), ['__none__']);
  assert.deepEqual(toolIdSet(['tool_1']), ['tool_1']);
});

test('oss prefix rejects foreign product roots', () => {
  assert.equal(assertSafePrefix('capability-center/'), 'capability-center');
  assert.equal(assertSafePrefix('visitworlds'), 'visitworlds');
  assert.throws(() => assertSafePrefix('xingma-stall'));
  assert.throws(() => assertSafePrefix('learn/images'));
});
