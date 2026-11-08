import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptUserSend, composerKeyAction, shouldStopBeforeSend } from './chat-ux';

test('Enter sends and Shift+Enter inserts a newline', () => {
  assert.equal(composerKeyAction({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, composing: false }), 'send');
  assert.equal(composerKeyAction({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13, composing: false }), 'newline');
  assert.equal(composerKeyAction({ key: 'a', shiftKey: false, isComposing: false, keyCode: 65, composing: false }), 'ignore');
});

test('IME composition does not send on Enter', () => {
  const base = { key: 'Enter', shiftKey: false, keyCode: 13, composing: false, isComposing: false };
  assert.equal(composerKeyAction({ ...base, isComposing: true }), 'ignore');
  assert.equal(composerKeyAction({ ...base, keyCode: 229 }), 'ignore');
  assert.equal(composerKeyAction({ ...base, composing: true, keyCode: 229, isComposing: true }), 'ignore');
  assert.equal(composerKeyAction({ ...base, composing: true }), 'ignore');
});

test('a new send replaces the unsent draft and stops an in-flight reply', () => {
  const first = acceptUserSend(null, { content: '第一条', file: '' });
  const second = acceptUserSend(first.slot, { content: '第二条', file: '' });
  const third = acceptUserSend(second.slot, { content: '第三条', file: '' });
  assert.equal(first.replaced, false);
  assert.equal(second.replaced, true);
  assert.equal(third.slot.content, '第三条');
  assert.equal(shouldStopBeforeSend(true), true);
  assert.equal(shouldStopBeforeSend(false), false);
});
