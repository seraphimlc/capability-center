'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { InvokeDrawer } from '../components/invoke-drawer';
import { api } from '../lib/api';
import { hasToolForm } from '../tools/registry';
import { ToolRunner } from '../tools/runner';

type Tool = {
  key: string;
  name: string;
  summary: string;
  pricing_credits: number;
  category: { id: string; name: string; slug?: string } | null;
  favored: boolean;
  schema: Record<string, unknown>;
  async: boolean;
  deprecated: boolean;
  store_bound?: boolean;
  platforms?: string[];
};

type PageMeta = { page: number; page_size: number; total: number };

export default function CatalogPage() {
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [recent, setRecent] = useState<Tool[]>([]);
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');
  const [category, setCategory] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [boundFilter, setBoundFilter] = useState<'all' | 'bound' | 'general'>('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pageMeta, setPageMeta] = useState<PageMeta>({ page: 1, page_size: 48, total: 0 });
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState<Tool | null>(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil((pageMeta.total || 0) / (pageMeta.page_size || 48))), [pageMeta]);

  async function load(nextPage = page, nextQ = q) {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        q: nextQ,
        sort,
        favorite: favorite ? '1' : '',
        page: String(nextPage),
        page_size: '48',
      });
      if (category) query.set('category', category);
      if (boundFilter === 'bound') query.set('store_bound', '1');
      if (boundFilter === 'general') query.set('store_bound', '0');
      const [cats, list, recentList] = await Promise.all([
        api<{ items: { id: string; name: string }[] }>('/api/www/categories'),
        api<{ items: Tool[]; __page?: PageMeta }>(`/api/www/tools?${query.toString()}`),
        api<{ items: Tool[] }>('/api/www/tools/recent'),
      ]);
      setCategories(cats.items);
      setTools(list.items);
      setRecent(recentList.items);
      if (list.__page) setPageMeta(list.__page);
      else setPageMeta({ page: nextPage, page_size: 48, total: list.items.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(page, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, favorite, sort, page, boundFilter]);

  function applySearch() {
    setQ(draftQ);
    setPage(1);
    void load(1, draftQ);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-moss">能力目录</p>
          <h1 className="font-display text-4xl md:text-5xl">挑一项立刻跑</h1>
          <p className="mt-2 text-sm text-ink/60">
            共 {pageMeta.total || tools.length} 项 · 点选使用，成功后按积分扣费
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-full border border-line bg-white">
            <input
              className="w-52 bg-transparent px-4 py-2 text-sm outline-none md:w-72"
              placeholder="搜索名称、关键词、平台…"
              value={draftQ}
              onChange={(event) => setDraftQ(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && applySearch()}
            />
            <button className="bg-ink px-4 text-sm text-paper" onClick={applySearch}>
              搜索
            </button>
          </div>
          <select className="w-auto shrink-0 rounded-full border border-line bg-white px-3 py-2 text-sm outline-none ring-clay/30 focus:ring-2" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            <option value="newest">最新上架</option>
            <option value="price">积分从低到高</option>
          </select>
          <button className={`btn ${favorite ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setFavorite((v) => !v); setPage(1); }}>
            {favorite ? '★ 收藏中' : '☆ 只看收藏'}
          </button>
          <div className="flex rounded-full border border-line bg-white p-1 text-xs">
            <button className={`rounded-full px-3 py-1 ${view === 'grid' ? 'bg-ink text-paper' : ''}`} onClick={() => setView('grid')}>卡片</button>
            <button className={`rounded-full px-3 py-1 ${view === 'list' ? 'bg-ink text-paper' : ''}`} onClick={() => setView('list')}>列表</button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2 overflow-auto pb-1 text-sm">
        <button
          className={`shrink-0 rounded-full px-3 py-1.5 ${category === '' ? 'bg-moss text-white' : 'bg-white ring-1 ring-line'}`}
          onClick={() => { setCategory(''); setPage(1); }}
        >
          全部
        </button>
        {categories.map((item) => (
          <button
            key={item.id}
            className={`shrink-0 rounded-full px-3 py-1.5 ${category === item.id ? 'bg-moss text-white' : 'bg-white ring-1 ring-line'}`}
            onClick={() => { setCategory(item.id); setPage(1); }}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2 overflow-auto pb-1 text-xs">
        {([
          ['all', '全部能力'],
          ['bound', '需绑店'],
          ['general', '通用'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`shrink-0 rounded-full px-3 py-1 ${boundFilter === key ? 'bg-ink text-paper' : 'bg-white ring-1 ring-line text-ink/70'}`}
            onClick={() => { setBoundFilter(key); setPage(1); }}
          >
            {label}
          </button>
        ))}
        <Link href="/stores" className="shrink-0 rounded-full bg-white px-3 py-1 text-moss ring-1 ring-line">
          从店铺进入 →
        </Link>
      </div>

      {recent.length ? (
        <div className="mt-6">
          <p className="text-sm text-ink/50">最近使用</p>
          <div className="mt-2 flex gap-2 overflow-auto">
            {recent.map((tool) => (
              <button
                key={tool.key}
                className="card shrink-0 px-3 py-2 text-left text-sm hover:border-ink"
                onClick={() => setDrawer(tool)}
              >
                <span className="block font-medium">{tool.name}</span>
                <span className="text-xs text-ink/50">{tool.pricing_credits} 积分</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-40 animate-pulse bg-white/70 p-5" />
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-8 text-sm text-clay">{error}</p> : null}

      {!loading && tools.length === 0 ? (
        <div className="card mt-8 p-10 text-center">
          <p className="text-lg">没有匹配的能力</p>
          <p className="mt-2 text-sm text-ink/55">换个关键词，或清空筛选后再看</p>
          <button
            className="btn btn-ghost mt-4"
            onClick={() => {
              setDraftQ('');
              setQ('');
              setFavorite(false);
              setCategory('');
              setPage(1);
              void load(1, '');
            }}
          >
            清空筛选
          </button>
        </div>
      ) : null}

      {!loading && view === 'grid' ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => (
            <article key={tool.key} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-ink/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-moss">
                    {tool.category?.name || '未分类'}
                    {tool.async ? ' · 异步' : ''}
                    {tool.store_bound ? ' · 需绑店' : ' · 通用'}
                  </p>
                  <h2 className="mt-1 truncate text-xl font-medium">{tool.name}</h2>
                </div>
                <button
                  className="text-xl leading-none text-ink/40 hover:text-moss"
                  onClick={async () => {
                    const method = tool.favored ? 'DELETE' : 'POST';
                    await api(`/api/www/tools/${tool.key}/favorite`, { method });
                    setTools((rows) => rows.map((row) => (row.key === tool.key ? { ...row, favored: !row.favored } : row)));
                  }}
                  aria-label="收藏"
                >
                  {tool.favored ? '★' : '☆'}
                </button>
              </div>
              <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-ink/70">{tool.summary}</p>
              {tool.deprecated ? <p className="mt-2 text-xs text-clay">即将下线</p> : null}
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="rounded-full bg-paper px-2.5 py-1 text-sm">{tool.pricing_credits} 积分</span>
                <button className="btn btn-primary" onClick={() => setDrawer(tool)}>
                  使用
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && view === 'list' ? (
        <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-card">
          {tools.map((tool, idx) => (
            <div
              key={tool.key}
              className={`flex flex-wrap items-center gap-3 px-4 py-3 md:flex-nowrap ${idx ? 'border-t border-line/80' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-medium">{tool.name}</h2>
                  <span className="shrink-0 text-xs text-moss">{tool.category?.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${tool.store_bound ? 'bg-clay/10 text-clay' : 'bg-paper text-ink/50'}`}>
                    {tool.store_bound ? '需绑店' : '通用'}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-1 text-sm text-ink/60">{tool.summary}</p>
              </div>
              <span className="text-sm">{tool.pricing_credits} 积分</span>
              <button
                className="text-lg"
                onClick={async () => {
                  const method = tool.favored ? 'DELETE' : 'POST';
                  await api(`/api/www/tools/${tool.key}/favorite`, { method });
                  setTools((rows) => rows.map((row) => (row.key === tool.key ? { ...row, favored: !row.favored } : row)));
                }}
              >
                {tool.favored ? '★' : '☆'}
              </button>
              <button className="btn btn-primary" onClick={() => setDrawer(tool)}>
                使用
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && pageMeta.total > pageMeta.page_size ? (
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-sm text-ink/50">
            第 {pageMeta.page} / {totalPages} 页
          </p>
          <div className="flex gap-2">
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              上一页
            </button>
            <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              下一页
            </button>
          </div>
        </div>
      ) : null}

      {drawer ? (
        hasToolForm(drawer.key) ? (
          <ToolRunner
            toolKey={drawer.key}
            onClose={() => {
              setDrawer(null);
              void load(page, q);
            }}
          />
        ) : (
          <InvokeDrawer
            toolKey={drawer.key}
            name={drawer.name}
            price={drawer.pricing_credits}
            summary={drawer.summary}
            storeBound={Boolean(drawer.store_bound)}
            schema={drawer.schema as { required?: string[]; properties?: Record<string, { type?: string; title?: string; enum?: string[]; format?: string; 'x-file'?: boolean; default?: unknown; description?: string }>; 'x-fill-status'?: string }}
            onClose={() => {
              setDrawer(null);
              void load(page, q);
            }}
          />
        )
      ) : null}
    </div>
  );
}
