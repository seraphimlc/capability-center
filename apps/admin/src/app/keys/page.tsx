'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type KeyRow = { id: string; name: string; env: string; prefix: string; status: string; user_id: string };

export default function KeysPage() {
  const [items, setItems] = useState<KeyRow[]>([]);
  async function load() { setItems((await api<{ items: KeyRow[] }>('/api/admin/keys')).items); }
  useEffect(() => { void load(); }, []);
  return (
    <div>
      <h1 className="text-3xl">API 密钥</h1>
      <p className="mt-2 text-sm text-ink/60">明文不落库。这里只能看到前缀并吊销。</p>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="card flex justify-between p-3 text-sm">
            <span>{item.name} · {item.env} · {item.prefix} · {item.status}</span>
            {item.status === 'active' ? <button className="text-red-700" onClick={async () => { await api(`/api/admin/keys/${item.id}/revoke`, { method: 'POST' }); await load(); }}>吊销</button> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
