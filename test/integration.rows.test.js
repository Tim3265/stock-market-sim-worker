// D1 免費額度是用「讀、寫幾列」計算（每天讀 500 萬列、寫 10 萬列，整個帳號共用）。
// 這個測試先造出約 100 分鐘市場＋40 位玩家的資料，量每種請求（不含快取）讀寫幾列，
// 超過上限就失敗，避免之後改程式又變成每個請求掃整張表。印出的 ROWS-REPORT 可用來估算一堂課的用量。
import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';
import { maybeTick } from '../src/domain/marketMaker.js';
import { matchCrossed } from '../src/domain/orders.js';
import { runBotActivity } from '../src/domain/botActivity.js';

beforeEach(async () => {
  for (const m of env.ORDERBOOK_MIGRATIONS) await env.DB.batch(m.queries.map((sql) => env.DB.prepare(sql)));
});

function instrument(db, acc) {
  const add = (r, sql) => { if (r && r.meta) { acc.read += r.meta.rows_read || 0; acc.written += r.meta.rows_written || 0; if (acc.by && sql) { const k = sql.replace(/\s+/g, ' ').slice(0, 110); acc.by[k] = (acc.by[k] || 0) + (r.meta.rows_read || 0); } } };
  const wrapStmt = (stmt, sql) => new Proxy(stmt, {
    get(t, prop) {
      if (prop === 'bind') return (...a) => wrapStmt(t.bind(...a), sql); if (prop === '__sql') return sql;
      if (prop === 'first') return async (col) => { const r = await t.all(); add(r, sql); const row = r.results[0] ?? null; return col && row ? row[col] : row; };
      if (prop === 'all' || prop === 'run') return async (...a) => { const r = await t[prop](...a); add(r, sql); return r; };
      if (prop === '__raw') return t;
      return t[prop];
    }
  });
  return new Proxy(db, {
    get(t, prop) {
      if (prop === 'prepare') return (sql) => wrapStmt(t.prepare(sql), sql);
      if (prop === 'batch') return async (stmts) => { const res = await t.batch(stmts.map(s => s.__raw || s)); res.forEach((r, i) => add(r, stmts[i].__sql)); return res; };
      return t[prop];
    }
  });
}

const ctx = { waitUntil() {}, passThroughOnException() {} };
async function call(ienv, path, cookie, method = 'GET', body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  return worker.fetch(new Request('https://example.com' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), ienv, ctx);
}

