'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, uploadFile, type ApiError } from '../lib/api';

type FieldProp = {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  format?: string;
  'x-file'?: boolean;
  default?: unknown;
};

type Schema = {
  required?: string[];
  properties?: Record<string, FieldProp>;
  'x-fill-status'?: string;
};

function ResultView({ value }: { value: unknown }) {
  if (value == null) return <p className="text-sm text-ink/50">无输出</p>;

  const rows =
    Array.isArray(value)
      ? value
      : value && typeof value === 'object' && Array.isArray((value as { items?: unknown[] }).items)
        ? (value as { items: unknown[] }).items
        : value && typeof value === 'object' && Array.isArray((value as { data?: unknown[] }).data)
          ? (value as { data: unknown[] }).data
          : null;

  if (rows && rows.length > 0 && typeof rows[0] === 'object' && rows[0]) {
    const keySet = new Set<string>();
    for (const row of rows.slice(0, 50)) {
      if (!row || typeof row !== 'object') continue;
      for (const k of Object.keys(row as Record<string, unknown>).slice(0, 8)) keySet.add(k);
    }
    const keys = Array.from(keySet);
    return (
      <div className="overflow-auto rounded-xl border border-line">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-paper text-ink/60">
            <tr>
              {keys.map((k) => (
                <th key={k} className="whitespace-nowrap px-3 py-2 font-medium">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((row, idx) => (
              <tr key={idx} className="border-t border-line/70 odd:bg-white even:bg-paper/60">
                {keys.map((k) => {
                  const cell = (row as Record<string, unknown>)[k];
                  const text =
                    cell == null
                      ? ''
                      : typeof cell === 'object'
                        ? JSON.stringify(cell)
                        : String(cell);
                  return (
                    <td key={k} className="max-w-[14rem] truncate px-3 py-2" title={text}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 50 ? <p className="border-t border-line px-3 py-2 text-xs text-ink/50">仅展示前 50 条，共 {rows.length} 条</p> : null}
      </div>
    );
  }

  return <pre className="overflow-auto rounded-xl bg-ink p-3 text-xs leading-5 text-paper">{JSON.stringify(value, null, 2)}</pre>;
}

export function InvokeDrawer({
  toolKey,
  name,
  price,
  schema,
  summary,
  initial,
  storeBound = false,
  initialStoreId,
  lockStore = false,
  onClose,
}: {
  toolKey: string;
  name: string;
  price: number;
  schema: Schema;
  summary?: string;
  initial?: Record<string, unknown>;
  storeBound?: boolean;
  initialStoreId?: string;
  lockStore?: boolean;
  onClose: () => void;
}) {
  const props = schema.properties || {};
  const required = schema.required || [];
  const defaults = useMemo(() => {
    const base: Record<string, unknown> = { ...(initial || {}) };
    for (const [key, prop] of Object.entries(props)) {
      if (base[key] === undefined && prop.default !== undefined) base[key] = prop.default;
    }
    return base;
  }, [initial, props]);

  const [values, setValues] = useState<Record<string, unknown>>(defaults);
  const [wallet, setWallet] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [invokeMeta, setInvokeMeta] = useState<{ id: string; status: string; task_id?: string } | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [rawMode, setRawMode] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [shops, setShops] = useState<{ id: string; name: string; platform_name: string; status: string }[]>([]);
  const [storeId, setStoreId] = useState(initialStoreId || '');

  useEffect(() => {
    setValues(defaults);
    setResult(null);
    setInvokeMeta(null);
    setError('');
    setFieldError('');
  }, [toolKey, defaults]);

  useEffect(() => {
    api<{ available: number }>('/api/www/wallet').then((row) => setWallet(row.available)).catch(() => setWallet(null));
    api<{ items: { id: string; name: string; platform_name: string; status: string }[] }>('/api/www/shops')
      .then((data) => {
        const connected = (data.items || []).filter((s) => s.status === 'connected');
        setShops(connected);
        if (initialStoreId) setStoreId(initialStoreId);
        else if (connected.length === 1) setStoreId(connected[0].id);
      })
      .catch(() => setShops([]));
  }, [initialStoreId]);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [running]);

  const blocked = wallet !== null && wallet < price;
  const fillStatus = schema['x-fill-status'];
  const fields = Object.entries(props);

  function setField(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setFieldError('');
    const missing = required.find((key) => {
      const v = values[key];
      return v === undefined || v === '' || v === null;
    });
    if (missing) {
      setFieldError(props[missing]?.title || missing);
      return;
    }
    if (storeBound && !storeId) {
      setError('该能力需要选择已连接店铺');
      return;
    }
    setRunning(true);
    setElapsed(0);
    setResult(null);
    setInvokeMeta(null);
    try {
      const data = await api<{ invoke: { id: string; status: string; output: unknown; task_id?: string; error_code?: string } }>(
        '/api/www/invokes',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            tool_key: toolKey,
            input: storeId ? { ...values, store_id: storeId } : values,
          }),
        },
      );
      setInvokeMeta({ id: data.invoke.id, status: data.invoke.status, task_id: data.invoke.task_id });
      setResult(data.invoke.output ?? data.invoke);
      api<{ available: number }>('/api/www/wallet').then((row) => setWallet(row.available)).catch(() => undefined);
    } catch (err) {
      const parsed = err as ApiError;
      setError(parsed.message);
      setRequestId(parsed.requestId || '');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/40 backdrop-blur-[2px]" onClick={onClose}>
      <form
        className="flex h-full w-full max-w-3xl flex-col bg-paper shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        <header className="border-b border-line px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-moss">调用工作台</p>
              <h2 className="mt-1 truncate font-display text-3xl">{name}</h2>
              {summary ? <p className="mt-1 line-clamp-2 text-sm text-ink/65">{summary}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-ink px-2.5 py-1 text-paper">成功扣 {price} 积分</span>
                <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-line">
                  可用 {wallet === null ? '…' : wallet}
                </span>
                {fillStatus && fillStatus !== 'ok' ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">参数待精修 · {fillStatus}</span>
                ) : null}
              </div>
            </div>
            <button type="button" className="btn btn-ghost shrink-0" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-2">
          <section className="min-h-0 overflow-auto border-b border-line px-6 py-5 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium">输入参数</h3>
              <button type="button" className="text-xs text-moss" onClick={() => setRawMode((v) => !v)}>
                {rawMode ? '表单模式' : '原始 JSON'}
              </button>
            </div>

            {storeBound || shops.length > 0 ? (
              <label className="mb-4 block text-sm">
                <span className="mb-1 flex items-center justify-between font-medium">
                  <span>
                    操作店铺
                    {storeBound ? <span className="ml-2 rounded bg-clay/10 px-1.5 text-[10px] text-clay">需绑店</span> : <span className="ml-2 rounded bg-paper px-1.5 text-[10px] text-ink/50">可选</span>}
                  </span>
                  <a href="/stores" className="text-xs text-moss">管理店铺</a>
                </span>
                {shops.length > 0 ? (
                  <select
                    className="field"
                    value={storeId}
                    disabled={lockStore && Boolean(initialStoreId)}
                    onChange={(event) => setStoreId(event.target.value)}
                  >
                    {!storeBound ? <option value="">不绑定店铺（通用能力）</option> : <option value="">请选择已连接店铺</option>}
                    {shops.map((shop) => (
                      <option key={shop.id} value={shop.id}>
                        {shop.platform_name} · {shop.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="rounded-xl border border-dashed border-line px-3 py-2 text-sm text-ink/60">
                    尚未对接店铺。去 <a className="text-moss underline" href="/stores">店铺管理</a> 授权后再调用。
                  </p>
                )}
                <span className="mt-1 block text-xs text-ink/50">
                  {lockStore && initialStoreId
                    ? '已锁定为当前工作台店铺，调用将注入该店凭证。'
                    : storeBound
                      ? '该能力必须选择店铺，系统会注入凭证后执行。'
                      : '选中后会把该店凭证注入本次调用；通用能力可不选。'}
                </span>
              </label>
            ) : null}

            {blocked ? (
              <p className="mb-4 rounded-xl bg-amber-100 px-3 py-2 text-sm">积分不足。当前可用 {wallet}，需要 {price}。</p>
            ) : null}

            {rawMode ? (
              <textarea
                className="field min-h-[22rem] font-mono text-xs"
                value={JSON.stringify(values, null, 2)}
                onChange={(event) => {
                  try {
                    const parsed = JSON.parse(event.target.value);
                    if (parsed && typeof parsed === 'object') setValues(parsed as Record<string, unknown>);
                  } catch {
                    /* keep typing */
                  }
                }}
              />
            ) : (
              <div className="space-y-4">
                {fields.length === 0 ? <p className="text-sm text-ink/50">该能力暂无参数定义</p> : null}
                {fields.map(([key, prop]) => {
                  const isReq = required.includes(key);
                  return (
                    <label key={key} className="block text-sm">
                      <span className="mb-1 flex items-center gap-2 font-medium">
                        {prop.title || key}
                        {isReq ? <span className="rounded bg-clay/10 px-1.5 text-[10px] text-clay">必填</span> : null}
                      </span>
                      {prop.description ? <span className="mb-2 block text-xs leading-5 text-ink/55">{prop.description}</span> : null}
                      {prop.enum ? (
                        <select className="field" value={String(values[key] ?? '')} onChange={(event) => setField(key, event.target.value)}>
                          <option value="">请选择</option>
                          {prop.enum.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      ) : prop.format === 'file' || prop['x-file'] ? (
                        <input
                          className="field"
                          type="file"
                          accept="image/*,.pdf,.txt,.csv,.json"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            try {
                              const fileId = await uploadFile(file);
                              setField(key, fileId);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : '上传失败');
                            }
                          }}
                        />
                      ) : prop.type === 'boolean' ? (
                        <select
                          className="field"
                          value={values[key] === undefined ? '' : values[key] ? 'true' : 'false'}
                          onChange={(event) => setField(key, event.target.value === 'true')}
                        >
                          <option value="">请选择</option>
                          <option value="true">是</option>
                          <option value="false">否</option>
                        </select>
                      ) : prop.type === 'integer' || prop.type === 'number' ? (
                        <input
                          className="field"
                          type="number"
                          value={values[key] === undefined || values[key] === null ? '' : String(values[key])}
                          onChange={(event) => setField(key, event.target.value === '' ? '' : Number(event.target.value))}
                        />
                      ) : prop.type === 'object' || prop.type === 'array' || key === 'payload' || key === 'queryValue' ? (
                        <textarea
                          className="field min-h-28 font-mono text-xs"
                          placeholder={prop.type === 'array' ? 'JSON 数组' : 'JSON 对象或文本'}
                          value={
                            typeof values[key] === 'string'
                              ? String(values[key])
                              : values[key] === undefined
                                ? ''
                                : JSON.stringify(values[key], null, 2)
                          }
                          onChange={(event) => {
                            const raw = event.target.value;
                            try {
                              setField(key, JSON.parse(raw));
                            } catch {
                              setField(key, raw);
                            }
                          }}
                        />
                      ) : (prop.title || '').includes('文本') || key === 'text' || key === 'brief' || key === 'titles' || (prop.description || '').length > 80 ? (
                        <textarea className="field min-h-28" value={String(values[key] ?? '')} onChange={(event) => setField(key, event.target.value)} />
                      ) : (
                        <input className="field" value={String(values[key] ?? '')} onChange={(event) => setField(key, event.target.value)} />
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            {fieldError ? <p className="mt-3 text-sm text-clay">请填写：{fieldError}</p> : null}
            {error ? (
              <p className="mt-3 rounded-xl bg-clay/10 px-3 py-2 text-sm text-clay">
                {error}
                {requestId ? <span className="mt-1 block text-xs text-ink/50">问题编号：{requestId}</span> : null}
              </p>
            ) : null}
          </section>

          <section className="min-h-0 overflow-auto px-6 py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">运行结果</h3>
              <div className="flex items-center gap-2 text-xs text-ink/50">
                {running ? <span>运行中 {elapsed}s</span> : null}
                {invokeMeta ? <span>#{invokeMeta.id.slice(-8)} · {invokeMeta.status}</span> : null}
                {result ? (
                  <button type="button" className="text-moss" onClick={() => setShowJson((v) => !v)}>
                    {showJson ? '表格优先' : '看 JSON'}
                  </button>
                ) : null}
              </div>
            </div>
            {!result && !running ? (
              <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-line bg-white/50 text-sm text-ink/45">
                填写左侧参数后运行，结果会在这里展示
              </div>
            ) : null}
            {running ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-white">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-moss border-t-transparent" />
                <p className="text-sm text-ink/60">正在调用上游能力…</p>
              </div>
            ) : null}
            {result ? (showJson ? <ResultView value={result} /> : <ResultView value={result} />) : null}
            {result && showJson ? null : null}
            {result ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink/50">原始 JSON</summary>
                <pre className="mt-2 overflow-auto rounded-xl bg-ink p-3 text-xs text-paper">{JSON.stringify(result, null, 2)}</pre>
              </details>
            ) : null}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line bg-white/80 px-6 py-4 backdrop-blur">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setValues(defaults);
              setResult(null);
              setError('');
              setFieldError('');
              setInvokeMeta(null);
            }}
          >
            重置
          </button>
          <div className="flex gap-2">
            {invokeMeta?.id ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  await api(`/api/www/invokes/${invokeMeta.id}/cancel`, { method: 'POST' }).catch((err) => setError(err.message));
                }}
              >
                取消运行
              </button>
            ) : null}
            <button className="btn btn-primary min-w-28" disabled={running || blocked}>
              {running ? `运行中 ${elapsed}s` : '运行'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
