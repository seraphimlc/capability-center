'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Tool = { id: string; key: string; name: string; status: string; pricingCredits: number; summary: string };

export default function ToolsPage() {
  const [items, setItems] = useState<Tool[]>([]);
  const [note, setNote] = useState('');
  async function load() {
    const data = await api<{ items: Tool[] }>('/api/admin/tools');
    setItems(data.items);
  }
  useEffect(() => { void load(); }, []);
  return (
    <div>
      <h1 className="text-3xl">能力</h1>
      <p className="mt-2 text-sm text-ink/60">演示数据已上架。可在这里下架，用户目录会立刻看不到。</p>
      {note ? <p className="mt-2 text-sm">{note}</p> : null}
      <div className="mt-4 space-y-2">
        {items.map((tool) => (
          <article key={tool.id} className="card flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <div>
              <strong>{tool.name}</strong>
              <span className="ml-2 text-ink/50">{tool.key} · {tool.pricingCredits} 积分 · {tool.status}</span>
              <p>{tool.summary}</p>
            </div>
            <button className="btn btn-ghost" onClick={async () => {
              const status = tool.status === 'published' ? 'unpublished' : 'published';
              await api(`/api/admin/tools/${tool.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
              setNote(`${tool.name} 已设为 ${status}`);
              await load();
            }}>{tool.status === 'published' ? '下架' : '上架'}</button>
          </article>
        ))}
      </div>
    </div>
  );
}
