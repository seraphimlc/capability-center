'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api, clearToken, getToken } from '../lib/api';

const NAV = [
  ['/', '目录'],
  ['/stores', '店铺'],
  ['/agents', '助手'],
  ['/tasks', '任务'],
  ['/invokes', '调用记录'],
  ['/wallet', '钱包'],
  ['/bills', '账单'],
  ['/inbox', '消息'],
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const bare = path.startsWith('/login') || path.startsWith('/register');
  const [ready, setReady] = useState(bare);
  const [balance, setBalance] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ tools: { key: string; name: string }[]; agents: { key: string; name: string }[] } | null>(null);
  const [banner, setBanner] = useState('');

  useEffect(() => {
    if (bare) return;
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        const refreshed = await fetch('/api/www/auth/refresh', { method: 'POST', credentials: 'include' });
        const body = await refreshed.json().catch(() => null);
        if (refreshed.ok && body?.data?.access_token) {
          sessionStorage.setItem('cc_www_access', body.data.access_token);
        } else {
          router.replace(`/login?redirect=${encodeURIComponent(path)}`);
          return;
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [bare, path, router]);

  useEffect(() => {
    if (!ready || bare) return;
    let stop = false;
    const load = async () => {
      try {
        const wallet = await api<{ available: number }>('/api/www/wallet');
        const notes = await api<{ unread: number }>('/api/www/notifications');
        if (!stop) {
          setBalance(wallet.available);
          setUnread(notes.unread);
        }
      } catch {
        /* shell stays usable */
      }
    };
    void load();
    const timer = setInterval(load, 20000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [ready, bare]);

  useEffect(() => {
    const onError = (event: Event) => setBanner((event as CustomEvent<string>).detail);
    window.addEventListener('cc-error', onError);
    return () => window.removeEventListener('cc-error', onError);
  }, []);

  if (bare) return <>{children}</>;
  if (!ready) return <div className="grid min-h-screen place-items-center text-sm text-ink/60">正在恢复登录…</div>;

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!q.trim()) return setHits(null);
    const data = await api<{ tools: { key: string; name: string }[]; agents: { key: string; name: string }[] }>(
      `/api/www/search?q=${encodeURIComponent(q.trim())}`,
    );
    setHits(data);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="font-display text-2xl leading-none tracking-tight">
            能力中心
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map(([href, label]) => {
              const to = href.trim();
              const active = to === '/' ? path === '/' : path.startsWith(to);
              return (
                <Link key={to} href={to} className={`rounded-full px-3 py-1 ${active ? 'bg-ink text-paper' : 'hover:bg-white'}`}>
                  {label}
                  {to === '/inbox' && unread > 0 ? <span className="ml-1 text-clay">{unread}</span> : null}
                </Link>
              );
            })}
          </nav>
          <form onSubmit={search} className="relative ml-auto min-w-[200px] flex-1 md:max-w-xs">
            <input className="field" placeholder="搜索能力或助手" value={q} onChange={(event) => setQ(event.target.value)} />
            {hits ? (
              <div className="absolute left-0 right-0 top-11 z-20 card p-2 text-sm">
                <p className="px-2 py-1 text-xs text-ink/50">能力</p>
                {hits.tools.length === 0 ? <p className="px-2 py-1 text-ink/50">没有匹配的能力</p> : null}
                {hits.tools.map((tool) => (
                  <Link key={tool.key} href={`/tools/${tool.key}`} className="block rounded-lg px-2 py-1 hover:bg-paper" onClick={() => setHits(null)}>
                    {tool.name}
                  </Link>
                ))}
                <p className="px-2 py-1 text-xs text-ink/50">助手</p>
                {hits.agents.map((agent) => (
                  <Link key={agent.key} href={`/agents?focus=${agent.key}`} className="block rounded-lg px-2 py-1 hover:bg-paper" onClick={() => setHits(null)}>
                    {agent.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </form>
          <Link href="/wallet" className="rounded-full bg-white px-3 py-1 text-sm">
            余额 {balance ?? '—'}
          </Link>
          <Link href="/settings" className="text-sm">
            设置
          </Link>
          <button
            className="text-sm text-ink/60"
            onClick={async () => {
              await api('/api/www/auth/logout', { method: 'POST' }).catch(() => undefined);
              clearToken();
              router.replace('/login');
            }}
          >
            登出
          </button>
        </div>
      </header>
      {banner ? (
        <div className="bg-clay px-4 py-2 text-center text-sm text-white">
          {banner}
          <button className="ml-3 underline" onClick={() => setBanner('')}>
            关闭
          </button>
        </div>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
