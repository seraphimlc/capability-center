'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Note = { id: string; title: string; body: string; read: boolean; created_at: string };

export default function InboxPage() {
  const [items, setItems] = useState<Note[]>([]);
  async function load() {
    const data = await api<{ items: Note[] }>('/api/www/notifications');
    setItems(data.items);
  }
  useEffect(() => { void load(); }, []);
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">消息</h1>
        <button className="btn btn-ghost" onClick={async () => { await api('/api/www/notifications/read-all', { method: 'POST' }); await load(); }}>全部已读</button>
      </div>
      {items.length === 0 ? <p className="card mt-6 p-8 text-center">暂无消息</p> : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <article key={item.id} className="card p-4">
              <div className="flex justify-between text-sm">
                <strong>{item.title}</strong>
                <span className="text-ink/40">{item.read ? '已读' : '未读'}</span>
              </div>
              <p className="mt-2 text-sm text-ink/75">{item.body}</p>
              {!item.read ? <button className="mt-2 text-xs underline" onClick={async () => { await api(`/api/www/notifications/${item.id}/read`, { method: 'POST' }); await load(); }}>标为已读</button> : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
