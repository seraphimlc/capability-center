import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ApiException } from './errors';
import { whitelabelText } from './domain';

/**
 * Minimal MCP client for upstream tools exposed over Streamable HTTP.
 *
 * The pilot connector is a single platform-level account: the access/refresh
 * token lives in `connectors.config_enc` and is refreshed in place when the
 * upstream returns 401. Per-user OAuth comes later; do not copy this pattern
 * for user-specific credentials.
 */

const DEFAULT_URL = 'https://ipunique.com/mcp';
const DEFAULT_TOKEN_URL = 'https://ipunique.com/api/oauth/token';
const DEFAULT_RESOURCE = 'https://ipunique.com/mcp';
const CALL_TIMEOUT_MS = 90_000;

type McpConfig = {
  url?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  tokenUrl?: string;
  resource?: string;
  expiresAt?: number;
};

type JsonRpcResponse = {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code?: number; message?: string; data?: unknown };
};

class UnauthorizedError extends Error {}

@Injectable()
export class McpService {
  constructor(private readonly prisma: PrismaService) {}

  async call(connectorId: string, toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const connector = await this.prisma.connector.findUnique({ where: { id: connectorId } });
    if (!connector || connector.status !== 'active') throw new ApiException('CONNECTOR_UNAVAILABLE');
    const config = this.readConfig(connector.configEnc);
    const token = config.accessToken || process.env.TRADEMARK_MCP_TOKEN || '';
    if (!token) {
      throw new ApiException('CONNECTOR_UNAVAILABLE', '商标数据服务尚未授权，请联系管理员');
    }
    try {
      return await this.send(config, token, toolName, input);
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      if (!config.refreshToken) {
        throw new ApiException('CONNECTOR_UNAVAILABLE', '商标数据服务授权已过期，请重新授权');
      }
      const next = await this.refresh(config);
      await this.persist(connector.id, { ...config, ...next });
      try {
        return await this.send({ ...config, ...next }, next.accessToken, toolName, input);
      } catch (retryError) {
        if (retryError instanceof UnauthorizedError) {
          throw new ApiException('CONNECTOR_UNAVAILABLE', '商标数据服务授权已失效，请重新授权');
        }
        throw retryError;
      }
    }
  }

  private async send(
    config: McpConfig,
    token: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const url = config.url || process.env.TRADEMARK_MCP_URL || DEFAULT_URL;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: toolName, arguments: input },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbort(error)) throw new ApiException('DEPENDENCY_TIMEOUT', '商标数据服务响应超时，请稍后重试');
      throw new ApiException('CONNECTOR_UNAVAILABLE', '商标数据服务暂时不可用，请稍后重试');
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    if (response.status === 401) throw new UnauthorizedError('unauthorized');
    if (!response.ok) throw this.upstreamError(raw, response.status);

    const payload = parseRpc(raw, response.headers.get('content-type'));
    if (payload.error) {
      throw this.upstreamError(payload.error.message || '商标数据服务返回错误', response.status);
    }
    const result = payload.result;
    if (result?.isError) {
      const text = (result.content || []).map((item) => item.text || '').join(' ').trim();
      throw this.upstreamError(text || '商标数据服务返回错误', response.status);
    }
    return result?.structuredContent ?? result ?? null;
  }

  private async refresh(config: McpConfig): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
    const tokenUrl = config.tokenUrl || process.env.TRADEMARK_MCP_TOKEN_URL || DEFAULT_TOKEN_URL;
    const clientId = config.clientId || process.env.TRADEMARK_MCP_CLIENT_ID || '';
    const resource = config.resource || DEFAULT_RESOURCE;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.refreshToken || '',
    });
    if (clientId) body.set('client_id', clientId);
    if (resource) body.set('resource', resource);

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ApiException('CONNECTOR_UNAVAILABLE', '商标数据服务授权刷新失败，请稍后重试');
    }
    const raw = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      json = {};
    }
    const data = json.data as Record<string, unknown> | undefined;
    if (!json.access_token && data?.access_token) json = data;
    if (!response.ok || typeof json.access_token !== 'string') {
      throw new ApiException('CONNECTOR_UNAVAILABLE', '商标数据服务授权已失效，请联系管理员重新授权');
    }
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : config.refreshToken || '',
      expiresAt: Date.now() + Number(json.expires_in || 0) * 1000,
    };
  }

  private upstreamError(raw: string, status: number): ApiException {
    const message = whitelabelText(String(raw || '')).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (/额度|quota|limit/i.test(message)) {
      return new ApiException('CONNECTOR_UNAVAILABLE', '商标数据服务额度不足，请联系管理员增加额度');
    }
    if (/授权|unauthorized|401/i.test(message)) {
      return new ApiException('CONNECTOR_UNAVAILABLE', '商标数据服务授权已过期，请重新授权');
    }
    return new ApiException('UPSTREAM_ERROR', message || `商标数据服务返回 ${status}`);
  }

  private readConfig(raw: string): McpConfig {
    try {
      const parsed = JSON.parse(raw || '{}') as McpConfig;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async persist(connectorId: string, config: McpConfig): Promise<void> {
    await this.prisma.connector
      .update({ where: { id: connectorId }, data: { configEnc: JSON.stringify(config) } })
      .catch(() => undefined);
  }
}

function parseRpc(raw: string, contentType: string | null): JsonRpcResponse {
  const text = (raw || '').trim();
  if (!text) return {};
  if ((contentType || '').includes('text/event-stream') || text.startsWith('event:') || text.includes('\ndata:')) {
    const lines = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]) as JsonRpcResponse;
      } catch {
        /* keep scanning */
      }
    }
  }
  try {
    return JSON.parse(text) as JsonRpcResponse;
  } catch {
    throw new ApiException('UPSTREAM_ERROR', '商标数据服务返回了无法解析的内容');
  }
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError');
}
