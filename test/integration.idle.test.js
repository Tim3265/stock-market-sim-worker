// 背景行情（沒人上線時由排程推進股價）：會走、遵守漲跌停、不跟玩家搶、超過額度就停、寫入量便宜。
import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';
import { idleTick, IDLE_AFTER_MS } from '../src/domain/idleMarket.js';
import { maybeTick } from '../src/domain/marketMaker.js';

beforeEach(async () => {
  for (const m of env.ORDERBOOK_MIGRATIONS) await env.DB.batch(m.queries.map((sql) => env.DB.prepare(sql)));
  await env.DB.prepare('DELETE FROM usage_minutes').run(); // 用量表不在每次測試重建的清單裡
});

const prices = async () => Object.fromEntries((await env.DB.prepare('SELECT symbol, price FROM stocks').all()).results.map(r => [r.symbol, Number(r.price)]));
const count = async (sql) => (await env.DB.prepare(sql).first()).n;

it('沒人上線時股價會走，並留下價格歷史與指數', async () => {
  const now = Date.now();
  await env.DB.prepare('UPDATE market_state SET last_tick_at=? WHERE id=1').bind(now - IDLE_AFTER_MS - 1000).run();
  const before = await prices();
  const ticksBefore = await count('SELECT tick_count n FROM market_state');
  const r = await idleTick(env.DB, now, () => 0.9);
  expect(r).toEqual({ ran: true });
  const after = await prices();
  expect(Object.keys(after).some(k => after[k] !== before[k])).toBe(true);
  expect(await count("SELECT COUNT(*) n FROM price_history WHERE source='IDLE'")).toBeGreaterThan(0);
  expect(await count('SELECT COUNT(*) n FROM index_history')).toBeGreaterThan(0);
  // tick_count 補到 4 的倍數 → 下次有人上線時造市商依新價重新報價
  expect((await count('SELECT tick_count n FROM market_state')) % 4).toBe(0);
  expect(await count('SELECT tick_count n FROM market_state')).toBeGreaterThanOrEqual(ticksBefore);
});

it('一整晚都往同一方向走，也不會超過漲跌停', async () => {
  let now = Date.now();
  const ref = await prices();
  for (let i = 0; i < 60; i++) {
    now += 5 * 60000;
    await env.DB.prepare('UPDATE market_state SET last_tick_at=? WHERE id=1').bind(now - IDLE_AFTER_MS - 1000).run();
    await idleTick(env.DB, now, () => 1);
  }
  const stocks = (await env.DB.prepare('SELECT symbol, price, ref_price FROM stocks').all()).results;
  for (const s of stocks) {
    expect(Number(s.price)).toBeLessThanOrEqual(Math.floor(Math.round(Number(s.ref_price) * 100) * 1.1) / 100 + 1e-9);
    expect(Number(s.price)).toBeGreaterThan(0);
  }
  expect(Object.values(ref).length).toBe(stocks.length);
});

it('有人在玩、或今天額度已用掉六成時不執行', async () => {
  const now = Date.now();
  await env.DB.prepare('UPDATE market_state SET last_tick_at=? WHERE id=1').bind(now - 30000).run();
  expect(await idleTick(env.DB, now)).toEqual({ ran: false, reason: 'players-active' });

  await env.DB.prepare('UPDATE market_state SET last_tick_at=? WHERE id=1').bind(now - IDLE_AFTER_MS - 1000).run();
  await env.DB.prepare('INSERT INTO usage_minutes(minute, rows_read, rows_written, requests) VALUES(?, 0, 60000, 1)').bind(Math.floor(now / 60000)).run();
  const before = await prices();
  expect(await idleTick(env.DB, now)).toEqual({ ran: false, reason: 'budget' });
  expect(await prices()).toEqual(before);
});

it('跟玩家同時發生時，只有一邊成功', async () => {
  const now = Date.now();
  await env.DB.prepare('UPDATE market_state SET last_tick_at=? WHERE id=1').bind(now - IDLE_AFTER_MS - 1000).run();
  // 模擬讀完狀態後，玩家剛好讓市場推進（版本號變了）
  const db = new Proxy(env.DB, { get(t, p) {
    if (p === 'batch') return async (ops) => { await maybeTick(env.DB, now, 0); return t.batch(ops); };
    return typeof t[p] === 'function' ? t[p].bind(t) : t[p];
  } });
  expect(await idleTick(db, now)).toEqual({ ran: false, reason: 'conflict' });
  expect(await count("SELECT COUNT(*) n FROM price_history WHERE source='IDLE'")).toBe(0);
});

it('排程每輪寫入少、並記入用量', async () => {
  const sum = () => env.DB.prepare('SELECT COALESCE(SUM(rows_read),0) r, COALESCE(SUM(rows_written),0) w FROM usage_minutes').first();
  const run = async (now) => {
    await env.DB.prepare('UPDATE market_state SET last_tick_at=? WHERE id=1').bind(now - IDLE_AFTER_MS - 1000).run();
    await worker.scheduled({ scheduledTime: now, cron: '*/5 * * * *' }, env, { waitUntil() {} });
  };
  const now = Date.now();
  await run(now); // 第一輪會順便換日（更新參考價），比平常多寫幾列
  const first = await sum();
  await run(now + 5 * 60000);
  const second = await sum();
  const u = { r: second.r - first.r, w: second.w - first.w };
  console.log('IDLE-TICK rows first', JSON.stringify(first), 'steady', JSON.stringify(u));
  expect(await count("SELECT COUNT(*) n FROM price_history WHERE source='IDLE'")).toBeGreaterThan(0);
  expect(first.w).toBeGreaterThan(0);
  // 實測約 46 列。一天 288 輪 × 50 列 ≈ 14,400 列，免費額度的 15% 以內
  expect(u.w).toBeLessThanOrEqual(50);
  expect(u.r).toBeLessThanOrEqual(100);
});
