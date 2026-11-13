// 额度量测：模拟玩家轮询与 tick 推进，统计 D1 rows_read / rows_written。
// 用法：npx vitest run test/quota.measure.test.js —— 会印出 JSON 基准数字。
import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';

beforeEach(async () => {
  for (const m of env.ORDERBOOK_MIGRATIONS) await env.DB.batch(m.queries.map((sql) => env.DB.prepare(sql)));
});

function instrument(db, acc) {
  const wrapStmt = (stmt) => new Proxy(stmt, {
    get(t, prop) {
      if (prop === 'bind') return (...a) => wrapStmt(t.bind(...a));
      if (prop === 'first' || prop === 'all' || prop === 'run') return async (...a) => {
        const r = await t[prop](...a);
        if (r && r.meta) { acc.read += r.meta.rows_read || 0; acc.written += r.meta.rows_written || 0; }
        return r;
      };
      return t[prop];
    }
  });
  return new Proxy(db, {
    get(t, prop) {
      if (prop === 'prepare') return (sql) => wrapStmt(t.prepare(sql));
      if (prop === 'batch') return async (stmts) => {
        const res = await t.batch(stmts);
        for (const r of res) if (r && r.meta) { acc.read += r.meta.rows_read || 0; acc.written += r.meta.rows_written || 0; }
        return res;
      };
      if (prop === 'exec') return async (sql) => {
        const r = await t.exec(sql);
        return r;
      };
      return t[prop];
    }
  });
}

async function call(ienv, path, cookie, method = 'GET', body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://example.com' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), ienv);
  return res;
}

it('量測 D1額度消耗基準', async () => {
  const acc = { read: 0, written: 0 };
  const ienv = new Proxy(env, { get(t, p) { return p === 'DB' ? instrument(t.DB, acc) : t[p]; } });

  // 建一个玩家帳號
  const g = await call(ienv, '/api/auth/guest', null, 'POST', { nickname: 'quota' });
  const cookie = g.headers.get('Set-Cookie').split(';')[0];
  expect(g.status).toBe(200);

  // Phase A: 12 個 poll cycle（新 client 每輪只打 /api/live）
  acc.read = 0; acc.written = 0;
  for (let i = 0; i < 12; i++) {
    await call(ienv, '/api/live?symbol=2330', cookie);
  }
  const pollRead = acc.read / 12, pollWritten = acc.written / 12;

  // Phase B: fast-forward 60 ticks（模拟 15 分鐘市場推進）
  acc.read = 0; acc.written = 0;
  const ff = await call(ienv, '/api/market/fast-forward', cookie, 'POST', { ticks: 60 });
  expect(ff.status).toBe(200);
  const tickRead = acc.read / 60, tickWritten = acc.written / 60;

  const report = {
    perPollCycle: { rowsRead: Math.round(pollRead), rowsWritten: Math.round(pollWritten) },
    perTick: { rowsRead: Math.round(tickRead), rowsWritten: Math.round(tickWritten) },
    assumptions: { pollIntervalSec: 5, tickIntervalSec: 15 },
    perUserPerMin: {
      rowsRead: Math.round(pollRead * (60 / 5) + tickRead * (60 / 15)),
      rowsWritten: Math.round(pollWritten * (60 / 5) + tickWritten * (60 / 15)),
    },
  };
  console.log('QUOTA-REPORT ' + JSON.stringify(report));
  expect(report.perPollCycle.rowsRead).toBeGreaterThan(0);
}, 120000);
