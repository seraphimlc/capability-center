'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Row = { id: string; action: string; actor_id?: string; target_type: string; target_id?: string; created_at: string; request_id?: string };

export default function AuditPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [diffs, setDiffs] = useState<string>('');
  useEffect(() => { api<{ items: Row[] }>('/api/admin/audit').then((data) => setItems(data.items)); }, []);
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">审计</h1>
        <button className="btn btn-ghost" onClick={async () => {
          const result = await api<{ success_invokes: number; diffs: unknown[] }>('/api/admin/reconciliation/runs', { method: 'POST' });
          setDiffs(`成功调用 ${result.success_invokes}，差异 ${result.diffs.length}`);
        }}>跑一次对账</button>
      </div>
      {diffs ? <p className="mt-2 text-sm">{diffs}</p> : null}
      <table className="mt-4 w-full text-left text-sm">
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="py-2">{new Date(row.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
              <td>{row.action}</td>
              <td>{row.target_type}</td>
              <td className="text-xs text-ink/50">{row.request_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
