'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';

type PlatformField = {
  key: string;
  title: string;
  secret: boolean;
  required: boolean;
  placeholder: string;
};

type Platform = {
  id: string;
  name: string;
  fields: PlatformField[];
  capabilities: string[];
};

export default function NewStorePage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [selected, setSelected] = useState('amazon');
  const [name, setName] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const platform = useMemo(() => platforms.find((item) => item.id === selected) || null, [platforms, selected]);

  useEffect(() => {
    api<{ items: Platform[] }>('/api/www/shops/platforms')
      .then((data) => {
        setPlatforms(data.items);
        if (data.items[0]) setSelected((current) => current || data.items[0].id);
      })
      .catch((err) => setError((err as ApiError).message || '加载失败'));
  }, []);

  useEffect(() => {
    setCreds({});
  }, [selected]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!platform) return;
    setBusy(true);
    setError('');
    try {
      const created = await api<{ id: string }>('/api/www/shops', {
        method: 'POST',
        body: JSON.stringify({
          platform: platform.id,
          name: name.trim() || `${platform.name} 店铺`,
          credentials: creds,
          marketplace: creds.marketplace || creds.region || undefined,
        }),
      });
      window.location.href = created.id ? `/stores/${created.id}` : '/stores';
    } catch (err) {
      setError((err as ApiError).message || '保存失败');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <Link href="/stores" className="text-sm text-ink/50">返回店铺</Link>
        <h1 className="mt-2 font-display text-3xl">对接店铺</h1>
        <p className="mt-2 text-sm text-ink/65">选择平台并填写凭证。保存后进入该店工作台。</p>
      </div>
      {error ? <p className="rounded-xl bg-clay/10 px-4 py-2 text-sm text-clay">{error}</p> : null}
      <form className="card p-5" onSubmit={onCreate}>
        <span className="mb-2 block text-sm font-medium">平台</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {platforms.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              className={`rounded-xl px-3 py-2 text-left text-sm ring-1 transition ${
                selected === item.id ? 'bg-ink text-paper ring-ink' : 'bg-white ring-line hover:bg-paper'
              }`}
            >
              <span className="block font-medium">{item.name}</span>
              <span className={`mt-0.5 block text-[10px] ${selected === item.id ? 'text-paper/70' : 'text-ink/45'}`}>
                {(item.capabilities || []).slice(0, 2).join(' · ')}
              </span>
            </button>
          ))}
        </div>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium">店铺显示名</span>
          <input
            className="field"
            placeholder={platform ? `${platform.name} 主店` : '例如：美亚旗舰店'}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        {platform?.fields.map((field) => (
          <label key={field.key} className="mt-3 block text-sm">
            <span className="mb-1 flex items-center gap-2 font-medium">
              {field.title}
              {field.required ? <span className="rounded bg-clay/10 px-1.5 text-[10px] text-clay">必填</span> : null}
            </span>
            <input
              className="field"
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={field.placeholder || ''}
              value={creds[field.key] || ''}
              onChange={(event) => setCreds((prev) => ({ ...prev, [field.key]: event.target.value }))}
              required={field.required}
            />
          </label>
        ))}
        <button className="btn btn-primary mt-5 w-full" disabled={busy || !platform}>
          {busy ? '保存中…' : '保存并进入工作台'}
        </button>
      </form>
    </div>
  );
}
