'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, setToken } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const data = await api<{ access_token: string }>('/api/www/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName }),
      });
      setToken(data.access_token);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-display text-4xl">注册</h1>
      <p className="mt-2 text-sm text-ink/60">新账号钱包余额为 0，由管理员充值后才能调用付费能力。</p>
      <form className="card mt-6 space-y-3 p-6" onSubmit={onSubmit}>
        <input className="field" placeholder="显示名" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        <input className="field" placeholder="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className="field" placeholder="密码（至少 8 位，含字母和数字）" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        {error ? <p className="text-sm text-clay">{error}</p> : null}
        <button className="btn btn-primary w-full">创建账号</button>
        <Link href="/login" className="block text-center text-sm underline">返回登录</Link>
      </form>
    </main>
  );
}
