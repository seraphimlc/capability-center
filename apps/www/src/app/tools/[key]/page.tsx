'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { InvokeDrawer } from '../../../components/invoke-drawer';
import { api } from '../../../lib/api';
import { hasToolForm } from '../../../tools/registry';
import { ToolRunner } from '../../../tools/runner';

type Detail = {
  key: string;
  name: string;
  summary: string;
  description_md: string;
  pricing_credits: number;
  schema: Record<string, unknown>;
  examples: unknown;
  deprecated: boolean;
  store_bound?: boolean;
  platforms?: string[];
  related_agents: { key: string; name: string; summary: string }[];
};

export default function ToolDetailPage() {
  const params = useParams<{ key: string }>();
  const [tool, setTool] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<Detail>(`/api/www/tools/${params.key}`).then(setTool).catch((err) => setError(err.message));
  }, [params.key]);

  if (error) return <p className="text-clay">{error}</p>;
  if (!tool) return <p className="text-sm text-ink/50">正在打开能力…</p>;

  const fill = (tool.schema as { 'x-fill-status'?: string })['x-fill-status'];
  const dedicated = hasToolForm(tool.key);

  return (
    <article className="grid gap-6 lg:grid-cols-[1.45fr_0.85fr]">
      <div>
        <p className="text-sm text-moss">能力详情</p>
        <h1 className="font-display text-4xl md:text-5xl">{tool.name}</h1>
        <p className="mt-3 text-lg leading-7 text-ink/75">{tool.summary}</p>
        {tool.deprecated ? <p className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-sm">该能力即将下线</p> : null}
        {fill && fill !== 'ok' ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">参数 schema 仍在精修（{fill}），可先用原始 JSON 模式调用。</p>
        ) : null}
        <div className="card mt-6 whitespace-pre-wrap p-5 text-sm leading-7">{tool.description_md}</div>
        <h2 className="mt-6 text-sm text-ink/50">示例入参</h2>
        <pre className="mt-2 overflow-auto rounded-xl bg-white p-3 text-xs">{JSON.stringify(tool.examples, null, 2)}</pre>
        {dedicated ? null : (
          <>
            <h2 className="mt-6 text-sm text-ink/50">参数字段</h2>
            <div className="mt-2 overflow-auto rounded-xl border border-line bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-paper text-ink/50">
                  <tr>
                    <th className="px-3 py-2">字段</th>
                    <th className="px-3 py-2">类型</th>
                    <th className="px-3 py-2">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(((tool.schema as { properties?: Record<string, { type?: string; title?: string; description?: string }> }).properties) || {}).map(([key, prop]) => (
                    <tr key={key} className="border-t border-line/70">
                      <td className="px-3 py-2 font-medium">{prop.title || key}</td>
                      <td className="px-3 py-2 text-ink/60">{prop.type || 'string'}</td>
                      <td className="px-3 py-2 text-ink/70">{prop.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <aside className="card h-fit sticky top-4 p-5">
        <p className="text-4xl font-medium">{tool.pricing_credits}</p>
        <p className="text-sm text-ink/60">积分 / 成功一次 · 人民币口径</p>
        <p className="mt-2 text-xs text-ink/50">
          {tool.store_bound ? '需绑店 · 调用前必须选择已连接店铺' : '通用能力 · 可不绑定店铺'}
          {tool.platforms?.length ? ` · 平台 ${tool.platforms.join(' / ')}` : ''}
        </p>
        <button className="btn btn-primary mt-4 w-full" onClick={() => setOpen(true)}>打开调用工作台</button>
        <h2 className="mt-6 text-sm font-medium">用助手咨询</h2>
        <div className="mt-2 space-y-2">
          {tool.related_agents.length === 0 ? <p className="text-sm text-ink/50">还没有绑定助手</p> : null}
          {tool.related_agents.map((agent) => (
            <Link key={agent.key} href={`/agents?focus=${agent.key}`} className="block rounded-xl bg-paper px-3 py-2 text-sm hover:ring-1 hover:ring-line">
              {agent.name}
              <span className="block text-ink/50">{agent.summary}</span>
            </Link>
          ))}
        </div>
      </aside>
      {open ? (
        dedicated ? (
          <ToolRunner toolKey={tool.key} onClose={() => setOpen(false)} />
        ) : (
          <InvokeDrawer
            toolKey={tool.key}
            name={tool.name}
            price={tool.pricing_credits}
            summary={tool.summary}
            storeBound={Boolean(tool.store_bound)}
            schema={tool.schema as { required?: string[]; properties?: Record<string, { type?: string; title?: string; enum?: string[]; format?: string; 'x-file'?: boolean; default?: unknown; description?: string }>; 'x-fill-status'?: string }}
            onClose={() => setOpen(false)}
          />
        )
      ) : null}
    </article>
  );
}
