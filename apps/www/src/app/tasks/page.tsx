'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Task = { id: string; type: string; status: string; progress: number; created_at: string };

export default function TasksPage() {
  const [items, setItems] = useState<Task[]>([]);
  async function load() {
    const data = await api<{ items: Task[] }>('/api/www/tasks');
    setItems(data.items);
  }
  useEffect(() => {
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div>
      <h1 className="font-display text-4xl">任务</h1>
      {items.length === 0 ? (
        <div className="card mt-6 p-8 text-center">
          <p>暂无任务。生视频或导出完成后会出现在这里</p>
          <Link className="btn btn-primary mt-3" href="/agents">去助手</Link>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((task) => (
            <Link key={task.id} href={`/tasks/${task.id}`} className="card flex items-center justify-between p-4 text-sm">
              <span>{task.type} · {task.status}</span>
              <span>{task.progress}%</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
