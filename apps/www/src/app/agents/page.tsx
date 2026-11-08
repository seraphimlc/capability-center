'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Agent = { key: string; name: string; summary: string; tool_count: number; unbound: boolean; model_tier: string; store_assistant?: boolean; platforms?: string[] };

function AgentList() {
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState<Agent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ items: Agent[] }>('/api/www/agents').then((data) => setItems(data.items)).catch((err) => setError(err.message));
  }, []);

  async function open(agent: Agent) {
    const created = await api<{ id: string }>('/api/www/conversations', {
      method: 'POST',
      body: JSON.stringify({ agent_key: agent.key }),
    });
    router.push(`/chat/${created.id}`);
  }

  return (
    <div>
      <h1 className="font-display text-4xl">助手</h1>
      <p className="mt-2 text-sm text-ink/60">会话保存在云端，换浏览器登录后还能看到同一份历史。</p>
      {error ? <p className="mt-4 text-clay">{error}</p> : null}
      {items.length === 0 && !error ? <p className="card mt-6 p-8 text-center">暂无可用助手</p> : null}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {items.map((agent) => (
          <article key={agent.key} className={`card p-5 ${params.get('focus') === agent.key ? 'ring-2 ring-clay' : ''}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl">{agent.name}</h2>
              {agent.store_assistant ? <span className="rounded-full bg-moss/10 px-2 py-1 text-xs text-moss">店铺助手</span> : agent.unbound ? <span className="rounded-full bg-paper px-2 py-1 text-xs">未绑技能</span> : null}
            </div>
            <p className="mt-2 text-sm text-ink/70">{agent.summary}</p>
            <p className="mt-3 text-xs text-ink/50">{agent.model_tier} · {agent.tool_count} 个技能</p>
            <button className="btn btn-primary mt-4" onClick={() => open(agent)}>开始会话</button>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function AgentsPage() {
  return <Suspense><AgentList /></Suspense>;
}
