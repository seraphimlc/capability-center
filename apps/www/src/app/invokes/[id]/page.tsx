'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';

export default function InvokeDetailPage() {
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    api<Record<string, unknown>>(`/api/www/invokes/${params.id}`).then(setRow).catch((err) => setNote(err.message));
  }, [params.id]);

  async function ticket(event: FormEvent) {
    event.preventDefault();
    const created = await api<{ id: string }>('/api/www/adjustment-tickets', {
      method: 'POST',
      body: JSON.stringify({ invoke_id: params.id, reason }),
    });
    setNote(`已提交调账申请 ${created.id}`);
  }

  if (!row) return <p className="text-sm">{note || '加载中…'}</p>;
  return (
    <div>
      <Link href="/invokes" className="text-sm underline">返回记录</Link>
      <h1 className="mt-2 font-display text-4xl">{String(row.tool_key)}</h1>
      <p className="mt-2 text-sm text-ink/60">状态 {String(row.status)} · 积分 {String(row.credits)} · 问题编号 {String(row.request_id || '')}</p>
      {row.conversation_id ? <Link className="mt-2 inline-block text-sm underline" href={`/chat/${row.conversation_id}`}>回到会话</Link> : null}
      <pre className="card mt-4 overflow-auto p-4 text-xs">{JSON.stringify(row, null, 2)}</pre>
      <form className="mt-4 flex gap-2" onSubmit={ticket}>
        <input className="field" placeholder="对这笔调用有异议？写下原因" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button className="btn btn-ghost">申请调账</button>
      </form>
      {note ? <p className="mt-2 text-sm">{note}</p> : null}
    </div>
  );
}
