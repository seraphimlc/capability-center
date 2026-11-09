'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../lib/api';
import { getToolForm } from './registry';
import { EmptyResult } from './ui';

type ToolDetail = {
  key: string;
  name: string;
  summary: string;
  pricing_credits: number;
  store_bound?: boolean;
};

export function ToolRunner({ toolKey, onClose }: { toolKey: string; onClose: () => void }) {
  const def = getToolForm(toolKey);
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setTool(null);
    setLoadError('');
    api<ToolDetail>(`/api/www/tools/${toolKey}`)
      .then((row) => {
        if (!cancelled) setTool(row);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '加载能力失败');
      });
    return () => {
      cancelled = true;
    };
  }, [toolKey]);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [running]);

  async function run(input: Record<string, unknown>) {
    setRunning(true);
    setElapsed(0);
    setError('');
    setRequestId('');
    setResult(null);
    try {
      const data = await api<{ invoke: { output: unknown; status: string } }>('/api/www/invokes', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ tool_key: toolKey, input }),
      });
      setResult(data.invoke.output ?? data.invoke);
    } catch (err) {
      const parsed = err as ApiError;
      setError(parsed.message);
      setRequestId(parsed.requestId || '');
    } finally {
      setRunning(false);
    }
  }

  if (!def) return null;
  const Form = def.Form;
  const Result = def.Result;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-5xl flex-col bg-paper shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-line px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-moss">商标能力</p>
              <h2 className="mt-1 truncate font-display text-3xl">{tool?.name || '正在打开…'}</h2>
              {tool?.summary ? <p className="mt-1 line-clamp-2 text-sm text-ink/65">{tool.summary}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-ink px-2.5 py-1 text-paper">成功扣 {tool?.pricing_credits ?? '—'} 积分</span>
                <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-line">通常 5–20 秒</span>
                <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-line">公开商标数据 · 非法律意见</span>
              </div>
              <p className="mt-2 text-xs text-ink/45">上游按次消耗额度；若提示额度不足，需要管理员增加额度后再试。</p>
            </div>
            <button type="button" className="btn btn-ghost shrink-0" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-2">
          <section className="min-h-0 overflow-auto border-b border-line px-6 py-5 lg:border-b-0 lg:border-r">
            <h3 className="mb-3 text-sm font-medium">填写查询条件</h3>
            {tool ? <Form run={run} running={running} /> : <p className="text-sm text-ink/50">{loadError || '正在打开…'}</p>}
          </section>

          <section className="min-h-0 overflow-auto px-6 py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">查询结果</h3>
              {running ? <span className="text-xs text-ink/50">已用 {elapsed}s</span> : null}
            </div>

            {running ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-white">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-moss border-t-transparent" />
                <p className="text-sm text-ink/60">正在查询公开商标数据…</p>
                <p className="text-xs text-ink/40">数据量较大时可能需要 10–20 秒，请不要关闭窗口</p>
              </div>
            ) : error ? (
              <div className="rounded-xl bg-clay/10 px-4 py-3 text-sm text-clay">
                <p>{error}</p>
                {requestId ? <p className="mt-1 text-xs text-ink/50">问题编号：{requestId}</p> : null}
              </div>
            ) : result !== null ? (
              <Result value={result} />
            ) : (
              <EmptyResult>填好左侧条件后开始查询，结果会显示在这里。</EmptyResult>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
