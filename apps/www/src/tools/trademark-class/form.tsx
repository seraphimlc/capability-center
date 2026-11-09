'use client';

import { FormEvent, useState } from 'react';
import type { ToolFormProps } from '../types';
import { Field } from '../ui';

export function TrademarkClassForm({ run, running }: ToolFormProps) {
  const [mode, setMode] = useState<'number' | 'name'>('number');
  const [number, setNumber] = useState('11');
  const [name, setName] = useState('');
  const [limit, setLimit] = useState(10);
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'number' && !number.trim()) return setError('请填写分类号。');
    if (mode === 'name' && !name.trim()) return setError('请填写商品或服务关键词。');
    setError('');
    run({
      country_code: 'US',
      page: 1,
      limit,
      ...(mode === 'number' ? { category_number: number.trim() } : { category_name: name.trim() }),
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="flex rounded-full border border-line bg-white p-1 text-sm">
        <button
          type="button"
          className={`flex-1 rounded-full px-3 py-1.5 ${mode === 'number' ? 'bg-ink text-paper' : 'text-ink/60'}`}
          onClick={() => setMode('number')}
        >
          按分类号
        </button>
        <button
          type="button"
          className={`flex-1 rounded-full px-3 py-1.5 ${mode === 'name' ? 'bg-ink text-paper' : 'text-ink/60'}`}
          onClick={() => setMode('name')}
        >
          按商品 / 服务
        </button>
      </div>

      {mode === 'number' ? (
        <Field label="尼斯分类号" hint="1–45，例如露营灯通常在 11 类；灯具配件可能涉及 9 类。" required>
          <input className="field" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="11" autoFocus />
        </Field>
      ) : (
        <Field label="商品 / 服务关键词" hint="用英文或中文描述，例如 camping lantern、服装。" required>
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="camping lantern" autoFocus />
        </Field>
      )}

      <Field label="每页小类数量">
        <select className="field" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
          {[5, 10, 20, 30, 50].map((size) => (
            <option key={size} value={size}>
              {size} 条
            </option>
          ))}
        </select>
      </Field>

      {error ? <p className="rounded-xl bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p> : null}

      <button className="btn btn-primary w-full" type="submit" disabled={running}>
        {running ? '查询中…' : '查询分类'}
      </button>
      <p className="text-xs leading-5 text-ink/45">分类结果仅作参考，正式申请前建议由代理机构复核。</p>
    </form>
  );
}
