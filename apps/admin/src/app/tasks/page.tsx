'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Task = { id: string; type: string; status: string; progress: number; error_code?: string };

export default function AdminTasksPage() {
  const [items, setItems] = useState<Task[]>([]);
  async function load() {
    const data = await api<{ items: Task[] }>('/api/admin/tasks');
    setItems(data.items);
  }
  useEffect(() => { void load(); const timer = setInterval(load, 4000); return () => clearInterval(timer); }, []);
  return (
    <div>
      <h1 className="text-3xl">任务监管</h1>
      {items.length === 0 ? <p className="mt-4 text-sm text-ink/50">暂无异步任务</p> : null}
      <div className="mt-4 space-y-2">
        {items.map((task) => (
          <article key={task.id} className="card flex items-center justify-between p-3 text-sm">
            <span>{task.type} · {task.status} · {task.progress}% {task.error_code || ''}</span>
            {task.status === 'failed' ? <button className="btn btn-ghost" onClick={async () => { await api(`/api/admin/tasks/${task.id}/retry`, { method: 'POST' }); await load(); }}>重试</button> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
