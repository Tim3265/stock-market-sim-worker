import { beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { maybeTick } from '../src/domain/marketMaker.js';
const base='https://example.com';
async function get(path){const r=await SELF.fetch(base+path);return {status:r.status,body:await r.json()};}
async function order(data){const r=await SELF.fetch(base+'/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};}
beforeEach(async()=>{await env.DB.batch(env.ORDERBOOK_MIGRATIONS[0].queries.map(sql=>env.DB.prepare(sql)));});
describe('Sprint 2: 市價單及造市商',()=>{
 it('走勢只提供該股票最近六小時的真實成交紀錄，依時間順序回傳',async()=>{
  await env.DB.prepare("INSERT INTO price_history(symbol,price,source,created_at) VALUES ('2330',900,'TRADE',datetime('now','-7 hours')),('2330',975,'TRADE',datetime('now','-5 minutes')),('2330',980,'TRADE',datetime('now','-1 minute')),('YZU',45,'TRADE',datetime('now'))").run();
  const r=await get('/api/history?symbol=2330');
  expect(r.status).toBe(200);
  expect(r.body.history.map(point=>point.price)).toEqual([975,980]);
  expect((await get('/api/history?symbol=missing')).status).toBe(404);
 });
 it('限價買單未成交時凍結資金，取消後釋放',async()=>{
  await get('/api/orderbook?symbol=YZU');
  const placed=await order({account_id:1,symbol:'YZU',side:'BUY',type:'LIMIT',price:41,shares:10,request_id:'limit-buy-test-0001'});
  expect(placed.body).toMatchObject({status:'OPEN',filledShares:0,remaining:10});
  expect(await env.DB.prepare('SELECT frozen_cash FROM accounts WHERE id=1').first()).toEqual({frozen_cash:410});
  expect((await get('/api/orders?id=1')).body.orders[0]).toMatchObject({status:'OPEN',price:41});
  const response=await SELF.fetch(base+'/api/orders/'+placed.body.orderId+'?account_id=1',{method:'DELETE'});
  expect(response.status).toBe(200);
  expect(await env.DB.prepare('SELECT frozen_cash FROM accounts WHERE id=1').first()).toEqual({frozen_cash:0});
 });
 it('限價單跨價成交後只凍結剩餘股數，另一位玩家可成交它',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(2,'乙',100000,100000)").run();
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(2,'YZU',10)").run();
  const buy=await order({account_id:1,symbol:'YZU',side:'BUY',type:'LIMIT',price:44,shares:10,request_id:'resting-buy-test-01'});
  expect(buy.body.status).toBe('OPEN');
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE account_id=1000000 AND symbol='YZU' AND side='BUY'").run();
  const sell=await order({account_id:2,symbol:'YZU',side:'SELL',type:'LIMIT',price:44,shares:5,request_id:'resting-sell-test-1'});
  expect(sell.body).toMatchObject({status:'FILLED',filledShares:5});
  expect(await env.DB.prepare('SELECT frozen_cash FROM accounts WHERE id=1').first()).toEqual({frozen_cash:220});
  const playerOrders=await get('/api/orders?id=1');
  expect(playerOrders.body.orders[0]).toMatchObject({status:'PARTIAL',filled_shares:5});
 });
 it('造市商重新報價穿過玩家限價時，會成交並釋放剩餘凍結資金',async()=>{
  await get('/api/orderbook?symbol=YZU');
  const buy=await order({account_id:1,symbol:'YZU',side:'BUY',type:'LIMIT',price:44,shares:10,request_id:'requote-player-0001'});
  expect(buy.body.status).toBe('OPEN');
  await env.DB.prepare("UPDATE orders SET price=43 WHERE id=(SELECT id FROM orders WHERE account_id=1000000 AND symbol='YZU' AND side='SELL' AND status='OPEN' ORDER BY id LIMIT 1)").run();
  const result=await get('/api/orders?id=1');
  expect(result.body.orders[0]).toMatchObject({status:'FILLED',filled_shares:10});
  expect(await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=1').first()).toEqual({cash:99570,frozen_cash:0});
  expect((await get('/api/history?symbol=YZU')).body.history.at(-1).price).toBe(43);
 });
 it('限價賣單凍結持股，不能重複出售，取消後能再次使用',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await order({account_id:1,symbol:'YZU',side:'BUY',shares:10,request_id:'sell-limit-buy-0001'});
  const sell=await order({account_id:1,symbol:'YZU',side:'SELL',type:'LIMIT',price:49,shares:10,request_id:'sell-limit-open-001'});
  expect(sell.body.status).toBe('OPEN');
  expect((await order({account_id:1,symbol:'YZU',side:'SELL',shares:1,request_id:'sell-limit-again-01'})).body.code).toBe('INSUFFICIENT_SHARES');
  expect(await env.DB.prepare("SELECT shares,frozen_shares FROM holdings WHERE account_id=1 AND symbol='YZU'").first()).toEqual({shares:10,frozen_shares:10});
  expect((await SELF.fetch(base+'/api/orders/'+sell.body.orderId+'?account_id=1',{method:'DELETE'})).status).toBe(200);
  expect(await env.DB.prepare("SELECT shares,frozen_shares FROM holdings WHERE account_id=1 AND symbol='YZU'").first()).toEqual({shares:10,frozen_shares:0});
 });
 it('同時取消與對手下單不會重複釋放資金或憑空增加股份',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(2,'乙',100000,100000)").run();
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(2,'YZU',10)").run();
  const buy=await order({account_id:1,symbol:'YZU',side:'BUY',type:'LIMIT',price:44,shares:10,request_id:'race-limit-buy-001'});
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE account_id=1000000 AND symbol='YZU' AND side='BUY'").run();
  await Promise.all([SELF.fetch(base+'/api/orders/'+buy.body.orderId+'?account_id=1',{method:'DELETE'}),order({account_id:2,symbol:'YZU',side:'SELL',shares:10,request_id:'race-limit-sell-01'})]);
  const state=await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=1').first();
  expect(state.frozen_cash).toBe(0);
  expect(state.cash).toBeGreaterThanOrEqual(99560);
  expect(state.cash).toBeLessThanOrEqual(100000);
  expect((await env.DB.prepare("SELECT SUM(shares) total FROM holdings WHERE account_id IN (1,2) AND symbol='YZU'").first()).total).toBe(10);
 });
 it('造市商產生買賣五檔，玩家買入並以掛單價交割',async()=>{
  const book=await get('/api/orderbook?symbol=2330');
  expect(book.status).toBe(200);expect(book.body.asks.length).toBeGreaterThan(0);
  const makerPrice=book.body.asks[0].price;
  const result=await order({account_id:1,symbol:'2330',side:'BUY',type:'MARKET',shares:10,request_id:'one-test-request-0001'});
  expect(result.status).toBe(200);expect(result.body).toMatchObject({filledShares:10,remaining:0,status:'FILLED'});
  expect(result.body.fills[0]).toMatchObject({price:makerPrice,shares:10});
  const buyer=await get('/api/account?id=1');expect(buyer.body.account.cash).toBeCloseTo(100000-makerPrice*10,2);
  expect(buyer.body.holdings.find(h=>h.symbol==='2330').shares).toBe(10);
  const seller=await get('/api/account?id=1000000');expect(seller.body.holdings.find(h=>h.symbol==='2330').shares).toBe(1999990);
 });
 it('買單流動性不足時部分成交並取消餘量',async()=>{
  await get('/api/orderbook?symbol=YOUJIAN');
  await env.DB.prepare('UPDATE accounts SET cash=10000000 WHERE id=1').run();
  const r=await order({account_id:1,symbol:'YOUJIAN',side:'BUY',type:'MARKET',shares:1000,request_id:'partial-request-0001'});
  expect(r.status).toBe(200);expect(r.body.filledShares).toBe(340);expect(r.body.remaining).toBe(660);expect(r.body.status).toBe('CANCELLED');
 });
 it('六檔股票含右鍵，不把舊資料中的股票刪除',async()=>{
  const r=await get('/api/stocks');expect(r.body.stocks.map(s=>s.symbol).sort()).toEqual(['2317','2330','2454','3711','YOUJIAN','YZU']);
  expect(await env.DB.prepare("SELECT symbol FROM stocks WHERE symbol='0050'").first()).toBeTruthy();
 });
 it('沒有對手盤時市價單全數取消，成交價不變',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE symbol='YZU' AND side='SELL'").run();
  const before=await env.DB.prepare("SELECT price FROM stocks WHERE symbol='YZU'").first();
  const r=await order({account_id:1,symbol:'YZU',side:'BUY',shares:10,request_id:'no-liquidity-0001'});
  expect(r.body).toMatchObject({filledShares:0,remaining:10,status:'CANCELLED',fills:[]});
  expect(await env.DB.prepare("SELECT price FROM stocks WHERE symbol='YZU'").first()).toEqual(before);
 });
 it('相同請求重送不重複交易',async()=>{
  await get('/api/orderbook?symbol=2330');
  const input={account_id:1,symbol:'2330',side:'BUY',shares:1,request_id:'duplicate-test-0001'};
  const results=await Promise.all([order(input),order(input)]);
  expect(results.map(r=>r.status)).toEqual([200,200]);
  expect(results[0].body.orderId).toBe(results[1].body.orderId);
  const a=await get('/api/account?id=1');expect(a.body.holdings.find(h=>h.symbol==='2330').shares).toBe(1);
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM order_fills").first()).toMatchObject({n:1});
 });
 it('同時買入兩次、資金只夠一次時不能透支',async()=>{
  await get('/api/orderbook?symbol=2330');
  await env.DB.prepare('UPDATE accounts SET cash=1000 WHERE id=1').run();
  const payload={account_id:1,symbol:'2330',side:'BUY',shares:1};
  const r=await Promise.all([order({...payload,request_id:'concurrent-a-0001'}),order({...payload,request_id:'concurrent-b-0001'})]);
  expect(r.map(x=>x.status).sort()).toEqual([200,400]);
  const a=await get('/api/account?id=1');expect(a.body.account.cash).toBeGreaterThanOrEqual(0);
  expect(a.body.holdings.find(h=>h.symbol==='2330').shares).toBe(1);
 });
 it('買賣交割保持雙方現金與股份總數',async()=>{
  await get('/api/orderbook?symbol=2330');
  const cash=await env.DB.prepare('SELECT ROUND(SUM(cash),2) n FROM accounts').first();
  const shares=await env.DB.prepare("SELECT SUM(shares) n FROM holdings WHERE symbol='2330'").first();
  expect((await order({account_id:1,symbol:'2330',side:'BUY',shares:12,request_id:'conservation-buy-1'})).status).toBe(200);
  expect((await order({account_id:1,symbol:'2330',side:'SELL',shares:7,request_id:'conservation-sell-1'})).status).toBe(200);
  expect(await env.DB.prepare('SELECT ROUND(SUM(cash),2) n FROM accounts').first()).toEqual(cash);
  expect(await env.DB.prepare("SELECT SUM(shares) n FROM holdings WHERE symbol='2330'").first()).toEqual(shares);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM transaction_guard').first()).toMatchObject({n:0});
 });
 it('舊版直接成交 API 在遷移後不能繞過委託簿',async()=>{
  const r=await SELF.fetch(base+'/api/trade',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account_id:1,symbol:'2330',side:'BUY',shares:1})});
  expect(r.status).toBe(400);
 });
 it('超出漲跌停的限價被拒絕，不建立委託',async()=>{
  await get('/api/orderbook?symbol=YZU');
  const r=await order({account_id:1,symbol:'YZU',side:'BUY',type:'LIMIT',price:100,shares:1,request_id:'out-of-band-0001'});
  expect(r).toMatchObject({status:400,body:{code:'PRICE_LIMIT'}});
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM orders WHERE account_id=1").first()).toMatchObject({n:0});
 });
 it('多檔價格優先、同價先到先成交，成交價採掛單價',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE account_id=1000000 AND symbol='YZU' AND side='BUY'").run();
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(10,'甲',100,100),(11,'乙',100,100),(12,'丙',100,100)").run();
  for(const id of [10,11,12]) await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares,frozen_shares) VALUES(?,'YZU',10,10)").bind(id).run();
  for(const [id,price] of [[10,44],[11,43],[12,43]])await env.DB.prepare("INSERT INTO orders(account_id,symbol,side,type,price,shares,status) VALUES(?,'YZU','SELL','LIMIT',?,10,'OPEN')").bind(id,price).run();
  const r=await order({account_id:1,symbol:'YZU',side:'BUY',shares:23,request_id:'priority-test-0001'});
  expect(r.status).toBe(200);expect(r.body.fills.map(f=>[f.price,f.shares])).toEqual([[43,10],[43,10],[44,3]]);
  expect(r.body.amount).toBe(992);
  expect(await env.DB.prepare('SELECT SUM(shares) n FROM holdings WHERE account_id IN(10,11,12)').first()).toMatchObject({n:7});
 });
 it('交割途中失敗時整筆回復，不留下成交或現金變化',async()=>{
  await get('/api/orderbook?symbol=2330');
  const before=await env.DB.prepare("SELECT cash FROM accounts WHERE id=1").first();
  const revision=await env.DB.prepare('SELECT match_seq FROM market_state WHERE id=1').first();
  await env.DB.exec("CREATE TRIGGER fail_test BEFORE INSERT ON order_fills BEGIN SELECT RAISE(ABORT, 'TEST_FAILURE'); END");
  try {
   const r=await order({account_id:1,symbol:'2330',side:'BUY',shares:1,request_id:'rollback-test-0001'});
   expect(r.status).toBe(500);
   expect(await env.DB.prepare('SELECT cash FROM accounts WHERE id=1').first()).toEqual(before);
   expect(await env.DB.prepare('SELECT match_seq FROM market_state WHERE id=1').first()).toEqual(revision);
   expect(await env.DB.prepare('SELECT COUNT(*) n FROM trades').first()).toMatchObject({n:0});
   expect(await env.DB.prepare('SELECT COUNT(*) n FROM order_fills').first()).toMatchObject({n:0});
  } finally {await env.DB.exec('DROP TRIGGER fail_test');}
 });
 it('同時讀取行情只推進一輪，10 秒內不重複推進',async()=>{
  const results=await Promise.all(Array.from({length:8},()=>get('/api/stocks')));
  expect(results.every(r=>r.status===200)).toBe(true);
  expect(await env.DB.prepare('SELECT tick_count FROM market_state WHERE id=1').first()).toMatchObject({tick_count:1});
  await get('/api/stocks');expect(await env.DB.prepare('SELECT tick_count FROM market_state WHERE id=1').first()).toMatchObject({tick_count:1});
 });
 it('並行賣出不能超過持股',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await order({account_id:1,symbol:'YZU',side:'BUY',shares:5,request_id:'before-sell-buy-01'});
  const r=await Promise.all(['sell-parallel-0001','sell-parallel-0002'].map(request_id=>order({account_id:1,symbol:'YZU',side:'SELL',shares:5,request_id})));
  expect(r.map(x=>x.status).sort()).toEqual([200,400]);
  expect(await env.DB.prepare("SELECT shares FROM holdings WHERE account_id=1 AND symbol='YZU'").first()).toMatchObject({shares:0});
 });
 it('造市商資金或庫存耗盡時停止該方向報價，市場仍可運作',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare('UPDATE accounts SET cash=0,frozen_cash=0 WHERE id=1000000').run();
  await env.DB.prepare("UPDATE holdings SET shares=0,frozen_shares=0 WHERE account_id=1000000 AND symbol='YZU'").run();
  await env.DB.prepare('UPDATE market_state SET last_tick_at=0').run();
  const result=await get('/api/orderbook?symbol=YZU');
  expect(result.status).toBe(200);expect(result.body.bids).toEqual([]);expect(result.body.asks).toEqual([]);
 });
 it('時間到了只推進一輪，不補跑，且無成交時股價不變',async()=>{
  const before=await env.DB.prepare("SELECT price FROM stocks WHERE symbol='2330'").first();
  expect(await maybeTick(env.DB,2000000000000)).toBe(true);
  expect(await maybeTick(env.DB,2000000001000)).toBe(false);
  expect(await maybeTick(env.DB,2000000060000)).toBe(true);
  expect(await env.DB.prepare('SELECT tick_count FROM market_state WHERE id=1').first()).toMatchObject({tick_count:2});
  expect(await env.DB.prepare("SELECT price FROM stocks WHERE symbol='2330'").first()).toEqual(before);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM price_history').first()).toMatchObject({n:0});
 });
 it('一萬股對不同流動性的影響及成交量不同',async()=>{
  await get('/api/orderbook?symbol=2330');
  await env.DB.prepare('UPDATE accounts SET cash=20000000 WHERE id=1').run();
  const large=await order({account_id:1,symbol:'2330',side:'BUY',shares:10000,request_id:'liquid-market-0001'});
  expect(large.body.filledShares).toBe(10000);
  const small=await order({account_id:1,symbol:'YZU',side:'BUY',shares:10000,request_id:'thin-market-00001'});
  expect(small.body.filledShares).toBe(510);expect(small.body.remaining).toBe(9490);
  expect(new Set(large.body.fills.map(f=>f.price)).size).toBe(1);
  expect(new Set(small.body.fills.map(f=>f.price)).size).toBeGreaterThan(1);
 });
});
