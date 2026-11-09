'use client';

import { FormEvent, useState } from 'react';
import type { ToolFormProps } from '../types';
import { Field } from '../ui';

const COUNTRIES: [string, string][] = [
  ['US', '美国'],
  ['EU', '欧盟'],
  ['GB', '英国'],
  ['CA', '加拿大'],
  ['JP', '日本'],
  ['VN', '越南'],
];

export function TrademarkSimilarForm({ run, running }: ToolFormProps) {
  const [keyword, setKeyword] = useState('');
  const [countries, setCountries] = useState<string[]>(['US']);
  const [classes, setClasses] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');

  function toggle(code: string) {
    setCountries((prev) => (prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code]));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = keyword.trim();
    if (!name) return setError('请填写要检索的商标名称。');
    if (!countries.length) return setError('请至少选择一个国家或地区。');
    if ((start && !end) || (!start && end)) return setError('申请日期需要同时填写开始和结束。');
    const categoryNumbers = classes
      .split(/[\s,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setError('');
    run({
      keyword: name,
      countries,
      page_size: pageSize,
      ...(categoryNumbers.length ? { category_numbers: categoryNumbers } : {}),
      ...(start && end ? { apply_date_start: start, apply_date_end: end } : {}),
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="商标名称" hint="按文字查询字形、读音或含义近似的商标，支持 * 通配符（例如 *GLOW、GLOW.*）。" required>
        <input
          className="field"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="例如 CAMPING"
          autoFocus
        />
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium">
          国家 / 地区
          <span className="ml-2 text-xs font-normal text-ink/50">可多选，默认美国</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {COUNTRIES.map(([code, label]) => {
            const active = countries.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => toggle(code)}
                className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-ink bg-ink text-paper' : 'border-line bg-white text-ink/70'}`}
              >
                {label}
                <span className="ml-1 text-xs opacity-60">{code}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="尼斯分类" hint="可选，多个用逗号分隔，例如 9, 11, 28。">
          <input className="field" value={classes} onChange={(event) => setClasses(event.target.value)} placeholder="11" />
        </Field>
        <Field label="每页数量" hint="结果越多等待越久，建议先看 10 条。">
          <select className="field" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {[10, 20, 30, 50].map((size) => (
              <option key={size} value={size}>
                {size} 条
              </option>
            ))}
          </select>
        </Field>
      </div>

      <details className="rounded-xl border border-line bg-white/60 px-3 py-2">
        <summary className="cursor-pointer text-sm text-ink/60">更多条件（申请日期）</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="申请日期起">
            <input className="field" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </Field>
          <Field label="申请日期止">
            <input className="field" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </Field>
        </div>
      </details>

      {error ? <p className="rounded-xl bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p> : null}

      <button className="btn btn-primary w-full" type="submit" disabled={running}>
        {running ? '查询中…' : '开始检索'}
      </button>
      <p className="text-xs leading-5 text-ink/45">
        只检索当前条件下的候选记录，不代表可以注册或不存在侵权风险，不构成法律意见。
      </p>
    </form>
  );
}
