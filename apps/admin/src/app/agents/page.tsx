'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Agent = { id: string; key: string; name: string; status: string; summary: string; tool_ids: string[]; suggestions: string[] };
type Tool = { id: string; name: string };
type Model = { id: string; display_name: string };

export default function AgentsPage() {
  const [items, setItems] = useState<Agent[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  useEffect(() => {
    api<{ items: Agent[] }>('/api/admin/agents').then((data) => setItems(data.items));
    api<{ items: Tool[] }>('/api/admin/tools').then((data) => setTools(data.items));
    api<{ items: Model[] }>('/api/admin/models').then((data) => setModels(data.items));
  }, []);
  return (
    <div>
      <h1 className="text-3xl">助手</h1>
      <p className="mt-2 text-sm text-ink/60">用户不能自建助手。这里维护发布状态、技能和主模型。</p>
      <div className="mt-4 space-y-3">
        {items.map((agent) => (
          <article key={agent.id} className="card p-4 text-sm">
            <div className="flex justify-between">
              <strong>{agent.name}</strong>
              <span>{agent.status}</span>
            </div>
            <p className="text-ink/70">{agent.summary}</p>
            <p className="mt-2">建议问题：{(agent.suggestions || []).join(' / ')}</p>
            <p className="mt-1">技能：{agent.tool_ids.map((id) => tools.find((tool) => tool.id === id)?.name || id).join('、') || '未绑定'}</p>
            <p className="mt-1 text-ink/50">可选模型档：{models.map((model) => model.display_name).join('、')}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
