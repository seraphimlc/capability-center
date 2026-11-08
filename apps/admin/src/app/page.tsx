'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function OverviewPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Record<string, unknown>>('/api/admin/overview').then(setData).catch((err) => setError(err.message));
  }, []);
  if (error) return <p>{error}</p>;
  if (!data) return <p>加载总览…</p>;
  const llm = data.llm as { provider?: string; has_key?: boolean } | undefined;
  const oss = data.oss as { provider?: string; bucket?: string; prefix?: string } | undefined;
  return (
    <div>
      <h1 className="text-3xl">总览</h1>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {[
          ['用户', data.users],
          ['已发布能力', data.published_tools],
          ['进行中任务', data.running_tasks],
          ['调用次数', data.invokes],
        ].map(([label, value]) => (
          <div key={String(label)} className="card p-4">
            <p className="text-sm text-ink/50">{String(label)}</p>
            <p className="text-3xl">{String(value)}</p>
          </div>
        ))}
      </div>
      <div className="card mt-4 p-4 text-sm leading-7">
        <p>计费策略 {String(data.billing_strategy)}（A = 只扣技能，对话由平台承担）</p>
        <p>模型通道 {llm?.provider} {llm?.has_key ? '已配置密钥' : '未配置密钥，使用本地模拟'}</p>
        <p>对象存储 {oss?.provider} / {oss?.bucket} / 前缀 {oss?.prefix}</p>
        <p>维护模式 {data.maintenance ? '开' : '关'}</p>
      </div>
    </div>
  );
}
