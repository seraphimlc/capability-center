import type { ReactNode } from 'react';
import { text } from './data';

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center gap-2 font-medium">
        {label}
        {required ? <span className="rounded bg-clay/10 px-1.5 text-[10px] text-clay">必填</span> : null}
      </span>
      {hint ? <span className="mb-2 block text-xs leading-5 text-ink/55">{hint}</span> : null}
      {children}
    </label>
  );
}

export function StatusPill({ value }: { value: unknown }) {
  const label = text(value) || '未知';
  const tone = /注册|有效|续展|公告/.test(label)
    ? 'bg-moss/10 text-moss'
    : /失效|放弃|撤销|取消|拒绝|驳回/.test(label)
      ? 'bg-clay/10 text-clay'
      : 'bg-amber-100 text-amber-900';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${tone}`}>{label}</span>;
}

export function KeyValue({ label, value, wide }: { label: string; value: unknown; wide?: boolean }) {
  const shown = text(value);
  if (!shown) return null;
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs text-ink/50">{label}</dt>
      <dd className={`mt-0.5 whitespace-pre-wrap text-sm ${wide ? '' : 'break-words'}`}>{shown}</dd>
    </div>
  );
}

export function ResultNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-5 text-ink/45">{children}</p>;
}

export function EmptyResult({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-line bg-white/50 px-6 text-center text-sm text-ink/45">
      {children}
    </div>
  );
}
