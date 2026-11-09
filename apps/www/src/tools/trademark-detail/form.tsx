'use client';

import { FormEvent, useState } from 'react';
import type { ToolFormProps } from '../types';
import { Field } from '../ui';

export function TrademarkDetailForm({ run, running }: ToolFormProps) {
  const [mode, setMode] = useState<'number' | 'keyword'>('number');
  const [number, setNumber] = useState('');
  const [keyword, setKeyword] = useState('');
  const [country, setCountry] = useState('US');
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'number' && !number.trim()) return setError('请填写申请号或注册号。');
    if (mode === 'keyword' && !keyword.trim()) return setError('请填写商标名称。');
    setError('');
    run(
      mode === 'number'
        ? { trademark_number: number.trim(), country }
        : { keyword: keyword.trim(), country },
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="flex rounded-full border border-line bg-white p-1 text-sm">
        <button
          type="button"
          className={`flex-1 rounded-full px-3 py-1.5 ${mode === 'number' ? 'bg-ink text-paper' : 'text-ink/60'}`}
          onClick={() => setMode('number')}
        >
          按申请号 / 注册号
        </button>
        <button
          type="button"
          className={`flex-1 rounded-full px-3 py-1.5 ${mode === 'keyword' ? 'bg-ink text-paper' : 'text-ink/60'}`}
          onClick={() => setMode('keyword')}
        >
          按商标名称
        </button>
      </div>

      {mode === 'number' ? (
        <Field label="申请号 / 注册号" hint="提供号码时直接返回完整详情，速度比按名称查更快。" required>
          <input
            className="field"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="例如 97175303"
            autoFocus
          />
        </Field>
      ) : (
        <Field label="商标名称" hint="只给名称会返回候选列表；选中申请号后再查完整详情。" required>
          <input
            className="field"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="例如 CAMPING"
            autoFocus
          />
        </Field>
      )}

      <Field label="国家 / 地区" hint="目前详情数据以美国为主。">
        <select className="field" value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="US">美国（US）</option>
        </select>
      </Field>

      {error ? <p className="rounded-xl bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p> : null}

      <button className="btn btn-primary w-full" type="submit" disabled={running}>
        {running ? '查询中…' : '查询详情'}
      </button>
      <p className="text-xs leading-5 text-ink/45">结果来自公开商标数据，不构成法律意见。</p>
    </form>
  );
}