it('每種請求的讀寫列數', async () => {
  const raw = env.DB;
  // 造資料：400 輪市場（約 100 分鐘）＋ 40 位玩家各交易幾次
  for (let i = 0; i < 400; i++) { await maybeTick(raw, Date.now() + i * 15000, 0); await matchCrossed(raw); await runBotActivity(raw); }
  const plain = new Proxy(env, { get(t, p) { return p === 'LIVE_CACHE_MS' ? '0' : t[p]; } });
  const cookies = [];
  for (let i = 0; i < 40; i++) {
    const g = await call(plain, '/api/auth/guest', null, 'POST', { nickname: 'p' + i });
    cookies.push(g.headers.get('Set-Cookie').split(';')[0]);
  }
  const syms = ['2330', '2317', '2454', '3711', 'YZU', 'YOUJIAN'];
  let n = 0;
  for (let r = 0; r < 4; r++) for (let i = 0; i < 40; i++) {
    await call(plain, '/api/orders', cookies[i], 'POST', { symbol: syms[(i + r) % 6], side: 'BUY', type: 'MARKET', shares: 2, request_id: 'seed-buy-' + (n++) + '-xxxxxxxxxx' });
  }
  const sizes = {};
  for (const t of ['orders', 'trades', 'order_fills', 'price_history', 'index_history', 'accounts', 'holdings', 'login_events', 'player_sessions'])
    sizes[t] = (await raw.prepare('SELECT COUNT(*) n FROM ' + t).first()).n;
  const now = () => raw.prepare('UPDATE market_state SET last_tick_at=? WHERE id=1').bind(Date.now()).run();

  const acc = { read: 0, written: 0 };
  const ienv = new Proxy(env, { get(t, p) { if (p === 'DB') return instrument(t.DB, acc); if (p === 'LIVE_CACHE_MS') return '0'; return t[p]; } });
  const out = {}, top = {};
  async function measure(name, fn, times = 3) {
    let rd = 0, wr = 0;
    acc.by = {}; for (let k = 0; k < times; k++) { await now(); acc.read = 0; acc.written = 0; await fn(k); rd += acc.read; wr += acc.written; } top[name] = Object.entries(acc.by).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([q, v]) => Math.round(v / times) + '  ' + q); acc.by = null;
    out[name] = { read: Math.round(rd / times), written: Math.round(wr / times) };
  }
  const c = cookies[0];
  await measure('GET / (頁面)', () => call(ienv, '/', null));
  await measure('live light', () => call(ienv, '/api/live?symbol=2330&light=1', c));
  await measure('live full', () => call(ienv, '/api/live?symbol=2330', c));
  await measure('orderbook', () => call(ienv, '/api/orderbook?symbol=2330', c));
  await measure('leaderboard', () => call(ienv, '/api/leaderboard', c));
  await measure('history', () => call(ienv, '/api/history?symbol=2330', c));
  await measure('bots', () => call(ienv, '/api/bots', c));
  await measure('session', () => call(ienv, '/api/auth/session', c));
  await measure('market buy', k => call(ienv, '/api/orders', c, 'POST', { symbol: '2330', side: 'BUY', type: 'MARKET', shares: 1, request_id: 'm-buy-' + k + '-xxxxxxxxxxxx' }));
  await measure('market sell', k => call(ienv, '/api/orders', c, 'POST', { symbol: '2330', side: 'SELL', type: 'MARKET', shares: 1, request_id: 'm-sel-' + k + '-xxxxxxxxxxxx' }));
  const px = (await raw.prepare("SELECT price FROM stocks WHERE symbol='2330'").first()).price;
  const ids = [];
  await measure('limit buy', async k => { const r = await call(ienv, '/api/orders', c, 'POST', { symbol: '2330', side: 'BUY', type: 'LIMIT', price: Math.round(px * 0.95 * 100) / 100, shares: 1, request_id: 'l-buy-' + k + '-xxxxxxxxxxxx' }); ids.push((await r.json()).orderId); });
  await measure('cancel', k => call(ienv, '/api/orders/' + ids[k], c, 'DELETE'));
  await measure('guest login', k => call(ienv, '/api/auth/guest', null, 'POST', { nickname: 'q' + k }));
  await measure('admin overview', () => call(ienv, '/api/admin/overview', null));
  await measure('admin player', () => call(ienv, '/api/admin/player?id=' + 1, null), 1);
  await measure('tick (市場推進一輪)', async k => { await raw.prepare('UPDATE market_state SET last_tick_at=0 WHERE id=1').run(); await call(ienv, '/api/auth/session', c); }, 8);
  console.log('ROWS-REPORT ' + JSON.stringify({ sizes, out, top }, null, 1));
  const limits = { 'session': 20, 'live light': 250, 'live full': 250, 'orderbook': 60, 'leaderboard': 400, 'history': 150, 'bots': 120, 'market buy': 150, 'market sell': 150, 'limit buy': 80, 'cancel': 40, 'guest login': 80, 'tick (市場推進一輪)': 1200 };
  for (const [name, max] of Object.entries(limits)) expect(out[name].read, name + ' 讀取列數').toBeLessThanOrEqual(max);
  expect(out['market buy'].written, '市價買進寫入列數').toBeLessThanOrEqual(45);
  expect(out['tick (市場推進一輪)'].written, '市場推進寫入列數').toBeLessThanOrEqual(200);
}, 600000);
