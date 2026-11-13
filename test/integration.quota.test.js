import { beforeEach, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { maybeTick } from '../src/domain/marketMaker.js';
import { noteRequest, tickIntervalMs, pollMs, requestsPerMin } from '../src/domain/activity.js';

const base = 'https://example.com';
beforeEach(async () => {
  for (const m of env.ORDERBOOK_MIGRATIONS) await env.DB.batch(m.queries.map((sql) => env.DB.prepare(sql)));
});

async function get(path, cookie) {
  const res = await SELF.fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, body: await res.json() };
}

it('MM in-place requote 保住既有委託 id（FIFO 時間優先不變）', async () => {
  await get('/api/stocks');
  await env.DB.prepare('UPDATE market_state SET tick_count=2,last_tick_at=0').run();
  await get('/api/orderbook?symbol=2330'); // tick_count 2 -> 3，會 requote
  const before = (await env.DB.prepare("SELECT id FROM orders WHERE account_id=1000000 AND symbol='2330' AND status IN ('OPEN','PARTIAL') ORDER BY id").all()).results.map(r => r.id);
  expect(before.length).toBeGreaterThan(0);
  await env.DB.prepare('UPDATE market_state SET tick_count=5,last_tick_at=0').run();
  await get('/api/orderbook?symbol=2330'); // tick_count 5 -> 6，再次 requote
  const after = (await env.DB.prepare("SELECT id FROM orders WHERE account_id=1000000 AND symbol='2330' AND status IN ('OPEN','PARTIAL') ORDER BY id").all()).results.map(r => r.id);
  expect(after).toEqual(before);
});

it('非 requote 輪不改寫 MM 委託', async () => {
  await get('/api/stocks');
  await env.DB.prepare('UPDATE market_state SET tick_count=3,last_tick_at=0').run();
  await get('/api/orderbook?symbol=2330'); // 3 -> 4，不 requote
  const ids = (await env.DB.prepare("SELECT id,price FROM orders WHERE account_id=1000000 AND symbol='2330' AND status IN ('OPEN','PARTIAL') ORDER BY id").all()).results;
  expect(ids.length).toBeGreaterThan(0);
  await env.DB.prepare('UPDATE market_state SET tick_count=4,last_tick_at=0').run();
  await get('/api/orderbook?symbol=2330'); // 4 -> 5，仍不 requote
  const ids2 = (await env.DB.prepare("SELECT id,price FROM orders WHERE account_id=1000000 AND symbol='2330' AND status IN ('OPEN','PARTIAL') ORDER BY id").all()).results;
  expect(ids2).toEqual(ids);
});

it('自適應 tick 間隔：無請求維持 15 秒，人少放慢到 60 秒', () => {
  // 用未來時間戳，避免同檔其他測試的請求污染全域計數器
  const now = Date.now() + 3600000;
  expect(tickIntervalMs(now + 100000)).toBe(15000); // 無資料
  for (let i = 0; i < 5; i++) noteRequest(now + i * 1000);
  expect(requestsPerMin(now + 5000)).toBe(5);
  expect(tickIntervalMs(now + 5000)).toBe(60000);
  expect(pollMs(now + 5000)).toBe(5000);
  for (let i = 0; i < 200; i++) noteRequest(now + i * 200);
  expect(tickIntervalMs(now + 40000)).toBe(15000);
  expect(pollMs(now + 40000)).toBe(10000);
});

it('/api/live 回傳 pollMs 與 indexHistory（前端不再需要另打 /api/index）', async () => {
  const g = await SELF.fetch(base + '/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'quota-ui' }) });
  const cookie = g.headers.get('Set-Cookie').split(';')[0];
  const r = await get('/api/live?symbol=2330', cookie);
  expect(r.status).toBe(200);
  expect(r.body.pollMs).toBeGreaterThanOrEqual(5000);
  expect(Array.isArray(r.body.indexHistory)).toBe(true);
  expect(r.body.index).toBeGreaterThan(0);
});

it('maybeTick 可用 intervalMs=0 強制推進（fast-forward / 手動 tick）', async () => {
  await get('/api/stocks');
  const t = Date.now();
  expect(await maybeTick(env.DB, t, 0)).toBe(true);
  expect(await maybeTick(env.DB, t + 1, 0)).toBe(true);
});
