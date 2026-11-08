'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../lib/api';

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
};

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  connected: '已连接',
  error: '异常',
  revoked: '已断开',
};

export default function StoresPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    const data = await api<{ items: Shop[] }>('/api/www/shops');
    setShops(data.items);
  }

  useEffect(() => {
    refresh().catch((err) => setError((err as ApiError).message || '加载失败'));
  }, []);

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
    setError('');
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
    setError('');
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
            先对接店铺，再进店工作台看该平台相关能力。通用调研类能力仍在目录。
          </p>
        </div>
        <Link href="/stores/new" className="btn btn-primary">对接店铺</Link>
      </header>

      {note ? <p className="rounded-xl bg-moss/10 px-4 py-2 text-sm text-moss">{note}</p> : null}
      {error ? <p className="rounded-xl bg-clay/10 px-4 py-2 text-sm text-clay">{error}</p> : null}

      {shops.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink/50">
          还没有店铺。
          <Link href="/stores/new" className="ml-1 text-moss underline">去对接</Link>
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shops.map((shop) => (
            <article key={shop.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">{shop.name}</h2>
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
              <p className="mt-2 text-xs text-ink/50">
                {shop.marketplace ? `站点 ${shop.marketplace} · ` : ''}
                {(shop.capabilities || []).join(' / ') || '通用'}
                {shop.last_checked_at ? ` · 最近校验 ${new Date(shop.last_checked_at).toLocaleString('zh-CN')}` : ''}
              </p>
              {shop.error_message ? <p className="mt-1 text-xs text-clay">{shop.error_message}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/stores/${shop.id}`} className="btn btn-primary text-xs">进入工作台</Link>
                <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={() => probe(shop.id)}>校验连接</button>
                <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={() => disconnect(shop.id)}>断开</button>
                <button type="button" className="btn btn-ghost text-xs text-clay" disabled={busy} onClick={() => remove(shop.id)}>删除</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
