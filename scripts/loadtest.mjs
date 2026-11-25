// 壓力測試：N 個虛擬玩家同時進站、看盤、下單，並在指定秒數讓所有人同一秒搶買 2330。
// 用法：node scripts/loadtest.mjs <網址> [玩家數=40] [秒數=180] [搶買秒數=60]
// 請對「測試用」的 Worker + D1 執行，不要打線上站：會建立大量假玩家並消耗 D1 每日額度。
// 跑完可用 scripts/loadtest-integrity.sql 檢查帳目（money_invariant 應為 0、各股總股數不變、其餘異常計數為 0）。
const BASE = process.argv[2];
const USERS = Number(process.argv[3] || 40);
const SECONDS = Number(process.argv[4] || 180);
const FLASH_AT = Number(process.argv[5] || 60);
const SYMS = ['2330', '2317', '2454', '3711', 'YZU', 'YOUJIAN'];
const TAG = Date.now().toString(36).slice(-2);
const stats = new Map(); // endpoint -> {n, lat[], status{}, codes{}}
const problems = [];
const t0 = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

function rec(ep, ms, status, code) {
  let s = stats.get(ep); if (!s) stats.set(ep, s = { n: 0, lat: [], status: {}, codes: {} });
  s.n++; s.lat.push(ms); s.status[status] = (s.status[status] || 0) + 1; if (code) s.codes[code] = (s.codes[code] || 0) + 1;
}
async function req(user, method, path, body, ep = path.split('?')[0].replace(/\/\d+$/, '/:id')) {
  const st = performance.now();
  try {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(user?.cookie ? { cookie: user.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const sc = r.headers.get('set-cookie'); if (sc && user && sc.startsWith('stock_session=') && !sc.startsWith('stock_session=;')) user.cookie = sc.split(';')[0];
    const text = await r.text(); let d = null; try { d = JSON.parse(text); } catch { }
    const ms = performance.now() - st;
    const code = d && d.ok === false ? d.code : null;
    rec(ep, ms, r.status, code);
    if (r.status >= 500) problems.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${method} ${path} -> ${r.status} ${text.slice(0, 160)}`);
    return { s: r.status, d, ms };
  } catch (e) {
    rec(ep, performance.now() - st, 'ERR', String(e.name || e));
    problems.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${method} ${path} -> ${e.name}: ${e.message}`);
    return { s: 'ERR', d: null };
  }
}


// 模擬網頁的自動重送：CONFLICT / 5xx / 網路錯誤時用同一個 request_id 再送，最多 8 次
const finals = new Map(); // ep -> {n, outcome{}, attempts[], totalMs[]}
async function order(u, body, ep) {
  const st = performance.now(); let r, attempt = 0;
  for (; attempt < 8; attempt++) {
    if (attempt) await sleep(200 + Math.random() * 300 * Math.min(attempt, 4));
    r = await req(u, 'POST', '/api/orders', body, ep + ' (每次送出)');
    if (r.d?.ok || (r.d && !['CONFLICT', 'INTERNAL'].includes(r.d.code) && r.s < 500) ) break;
  }
  const f = finals.get(ep) || { n: 0, outcome: {}, attempts: [], totalMs: [] }; finals.set(ep, f);
  f.n++; const k = r.d?.ok ? (r.d.status || 'OK') : (r.d?.code || r.s); f.outcome[k] = (f.outcome[k] || 0) + 1; f.attempts.push(attempt + (attempt < 8 ? 1 : 0)); f.totalMs.push(performance.now() - st);
  return r;
}

let flashGate; const flash = new Promise(r => (flashGate = r));
const flashResults = [];

async function player(i) {
  const u = { cookie: null, open: [], holdings: {}, symbol: pick(SYMS) };
  await req(u, 'GET', '/', null, 'GET /');
  const login = await req(u, 'POST', '/api/auth/guest', { nickname: '壓' + TAG + i });
  if (!u.cookie) { problems.push(`user ${i} login failed: ${login.s} ${JSON.stringify(login.d)}`); return; }
  await req(u, 'GET', '/api/auth/session');
  let flashed = false;
  const end = t0 + SECONDS * 1000;
  let nextPoll = 0, nextAction = Date.now() + rand(3000, 12000);
  flash.then(async () => { flashed = true; const r = await order(u, { symbol: '2330', side: 'BUY', type: 'MARKET', shares: 1 + Math.floor(Math.random() * 3), request_id: 'flash-' + TAG + '-' + i + '-' + Date.now() }, 'FLASH buy'); flashResults.push(r); });
  while (Date.now() < end) {
    const now = Date.now();
    if (now >= nextPoll) {
      const r = await req(u, 'GET', `/api/live?symbol=${u.symbol}&light=1`, null, 'GET /api/live (light)');
      if (r.d?.holdings) u.holdings = Object.fromEntries(r.d.holdings.map(h => [h.symbol, h.shares - (h.frozen_shares || 0)]));
      nextPoll = Date.now() + (r.d?.pollMs || 5000);
    }
    if (now >= nextAction) {
      const roll = Math.random();
      const sym = pick(SYMS);
      if (roll < 0.30) {
        await order(u, { symbol: sym, side: 'BUY', type: 'MARKET', shares: 1 + Math.floor(Math.random() * 5), request_id: `m${TAG}-${i}-${Date.now()}` }, 'market buy');
      } else if (roll < 0.45) {
        const held = Object.entries(u.holdings).filter(([, n]) => n > 0);
        if (held.length) { const [s, n] = pick(held); await order(u, { symbol: s, side: 'SELL', type: 'MARKET', shares: 1 + Math.floor(Math.random() * n), request_id: `s${TAG}-${i}-${Date.now()}` }, 'market sell'); }
      } else if (roll < 0.60) {
        const ob = await req(u, 'GET', '/api/orderbook?symbol=' + sym);
        const bid = ob.d?.bids?.[0]?.price;
        if (bid) { const price = Math.round(bid * 0.99 * 100) / 100; const r = await order(u, { symbol: sym, side: 'BUY', type: 'LIMIT', price, shares: 1 + Math.floor(Math.random() * 3), request_id: `l${TAG}-${i}-${Date.now()}` }, 'limit buy'); if (r.d?.status === 'OPEN') u.open.push(r.d.orderId); }
      } else if (roll < 0.70) {
        const id = u.open.shift(); if (id) await req(u, 'DELETE', '/api/orders/' + id);
      } else if (roll < 0.80) {
        u.symbol = sym; await req(u, 'GET', `/api/live?symbol=${sym}`, null, 'GET /api/live (full)');
      } else if (roll < 0.90) {
        await req(u, 'GET', '/api/leaderboard');
      } else if (roll < 0.95) {
        await req(u, 'GET', '/api/history?symbol=' + sym);
      } else {
        await req(u, 'GET', '/api/bots');
      }
      nextAction = Date.now() + rand(6000, 20000);
    }
    await sleep(200);
  }
}

async function admin() {
  const end = t0 + SECONDS * 1000;
  while (Date.now() < end) { await req(null, 'GET', '/api/admin/overview'); await sleep(10000); }
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : 0; };
console.log(`壓測 ${BASE}  玩家 ${USERS}  時間 ${SECONDS}s  同時搶買於 ${FLASH_AT}s`);
setTimeout(() => flashGate(), FLASH_AT * 1000);
const progress = setInterval(() => { let n = 0; for (const s of stats.values()) n += s.n; process.stdout.write(`  ${((Date.now() - t0) / 1000).toFixed(0)}s 已送出 ${n} 個請求\n`); }, 30000);
await Promise.all([...Array(USERS)].map((_, i) => player(i)).concat(admin()));
clearInterval(progress);
await sleep(3000);

let total = 0, fails = 0;
console.log('\n端點'.padEnd(30), '次數', '  p50', '  p95', '   max', ' 狀態 / 業務錯誤');
for (const [ep, s] of [...stats.entries()].sort((a, b) => b[1].n - a[1].n)) {
  total += s.n; for (const [k, v] of Object.entries(s.status)) if (k === 'ERR' || Number(k) >= 500) fails += v;
  console.log(ep.padEnd(30), String(s.n).padStart(4), String(Math.round(pct(s.lat, 50))).padStart(5), String(Math.round(pct(s.lat, 95))).padStart(5), String(Math.round(Math.max(...s.lat))).padStart(6), ' ', JSON.stringify(s.status), Object.keys(s.codes).length ? JSON.stringify(s.codes) : '');
}
const fl = flashResults.reduce((m, r) => { const k = r.d?.status || r.d?.code || r.s; m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`\n同時搶買 2330：${flashResults.length} 筆 →`, JSON.stringify(fl), ' p95', Math.round(pct(flashResults.map(r => r.ms || 0), 95)), 'ms');
console.log('玩家看到的最終結果（含自動重送）：');
for (const [ep, f] of finals) console.log('  ' + ep.padEnd(12), 'n=' + f.n, JSON.stringify(f.outcome), '平均送出次數', (f.attempts.reduce((a, b) => a + b, 0) / f.n).toFixed(2), '等待 p50/p95/max', Math.round(pct(f.totalMs, 50)), Math.round(pct(f.totalMs, 95)), Math.round(Math.max(...f.totalMs)), 'ms');
console.log(`總請求 ${total}，伺服器錯誤/逾時 ${fails}`);
if (problems.length) { console.log('\n問題（前 25 筆）：'); for (const p of problems.slice(0, 25)) console.log('  ' + p); }
