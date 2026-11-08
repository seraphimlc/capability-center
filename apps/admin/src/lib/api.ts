const TOKEN = 'cc_admin_access';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN);
}
export function setToken(token: string) { sessionStorage.setItem(TOKEN, token); }
export function clearToken() { sessionStorage.removeItem(TOKEN); }

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  const body = await response.json().catch(() => ({}));
  if (retry && (response.status === 401 || body?.error?.code === 'AUTH_TOKEN_EXPIRED') && !path.includes('/auth/')) {
    const refreshed = await fetch('/api/admin/auth/refresh', { method: 'POST', credentials: 'include' });
    const next = await refreshed.json().catch(() => null);
    if (refreshed.ok && next?.data?.access_token) {
      setToken(next.data.access_token);
      return api<T>(path, init, false);
    }
    clearToken();
    if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
  }
  if (!body?.ok) {
    const error = new Error(body?.error?.message || '请求失败') as Error & { requestId?: string };
    error.requestId = body?.request_id;
    throw error;
  }
  return body.data as T;
}
