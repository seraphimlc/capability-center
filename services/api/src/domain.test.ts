import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafePrefix, canHold, containsBannedBrand, whitelabelText, whitelabelValue } from './domain';

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

test('oss prefix rejects foreign product roots', () => {
  assert.equal(assertSafePrefix('capability-center/'), 'capability-center');
  assert.equal(assertSafePrefix('visitworlds'), 'visitworlds');
  assert.throws(() => assertSafePrefix('xingma-stall'));
  assert.throws(() => assertSafePrefix('learn/images'));
});
