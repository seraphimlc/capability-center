'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../lib/api';

type PlatformField = {
  key: string;
  title: string;
  secret: boolean;
  required: boolean;
  placeholder: string;
};

type Platform = {
  id: string;
  name: string;
  auth_type: string;
  fields: PlatformField[];
  capabilities: string[];
};

type Shop = {
  id: string;
  platform: string;
  platform_name: string;
  name: string;
  marketplace: string | null;
  status: string;
  capabilities: string[];
  last_checked_at: string | null;
  error_message: string | null;
  updated_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  connected: '已连接',
  error: '异常',
  revoked: '已断开',
};

export default function StoresPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [selected, setSelected] = useState<string>('amazon');
  const [name, setName] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const platform = useMemo(() => platforms.find((p) => p.id === selected) || null, [platforms, selected]);

  async function refresh() {
    const [p, s] = await Promise.all([
      api<{ items: Platform[] }>('/api/www/shops/platforms'),
      api<{ items: Shop[] }>('/api/www/shops'),
    ]);
    setPlatforms(p.items);
    setShops(s.items);
    if (!selected && p.items[0]) setSelected(p.items[0].id);
  }

  useEffect(() => {
    refresh().catch((err) => setError((err as ApiError).message || '加载失败'));
  }, []);

  useEffect(() => {
    setCreds({});
    setName('');
  }, [selected]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!platform) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      await api('/api/www/shops', {
        method: 'POST',
        body: JSON.stringify({
          platform: platform.id,
          name: name.trim() || `${platform.name} 店铺`,
          credentials: creds,
          marketplace: creds.marketplace || creds.region || undefined,
        }),
      });
      setNote('店铺已保存，可点「校验连接」确认凭证');
      setName('');
      setCreds({});
      await refresh();
    } catch (err) {
      setError((err as ApiError).message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function probe(id: string) {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ ok: boolean; message?: string }>(`/api/www/shops/${id}/probe`, { method: 'POST' });
      setNote(res.message || (res.ok ? '校验通过' : '校验未通过'));
      await refresh();
    } catch (err) {
      setError((err as ApiError).message || '校验失败');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(id: string) {
    setBusy(true);
    try {
      await api(`/api/www/shops/${id}/disconnect`, { method: 'POST' });
      setNote('已断开连接');
      await refresh();
    } catch (err) {
      setError((err as ApiError).message || '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('确定删除该店铺？删除后调用记录仍保留，但无法再选该店。')) return;
    setBusy(true);
    try {
      await api(`/api/www/shops/${id}`, { method: 'DELETE' });
      setNote('已删除');
      await refresh();
    } catch (err) {
      setError((err as ApiError).message || '删除失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-moss">跨境店铺</p>
          <h1 className="mt-1 font-display text-3xl">店铺管理</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink/65">
            先对接店铺，再进店工作台看该平台相关能力；通用调研类能力仍在目录。调用时系统会注入该店凭证。
          </p>
        </div>
        <Link href="/" className="btn btn-ghost">
          去目录调用
        </Link>
      </header>

      {note ? <p className="rounded-xl bg-moss/10 px-4 py-2 text-sm text-moss">{note}</p> : null}
      {error ? <p className="rounded-xl bg-clay/10 px-4 py-2 text-sm text-clay">{error}</p> : null}

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-5">
          <h2 className="text-lg font-medium">已对接店铺</h2>
          <p className="mt-1 text-sm text-ink/50">状态为「已连接」的店铺会出现在调用工作台的选店列表里。</p>
          <div className="mt-4 space-y-3">
            {shops.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink/50">
                还没有店铺。右侧选一个平台填凭证即可。
              </p>
            ) : (
              shops.map((shop) => (
                <article key={shop.id} className="rounded-2xl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{shop.name}</h3>
                        <span className="rounded-full bg-paper px-2 py-0.5 text-xs ring-1 ring-line">{shop.platform_name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            shop.status === 'connected'
                              ? 'bg-moss/15 text-moss'
                              : shop.status === 'error'
                                ? 'bg-clay/15 text-clay'
                                : 'bg-paper text-ink/60'
                          }`}
                        >
                          {STATUS_LABEL[shop.status] || shop.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink/50">
                        {shop.marketplace ? `站点 ${shop.marketplace} · ` : ''}
                        能力：{(shop.capabilities || []).join(' / ') || '通用'}
                        {shop.last_checked_at ? ` · 最近校验 ${new Date(shop.last_checked_at).toLocaleString('zh-CN')}` : ''}
                      </p>
                      {shop.error_message ? <p className="mt-1 text-xs text-clay">{shop.error_message}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {shop.status === 'connected' ? (
                        <Link href={`/stores/${shop.id}`} className="btn btn-primary text-xs">
                          进入工作台
                        </Link>
                      ) : null}
                      <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={() => probe(shop.id)}>
                        校验连接
                      </button>
                      {shop.status === 'connected' ? (
                        <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={() => disconnect(shop.id)}>
                          断开
                        </button>
                      ) : null}
                      <button type="button" className="btn btn-ghost text-xs text-clay" disabled={busy} onClick={() => remove(shop.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <form className="card p-5" onSubmit={onCreate}>
          <h2 className="text-lg font-medium">对接新店铺</h2>
          <p className="mt-1 text-sm text-ink/50">一期先用 API Key / Token 对接；OAuth 授权流后续补。</p>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium">平台</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={`rounded-xl px-3 py-2 text-left text-sm ring-1 transition ${
                    selected === p.id ? 'bg-ink text-paper ring-ink' : 'bg-white ring-line hover:bg-paper'
                  }`}
                >
                  <span className="block font-medium">{p.name}</span>
                  <span className={`mt-0.5 block text-[10px] ${selected === p.id ? 'text-paper/70' : 'text-ink/45'}`}>
                    {(p.capabilities || []).slice(0, 2).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          </label>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium">店铺显示名</span>
            <input
              className="field"
              placeholder={platform ? `${platform.name} 主店` : '例如：美亚旗舰店'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          {platform?.fields.map((field) => (
            <label key={field.key} className="mt-3 block text-sm">
              <span className="mb-1 flex items-center gap-2 font-medium">
                {field.title}
                {field.required ? <span className="rounded bg-clay/10 px-1.5 text-[10px] text-clay">必填</span> : null}
              </span>
              <input
                className="field"
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={field.placeholder || ''}
                value={creds[field.key] || ''}
                onChange={(e) => setCreds((prev) => ({ ...prev, [field.key]: e.target.value }))}
                required={field.required}
              />
            </label>
          ))}

          <button className="btn btn-primary mt-5 w-full" disabled={busy || !platform}>
            {busy ? '保存中…' : '保存并对接'}
          </button>
        </form>
      </section>
    </div>
  );
}
