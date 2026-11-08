'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Row = { id: string; tool_key: string; source: string; status: string; credits: number; created_at: string; error_code?: string };

export default function InvokesPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const query = status ? `?status=${status}` : '';
    api<{ items: Row[] }>(`/api/www/invokes${query}`).then((data) => setItems(data.items)).catch((err) => setError(err.message));
  }, [status]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">调用记录</h1>
        <select className="field w-auto" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
          <option value="running">进行中</option>
          <option value="cancelled">已取消</option>
        </select>
      </div>
      {error ? <p className="mt-4 text-clay">{error}</p> : null}
      {items.length === 0 ? (
        <div className="card mt-6 p-8 text-center">
          <p>还没有调用记录。去能力目录试试第一次运行</p>
          <Link className="btn btn-primary mt-3" href="/">去目录</Link>
        </div>
      ) : (
        <div className="mt-4 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink/50"><tr><th className="py-2">时间</th><th>能力</th><th>来源</th><th>状态</th><th>积分</th></tr></thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="py-2">{new Date(row.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
                  <td><Link className="underline" href={`/invokes/${row.id}`}>{row.tool_key}</Link></td>
                  <td>{row.source}</td>
                  <td>{row.status}</td>
                  <td>{row.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
