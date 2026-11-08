'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { api, setToken } from '../../lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('demo@visitworlds.me');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const data = await api<{ access_token: string }>('/api/www/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(data.access_token);
      router.replace(params.get('redirect') || '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-6 py-16 md:grid-cols-2">
      <section>
        <p className="text-sm tracking-[0.2em] text-moss">VISITWORLDS</p>
        <h1 className="mt-3 font-display text-6xl leading-none">能力中心</h1>
        <p className="mt-4 max-w-md text-lg text-ink/70">把选品、内容和生成能力放在同一个钱包里。点选调用，或让助手帮你调用。</p>
      </section>
      <form className="card p-6" onSubmit={onSubmit}>
        <h2 className="text-xl font-medium">登录</h2>
        <label className="mt-4 block text-sm">
          邮箱
          <input className="field mt-1" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="mt-3 block text-sm">
          密码
          <input className="field mt-1" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="mt-3 text-sm text-clay">{error}</p> : null}
        <button className="btn btn-primary mt-4 w-full">进入</button>
        <p className="mt-3 text-sm text-ink/60">
          还没有账号？ <Link href="/register" className="underline">注册</Link>
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
