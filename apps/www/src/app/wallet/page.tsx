'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function WalletPage() {
  const [wallet, setWallet] = useState<{ balance: number; held: number; available: number; currency: string } | null>(null);
  const [items, setItems] = useState<{ id: string; type: string; amount: number; balance_after: number; note?: string; created_at: string }[]>([]);

  useEffect(() => {
    api<typeof wallet>('/api/www/wallet').then((data) => setWallet(data));
    api<{ items: typeof items }>('/api/www/wallet/ledger').then((data) => setItems(data.items));
  }, []);

  return (
    <div>
      <h1 className="font-display text-4xl">我的钱包</h1>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="card p-4"><p className="text-sm text-ink/50">可用</p><p className="text-3xl">{wallet?.available ?? '—'}</p></div>
        <div className="card p-4"><p className="text-sm text-ink/50">账面余额</p><p className="text-3xl">{wallet?.balance ?? '—'}</p></div>
        <div className="card p-4"><p className="text-sm text-ink/50">预留中</p><p className="text-3xl">{wallet?.held ?? '—'}</p></div>
      </div>
      <p className="mt-3 text-sm text-ink/60">积分按人民币口径记账，不支持多币种。在线支付尚未开通，请联系管理员充值。</p>
      {items.length === 0 ? <p className="card mt-6 p-8 text-center">暂无流水。积分由管理员发放</p> : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="text-ink/50"><tr><th>时间</th><th>类型</th><th>变动</th><th>余额</th><th>备注</th></tr></thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="py-2">{new Date(row.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
                <td>{row.type}</td>
                <td>{row.amount}</td>
                <td>{row.balance_after}</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
