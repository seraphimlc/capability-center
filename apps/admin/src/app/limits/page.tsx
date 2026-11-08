'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Rule = { scope: string; limit: number; windowSec: number; enabled: boolean };

export default function LimitsPage() {
  const [items, setItems] = useState<Rule[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => { api<{ items: Rule[] }>('/api/admin/rate-limits').then((data) => setItems(data.items)); }, []);
  return (
    <div>
      <h1 className="text-3xl">限流</h1>
      <div className="mt-4 space-y-3">
        {items.map((rule) => (
          <form key={rule.scope} className="card grid gap-2 p-4 text-sm md:grid-cols-4" onSubmit={async (event) => {
            event.preventDefault();
            await api(`/api/admin/rate-limits/${rule.scope}`, { method: 'PUT', body: JSON.stringify({ limit: rule.limit, window_sec: rule.windowSec, enabled: rule.enabled }) });
            setNote(`${rule.scope} 已更新`);
          }}>
            <strong className="self-center">{rule.scope}</strong>
            <input className="field" type="number" value={rule.limit} onChange={(event) => setItems(items.map((item) => item.scope === rule.scope ? { ...item, limit: Number(event.target.value) } : item))} />
            <input className="field" type="number" value={rule.windowSec} onChange={(event) => setItems(items.map((item) => item.scope === rule.scope ? { ...item, windowSec: Number(event.target.value) } : item))} />
            <button className="btn btn-primary">保存</button>
          </form>
        ))}
      </div>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
    </div>
  );
}
