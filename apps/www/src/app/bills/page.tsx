'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Bill = { period: string; grant: number; consume: number; adjust: number; refund: number };

export default function BillsPage() {
  const [items, setItems] = useState<Bill[]>([]);
  useEffect(() => {
    api<{ items: Bill[] }>('/api/www/bills').then((data) => setItems(data.items));
  }, []);
  return (
    <div>
      <h1 className="font-display text-4xl">我的账单</h1>
      <p className="mt-2 text-sm text-ink/60">账期按 Asia/Shanghai 自然月。金额为积分，口径人民币。</p>
      {items.length === 0 ? <p className="card mt-6 p-8 text-center">本月暂无账单数据</p> : (
        <div className="mt-4 space-y-3">
          {items.map((bill) => (
            <article key={bill.period} className="card grid grid-cols-2 gap-2 p-4 text-sm md:grid-cols-5">
              <strong>{bill.period}</strong>
              <span>充值 {bill.grant}</span>
              <span>消耗 {bill.consume}</span>
              <span>调账 {bill.adjust}</span>
              <span>退款 {bill.refund}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
