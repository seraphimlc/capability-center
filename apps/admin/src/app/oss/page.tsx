'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Oss = {
  provider: string;
  endpoint: string;
  public_endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  signed_url_expires: number;
  media_public_base: string;
  force_path_style: boolean;
  public_read: boolean;
  access_key_id: string;
};

export default function OssPage() {
  const [form, setForm] = useState<Oss | null>(null);
  const [secret, setSecret] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { api<Oss>('/api/admin/oss').then(setForm); }, []);
  if (!form) return <p>读取存储配置…</p>;

  function set<K extends keyof Oss>(key: K, value: Oss[K]) {
    setForm({ ...form!, [key]: value });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    try {
      await api('/api/admin/oss', { method: 'PUT', body: JSON.stringify({ ...form, public_endpoint: form.public_endpoint, access_key_id: form.access_key_id, access_key_secret: secret, signed_url_expires: form.signed_url_expires, media_public_base: form.media_public_base, force_path_style: form.force_path_style, public_read: form.public_read }) });
      setNote('已保存。密钥留空表示不改。');
      setSecret('');
    } catch (err) {
      setNote(err instanceof Error ? err.message : '保存失败');
    }
  }

  return (
    <form className="max-w-2xl" onSubmit={save}>
      <h1 className="text-3xl">对象存储</h1>
      <p className="mt-2 text-sm text-ink/70">本地默认 MinIO。生产可改为 aliyun。前缀不要使用其他产品的目录。</p>
      <div className="mt-4 grid gap-3">
        <select className="field" value={form.provider} onChange={(event) => set('provider', event.target.value)}><option value="minio">minio</option><option value="aliyun">aliyun</option><option value="mock">mock</option></select>
        <input className="field" placeholder="endpoint" value={form.endpoint} onChange={(event) => set('endpoint', event.target.value)} />
        <input className="field" placeholder="public endpoint" value={form.public_endpoint} onChange={(event) => set('public_endpoint', event.target.value)} />
        <input className="field" placeholder="region" value={form.region} onChange={(event) => set('region', event.target.value)} />
        <input className="field" placeholder="bucket" value={form.bucket} onChange={(event) => set('bucket', event.target.value)} />
        <input className="field" placeholder="prefix" value={form.prefix} onChange={(event) => set('prefix', event.target.value)} />
        <input className="field" placeholder="AccessKeyId" value={form.access_key_id} onChange={(event) => set('access_key_id', event.target.value)} />
        <input className="field" placeholder="AccessKeySecret（留空不修改）" value={secret} onChange={(event) => setSecret(event.target.value)} />
        <input className="field" placeholder="MEDIA_PUBLIC_BASE" value={form.media_public_base || ''} onChange={(event) => set('media_public_base', event.target.value)} />
        <label className="text-sm"><input type="checkbox" checked={form.force_path_style} onChange={(event) => set('force_path_style', event.target.checked)} /> path-style（MinIO 需要，阿里云通常关闭）</label>
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn btn-primary">保存</button>
        <button type="button" className="btn btn-ghost" onClick={async () => {
          try { const result = await api<{ ok: boolean; provider: string }>('/api/admin/oss/probe', { method: 'POST' }); setNote(`探活通过：${result.provider}`); }
          catch (err) { setNote(err instanceof Error ? err.message : '探活失败'); }
        }}>探活</button>
      </div>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
    </form>
  );
}
