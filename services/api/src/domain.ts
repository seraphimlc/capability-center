import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const BRAND = [/link\s*fox/gi, /紫讯/g, /xyb2b/gi, /xytoken/gi, /api\.xytoken\S*/gi, /Wally\s*Smarter/gi, /\bTsearch\b/gi, /skill\.linkfox\S*/gi, /来源技能/g];

export function whitelabelText(input: string): string {
  let out = input;
  for (const pattern of BRAND) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, '上游服务');
  }
  return out;
}

export function containsBannedBrand(input: string): boolean {
  return BRAND.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(input);
  });
}

const BANNED_KEY = /linkfox|紫讯|xyb2b|xytoken|upstream_model/i;

export function whitelabelValue(value: unknown): unknown {
  if (typeof value === 'string') return whitelabelText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => whitelabelValue(item));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (BANNED_KEY.test(key)) continue;
      out[key] = whitelabelValue(child);
    }
    return out;
  }
  return value;
}

export function availableCredits(balance: number, openHolds: number): number {
  return balance - openHolds;
}

export function canHold(balance: number, openHolds: number, cost: number): boolean {
  return cost >= 0 && availableCredits(balance, openHolds) >= cost;
}

export type ModelTokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

/**
 * Chat model prices are integer CNY credits on `ai_models.price_credits`.
 *
 * Default strategy A (flag missing, empty, or anything other than B): one
 * completed model call costs `priceCredits` when that price is positive.
 * Strategy B: `priceCredits` is the price per 1,000 tokens, rounded up.
 * Missing usage falls back to one unit. `priceCredits <= 0` is free under
 * every strategy, so billing is not limited to strategy B.
 */
export function modelTurnCredits(
  strategy: string | null | undefined,
  priceCredits: number,
  usage?: ModelTokenUsage | null,
): number {
  const price = creditPrice(priceCredits);
  if (price <= 0) return 0;
  if (!tokenStrategy(strategy)) return price;
  const tokens = tokenCount(usage);
  if (tokens <= 0) return price;
  return Math.ceil(tokens / 1000) * price;
}

/** Reservation taken before the call. Strategy B covers the prompt plus max output. */
export function modelHoldAmount(
  strategy: string | null | undefined,
  priceCredits: number,
  maxTokens = 2048,
  promptChars = 0,
): number {
  const price = creditPrice(priceCredits);
  if (price <= 0) return 0;
  if (!tokenStrategy(strategy)) return price;
  const promptTokens = Math.max(0, Math.floor(promptChars));
  const outputTokens = Math.max(1, Math.floor(maxTokens) || 0);
  const units = Math.max(1, Math.ceil((promptTokens + outputTokens) / 1000));
  return units * price;
}

function creditPrice(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function tokenStrategy(strategy: string | null | undefined): boolean {
  return (strategy || 'A').trim().toUpperCase() === 'B';
}

function tokenCount(usage?: ModelTokenUsage | null): number {
  if (!usage) return 0;
  if (usage.total_tokens && usage.total_tokens > 0) return usage.total_tokens;
  return (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
}

export function assertSafePrefix(prefix: string): string {
  const cleaned = prefix.trim().replace(/^\/+|\/+$/g, '');
  if (!cleaned) {
    throw new Error('OSS prefix is empty');
  }
  const lower = cleaned.toLowerCase();
  if (lower.includes('xingma-stall') || lower === 'learn' || lower.startsWith('learn/')) {
    throw new Error('OSS prefix is reserved by another product');
  }
  return cleaned;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function shanghaiParts(date = new Date()): { y: string; m: string; d: string; period: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const m = parts.find((part) => part.type === 'month')?.value ?? '01';
  const d = parts.find((part) => part.type === 'day')?.value ?? '01';
  return { y, m, d, period: `${y}-${m}` };
}

export function pageArgs(query: Record<string, unknown>): { page: number; pageSize: number; skip: number } {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function passwordOk(password: string): boolean {
  return password.length >= 8 && password.length <= 72 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export function emailOk(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
}

export type JsonSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchemaProperty>;
  'x-hints'?: string[];
};

export type JsonSchemaProperty = {
  type?: string;
  title?: string;
  enum?: string[];
  format?: string;
  default?: unknown;
  maxLength?: number;
  description?: string;
  'x-file'?: boolean;
  'x-hints'?: string[];
};

export function validateInput(schema: JsonSchema | null | undefined, input: Record<string, unknown>): string | null {
  if (!schema || schema.type !== 'object') return null;
  const required = schema.required ?? [];
  for (const key of required) {
    const value = input?.[key];
    if (value === undefined || value === null || value === '') return key;
  }
  const props = schema.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    const value = input?.[key];
    if (value === undefined || value === null || value === '') continue;
    if ((prop.type === 'number' || prop.type === 'integer') && typeof value !== 'number') return key;
    if (prop.type === 'string' && typeof value !== 'string') return key;
    if (prop.type === 'boolean' && typeof value !== 'boolean') return key;
    if (prop.enum && !prop.enum.includes(String(value))) return key;
  }
  return null;
}

export function hashBody(value: unknown): string {
  return sha256(JSON.stringify(value ?? null));
}

export function parseApiKey(token: string): { env: string; publicId: string; secret: string } | null {
  const matched = /^ck_(sandbox|prod)_([A-Za-z0-9]+)_([A-Za-z0-9]+)$/.exec(token.trim());
  if (!matched) return null;
  return { env: matched[1], publicId: matched[2], secret: matched[3] };
}

export function isBlockedText(value: string): boolean {
  return value.includes('[[blocked]]');
}
