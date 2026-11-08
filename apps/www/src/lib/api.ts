export type ApiError = Error & { code?: string; requestId?: string; details?: { balance?: number; required?: number; field?: string } };

const TOKEN = 'cc_www_access';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, true);
}

async function request<T>(path: string, init: RequestInit, retry: boolean): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  const code = body?.error?.code as string | undefined;
  if (retry && !path.includes('/auth/') && (response.status === 401 || code === 'AUTH_TOKEN_EXPIRED' || code === 'UNAUTHORIZED')) {
    const refreshed = await fetch('/api/www/auth/refresh', { method: 'POST', credentials: 'include' });
    const next = await refreshed.json().catch(() => null);
    if (refreshed.ok && next?.data?.access_token) {
      setToken(next.data.access_token);
      return request<T>(path, init, false);
    }
    clearToken();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
  }
  if (!body?.ok) {
    const error = new Error(body?.error?.message || '请求失败') as ApiError;
    error.code = code;
    error.requestId = body?.request_id;
    error.details = body?.error?.details;
    throw error;
  }
  const data = body.data as T;
  if (body.meta && data && typeof data === 'object' && !Array.isArray(data) && !(data as { __page?: unknown }).__page) {
    (data as { __page?: unknown }).__page = body.meta;
  }
  return data;
}

export async function uploadFile(file: File): Promise<string> {
  const presign = await api<{
    file_id: string;
    upload_url: string;
    headers: Record<string, string>;
  }>('/api/www/files/presign', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, mime: file.type || 'application/octet-stream', size: file.size }),
  });
  const headers = new Headers(presign.headers || {});
  if (presign.upload_url.startsWith('/')) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const put = await fetch(presign.upload_url, { method: 'PUT', headers, body: file });
  if (!put.ok && put.status !== 204) throw new Error('上传失败');
  await api(`/api/www/files/${presign.file_id}/complete`, { method: 'POST' });
  return presign.file_id;
}

export function readSse(buffer: string, onEvent: (event: string, data: Record<string, unknown>) => void): string {
  const chunks = buffer.split('\n\n');
  const rest = chunks.pop() ?? '';
  for (const chunk of chunks) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    try {
      onEvent(event, JSON.parse(dataLines.join('\n')) as Record<string, unknown>);
    } catch {
      onEvent(event, { text: dataLines.join('\n') });
    }
  }
  return rest;
}
