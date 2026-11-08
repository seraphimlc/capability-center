'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';

type KeyRow = { id: string; name: string; env: string; prefix: string; status: string; scopes: string[] };

export default function KeysPage() {
  const [items, setItems] = useState<KeyRow[]>([]);
  const [mcp, setMcp] = useState<{ url: string; note: string } | null>(null);
  const [name, setName] = useState('WorkBuddy');
  const [fresh, setFresh] = useState('');

  async function load() {
    const data = await api<{ items: KeyRow[]; mcp: { url: string; note: string } }>('/api/www/open/keys');
    setItems(data.items);
    setMcp(data.mcp);
  }
  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    const data = await api<{ token: string }>('/api/www/open/keys', {
      method: 'POST',
      body: JSON.stringify({ name, env: 'sandbox', scopes: ['tools:read', 'tools:invoke', 'wallet:read'] }),
    });
    setFresh(data.token);
    await load();
  }

  const origin = typeof window === 'undefined' ? 'http://api.localhost:8890' : `${window.location.protocol}//${window.location.hostname}:8890`;

  return (
    <div>
      <h1 className="font-display text-4xl">开放接入</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink/70">外部工作台通过 MCP 调用与你同一套能力和钱包。密钥只在创建时完整显示一次。</p>
      <form className="mt-4 flex gap-2" onSubmit={create}>
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
        <button className="btn btn-primary">创建密钥</button>
      </form>
      {fresh ? <p className="mt-3 break-all rounded-xl bg-amber-50 p-3 text-sm">请立即复制：{fresh}</p> : null}
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="card flex items-center justify-between p-3 text-sm">
            <span>{item.name} · {item.env} · {item.prefix}… · {item.status}</span>
            {item.status === 'active' ? <button className="text-clay" onClick={async () => { await api(`/api/www/open/keys/${item.id}/revoke`, { method: 'POST' }); await load(); }}>吊销</button> : null}
          </div>
        ))}
      </div>
      <section className="card mt-6 p-5 text-sm">
        <h2 className="text-lg">WorkBuddy / MCP</h2>
        <p className="mt-2">{mcp?.note}</p>
        <pre className="mt-3 overflow-auto rounded-xl bg-ink p-3 text-xs text-paper">{JSON.stringify({
          mcpServers: {
            capabilityCenter: {
              url: `${origin}/mcp`,
              transport: 'streamableHttp',
              headers: { Authorization: 'Bearer <你的密钥>' },
            },
          },
        }, null, 2)}</pre>
      </section>
    </div>
  );
}
