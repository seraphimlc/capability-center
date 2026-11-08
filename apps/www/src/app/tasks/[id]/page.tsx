'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<Record<string, unknown> | null>(null);
  const [note, setNote] = useState('');

  async function load() {
    setTask(await api(`/api/www/tasks/${params.id}`));
  }
  useEffect(() => {
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [params.id]);

  if (!task) return <p>加载任务…</p>;
  return (
    <div>
      <Link href="/tasks" className="text-sm underline">返回任务</Link>
      <h1 className="mt-2 font-display text-4xl">{String(task.type)}</h1>
      <p className="mt-2">状态 {String(task.status)} · 进度 {String(task.progress)}%</p>
      {['pending', 'queued', 'running'].includes(String(task.status)) ? (
        <button className="btn btn-ghost mt-3" onClick={async () => {
          try {
            await api(`/api/www/tasks/${params.id}/cancel`, { method: 'POST' });
            await load();
          } catch (err) {
            setNote(err instanceof Error ? err.message : '无法取消');
          }
        }}>取消任务</button>
      ) : null}
      {note ? <p className="mt-2 text-sm text-clay">{note}</p> : null}
      <pre className="card mt-4 overflow-auto p-4 text-xs">{JSON.stringify(task, null, 2)}</pre>
    </div>
  );
}
