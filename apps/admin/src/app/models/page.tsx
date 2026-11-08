'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Model = { id: string; display_name: string; capability: string; upstream_model: string; status: string; price_credits: number };
type Runtime = { provider: string; has_key: boolean; base_url: string; default_model: string };

export default function ModelsPage() {
  const [items, setItems] = useState<Model[]>([]);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [note, setNote] = useState('');
  async function load() {
    const data = await api<{ items: Model[]; runtime: Runtime }>('/api/admin/models');
    setItems(data.items);
    setRuntime(data.runtime);
  }
  useEffect(() => { void load(); }, []);
  return (
    <div>
      <h1 className="text-3xl">模型中心</h1>
      <p className="mt-2 text-sm text-ink/70">用户只看见白标档名。上游模型 ID 只在此页显示。当前通道 {runtime?.provider}，{runtime?.has_key ? '已配置密钥' : '无密钥，对话走本地模拟'}。</p>
      <div className="mt-4 space-y-3">
        {items.map((model) => (
          <article key={model.id} className="card p-4 text-sm">
            <div className="flex justify-between"><strong>{model.display_name}</strong><span>{model.capability} · {model.status}</span></div>
            <p className="mt-1 text-ink/60">上游模型 ID（不对用户展示）：{model.upstream_model}</p>
            <button className="btn btn-ghost mt-2" onClick={async () => {
              try {
                const result = await api<{ text: string; provider: string; latency_ms: number }>(`/api/admin/models/${model.id}/test`, { method: 'POST', body: JSON.stringify({ prompt: '回复两个字：就绪' }) });
                setNote(`${result.provider} · ${result.latency_ms}ms · ${result.text}`);
              } catch (err) {
                setNote(err instanceof Error ? err.message : '测试失败');
              }
            }}>测试调用</button>
          </article>
        ))}
      </div>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
    </div>
  );
}
