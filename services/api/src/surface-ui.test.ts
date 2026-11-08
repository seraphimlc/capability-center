import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(__dirname, '../../..');

test('model billing writes a model ledger and is not a stub', () => {
  const source = readFileSync(path.join(repoRoot, 'services/api/src/agent.service.ts'), 'utf8');
  assert.match(source, /bizType: 'model'/);
  assert.match(source, /captureKeyed/);
  assert.equal(source.includes('void WalletService'), false);
  assert.match(source, /INSUFFICIENT_CREDITS/);
});

test('stores list is cards and creation is a separate page', () => {
  const list = readFileSync(path.join(repoRoot, 'apps/www/src/app/stores/page.tsx'), 'utf8');
  const create = readFileSync(path.join(repoRoot, 'apps/www/src/app/stores/new/page.tsx'), 'utf8');
  assert.match(list, /sm:grid-cols-2/);
  assert.match(list, /href="\/stores\/new"/);
  assert.match(list, /进入工作台/);
  assert.match(list, /校验连接/);
  assert.match(list, /断开/);
  assert.match(list, /删除/);
  assert.equal(list.includes('<form'), false);
  assert.match(create, /保存并进入工作台/);
  assert.match(create, /\/stores\/\$\{created\.id\}/);
});

test('chat page uses the shared composer rules', () => {
  const page = readFileSync(path.join(repoRoot, 'apps/www/src/app/chat/[id]/page.tsx'), 'utf8');
  assert.match(page, /composerKeyAction/);
  assert.match(page, /acceptUserSend/);
  assert.match(page, /shouldStopBeforeSend/);
});

test('user-visible app copy does not name upstream brands', () => {
  const roots = [path.join(repoRoot, 'apps/www/src'), path.join(repoRoot, 'apps/admin/src')];
  const banned = [/link\s*fox/i, /xytoken/i, /xyb2b/i, /紫讯/, /Wally\s*Smarter/i, /\bTsearch\b/i];
  const hits: string[] = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const visible = stripNonCopy(readFileSync(file, 'utf8'));
      for (const pattern of banned) {
        pattern.lastIndex = 0;
        if (pattern.test(visible)) hits.push(`${path.relative(repoRoot, file)} ${pattern}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(name)) out.push(full);
  }
  return out;
}

function stripNonCopy(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/(?:\\\/|[^/\n])+\/[gimsuy]*/g, '');
}
