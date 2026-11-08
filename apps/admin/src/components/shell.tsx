'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api, clearToken, getToken } from '../lib/api';

const LINKS = [
  ['/', '总览'],
  ['/users', '用户与充值'],
  ['/tools', '能力'],
  ['/agents', '助手'],
  ['/connectors', '连接器'],
  ['/models', '模型'],
  ['/oss', '对象存储'],
  ['/tasks', '任务'],
  ['/audit', '审计'],
  ['/keys', '密钥'],
  ['/limits', '限流'],
  ['/settings', '设置'],
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const bare = path.startsWith('/login');
  const [ready, setReady] = useState(bare);

  useEffect(() => {
    if (bare) return;
    (async () => {
      if (!getToken()) {
        const refreshed = await fetch('/api/admin/auth/refresh', { method: 'POST', credentials: 'include' });
        const body = await refreshed.json().catch(() => null);
        if (refreshed.ok && body?.data?.access_token) sessionStorage.setItem('cc_admin_access', body.data.access_token);
        else {
          router.replace('/login');
          return;
        }
      }
      setReady(true);
    })();
  }, [bare, router]);

  if (bare) return <>{children}</>;
  if (!ready) return <div className="grid min-h-screen place-items-center text-sm">正在进入管理端…</div>;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="bg-ink text-paper md:min-h-screen">
        <div className="px-4 py-5">
          <p className="text-xs tracking-[0.2em] text-white/50">ADMIN</p>
          <p className="text-xl">能力中心</p>
        </div>
        <nav className="flex gap-1 overflow-auto px-2 pb-4 md:block">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={`block whitespace-nowrap rounded-lg px-3 py-2 text-sm ${path === href ? 'bg-white/15' : 'text-white/75'}`}>
              {label}
            </Link>
          ))}
        </nav>
        <button className="m-3 text-sm text-white/60" onClick={async () => { await api('/api/admin/auth/logout', { method: 'POST' }).catch(() => undefined); clearToken(); router.replace('/login'); }}>登出</button>
      </aside>
      <main className="px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
