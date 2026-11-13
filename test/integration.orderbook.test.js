import { beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { maybeTick } from '../src/domain/marketMaker.js';
const base='https://example.com';
async function cookie(id=1){
 const token=Number(id).toString(16).padStart(64,'0');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare("INSERT OR IGNORE INTO player_credentials(account_id,username,password_salt,password_hash) VALUES(?,?,?,?)").bind(id,'test_'+id,'00','00').run();
 await env.DB.prepare('INSERT OR IGNORE INTO player_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(hash,id,Date.now()+600000).run();
 return 'stock_session='+token;
}
async function get(path){const id=Number(new URL(base+path).searchParams.get('id')||1);const r=await SELF.fetch(base+path,{headers:{Cookie:await cookie(id)}});return {status:r.status,body:await r.json()};}
async function order(data){const r=await SELF.fetch(base+'/api/orders',{method:'POST',headers:{'content-type':'application/json',Cookie:await cookie(data.account_id||1)},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};}
beforeEach(async()=>{for(const migration of env.ORDERBOOK_MIGRATIONS)await env.DB.batch(migration.queries.map(sql=>env.DB.prepare(sql)));});
describe('Sprint 2: 市價單及造市商',()=>{
 it('每筆成交手續費按大樹證券 2.8 折（0.0399%）向上取到分，費用進入費用帳',async()=>{
  await get('/api/stocks');
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE symbol='YZU' AND side='SELL'").run();
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(12,'seller',100,100)").run();
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares,frozen_shares) VALUES(12,'YZU',100,100)").run();
  await env.DB.prepare("INSERT INTO orders(account_id,symbol,side,type,price,shares,status) VALUES(12,'YZU','SELL','LIMIT',45,100,'OPEN')").run();
  const result=await order({account_id:1,symbol:'YZU',side:'BUY',shares:100,request_id:'fee-test-00000001'});
  expect(result.body).toMatchObject({amount:4500,fee:1.80});
  expect(await env.DB.prepare('SELECT cash FROM accounts WHERE id=1').first()).toEqual({cash:95498.20});
  expect(await env.DB.prepare('SELECT amount FROM fee_revenue WHERE id=1').first()).toEqual({amount:1.80});
  expect(await env.DB.prepare("SELECT fee_amount FROM trades WHERE account_id=12").first()).toEqual({fee_amount:0});
 });
 it('市場活躍時機器人偶爾真實成交，並發請求不重複執行',async()=>{
  await get('/api/stocks');
  await env.DB.prepare('UPDATE market_state SET tick_count=6,last_tick_at=? WHERE id=1').bind(Date.now()).run();
  const result=await Promise.all(Array.from({length:5},()=>get('/api/stocks')));
  expect(result.every(r=>r.status===200)).toBe(true);
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM orders WHERE request_id='bot-activity-tick-6'").first()).toEqual({n:1});
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM order_fills WHERE buyer_id=1000001 OR seller_id=1000001").first()).n).toBe(1);
 });
 it('連續上漲與恐慌狀態觸發各自機器人下單',async()=>{
  await get('/api/stocks');
  for(const price of [1200,1210,1220,1230,1240])await env.DB.prepare("INSERT INTO price_history(symbol,price,source) VALUES('2454',?,'TRADE')").bind(price).run();
  await env.DB.prepare("INSERT INTO bot_state(account_id,symbol,panic_until) VALUES(1000003,'2454',6)").run();
  await env.DB.prepare('UPDATE market_state SET tick_count=6,last_tick_at=?').bind(Date.now()).run();
  expect((await get('/api/stocks')).status).toBe(200);
  expect(await env.DB.prepare("SELECT account_id,side FROM orders WHERE request_id='bot-momentum-2454-tick-6'").first()).toEqual({account_id:1000001,side:'BUY'});
  expect(await env.DB.prepare("SELECT account_id,side FROM orders WHERE request_id='bot-panic-2454-tick-6'").first()).toEqual({account_id:1000003,side:'SELL'});
 });
 it('偏離合理價格時價值機器人會反向掛限價單',async()=>{
  await get('/api/stocks');
  await env.DB.prepare("UPDATE stocks SET price=48 WHERE symbol='YZU'").run();
  await env.DB.prepare('UPDATE market_state SET tick_count=10,last_tick_at=?').bind(Date.now()).run();
  expect((await get('/api/stocks')).status).toBe(200);
  expect(await env.DB.prepare("SELECT account_id,side,type FROM orders WHERE request_id='bot-value-YZU-tick-10'").first()).toEqual({account_id:1000002,side:'SELL',type:'LIMIT'});
 });
 it('走勢只提供該股票最近六小時的真實成交紀錄，依時間順序回傳',async()=>{
  await env.DB.prepare("INSERT INTO price_history(symbol,price,source,created_at) VALUES ('2330',900,'TRADE',datetime('now','-7 hours')),('2330',975,'TRADE',datetime('now','-5 minutes')),('2330',980,'TRADE',datetime('now','-1 minute')),('YZU',45,'TRADE',datetime('now'))").run();
  const r=await get('/api/history?symbol=2330');
  expect(r.status).toBe(200);
  expect(r.body.history.map(point=>point.price)).toEqual([975,980]);
  const all=await get('/api/histories');
  expect(Object.keys(all.body.histories)).toHaveLength(6);
  expect(all.body.histories['2330'].map(point=>point.price)).toEqual([975,980]);
  expect(all.body.histories.YZU.map(point=>point.price)).toEqual([45]);
  expect((await get('/api/history?symbol=missing')).status).toBe(404);
 });
 it('限價買單未成交時凍結資金，取消後釋放',async()=>{
  await get('/api/orderbook?symbol=YZU');
  const placed=await order({account_id:1,symbol:'YZU',side:'BUY',type:'LIMIT',price:41,shares:10,request_id:'limit-buy-test-0001'});
  expect(placed.body).toMatchObject({status:'OPEN',filledShares:0,remaining:10});
  expect(await env.DB.prepare('SELECT frozen_cash FROM accounts WHERE id=1').first()).toEqual({frozen_cash:410.17});
  expect((await get('/api/orders?id=1')).body.orders[0]).toMatchObject({status:'OPEN',price:41});
  const response=await SELF.fetch(base+'/api/orders/'+placed.body.orderId+'?account_id=1',{method:'DELETE',headers:{Cookie:await cookie(1)}});
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
  expect(await env.DB.prepare('SELECT frozen_cash FROM accounts WHERE id=1').first()).toEqual({frozen_cash:220.09});
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
  expect(await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=1').first()).toEqual({cash:99569.82,frozen_cash:0});
  expect((await get('/api/history?symbol=YZU')).body.history.at(-1).price).toBe(43);
 });
 it('限價賣單凍結持股，不能重複出售，取消後能再次使用',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await order({account_id:1,symbol:'YZU',side:'BUY',shares:10,request_id:'sell-limit-buy-0001'});
  const sell=await order({account_id:1,symbol:'YZU',side:'SELL',type:'LIMIT',price:49,shares:10,request_id:'sell-limit-open-001'});
  expect(sell.body.status).toBe('OPEN');
  expect((await order({account_id:1,symbol:'YZU',side:'SELL',shares:1,request_id:'sell-limit-again-01'})).body.code).toBe('INSUFFICIENT_SHARES');
  expect(await env.DB.prepare("SELECT shares,frozen_shares FROM holdings WHERE account_id=1 AND symbol='YZU'").first()).toEqual({shares:10,frozen_shares:10});
  expect((await SELF.fetch(base+'/api/orders/'+sell.body.orderId+'?account_id=1',{method:'DELETE',headers:{Cookie:await cookie(1)}})).status).toBe(200);
  expect(await env.DB.prepare("SELECT shares,frozen_shares FROM holdings WHERE account_id=1 AND symbol='YZU'").first()).toEqual({shares:10,frozen_shares:0});
 });
 it('同時取消與對手下單不會重複釋放資金或憑空增加股份',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(2,'乙',100000,100000)").run();
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(2,'YZU',10)").run();
  const buy=await order({account_id:1,symbol:'YZU',side:'BUY',type:'LIMIT',price:44,shares:10,request_id:'race-limit-buy-001'});
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE account_id=1000000 AND symbol='YZU' AND side='BUY'").run();
  await Promise.all([SELF.fetch(base+'/api/orders/'+buy.body.orderId+'?account_id=1',{method:'DELETE',headers:{Cookie:await cookie(1)}}),order({account_id:2,symbol:'YZU',side:'SELL',shares:10,request_id:'race-limit-sell-01'})]);
  const state=await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=1').first();
  expect(state.frozen_cash).toBe(0);
  expect(state.cash).toBeGreaterThanOrEqual(99559.37);
  expect(state.cash).toBeLessThanOrEqual(100000);
  expect((await env.DB.prepare("SELECT SUM(shares) total FROM holdings WHERE account_id IN (1,2) AND symbol='YZU'").first()).total).toBe(10);
 });
 it('造市商產生買賣十檔，玩家買入並以掛單價交割',async()=>{
  const book=await get('/api/orderbook?symbol=2330');
  expect(book.status).toBe(200);expect(book.body.asks.length).toBe(5);expect(book.body.bids.length).toBe(5);
  const makerPrice=book.body.asks[0].price;
  const result=await order({account_id:1,symbol:'2330',side:'BUY',type:'MARKET',shares:10,request_id:'one-test-request-0001'});
  expect(result.status).toBe(200);expect(result.body).toMatchObject({filledShares:10,remaining:0,status:'FILLED'});
  expect(result.body.fills[0]).toMatchObject({price:makerPrice,shares:10});
  const buyer=await get('/api/account?id=1');expect(buyer.body.account.cash).toBeCloseTo(100000-makerPrice*10-result.body.fee,2);
  expect(buyer.body.holdings.find(h=>h.symbol==='2330').shares).toBe(10);
  const seller=await get('/api/account?id=1000000');expect(seller.body.holdings.find(h=>h.symbol==='2330').shares).toBe(1999990);
 });
 it('買單流動性不足時部分成交並取消餘量',async()=>{
  await get('/api/orderbook?symbol=YOUJIAN');
  await env.DB.prepare('UPDATE accounts SET cash=10000000 WHERE id=1').run();
  const r=await order({account_id:1,symbol:'YOUJIAN',side:'BUY',type:'MARKET',shares:2000,request_id:'partial-request-0001'});
  expect(r.status).toBe(200);expect(r.body.filledShares).toBe(1040);expect(r.body.remaining).toBe(960);expect(r.body.status).toBe('CANCELLED');
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
  expect(await env.DB.prepare('SELECT ROUND(SUM(cash)+(SELECT amount FROM fee_revenue WHERE id=1),2) n FROM accounts').first()).toEqual(cash);
  expect(await env.DB.prepare("SELECT SUM(shares) n FROM holdings WHERE symbol='2330'").first()).toEqual(shares);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM transaction_guard').first()).toMatchObject({n:0});
 });
 it('舊版直接成交 API 在遷移後不能繞過委託簿',async()=>{
  const r=await SELF.fetch(base+'/api/trade',{method:'POST',headers:{'content-type':'application/json',Cookie:await cookie(1)},body:JSON.stringify({account_id:1,symbol:'2330',side:'BUY',shares:1})});
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
 it('同時讀取行情只推進一輪，15 秒內不重複推進',async()=>{
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
  await env.DB.prepare('UPDATE market_state SET tick_count=4,last_tick_at=0').run();
  const result=await get('/api/orderbook?symbol=YZU');
  expect(result.status).toBe(200);expect(result.body.bids).toEqual([]);expect(result.body.asks).toEqual([]);
 });
 it('時間到了只推進一輪，不補跑，且無成交時股價不變',async()=>{
  const before=await env.DB.prepare("SELECT price FROM stocks WHERE symbol='2330'").first();
  expect(await maybeTick(env.DB,2000000000000)).toBe(true);
  expect(await maybeTick(env.DB,2000000001000)).toBe(false);
  expect(await maybeTick(env.DB,2000000014000)).toBe(false);
  expect(await maybeTick(env.DB,2000000015000)).toBe(true);
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
  expect(small.body.filledShares).toBe(1560);expect(small.body.remaining).toBe(8440);
  expect(new Set(large.body.fills.map(f=>f.price)).size).toBe(1);
  expect(new Set(small.body.fills.map(f=>f.price)).size).toBeGreaterThan(1);
 });
 it('回歸：資金全凍結的掛單買方仍可成交（trg_trade_buy_guard 檢查總現金）',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(3,'丙',440.18,440.18)").run();
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(4,'丁',100000,100000)").run();
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(4,'YZU',10)").run();
  const buy=await order({account_id:3,symbol:'YZU',side:'BUY',type:'LIMIT',price:44,shares:10,request_id:'frozen-fill-00001'});
  expect(buy.body.status).toBe('OPEN');
  expect(await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=3').first()).toEqual({cash:440.18,frozen_cash:440.18});
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE account_id=1000000 AND symbol='YZU' AND side='BUY'").run();
  const sell=await order({account_id:4,symbol:'YZU',side:'SELL',type:'LIMIT',price:44,shares:10,request_id:'frozen-fill-00002'});
  expect(sell.status).toBe(200);expect(sell.body).toMatchObject({status:'FILLED',filledShares:10});
  expect(await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=3').first()).toEqual({cash:0,frozen_cash:0});
 });
 it('回歸：掛單買方分兩次部分成交後凍結資金歸零且狀態為 FILLED',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(5,'戊',100000,100000)").run();
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(6,'己',100000,100000)").run();
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(6,'YZU',10)").run();
  const buy=await order({account_id:5,symbol:'YZU',side:'BUY',type:'LIMIT',price:44,shares:10,request_id:'partial-fee-00001'});
  expect(buy.body.status).toBe('OPEN');
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE account_id=1000000 AND symbol='YZU' AND side='BUY'").run();
  const s1=await order({account_id:6,symbol:'YZU',side:'SELL',type:'LIMIT',price:44,shares:5,request_id:'partial-fee-00002'});
  expect(s1.body).toMatchObject({status:'FILLED',filledShares:5});
  const s2=await order({account_id:6,symbol:'YZU',side:'SELL',type:'LIMIT',price:44,shares:5,request_id:'partial-fee-00003'});
  expect(s2.status).toBe(200);expect(s2.body).toMatchObject({status:'FILLED',filledShares:5});
  const st5=await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=5').first();expect(st5.frozen_cash).toBe(0);expect(st5.cash).toBeCloseTo(100000-440-0.18,2);
  expect((await env.DB.prepare("SELECT status FROM orders WHERE request_id='partial-fee-00001'").first()).status).toBe('FILLED');
 });
 it('回歸：直接寫入 trades 超出總現金時被資料庫觸發器擋下',async()=>{
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(7,'庚',100,100)").run();
  await expect(env.DB.prepare("INSERT INTO trades(account_id,symbol,side,shares,price,amount,fee_amount) VALUES(7,'YZU','BUY',1,200,200,1)").run()).rejects.toThrow(/INSUFFICIENT_CASH/);
 });
 it('回歸：未登入不能快轉或手動 tick，登入後快轉不會把市場時鐘推到未來',async()=>{
  const anon=await SELF.fetch(base+'/api/market/fast-forward',{method:'POST',headers:{'content-type':'application/json'},body:'{"ticks":2}'});
  expect(anon.status).toBe(401);
  const anonTick=await SELF.fetch(base+'/api/tick',{method:'POST'});
  expect(anonTick.status).toBe(401);
  const before=await env.DB.prepare('SELECT last_tick_at FROM market_state WHERE id=1').first();
  const r=await SELF.fetch(base+'/api/market/fast-forward',{method:'POST',headers:{'content-type':'application/json',Cookie:await cookie(1)},body:'{"ticks":2}'});
  expect(r.status).toBe(200);
  const after=await env.DB.prepare('SELECT last_tick_at FROM market_state WHERE id=1').first();
  expect(after.last_tick_at).toBeLessThanOrEqual(Date.now());
  expect(after.last_tick_at).toBeGreaterThanOrEqual(before.last_tick_at);
 });
 it('回歸：6+4 分批部分成交後凍結資金恰好歸零（預扣差額釋放）',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(8,'辛',100000,100000)").run();
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(9,'壬',100000,100000)").run();
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(9,'YZU',10)").run();
  const buy=await order({account_id:8,symbol:'YZU',side:'BUY',type:'LIMIT',price:44,shares:10,request_id:'split-fee-000001'});
  expect(buy.body.status).toBe('OPEN');
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE account_id=1000000 AND symbol='YZU' AND side='BUY'").run();
  const s1=await order({account_id:9,symbol:'YZU',side:'SELL',type:'LIMIT',price:44,shares:6,request_id:'split-fee-000002'});
  expect(s1.status).toBe(200);expect(s1.body).toMatchObject({status:'FILLED',filledShares:6});
  const s2=await order({account_id:9,symbol:'YZU',side:'SELL',type:'LIMIT',price:44,shares:4,request_id:'split-fee-000003'});
  expect(s2.status).toBe(200);expect(s2.body).toMatchObject({status:'FILLED',filledShares:4});
  const st=await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=8').first();
  expect(st.frozen_cash).toBe(0);
  expect(st.cash).toBeCloseTo(100000-440-0.18,2);
  expect((await env.DB.prepare("SELECT status FROM orders WHERE request_id='split-fee-000001'").first()).status).toBe('FILLED');
 });
 it('回歸：部分成交後取消剩餘，釋放金額不會超過凍結（不會觸發 CHECK 500）',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(10,'癸',100000,100000)").run();
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(11,'子',100000,100000)").run();
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(11,'YZU',10)").run();
  const buy=await order({account_id:10,symbol:'YZU',side:'BUY',type:'LIMIT',price:44,shares:10,request_id:'cancel-fee-00001'});
  expect(buy.body.status).toBe('OPEN');
  await env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE account_id=1000000 AND symbol='YZU' AND side='BUY'").run();
  const s1=await order({account_id:11,symbol:'YZU',side:'SELL',type:'LIMIT',price:44,shares:6,request_id:'cancel-fee-00002'});
  expect(s1.status).toBe(200);
  const del=await SELF.fetch(base+'/api/orders/'+buy.body.orderId+'?account_id=10',{method:'DELETE',headers:{Cookie:await cookie(10)}});
  expect(del.status).toBe(200);
  expect(await env.DB.prepare('SELECT frozen_cash FROM accounts WHERE id=10').first()).toEqual({frozen_cash:0});
 });
 it('回歸：現金恰好等於價款加手續費時，資料庫觸發器不會因浮點誤判而擋下',async()=>{
  // 1.14*100 在浮點下是 113.99999999999999；觸發器必須 ROUND 到分再比較。
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(13,'浮',1.14,1.14)").run();
  await env.DB.prepare("INSERT INTO orders(account_id,symbol,side,type,price,shares,filled_shares,status,request_id,fee_scheme) VALUES(13,'YZU','BUY','LIMIT',1.13,1,0,'OPEN','float-edge-00001',1)").run();
  await env.DB.prepare("INSERT INTO trades(account_id,symbol,side,shares,price,amount,fee_amount) VALUES(13,'YZU','BUY',1,1.13,1.13,0.01)").run();
  await env.DB.prepare("INSERT INTO trades(account_id,symbol,side,shares,price,amount,fee_amount) VALUES(13,'YZU','BUY',1,1.13,1.13,0.01)").run();
 });
 it('回歸：凍結資金大於初始資金時 recharge 仍成功（先撤單並清空凍結）',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash,frozen_cash) VALUES(14,'充',100000,300000,250000)").run();
  await env.DB.prepare("INSERT INTO orders(account_id,symbol,side,type,price,shares,status,request_id,fee_scheme) VALUES(14,'YZU','BUY','LIMIT',44,100,'OPEN','recharge-000001',1)").run();
  const r=await SELF.fetch(base+'/api/account/recharge',{method:'POST',headers:{Cookie:await cookie(14)}});
  expect(r.status).toBe(200);
  const st=await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=14').first();
  expect(st.frozen_cash).toBe(0);
  expect(st.cash).toBeGreaterThanOrEqual(100000);
  expect((await env.DB.prepare("SELECT status FROM orders WHERE request_id='recharge-000001'").first()).status).toBe('CANCELLED');
 });
 it('回歸：GET /api/orders 支援 status 篩選',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await order({account_id:1,symbol:'YZU',side:'BUY',type:'LIMIT',price:41,shares:10,request_id:'status-filter-001'});
  const open=await get('/api/orders?id=1&status=OPEN');
  expect(open.status).toBe(200);expect(open.body.orders.length).toBeGreaterThan(0);
  expect(open.body.orders.every(o=>o.status==='OPEN')).toBe(true);
  const bad=await get('/api/orders?id=1&status=NOPE');
  expect(bad.status).toBe(400);
 });
 it('回歸：下單回應含 lastPrice',async()=>{
  await get('/api/orderbook?symbol=2330');
  await env.DB.prepare('UPDATE accounts SET cash=20000000 WHERE id=1').run();
  const r=await order({account_id:1,symbol:'2330',side:'BUY',type:'MARKET',shares:1,request_id:'lastprice-000001'});
  expect(typeof r.body.lastPrice).toBe('number');
 });
 it('回歸：matchCrossed 撮合全額凍結的買單時手續費與釋放一致，不會觸發 CHECK 500',async()=>{
  await get('/api/orderbook?symbol=YZU');
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(15,'全凍',121.55,121.55)").run();
  const buy=await order({account_id:15,symbol:'YZU',side:'BUY',type:'LIMIT',price:40.50,shares:3,request_id:'mc-frozen-000001'});
  expect(buy.body.status).toBe('OPEN');
  expect(await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=15').first()).toEqual({cash:121.55,frozen_cash:121.55});
  // 造市商賣單改價到 40.50，下一個請求觸發 matchCrossed 穿價撮合
  await env.DB.prepare("UPDATE orders SET price=40.50, shares=1, filled_shares=0 WHERE id=(SELECT id FROM orders WHERE account_id=1000000 AND symbol='YZU' AND side='SELL' AND status='OPEN' ORDER BY id LIMIT 1)").run();
  const r=await get('/api/stocks');
  expect(r.status).toBe(200);
  const st=await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=15').first();
  expect(st.frozen_cash).toBeLessThanOrEqual(st.cash);
  expect(st.frozen_cash).toBeCloseTo(81.04,2);
  expect(st.cash).toBeCloseTo(81.04,2);
 });
});

