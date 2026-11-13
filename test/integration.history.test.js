import { beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
const base = 'https://example.com';
async function cookie(id = 1) {
  const token = Number(id).toString(16).padStart(64, '0');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare("INSERT OR IGNORE INTO player_credentials(account_id,username,password_salt,password_hash) VALUES(?,?,?,?)").bind(id, 'test_' + id, '00', '00').run();
  await env.DB.prepare('INSERT OR IGNORE INTO player_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(hash, id, Date.now() + 600000).run();
  return 'stock_session=' + token;
}
async function get(path) { const r = await SELF.fetch(base + path, { headers: { Cookie: await cookie() } }); return { status: r.status, body: await r.json() }; }
beforeEach(async () => { for (const migration of env.ORDERBOOK_MIGRATIONS) await env.DB.batch(migration.queries.map(sql => env.DB.prepare(sql))); });

describe('K 線圖資料：/api/history 回傳價格歷史 + 該股歷史成交', () => {
  it('回傳 history（時間升序）與 fills（時間升序），symbol 不存在回 404', async () => {
    await get('/api/stocks');
    await env.DB.prepare("INSERT INTO price_history(symbol,price,source,created_at) VALUES ('2330',900,'TRADE',datetime('now','-10 minutes')),('2330',910,'TRADE',datetime('now','-5 minutes')),('2330',920,'TRADE',datetime('now','-1 minute'))").run();
    await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(11,'buyer',100000,100000),(12,'seller',100,100)").run();
    await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares,frozen_shares) VALUES(12,'2330',100,100)").run();
    await env.DB.prepare("INSERT INTO orders(id,account_id,symbol,side,type,price,shares,filled_shares,status,request_id) VALUES(9001,11,'2330','BUY','MARKET',905,10,10,'FILLED','t-hist-1'),(9002,12,'2330','SELL','LIMIT',905,10,10,'FILLED','t-hist-2')").run();
    await env.DB.prepare("INSERT INTO order_fills(symbol,buyer_id,seller_id,maker_order_id,taker_order_id,shares,price,amount,created_at) VALUES('2330',11,12,9002,9001,10,905,9050,datetime('now','-3 minutes'))").run();
    const r = await get('/api/history?symbol=2330');
    expect(r.status).toBe(200);
    expect(r.body.history.map(p => p.price)).toEqual([900, 910, 920]);
    expect(r.body.fills).toHaveLength(1);
    expect(r.body.fills[0]).toMatchObject({ shares: 10, price: 905, buyer_name: 'buyer', seller_name: 'seller' });
    expect((await get('/api/history?symbol=NOPE')).status).toBe(404);
  });
  it('fills 只含查詢股票的成交，且走 idx_fills_symbol index', async () => {
    await get('/api/stocks');
    await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(11,'b',100000,100000),(12,'s',100,100)").run();
    await env.DB.prepare("INSERT INTO orders(id,account_id,symbol,side,type,price,shares,filled_shares,status,request_id) VALUES(9001,11,'2330','BUY','MARKET',900,5,5,'FILLED','t-hist-1'),(9002,12,'2330','SELL','LIMIT',900,5,5,'FILLED','t-hist-2'),(9003,11,'YZU','BUY','MARKET',45,5,5,'FILLED','t-hist-3'),(9004,12,'YZU','SELL','LIMIT',45,5,5,'FILLED','t-hist-4')").run();
    await env.DB.prepare("INSERT INTO order_fills(symbol,buyer_id,seller_id,maker_order_id,taker_order_id,shares,price,amount) VALUES('2330',11,12,9002,9001,5,900,4500),('YZU',11,12,9004,9003,5,45,225)").run();
    const r = await get('/api/history?symbol=YZU');
    expect(r.body.fills.map(f => f.symbol ?? 'YZU')).toHaveLength(1);
    expect(r.body.fills[0].price).toBe(45);
    const plan = await env.DB.prepare("EXPLAIN QUERY PLAN SELECT f.id FROM order_fills f WHERE f.symbol=? ORDER BY f.id DESC LIMIT 20").bind('YZU').all();
    expect(JSON.stringify(plan.results)).toContain('idx_fills_symbol');
  });
});
