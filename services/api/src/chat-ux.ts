/**
 * Composer and send-slot rules shared with the chat page.
 * Enter sends. Shift+Enter inserts a newline. IME composition must not send.
 * A new send while a reply is in flight stops that reply and replaces any
 * unsent draft. There is one slot, not a backlog.
 */

export type ComposerKey = {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
  composing: boolean;
};

export function composerKeyAction(input: ComposerKey): 'send' | 'newline' | 'ignore' {
  if (input.key !== 'Enter') return 'ignore';
  if (input.shiftKey) return 'newline';
  if (input.composing || input.isComposing || input.keyCode === 229) return 'ignore';
  return 'send';
}

export type Outbound = { content: string; file: string };

/** One unsent draft. A newer send replaces it instead of appending. */
export function acceptUserSend(slot: Outbound | null, draft: Outbound): { slot: Outbound; replaced: boolean } {
  return { slot: draft, replaced: slot !== null };
}

export function shouldStopBeforeSend(inflight: boolean): boolean {
  return inflight;
}
