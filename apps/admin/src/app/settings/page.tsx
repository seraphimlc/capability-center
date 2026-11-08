'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function SettingsPage() {
  const [flags, setFlags] = useState<{ key: string; value: string }[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [announcements, setAnnouncements] = useState<{ id: string; title: string; body: string }[]>([]);
  const [note, setNote] = useState('');

  async function load() {
    setFlags((await api<{ items: { key: string; value: string }[] }>('/api/admin/settings/flags')).items);
    setAnnouncements((await api<{ items: { id: string; title: string; body: string }[] }>('/api/admin/announcements')).items);
  }
  useEffect(() => { void load(); }, []);

  async function publish(event: FormEvent) {
    event.preventDefault();
    await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ title, body }) });
    setTitle('');
    setBody('');
    await load();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h1 className="text-3xl">系统设置</h1>
        <div className="mt-4 space-y-2">
          {flags.map((flag) => (
            <form key={flag.key} className="card flex gap-2 p-3 text-sm" onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api(`/api/admin/settings/flags/${flag.key}`, { method: 'PUT', body: JSON.stringify({ value: flag.value }) });
                setNote(`${flag.key} 已保存`);
              } catch (err) {
                setNote(err instanceof Error ? err.message : '只有超管可以改开关');
              }
            }}>
              <span className="w-40 shrink-0 self-center">{flag.key}</span>
              <input className="field" value={flag.value} onChange={(event) => setFlags(flags.map((item) => item.key === flag.key ? { ...item, value: event.target.value } : item))} />
              <button className="btn btn-ghost">保存</button>
            </form>
          ))}
        </div>
        {note ? <p className="mt-2 text-sm">{note}</p> : null}
      </section>
      <section>
        <h2 className="text-xl">公告</h2>
        <form className="mt-3 space-y-2" onSubmit={publish}>
          <input className="field" placeholder="标题" value={title} onChange={(event) => setTitle(event.target.value)} />
          <textarea className="field min-h-24" placeholder="正文" value={body} onChange={(event) => setBody(event.target.value)} />
          <button className="btn btn-primary">发布</button>
        </form>
        <div className="mt-4 space-y-2">
          {announcements.map((item) => (
            <article key={item.id} className="card p-3 text-sm"><strong>{item.title}</strong><p>{item.body}</p></article>
          ))}
        </div>
      </section>
    </div>
  );
}
