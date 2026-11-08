'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, setToken } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('ops@visitworlds.me');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await api<{ access_token: string }>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(data.access_token);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <p className="text-xs tracking-[0.2em] text-moss">管理端</p>
      <h1 className="mt-2 text-4xl">能力中心</h1>
      <form className="card mt-6 space-y-3 p-6" onSubmit={onSubmit}>
        <input className="field" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className="field" type="password" placeholder="密码" value={password} onChange={(event) => setPassword(event.target.value)} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className="btn btn-primary w-full">登录</button>
      </form>
    </main>
  );
}
