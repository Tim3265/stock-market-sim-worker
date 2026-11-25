import { taipeiDate } from './domain/indexBase.js';
import { ADMIN_HTML } from './admin-page.js';
import { usageReport, officialUsage } from './usage.js';

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" };
const json = (body, status = 200) => Response.json(body, { status, headers });

// 台北時間今天 00:00 換算成資料庫使用的 UTC 字串
function todayStartUtc(now = Date.now()) {
  return new Date(Date.parse(taipeiDate(now) + 'T00:00:00+08:00')).toISOString().slice(0, 19).replace('T', ' ');
}

const PLAYERS_SQL = `SELECT a.id, COALESCE(c.username, a.name) AS name, COALESCE(c.is_guest, 0) AS is_guest, c.created_at, a.hidden,
  a.cash, a.initial_cash,
  COALESCE((SELECT SUM(h.shares * s.price) FROM holdings h JOIN stocks s ON s.symbol = h.symbol WHERE h.account_id = a.id), 0) AS stock_value,
  (SELECT COUNT(*) FROM trades t WHERE t.account_id = a.id) AS trade_count,
  (SELECT MAX(t.created_at) FROM trades t WHERE t.account_id = a.id) AS last_trade_at,
  (SELECT COUNT(*) FROM orders o WHERE o.account_id = a.id AND o.status IN ('OPEN','PARTIAL')) AS open_orders,
  MAX(COALESCE((SELECT MAX(l.created_at) FROM login_events l WHERE l.account_id = a.id), ''),
      COALESCE((SELECT MAX(p.created_at) FROM player_sessions p WHERE p.account_id = a.id), '')) AS last_login_at
FROM accounts a LEFT JOIN player_credentials c ON c.account_id = a.id
WHERE a.is_bot = 0
ORDER BY last_login_at DESC, a.id DESC LIMIT 300`;

async function overview(env) {
  const today = todayStartUtc();
  const [status, players, logins] = await env.DB.batch([
    env.DB.prepare(`SELECT
      (SELECT last_tick_at FROM market_state WHERE id = 1) AS last_tick_at,
      (SELECT MAX(created_at) FROM order_fills) AS last_fill_at,
      (SELECT COUNT(*) FROM order_fills WHERE created_at >= ?1) AS fills_today,
      (SELECT COUNT(*) FROM accounts WHERE is_bot = 0) AS players,
      (SELECT COUNT(DISTINCT account_id) FROM login_events WHERE created_at >= ?1 AND success = 1) AS active_today,
      (SELECT COUNT(*) FROM login_events WHERE created_at >= datetime('now','-1 day') AND success = 0) AS failed_logins_24h,
      (SELECT COUNT(*) FROM orders o JOIN accounts a ON a.id = o.account_id WHERE a.is_bot = 0 AND o.status IN ('OPEN','PARTIAL')) AS open_player_orders,
      (SELECT COALESCE(MAX(id), 0) FROM price_history) AS price_points,
      (SELECT created_at FROM price_history ORDER BY id LIMIT 1) AS history_since`).bind(today),
    env.DB.prepare(PLAYERS_SQL),
    env.DB.prepare('SELECT account_id, username, method, success, ip_address, created_at FROM login_events ORDER BY id DESC LIMIT 100'),
  ]);
  const size = status.meta?.size_after;
  return json({ ok: true, status: { ...status.results[0], database_ok: true, database_bytes: Number.isFinite(size) ? size : null }, players: players.results, logins: logins.results });
}

async function player(env, id) {
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, message: '玩家編號不正確' }, 400);
  const [info, holdings, trades, orders, logins] = await env.DB.batch([
    env.DB.prepare(PLAYERS_SQL.replace('WHERE a.is_bot = 0', 'WHERE a.is_bot = 0 AND a.id = ?1')).bind(id),
    env.DB.prepare('SELECT h.symbol, COALESCE(s.nickname, s.name) AS name, h.shares, s.price FROM holdings h JOIN stocks s ON s.symbol = h.symbol WHERE h.account_id = ? AND h.shares > 0 ORDER BY h.shares * s.price DESC').bind(id),
    env.DB.prepare('SELECT t.symbol, COALESCE(s.nickname, s.name) AS name, t.side, t.shares, t.price, t.amount, t.fee_amount, t.created_at FROM trades t JOIN stocks s ON s.symbol = t.symbol WHERE t.account_id = ? ORDER BY t.id DESC LIMIT 200').bind(id),
    env.DB.prepare('SELECT o.symbol, COALESCE(s.nickname, s.name) AS name, o.side, o.type, o.price, o.shares, o.filled_shares, o.status, o.created_at FROM orders o JOIN stocks s ON s.symbol = o.symbol WHERE o.account_id = ? ORDER BY o.id DESC LIMIT 100').bind(id),
    env.DB.prepare('SELECT username, method, success, ip_address, created_at FROM login_events WHERE account_id = ? ORDER BY id DESC LIMIT 100').bind(id),
  ]);
  if (!info.results.length) return json({ ok: false, message: '找不到這位玩家' }, 404);
  return json({ ok: true, player: info.results[0], holdings: holdings.results, trades: trades.results, orders: orders.results, logins: logins.results });
}

// D1 免費額度用量：本站自己記錄的數字；有設定 Cloudflare API token 時另附官方統計。
async function usage(env) {
  let report;
  try { report = await usageReport(env.DB); }
  catch (err) { if (!String(err).includes('usage_minutes')) throw err; return json({ ok: false, message: '尚未套用 0017 資料庫遷移，還沒有用量紀錄' }, 503); }
  return json({ ok: true, ...report, official: await officialUsage(env) });
}

// 從排行榜隱藏／恢復（測試帳號、不當暱稱）。不刪除任何交易紀錄。
async function setHidden(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, message: '請從本站操作' }, 403);
  const input = await request.json().catch(() => ({}));
  const id = Number(input.id);
  if (!Number.isInteger(id) || id <= 0 || typeof input.hidden !== 'boolean') return json({ ok: false, message: '資料不正確' }, 400);
  const result = await env.DB.prepare('UPDATE accounts SET hidden=? WHERE id=? AND is_bot=0').bind(input.hidden ? 1 : 0, id).run();
  if (!result.meta.changes) return json({ ok: false, message: '找不到這位玩家' }, 404);
  return json({ ok: true, id, hidden: input.hidden });
}

export async function adminRoute(request, env, path) {
  const u = new URL(request.url);
  if (path === '/admin' && request.method === 'GET') return new Response(ADMIN_HTML, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  if (path === '/api/admin/player/hidden' && request.method === 'POST') return setHidden(request, env);
  if (!path.startsWith('/api/admin/') || request.method !== 'GET') return null;
  if (path === '/api/admin/overview') return overview(env);
  if (path === '/api/admin/usage') return usage(env);
  if (path === '/api/admin/player') return player(env, Number(u.searchParams.get('id')));
  return json({ ok: false }, 404);
}

export async function recordLogin(db, request, result, method, username) {
  const ip = request.headers.get('CF-Connecting-IP');
  await db.prepare('INSERT INTO login_events(account_id,username,method,success,ip_address) VALUES(?,?,?,?,?)')
    .bind(result?.accountId ?? null, result?.username ?? (typeof username === 'string' ? username.slice(0, 40) : null), method, result ? 1 : 0, ip && ip.length <= 45 ? ip : null).run();
}
