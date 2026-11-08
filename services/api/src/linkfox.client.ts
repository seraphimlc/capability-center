import { ApiException } from './errors';
import { whitelabelValue } from './domain';

function apiKey(): string {
  return (
    process.env.LINKFOX_AGENT_API_KEY ||
    process.env.LINKFOXAGENT_API_KEY ||
    process.env.LINKFOX_API_KEY ||
    ''
  ).trim();
}

function gateway(): string {
  return (process.env.LINKFOX_TOOL_GATEWAY || 'https://tool-gateway.linkfox.com').replace(/\/$/, '');
}

function isOkCode(code: unknown): boolean {
  if (code === undefined || code === null || code === '') return true;
  if (typeof code === 'string' && !code.trim()) return true;
  const n = Number(code);
  return Number.isFinite(n) && n >= 200 && n < 300;
}

export async function linkfoxCall(toolPath: string, body: Record<string, unknown>): Promise<unknown> {
  const key = apiKey();
  if (!key) throw new ApiException('CONNECTOR_UNAVAILABLE', '上游能力未配置密钥');
  const path = toolPath.replace(/^\/+/, '');
  if (!path || path.includes('..')) throw new ApiException('VALIDATION_ERROR', '无效的上游能力路径');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150000);
  try {
    const response = await fetch(`${gateway()}/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'CapabilityCenter/1.0',
        authorization: key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 2000) };
    }
    if (response.status === 401 || response.status === 402) {
      throw new ApiException('CONNECTOR_UNAVAILABLE', '上游鉴权或额度异常，请检查密钥与余额');
    }
    if (!response.ok) {
      throw new ApiException('UPSTREAM_ERROR', '上游调用失败');
    }
    const code = json?.errcode ?? json?.errorCode;
    if (!isOkCode(code)) {
      const msg = String(json?.errmsg || json?.error || '上游业务失败');
      if (/auth|401|authorized/i.test(msg)) {
        throw new ApiException('CONNECTOR_UNAVAILABLE', '上游鉴权失败');
      }
      if (/402|余额|算力|quota|insufficient/i.test(msg)) {
        throw new ApiException('CONNECTOR_UNAVAILABLE', '上游额度不足');
      }
      throw new ApiException('UPSTREAM_ERROR', '上游返回业务错误');
    }
    return whitelabelValue(sanitizeUpstream(json));
  } catch (error) {
    if (error instanceof ApiException) throw error;
    throw new ApiException('CONNECTOR_UNAVAILABLE', '上游连接失败或超时');
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeUpstream(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeUpstream);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/^(costToken|sourceTool|sourceType|upstream_model|vendor_trace)$/i.test(k)) continue;
    out[k] = sanitizeUpstream(v);
  }
  return out;
}

export function hasLinkfoxKey(): boolean {
  return Boolean(apiKey());
}
