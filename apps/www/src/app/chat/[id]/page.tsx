'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { api, getToken, readSse, setToken, uploadFile } from '../../../lib/api';
import { acceptUserSend, composerKeyAction, shouldStopBeforeSend } from '../../../lib/chat-ux';

type Skill = { tool_id: string; key: string; name: string; summary: string; pricing_credits: number; enabled: boolean };
type Conversation = {
  id: string;
  title: string;
  version: number;
  confirm_mode: 'auto' | 'manual';
  show_thinking: boolean;
  agent: { key: string; name: string; summary?: string; suggestions: string[]; unbound: boolean; model_tier: string } | null;
  store?: { id: string; name: string; platform: string; marketplace?: string | null; status?: string } | null;
  skills: Skill[];
};
type Msg = { id: string; role: string; content: string; status?: string; tool_call?: { call_id?: string; tool_key?: string; tool_name?: string; ok?: boolean; args?: unknown } | null };
type ToolCard = { call_id: string; tool_key: string; tool_name?: string; args?: unknown; status: string; summary?: string };
type Draft = { content: string; file: string };

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [sessions, setSessions] = useState<{ id: string; title: string; agent_name?: string }[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [live, setLive] = useState('');
  const [thinking, setThinking] = useState('');
  const [cards, setCards] = useState<ToolCard[]>([]);
  const [pending, setPending] = useState<ToolCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fileId, setFileId] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef<Draft | null>(null);
  const pumpingRef = useRef(false);
  const needsStopRef = useRef(false);
  const epochRef = useRef(0);
  const conversationIdRef = useRef(params.id);
  const sendGen = useRef(0);
  conversationIdRef.current = params.id;

  function applySnapshot(id: string, snap: Snapshot) {
    if (conversationIdRef.current !== id) return;
    setConv(snap.detail);
    setSessions(snap.sessions);
    setMessages(snap.messages);
    setPending(confirmCard(snap.messages));
  }

  async function load(id = params.id) {
    const snap = await fetchConversation(id);
    applySnapshot(id, snap);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
    return () => {
      epochRef.current += 1;
      queuedRef.current = null;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [messages, live, cards]);

  function restoreDraft(draft: Draft) {
    setText((current) => current || draft.content);
    if (draft.file) setFileId((current) => current || draft.file);
  }

  async function stopServer() {
    try {
      await api(`/api/www/conversations/${params.id}/stop`, { method: 'POST' });
    } catch {
      // The turn may already have finished.
    }
  }

  async function stopOnly() {
    epochRef.current += 1;
    const pending = queuedRef.current;
    queuedRef.current = null;
    needsStopRef.current = false;
    if (pending) restoreDraft(pending);
    abortRef.current?.abort();
    setLive('');
    setHandoff(false);
    await stopServer();
  }

  function enqueue(draft: Draft) {
    queuedRef.current = acceptUserSend(queuedRef.current, draft).slot;
    if (shouldStopBeforeSend(Boolean(abortRef.current || inflightRef.current))) {
      needsStopRef.current = true;
      setHandoff(true);
      setLive('');
      abortRef.current?.abort();
    }
    if (!pumpingRef.current) void pump();
  }

  // Latest unsent draft wins. A new send stops the active stream, then posts.
  // It does not wait for the previous reply to finish, and it does not keep a backlog.
  async function pump() {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    const ticket = epochRef.current;
    setBusy(true);
    try {
      while (epochRef.current === ticket) {
        const next = queuedRef.current;
        if (!next) break;
        queuedRef.current = null;
        if (needsStopRef.current || inflightRef.current) {
          needsStopRef.current = false;
          setHandoff(true);
          abortRef.current?.abort();
          await stopServer();
          if (inflightRef.current) await inflightRef.current;
          if (epochRef.current !== ticket) {
            if (!queuedRef.current) restoreDraft(next);
            break;
          }
          if (queuedRef.current) continue;
          setHandoff(false);
        }
        const task = performSend(next.content, next.file, ticket);
        inflightRef.current = task;
        try {
          await task;
        } finally {
          if (inflightRef.current === task) inflightRef.current = null;
        }
      }
    } finally {
      pumpingRef.current = false;
      setHandoff(false);
      if (queuedRef.current) void pump();
      else setBusy(false);
    }
  }

  function send(content: string) {
    const trimmed = content.trim();
    const file = fileId;
    if (!trimmed && !file) return;
    setText('');
    setFileId('');
    setError('');
    enqueue({ content: trimmed, file });
  }

  async function performSend(content: string, file: string, ticket: number) {
    const id = params.id;
    const gen = ++sendGen.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setNotice('');
    setLive('');
    setThinking('');
    setCards([]);
    setPending(null);
    setMessages((rows) => [...rows, { id: `local-${gen}`, role: 'user', content: content || '（附件）' }]);
    let accepted = false;
    try {
      const response = await postChat(id, content, file, controller.signal);
      if (epochRef.current !== ticket || sendGen.current !== gen) return;
      if (response.status === 401) {
        const refreshed = await fetch('/api/www/auth/refresh', { method: 'POST', credentials: 'include' });
        const body = await refreshed.json().catch(() => null);
        if (body?.data?.access_token) setToken(body.data.access_token);
        setError('登录已过期，请重试发送');
        return;
      }
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        setError(formatChatError(body?.error || {}, '发送失败'));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (!controller.signal.aborted && epochRef.current === ticket && sendGen.current === gen) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        buf = readSse(buf, (event, data) => {
          if (epochRef.current !== ticket || sendGen.current !== gen) return;
          if (event === 'meta') accepted = true;
          if (event === 'delta') setLive((value) => value + String(data.text || ''));
          if (event === 'thinking') setThinking((value) => value + String(data.text || ''));
          if (event === 'tool_call') {
            setCards((rows) => [...rows, { call_id: String(data.call_id), tool_key: String(data.tool_key), tool_name: String(data.tool_name || data.tool_key), args: data.args, status: 'running' }]);
          }
          if (event === 'tool_result') {
            setCards((rows) => rows.map((row) => (row.call_id === data.call_id ? { ...row, status: data.ok ? 'success' : 'failed', summary: String(data.summary || '') } : row)));
          }
          if (event === 'tool_confirm_required') {
            setPending({ call_id: String(data.call_id), tool_key: String(data.tool_key), tool_name: String(data.tool_name || ''), args: data.args, status: 'confirm' });
          }
          if (event === 'error') setError(formatChatError(data, '生成失败'));
          if (event === 'notice') setNotice(scrubVendor(String(data.message || '')));
        });
      }
      if (controller.signal.aborted || epochRef.current !== ticket) {
        await reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (!isAbort(error) && epochRef.current === ticket && sendGen.current === gen) {
        setError(scrubVendor(error instanceof Error ? error.message : '发送失败'));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (queuedRef.current || conversationIdRef.current !== id || sendGen.current !== gen) return;
      const snap = await fetchConversation(id).catch(() => null);
      if (!snap || queuedRef.current || conversationIdRef.current !== id || sendGen.current !== gen) return;
      applySnapshot(id, snap);
      setLive('');
      setThinking('');
      if (!accepted && !controller.signal.aborted && epochRef.current === ticket) restoreDraft({ content, file });
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const action = composerKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.nativeEvent.keyCode,
      composing: composing.current,
    });
    if (action !== 'send') return;
    event.preventDefault();
    send(text);
  }

  async function patch(path: string, body: unknown) {
    if (!conv) return;
    try {
      await api(path, { method: 'PUT', body: JSON.stringify({ ...(body as object), base_version: conv.version }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      await load().catch(() => undefined);
    }
  }

  if (!conv) return <p className="text-sm text-ink/50">{error || '正在打开会话…'}</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr_260px]">
      <aside className="space-y-2">
        <Link href="/agents" className="btn btn-ghost w-full">新建会话</Link>
        {sessions.length === 0 ? <p className="text-sm text-ink/50">还没有会话，点下方开始</p> : null}
        {sessions.map((item) => (
          <Link key={item.id} href={`/chat/${item.id}`} className={`block rounded-xl px-3 py-2 text-sm ${item.id === conv.id ? 'bg-ink text-paper' : 'bg-white'}`}>
            <span className="block truncate">{item.title}</span>
            <span className="text-xs opacity-70">{item.agent_name}</span>
          </Link>
        ))}
      </aside>
      <section className="card flex min-h-[70vh] flex-col">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h1 className="font-medium">{conv.agent?.name}</h1>
            <p className="text-xs text-ink/50">{conv.agent?.model_tier}{conv.store ? ` · 默认店铺 ${conv.store.name}` : ''}{conv.agent?.unbound ? ' · 当前助手未绑定技能，仅支持对话' : ''}</p>
          </div>
          <button className="btn btn-ghost" disabled={!busy} onClick={() => { void stopOnly(); }}>停止生成</button>
        </header>
        <div ref={box} className="flex-1 space-y-3 overflow-auto px-4 py-4">
          {messages.length === 0 && !live ? (
            <div>
              <p className="text-sm text-ink/70">{emptyLead(conv)}</p>
              {(conv.agent?.suggestions || []).length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(conv.agent?.suggestions || []).map((prompt) => (
                    <button key={prompt} className="btn btn-ghost" type="button" onClick={() => send(prompt)}>{prompt}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {messages.map((message) => (
            <div key={message.id} className={message.role === 'user' ? 'ml-10 rounded-2xl bg-moss px-3 py-2 text-sm text-white' : 'mr-8 text-sm'}>
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.role === 'assistant' ? (
                <button className="mt-1 text-xs text-ink/40" onClick={() => navigator.clipboard.writeText(message.content)}>复制</button>
              ) : null}
            </div>
          ))}
          {busy ? <p className="text-xs text-ink/50">{handoff ? '正在停止上一条回复…' : '正在生成…'}</p> : null}
          {thinking && conv.show_thinking ? <p className="text-xs text-ink/40">思考：{thinking}</p> : null}
          {live ? <p className="mr-8 whitespace-pre-wrap text-sm">{live}</p> : null}
          {cards.map((card) => (
            <div key={card.call_id} className="rounded-xl border border-line bg-paper p-3 text-sm">
              <p>{card.tool_name || card.tool_key} · {card.status === 'running' ? '执行中' : card.status === 'success' ? '完成' : '失败'}</p>
              {card.summary ? <p className="mt-1 text-ink/70">{card.summary.slice(0, 280)}</p> : null}
              <Link className="text-xs underline" href="/invokes">在目录记录中查看</Link>
            </div>
          ))}
          {pending ? (
            <div className="rounded-xl bg-amber-50 p-3 text-sm">
              <p>调用「{pending.tool_name}」前需要确认。</p>
              <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(pending.args, null, 2)}</pre>
              <div className="mt-2 flex gap-2">
                <button className="btn btn-primary" onClick={async () => { await api(`/api/www/conversations/${conv.id}/tool-confirm`, { method: 'POST', body: JSON.stringify({ call_id: pending.call_id, decision: 'accept' }) }); setPending(null); await load(); }}>确认</button>
                <button className="btn btn-ghost" onClick={async () => { await api(`/api/www/conversations/${conv.id}/tool-confirm`, { method: 'POST', body: JSON.stringify({ call_id: pending.call_id, decision: 'reject' }) }); setPending(null); await load(); }}>拒绝</button>
              </div>
            </div>
          ) : null}
          {notice ? <p className="text-xs text-ink/50">{notice}</p> : null}
          {error ? <p className="text-sm text-clay">{error}</p> : null}
        </div>
        <form className="border-t border-line p-3" onSubmit={(event: FormEvent) => { event.preventDefault(); send(text); }}>
          <textarea
            className="field min-h-20"
            placeholder="Enter 发送 · Shift+Enter 换行"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { window.setTimeout(() => { composing.current = false; }, 0); }}
            onKeyDown={onComposerKeyDown}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <label className="text-xs text-ink/60">
              图片
              <input className="ml-2 text-xs" type="file" accept="image/*" onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try { setFileId(await uploadFile(file)); } catch (err) { setError(err instanceof Error ? err.message : '上传失败'); }
              }} />
              {fileId ? <span className="ml-2 text-moss">已附加</span> : null}
            </label>
            <button className="btn btn-primary" type="submit" disabled={!text.trim() && !fileId}>发送</button>
          </div>
        </form>
      </section>
      <aside className="card h-fit p-4 text-sm">
        <h2 className="font-medium">本会话技能</h2>
        <p className="mt-1 text-xs text-ink/45">勾选从下一条消息起生效。</p>
        {conv.agent?.unbound ? <p className="mt-2 text-ink/60">当前助手未绑定技能，只会对话，不会调用工具。</p> : null}
        <div className="mt-3 space-y-2">
          {conv.skills.map((skill) => (
            <label key={skill.tool_id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={skill.enabled}
                onChange={() => {
                  const enabled = conv.skills.filter((item) => (item.tool_id === skill.tool_id ? !item.enabled : item.enabled)).map((item) => item.tool_id);
                  void patch(`/api/www/conversations/${conv.id}/skills`, { enabled_tool_ids: enabled });
                }}
              />
              <span>
                {skill.name}
                <span className="block text-xs text-ink/50">{skill.pricing_credits} 积分</span>
              </span>
            </label>
          ))}
        </div>
        <label className="mt-4 block">
          工具调用
          <select className="field mt-1" value={conv.confirm_mode} onChange={(event) => patch(`/api/www/conversations/${conv.id}/settings`, { confirm_mode: event.target.value, show_thinking: conv.show_thinking })}>
            <option value="auto">自动调用</option>
            <option value="manual">每次先确认</option>
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2">
          <input type="checkbox" checked={conv.show_thinking} onChange={(event) => patch(`/api/www/conversations/${conv.id}/settings`, { confirm_mode: conv.confirm_mode, show_thinking: event.target.checked })} />
          显示思考过程
        </label>
        <button className="btn btn-ghost mt-4 w-full" onClick={async () => {
          const title = window.prompt('会话标题', conv.title);
          if (title) await patch(`/api/www/conversations/${conv.id}`, { title });
        }}>重命名</button>
        <button className="mt-2 w-full text-xs text-clay" onClick={async () => {
          await api(`/api/www/conversations/${conv.id}/delete`, { method: 'POST' });
          window.location.href = '/agents';
        }}>删除会话</button>
      </aside>
    </div>
  );
}

function postChat(id: string, content: string, file: string, signal: AbortSignal): Promise<Response> {
  const sendOnce = () => fetch(`/api/www/conversations/${id}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken() || ''}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ content, attachments: file ? [file] : [] }),
    signal,
  });
  return (async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const response = await sendOnce();
      if (response.status !== 409 || attempt === 5) return response;
      const body = await response.clone().json().catch(() => null);
      if (body?.error?.code !== 'CONFLICT') return response;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('发送失败');
  })();
}

type Snapshot = { detail: Conversation; sessions: { id: string; title: string; agent_name?: string }[]; messages: Msg[] };

async function fetchConversation(id: string): Promise<Snapshot> {
  const [detail, list, history] = await Promise.all([
    api<Conversation>(`/api/www/conversations/${id}`),
    api<{ items: { id: string; title: string; agent_name?: string }[] }>('/api/www/conversations'),
    api<{ items: Msg[] }>(`/api/www/conversations/${id}/messages`),
  ]);
  return { detail, sessions: list.items, messages: history.items };
}

function confirmCard(items: Msg[]): ToolCard | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const message = items[index];
    const call = message.tool_call;
    if (message.status === 'awaiting_confirm' && call?.call_id && call.tool_key) {
      return {
        call_id: call.call_id,
        tool_key: call.tool_key,
        tool_name: call.tool_name || call.tool_key,
        args: call.args,
        status: 'confirm',
      };
    }
  }
  return null;
}

const EMPTY_LEAD: Record<string, string> = {
  'buyer-assistant': '告诉我品类、站点或成本，我帮你判断做不做。',
  'studio-assistant': '给我商品和平台，我帮你整理能直接用的文案或画面说明。',
  'ops-assistant': '说下要看的店铺、链接或这周的问题，我按优先级给动作。',
  'desk-assistant': '我可以说明能力中心怎么用、积分怎么算。这里不查店铺实时数据。',
  'amazon-store-assistant': '从库存、Listing、广告或竞品里选一件今天要处理的事。',
  'shopify-store-assistant': '说下商品和你想提高的转化点，我按独立站页面来整理。',
  'temu-store-assistant': '说下站点、订单或上架问题，我按这家店的待办来排。',
  'ebay-store-assistant': '给我站点、关键词或一条刊登，我帮你改到能发出去。',
  'shopee-store-assistant': '说下站点、账户健康或买家问题，我按虾皮店铺来处理。',
  'tiktok-shop-assistant': '给我商品和想拍的点，我帮你收成一条能拍的短视频。',
  'walmart-store-assistant': '给我商品和成本，我帮你判断值不值得上、刊登该改哪句。',
  'alibaba1688-store-assistant': '说下要找的货和数量，我帮你收成可以询盘的货源短名单。',
};

function emptyLead(conv: Conversation): string {
  if (conv.agent?.unbound) return EMPTY_LEAD['desk-assistant'];
  return EMPTY_LEAD[conv.agent?.key || ''] || conv.agent?.summary || '直接输入问题，或点一条建议开始。';
}

const CHAT_ERROR: Record<string, string> = {
  MODEL_UNAVAILABLE: '模型暂时不可用，请稍后再试',
  INSUFFICIENT_CREDITS: '积分不足，请联系管理员充值',
  DEPENDENCY_TIMEOUT: '处理超时，请重试',
  UPSTREAM_ERROR: '能力执行失败，请稍后重试',
  WALLET_FROZEN: '钱包已冻结，请联系管理员',
  CONTENT_BLOCKED: '内容未通过安全审核',
  MESSAGE_EMPTY: '消息不能为空',
  STREAM_ABORTED: '已停止生成',
};

function formatChatError(data: { code?: unknown; message?: unknown; details?: unknown }, fallback: string): string {
  const code = typeof data.code === 'string' ? data.code : '';
  const mapped = CHAT_ERROR[code];
  const message = mapped || (typeof data.message === 'string' && data.message ? data.message : fallback);
  const clean = scrubVendor(message);
  if (code !== 'INSUFFICIENT_CREDITS') return clean;
  const details = data.details as { balance?: number; required?: number } | undefined;
  if (!details || typeof details.required !== 'number') return clean;
  const balance = typeof details.balance === 'number' ? details.balance : 0;
  return `${clean}（需要 ${details.required} 积分，当前可用 ${balance}）`;
}

function scrubVendor(text: string): string {
  return text
    .replace(/link\s*fox/gi, '上游服务')
    .replace(/xytoken|xyb2b/gi, '上游服务')
    .replace(/Wally\s*Smarter/gi, '上游服务')
    .replace(/\bTsearch\b/gi, '上游服务');
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
