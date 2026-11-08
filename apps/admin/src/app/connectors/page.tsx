'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Row = { id: string; name: string; type: string; status: string; config: Record<string, unknown> };

export default function ConnectorsPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => { api<{ items: Row[] }>('/api/admin/connectors').then((data) => setItems(data.items)); }, []);
  return (
    <div>
      <h1 className="text-3xl">连接器</h1>
      <p className="mt-2 text-sm text-ink/60">终端用户看不到连接器类型。探活失败时只返回白标提示。</p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <article key={item.id} className="card p-4 text-sm">
            <div className="flex justify-between"><strong>{item.name}</strong><span>{item.type} · {item.status}</span></div>
            <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(item.config, null, 2)}</pre>
            <button className="btn btn-ghost mt-2" onClick={async () => {
              try {
                const result = await api<{ message?: string; ok: boolean }>(`/api/admin/connectors/${item.id}/probe`, { method: 'POST' });
                setNote(result.message || (result.ok ? '探活通过' : '探活失败'));
              } catch (err) {
                setNote(err instanceof Error ? err.message : '探活失败');
              }
            }}>测试连接</button>
          </article>
        ))}
      </div>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
    </div>
  );
}
