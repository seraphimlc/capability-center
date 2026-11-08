#!/usr/bin/env node
// Local HTTP → HTTPS bridge for the model gateway.
//
// Docker Desktop on macOS can fail the TLS handshake to the upstream
// (OpenSSL unexpected EOF) from inside a container, while the host can
// connect. Run this on the host, then point the API container at
// http://host.docker.internal:18765/v1 via docker-compose.override.yml.
//
// The API key stays on the request the API container already sends.
// This process does not read or log Authorization, and it has no key of its own.
//
//   node scripts/xy-llm-proxy.mjs
//
// XY_PROXY_PORT    default 18765
// XY_PROXY_HOST    default 0.0.0.0 (so the container can reach the host)
// XY_PROXY_TARGET  default https://api.xytoken.xyb2b.com

import http from 'node:http';
import https from 'node:https';

const listenHost = process.env.XY_PROXY_HOST || '0.0.0.0';
const listenPort = Number(process.env.XY_PROXY_PORT || 18765);
const target = new URL(process.env.XY_PROXY_TARGET || 'https://api.xytoken.xyb2b.com');

if (target.protocol !== 'https:') {
  console.error('XY_PROXY_TARGET must be https');
  process.exit(1);
}
if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
  console.error('XY_PROXY_PORT is invalid');
  process.exit(1);
}

const hop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

const agent = new https.Agent({ keepAlive: true });

function copyHeaders(source, host) {
  const headers = {};
  for (const [key, value] of Object.entries(source)) {
    if (hop.has(key.toLowerCase()) || value === undefined) continue;
    headers[key] = value;
  }
  if (host) headers.host = host;
  return headers;
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const upstream = https.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      method: req.method,
      path: req.url,
      headers: copyHeaders(req.headers, target.host),
      agent,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, copyHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    },
  );
  upstream.setTimeout(0);

  const fail = (error) => {
    console.error(`xy-llm-proxy ${req.method} failed: ${error instanceof Error ? error.message : 'error'}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('upstream unavailable');
  };

  upstream.on('error', fail);
  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
  req.on('error', () => upstream.destroy());
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });
  req.pipe(upstream);
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;
server.timeout = 0;

server.listen(listenPort, listenHost, () => {
  console.log(`xy-llm-proxy listening on http://${listenHost}:${listenPort} -> ${target.origin}`);
});
