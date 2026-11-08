'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';

type User = { id: string; email: string; display_name: string; role: string; status: string; balance: number };

export default function UsersPage() {
  const [items, setItems] = useState<User[]>([]);
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState(200);
  const [reason, setReason] = useState('演示充值');
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [ledger, setLedger] = useState<{ id: string; amount: number; note?: string; type: string }[]>([]);

  async function load() {
    const data = await api<{ items: User[] }>('/api/admin/users');
    setItems(data.items);
    if (!userId && data.items[0]) setUserId(data.items.find((item) => item.role === 'end_user')?.id || data.items[0].id);
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!userId) return;
    api<{ items: typeof ledger }>(`/api/admin/ledger?user_id=${userId}`).then((data) => setLedger(data.items)).catch(() => undefined);
  }, [userId, note]);

  async function grant(event: FormEvent) {
    event.preventDefault();
    if (!confirm) return setNote('请勾选确认');
    try {
      const result = await api<{ balance: number }>('/api/admin/wallet/grant', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ user_id: userId, amount, reason }),
      });
      setNote(`已充值，余额 ${result.balance}`);
      setConfirm(false);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : '充值失败');
    }
  }

  return (
    <div>
      <h1 className="text-3xl">用户与充值</h1>
      <form className="card mt-4 grid gap-3 p-4 md:grid-cols-4" onSubmit={grant}>
        <select className="field" value={userId} onChange={(event) => setUserId(event.target.value)}>
          {items.map((user) => <option key={user.id} value={user.id}>{user.email} · {user.balance}</option>)}
        </select>
        <input className="field" type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
        <input className="field" value={reason} onChange={(event) => setReason(event.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />确认充值</label>
        <button className="btn btn-primary md:col-span-4">充值</button>
      </form>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
      <table className="mt-4 w-full text-left text-sm">
        <thead><tr className="text-ink/50"><th>邮箱</th><th>角色</th><th>状态</th><th>余额</th><th></th></tr></thead>
        <tbody>
          {items.map((user) => (
            <tr key={user.id} className="border-t border-line">
              <td className="py-2">{user.display_name}<span className="block text-xs text-ink/50">{user.email}</span></td>
              <td>{user.role}</td>
              <td>{user.status}</td>
              <td>{user.balance}</td>
              <td>
                <button className="text-xs underline" onClick={async () => {
                  await api(`/api/admin/users/${user.id}/status`, { method: 'POST', body: JSON.stringify({ status: user.status === 'active' ? 'disabled' : 'active' }) });
                  await load();
                }}>{user.status === 'active' ? '禁用' : '启用'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mt-6 text-lg">流水</h2>
      {ledger.length === 0 ? <p className="text-sm text-ink/50">这个用户还没有流水</p> : (
        <ul className="mt-2 text-sm">{ledger.map((row) => <li key={row.id}>{row.type} {row.amount} {row.note}</li>)}</ul>
      )}
    </div>
  );
}