describe("黑天鵝與市場快訊 API", () => {
  it("GET /api/events 回傳即時市場事件清單", async () => {
    const res = await (await SELF.fetch('https://example.com/api/events')).json();
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.events)).toBe(true);
    expect(res.events.length).toBeGreaterThan(0);
    expect(res.events[0]).toMatchObject({
      id: expect.any(String),
      symbol: expect.any(String),
      type: expect.any(String),
      title: expect.any(String),
      impact: expect.any(String),
      timestamp: expect.any(Number)
    });
  });

  it("GET /api/live 包含最新黑天鵝市場事件", async () => {
    const res = await (await SELF.fetch('https://example.com/api/live?symbol=2330')).json();
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.events)).toBe(true);
    expect(res.events.length).toBeGreaterThan(0);
  });
});
 it('trades 雙寫與 order_fills 一致（每筆成交兩列 trades + 一列 fills）',async()=>{
  await get('/api/orderbook?symbol=2330');
  await env.DB.prepare('UPDATE accounts SET cash=20000000 WHERE id=1').run();
  await order({account_id:1,symbol:'2330',side:'BUY',type:'MARKET',shares:10,request_id:'consistency-000001'});
  const fills=(await env.DB.prepare('SELECT COUNT(*) n FROM order_fills').first()).n;
  const trades=(await env.DB.prepare('SELECT COUNT(*) n FROM trades').first()).n;
  expect(trades).toBe(fills*2);
 });

 it('回歸：直接寫入 trades 超出總持股時被 trg_trade_sell_guard 擋下',async()=>{
  await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(8,'辛',100,100)").run();
  await expect(env.DB.prepare("INSERT INTO trades(account_id,symbol,side,shares,price,amount,fee_amount) VALUES(8,'YZU','SELL',5,45,225,0)").run()).rejects.toThrow(/INSUFFICIENT_SHARES/);
 });
