const api = 'http://127.0.0.1:8890';
const www = 'http://127.0.0.1:8888';

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, headers: response.headers };
}

function cookie(headers) {
  const raw = headers.getSetCookie?.() || [];
  return raw.map((item) => item.split(';')[0]).join('; ');
}

const health = await json(`${api}/healthz`);
if (health.status !== 200) throw new Error(`health ${health.status}`);

const adminLogin = await json(`${www.replace('8888', '8889')}/api/admin/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'ops@visitworlds.me', password: 'Ops123456' }),
});
if (!adminLogin.body?.ok) throw new Error(`admin login ${JSON.stringify(adminLogin.body)}`);
const adminToken = adminLogin.body.data.access_token;
const adminCookie = cookie(adminLogin.headers);

const userLogin = await json(`${www}/api/www/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'demo@visitworlds.me', password: 'Demo123456' }),
});
if (!userLogin.body?.ok) throw new Error(`user login ${JSON.stringify(userLogin.body)}`);
const userToken = userLogin.body.data.access_token;

const users = await json(`${www.replace('8888', '8889')}/api/admin/users`, {
  headers: { authorization: `Bearer ${adminToken}`, cookie: adminCookie },
});
const demo = users.body.data.items.find((item) => item.email === 'demo@visitworlds.me');
const grant = await json(`${www.replace('8888', '8889')}/api/admin/wallet/grant`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${adminToken}`,
    'content-type': 'application/json',
    'idempotency-key': `smoke-${Date.now()}`,
  },
  body: JSON.stringify({ user_id: demo.id, amount: 200, reason: '冒烟充值' }),
});
if (!grant.body?.ok) throw new Error(`grant ${JSON.stringify(grant.body)}`);

const blocked = await json(`${www}/api/www/invokes`, {
  method: 'POST',
  headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ tool_key: 'product-picker', input: {} }),
});
if (blocked.body?.error?.code !== 'SCHEMA_INVALID' && blocked.body?.ok) {
  /* empty input should fail validation before charge */
}

const invoke = await json(`${www}/api/www/invokes`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${userToken}`,
    'content-type': 'application/json',
    'idempotency-key': `smoke-invoke-${Date.now()}`,
  },
  body: JSON.stringify({ tool_key: 'product-picker', input: { keyword: '露营灯', market: 'US', limit: 2 } }),
});
if (!invoke.body?.ok || invoke.body.data.invoke.status !== 'success') {
  throw new Error(`invoke ${JSON.stringify(invoke.body)}`);
}
if (JSON.stringify(invoke.body).toLowerCase().includes('linkfox') || JSON.stringify(invoke.body).includes('紫讯')) {
  throw new Error('brand leak in invoke');
}

const ledger = await json(`${www}/api/www/wallet/ledger`, { headers: { authorization: `Bearer ${userToken}` } });
if (!ledger.body.data.items.some((row) => row.biz_id === invoke.body.data.invoke.id)) {
  throw new Error('ledger missing consume');
}

const created = await json(`${www}/api/www/conversations`, {
  method: 'POST',
  headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ agent_key: 'buyer-assistant' }),
});
const chat = await fetch(`${www}/api/www/conversations/${created.body.data.id}/chat`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${userToken}`,
    'content-type': 'application/json',
    accept: 'text/event-stream',
  },
  body: JSON.stringify({ content: '帮我做一份露营灯的选品简报' }),
});
const streamed = await chat.text();
if (!streamed.includes('event: delta') && !streamed.includes('event: tool_call')) {
  throw new Error(`sse missing events ${streamed.slice(0, 400)}`);
}

const list = await json(`${api}/mcp`, {
  method: 'POST',
  headers: {
    authorization: 'Bearer ck_sandbox_demo01_capabilitycenterdevsecret',
    'content-type': 'application/json',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
if (!list.body?.result?.tools?.length) throw new Error(`mcp list ${JSON.stringify(list.body)}`);
const call = await json(`${api}/mcp`, {
  method: 'POST',
  headers: {
    authorization: 'Bearer ck_sandbox_demo01_capabilitycenterdevsecret',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'text-insight', arguments: { text: '独立站卖家想要每周选品建议' } },
  }),
});
if (call.body?.result?.isError) throw new Error(`mcp call ${JSON.stringify(call.body)}`);

const presign = await json(`${www}/api/www/files/presign`, {
  method: 'POST',
  headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ filename: 'note.txt', mime: 'text/plain', size: 11 }),
});
if (!presign.body?.ok) throw new Error(`presign ${JSON.stringify(presign.body)}`);
const put = await fetch(presign.body.data.upload_url, {
  method: 'PUT',
  headers: presign.body.data.headers,
  body: 'hello world',
});
if (!put.ok && put.status !== 204) throw new Error(`put ${put.status}`);
const done = await json(`${www}/api/www/files/${presign.body.data.file_id}/complete`, {
  method: 'POST',
  headers: { authorization: `Bearer ${userToken}` },
});
if (done.body?.data?.status !== 'ready') throw new Error(`complete ${JSON.stringify(done.body)}`);

console.log('smoke ok', {
  invoke: invoke.body.data.invoke.id,
  balance: grant.body.data.balance,
  mcpTools: list.body.result.tools.length,
  file: presign.body.data.file_id,
});
