'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { InvokeDrawer } from '../../../components/invoke-drawer';
import { api, type ApiError } from '../../../lib/api';

type Shop = {
  id: string;
  platform: string;
  platform_name: string;
  name: string;
  marketplace: string | null;
  status: string;
  capabilities: string[];
};

type Category = { id: string; name: string; slug?: string };

type Agent = { key: string; name: string; summary: string; tool_count: number; unbound?: boolean; platforms?: string[] };

type Tool = {
  key: string;
  name: string;
  summary: string;
  pricing_credits: number;
  category: Category | null;
  schema: Record<string, unknown>;
  store_bound?: boolean;
  platforms?: string[];
  async?: boolean;
};

export default function StoreWorkspacePage() {
  const params = useParams<{ id: string }>();
  const [shop, setShop] = useState<Shop | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState<Tool | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const routerPush = (href: string) => { window.location.href = href; };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const shopRes = await api<Shop>(`/api/www/shops/${params.id}`);
        if (cancelled) return;
        setShop(shopRes);
        const query = new URLSearchParams({
          for_store_platform: shopRes.platform,
          page_size: '200',
          sort: 'newest',
        });
        const [cats, list] = await Promise.all([
          api<{ items: Category[] }>('/api/www/categories'),
          api<{ items: Tool[] }>(`/api/www/tools?${query.toString()}`),
        ]);
        if (cancelled) return;
        setCategories(cats.items);
        setTools(list.items);
        try {
          const agentRes = await api<{ items: Agent[] }>(`/api/www/agents?platform=${encodeURIComponent(shopRes.platform)}`);
          if (!cancelled) setAgents(agentRes.items || []);
        } catch {
          if (!cancelled) setAgents([]);
        }
      } catch (err) {
        if (!cancelled) setError((err as ApiError).message || '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const filtered = useMemo(() => {
    if (!category) return tools;
    return tools.filter((t) => t.category?.id === category);
  }, [tools, category]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tools) {
      const id = t.category?.id || '';
      map.set(id, (map.get(id) || 0) + 1);
    }
    return map;
  }, [tools]);

  if (error) {
    return (
      <div className="card p-8">
        <p className="text-clay">{error}</p>
        <Link href="/stores" className="btn btn-ghost mt-4">
          返回店铺列表
        </Link>
      </div>
    );
  }

  if (loading || !shop) {
    return <p className="text-sm text-ink/50">正在打开店铺工作台…</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-moss">店铺工作台</p>
          <h1 className="mt-1 font-display text-3xl">{shop.name}</h1>
          <p className="mt-2 text-sm text-ink/65">
            {shop.platform_name}
            {shop.marketplace ? ` · ${shop.marketplace}` : ''}
            {' · '}
            状态 {shop.status === 'connected' ? '已连接' : shop.status}
            {' · '}
            相关能力 {tools.length} 项（需绑店 + 本平台）
          </p>
          <p className="mt-1 text-xs text-ink/45">能力：{(shop.capabilities || []).join(' / ') || '通用'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/stores" className="btn btn-ghost">
            全部店铺
          </Link>
          <Link href="/" className="btn btn-ghost">
            能力目录
          </Link>
        </div>
      </header>

      {agents.length ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-moss">本店助手</p>
              <h2 className="mt-1 text-xl font-medium">和懂这家店的助手直接聊</h2>
              <p className="mt-1 text-sm text-ink/60">会话里可调用本平台相关能力；需绑店时默认用当前店铺。</p>
            </div>
            <Link href="/agents" className="btn btn-ghost">全部助手</Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {agents.map((agent) => (
              <article key={agent.key} className="rounded-2xl border border-line bg-paper/60 p-4">
                <h3 className="text-lg font-medium">{agent.name}</h3>
                <p className="mt-1 text-sm text-ink/70">{agent.summary}</p>
                <p className="mt-2 text-xs text-ink/45">{agent.tool_count} 个能力</p>
                <button
                  className="btn btn-primary mt-3"
                  onClick={async () => {
                    const created = await api<{ id: string }>('/api/www/conversations', {
                      method: 'POST',
                      body: JSON.stringify({ agent_key: agent.key }),
                    });
                    routerPush(`/chat/${created.id}`);
                  }}
                >
                  开始会话
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {shop.status !== 'connected' ? (
        <p className="rounded-xl bg-amber-100 px-4 py-2 text-sm">当前店铺未连接，请先回列表校验连接后再使用需绑店能力。</p>
      ) : null}

      <div className="flex gap-2 overflow-auto pb-1 text-sm">
        <button
          className={`shrink-0 rounded-full px-3 py-1.5 ${category === '' ? 'bg-moss text-white' : 'bg-white ring-1 ring-line'}`}
          onClick={() => setCategory('')}
        >
          全部 ({tools.length})
        </button>
        {categories
          .filter((c) => (counts.get(c.id) || 0) > 0)
          .map((item) => (
            <button
              key={item.id}
              className={`shrink-0 rounded-full px-3 py-1.5 ${category === item.id ? 'bg-moss text-white' : 'bg-white ring-1 ring-line'}`}
              onClick={() => setCategory(item.id)}
            >
              {item.name} ({counts.get(item.id) || 0})
            </button>
          ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg">这个店暂时没有匹配的能力</p>
          <p className="mt-2 text-sm text-ink/55">可去能力目录查看通用能力，或换一家已对接店铺。</p>
          <Link href="/" className="btn btn-ghost mt-4">
            去目录
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((tool) => (
            <article key={tool.key} className="card flex flex-col p-5">
              <p className="text-xs text-moss">
                {tool.category?.name || '未分类'}
                {tool.store_bound ? ' · 需绑店' : ' · 本平台相关'}
                {tool.async ? ' · 异步' : ''}
              </p>
              <h2 className="mt-1 text-xl font-medium">{tool.name}</h2>
              <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-ink/70">{tool.summary}</p>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="rounded-full bg-paper px-2.5 py-1 text-sm">{tool.pricing_credits} 积分</span>
                <button className="btn btn-primary" onClick={() => setDrawer(tool)}>
                  使用
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {drawer ? (
        <InvokeDrawer
          toolKey={drawer.key}
          name={drawer.name}
          price={drawer.pricing_credits}
          summary={drawer.summary}
          storeBound={Boolean(drawer.store_bound)}
          initialStoreId={shop.id}
          lockStore
          schema={
            drawer.schema as {
              required?: string[];
              properties?: Record<
                string,
                { type?: string; title?: string; enum?: string[]; format?: string; 'x-file'?: boolean; default?: unknown; description?: string }
              >;
              'x-fill-status'?: string;
            }
          }
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  );
}
