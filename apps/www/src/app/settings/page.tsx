'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function SettingsPage() {
  const [me, setMe] = useState<{ display_name: string; email: string } | null>(null);
  const [name, setName] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [usage, setUsage] = useState<{ used_bytes: number; limit_bytes: number } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    api<{ display_name: string; email: string }>('/api/www/me').then((data) => { setMe(data); setName(data.display_name); });
    api<{ used_bytes: number; limit_bytes: number }>('/api/www/storage/usage').then(setUsage);
  }, []);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    await api('/api/www/me', { method: 'PATCH', body: JSON.stringify({ display_name: name }) });
    setNote('资料已更新');
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/api/www/auth/password', { method: 'POST', body: JSON.stringify({ old_password: oldPassword, new_password: nextPassword }) });
      setNote('密码已更新，其他端需要重新登录');
    } catch (err) {
      setNote(err instanceof Error ? err.message : '修改失败');
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form className="card p-5" onSubmit={saveName}>
        <h1 className="text-xl">资料</h1>
        <p className="mt-1 text-sm text-ink/50">{me?.email}</p>
        <input className="field mt-3" value={name} onChange={(event) => setName(event.target.value)} />
        <button className="btn btn-primary mt-3">保存</button>
      </form>
      <form className="card p-5" onSubmit={savePassword}>
        <h2 className="text-xl">安全</h2>
        <input className="field mt-3" type="password" placeholder="当前密码" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} />
        <input className="field mt-2" type="password" placeholder="新密码" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} />
        <button className="btn btn-ghost mt-3">修改密码</button>
      </form>
      <section className="card p-5">
        <h2 className="text-xl">存储用量</h2>
        <p className="mt-2 text-sm">已用 {usage?.used_bytes ?? 0} / {usage?.limit_bytes ?? 0} 字节</p>
      </section>
      <section className="card p-5 text-sm">
        <h2 className="text-xl">更多</h2>
        <Link className="mt-3 block underline" href="/settings/keys">API 密钥与接入指引</Link>
        <Link className="mt-2 block underline" href="/docs">文档与公告</Link>
      </section>
      {note ? <p className="text-sm md:col-span-2">{note}</p> : null}
    </div>
  );
}
