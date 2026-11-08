'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function DocsPage() {
  const [items, setItems] = useState<{ id: string; title: string; body: string }[]>([]);
  useEffect(() => {
    api<{ items: { id: string; title: string; body: string }[] }>('/api/www/announcements').then((data) => setItems(data.items));
  }, []);
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-4xl">文档与公告</h1>
      <div className="card mt-4 space-y-3 p-5 text-sm leading-7">
        <p>用户端用于发现和调用能力。管理端用于充值、上架和查看审计。</p>
        <p>模型标价大于 0 时，完成的对话按人民币整数积分扣减。技能在执行成功时另扣。失败和取消会释放预留。</p>
        <p>对象存储走服务端签发的上传地址，浏览器不接触存储密钥。</p>
      </div>
      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <article key={item.id} className="card p-4">
            <h2 className="font-medium">{item.title}</h2>
            <p className="mt-2 text-sm text-ink/75">{item.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
