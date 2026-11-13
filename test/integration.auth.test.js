import { beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
const base='https://example.com';
beforeEach(async()=>{for(const m of env.ORDERBOOK_MIGRATIONS)await env.DB.batch(m.queries.map(sql=>env.DB.prepare(sql)));});
async function post(path,data,cookie){return SELF.fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});}
async function create(name){
 const registration=await post('/api/auth/register',{username:name,password:'valid-pass-123'});expect(registration.status).toBe(200);
 const login=await post('/api/auth/login',{username:name,password:'valid-pass-123'});expect(login.status).toBe(200);return login.headers.get('Set-Cookie').split(';')[0];
}
it('recharge 在 CAS 重試耗盡時回傳 409 CONFLICT',async()=>{
 const login=await post('/api/auth/guest',{nickname:'conflict-user'});
 const cookie=login.headers.get('Set-Cookie').split(';')[0];
 await env.DB.exec("CREATE TRIGGER force_conflict BEFORE UPDATE ON market_state BEGIN SELECT RAISE(ABORT, 'market_revision_guard'); END;");
 try{
  const res=await post('/api/account/recharge',{},cookie);
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('CONFLICT');
 }finally{
  await env.DB.exec('DROP TRIGGER IF EXISTS force_conflict;');
 }
});

it('allows repeated guest logins with the same nickname',async()=>{
 const a=await post('/api/auth/guest',{nickname:'guest'}),b=await post('/api/auth/guest',{nickname:'guest'});
 expect(a.status).toBe(200);expect(b.status).toBe(200);
 const ca=a.headers.get('Set-Cookie').split(';')[0],cb=b.headers.get('Set-Cookie').split(';')[0];
 const aa=await (await SELF.fetch(base+'/api/account',{headers:{Cookie:ca}})).json();
 const ab=await (await SELF.fetch(base+'/api/account',{headers:{Cookie:cb}})).json();
 expect(aa.account.id).not.toBe(ab.account.id);
});
describe('玩家登入和資料隔離',()=>{
 it('成交類別篩選先查詢再限制筆數',async()=>{
  const cookie=await create('filtered_trades');
  const account=(await (await SELF.fetch(base+'/api/account',{headers:{Cookie:cookie}})).json()).account;
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(?,'YZU',1)").bind(account.id).run();
  const insert=side=>env.DB.prepare("INSERT INTO trades(account_id,symbol,side,shares,price,amount) VALUES(?,'YZU',?,1,45,45)").bind(account.id,side);
  await env.DB.batch([insert('SELL'),...Array.from({length:31},()=>insert('BUY'))]);
  const live=await (await SELF.fetch(base+'/api/live?trade_side=SELL',{headers:{Cookie:cookie}})).json();
  const trades=await (await SELF.fetch(base+'/api/trades?limit=30&side=SELL',{headers:{Cookie:cookie}})).json();
  expect(live.trades).toHaveLength(1);
  expect(live.trades[0].side).toBe('SELL');
  expect(live.trades).toEqual(trades.trades);
 });
 it('即時行情回傳登入玩家最新成交紀錄',async()=>{
  const cookie=await create('live_trades');
  const order=await post('/api/orders',{symbol:'YZU',side:'BUY',shares:1,request_id:'live-trades-test-0001'},cookie);
  expect(order.status).toBe(200);
  const live=await (await SELF.fetch(base+'/api/live?symbol=YZU',{headers:{Cookie:cookie}})).json();
  const trades=await (await SELF.fetch(base+'/api/trades?limit=30',{headers:{Cookie:cookie}})).json();
  expect(live.trades).toEqual(trades.trades);
  expect(live.trades.length).toBeGreaterThan(0);
 });
 it('未登入不能讀取帳戶或下單',async()=>{
  expect((await SELF.fetch(base+'/api/account')).status).toBe(401);
  expect((await post('/api/orders',{symbol:'YZU',side:'BUY',shares:1})).status).toBe(401);
 });
 it('帳號密碼登入，偽造 account_id 也無法操作他人',async()=>{
  const a=await create('player_a'),b=await create('player_b');
  const before=await (await SELF.fetch(base+'/api/account',{headers:{Cookie:b}})).json();
  const order=await post('/api/orders',{account_id:before.account.id,symbol:'YZU',side:'BUY',shares:1,request_id:'auth-test-order-00001'},a);
  expect(order.status).toBe(200);
  const after=await (await SELF.fetch(base+'/api/account?id='+before.account.id,{headers:{Cookie:b}})).json();
  expect(after.account.cash).toBe(before.account.cash);
  await expect((await SELF.fetch(base+'/api/account?id='+before.account.id,{headers:{Cookie:a}})).json()).resolves.not.toMatchObject({account:{id:before.account.id}});
 });
 it('不能透過變更帳戶參數查詢或取消其他人的委託',async()=>{
  const a=await create('owner_a'),b=await create('owner_b');
  const placed=await (await post('/api/orders',{symbol:'YZU',side:'BUY',type:'LIMIT',price:41,shares:1,request_id:'private-order-test-1'},a)).json();
  expect(placed.status).toBe('OPEN');
  const denied=await SELF.fetch(base+'/api/orders/'+placed.orderId+'?account_id=1',{method:'DELETE',headers:{Cookie:b}});
  expect(denied.status).toBe(403);
  const own=await (await SELF.fetch(base+'/api/orders?id=1',{headers:{Cookie:b}})).json();expect(own.orders).toEqual([]);
  const original=await (await SELF.fetch(base+'/api/orders',{headers:{Cookie:a}})).json();expect(original.orders[0].status).toBe('OPEN');
 });
 it('持股查詢顯示已凍結股數，供下單時顯示可賣數量',async()=>{
  const player=await create('holdings');
  const account=(await (await SELF.fetch(base+'/api/account',{headers:{Cookie:player}})).json()).account;
  await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares,frozen_shares) VALUES(?,'YZU',10,4)").bind(account.id).run();
  const result=await (await SELF.fetch(base+'/api/account',{headers:{Cookie:player}})).json();
  expect(result.holdings.find(h=>h.symbol==='YZU')).toMatchObject({shares:10,frozen_shares:4});
 });
 it('錯誤密碼被拒絕且登出後無法讀取資料',async()=>{
  const cookie=await create('player_c');
  expect((await post('/api/auth/login',{username:'player_c',password:'wrong-pass'})).status).toBe(401);
  expect((await post('/api/auth/logout',{},cookie)).status).toBe(200);
  expect((await SELF.fetch(base+'/api/account',{headers:{Cookie:cookie}})).status).toBe(401);
 });
 it('短時間大量登入嘗試會被限制',async()=>{
  for(let i=0;i<15;i++)expect((await post('/api/auth/login',{username:'nobody',password:'wrong-pass'})).status).toBe(401);
  expect((await post('/api/auth/login',{username:'nobody',password:'wrong-pass'})).status).toBe(429);
 });
 it('交易紀錄可分頁及篩選，排行榜按總資產排序',async()=>{
  const a=await create('alpha'),b=await create('bravo');
  const user=(await (await SELF.fetch(base+'/api/account',{headers:{Cookie:a}})).json()).account;
  const stmts=Array.from({length:21},()=>env.DB.prepare("INSERT INTO trades(account_id,symbol,side,shares,price,amount) VALUES(?,'YZU','BUY',1,45,45)").bind(user.id));
  await env.DB.batch(stmts);
  const read=async url=>(await (await SELF.fetch(base+url,{headers:{Cookie:a}})).json());
  const first=await read('/api/trades?limit=20&side=BUY');expect(first.trades).toHaveLength(20);expect(first.hasMore).toBe(true);
  const second=await read('/api/trades?limit=20&offset=20&symbol=YZU');expect(second.trades).toHaveLength(1);expect(second.hasMore).toBe(false);
  expect((await read('/api/trades?side=SELL')).trades).toHaveLength(0);
  const leaderboard=await (await SELF.fetch(base+'/api/leaderboard')).json();
  expect(leaderboard.players.filter(p=>!p.is_bot).map(p=>p.username).slice(0,2)).toEqual(['alpha','bravo']);
  expect(leaderboard.players.some(p=>p.is_bot)).toBe(true);
  expect(b).toBeTruthy();
 });
 it('四位玩家同時下單，各自持股不互相覆寫',async()=>{
  const cookies=[];for(const name of ['one','two','three','four'])cookies.push(await create(name));
  const results=await Promise.all(cookies.map((cookie,i)=>post('/api/orders',{symbol:'YZU',side:'BUY',shares:1,request_id:'four-player-test-'+String(i).padStart(4,'0')},cookie)));
  expect(results.every(r=>r.status===200)).toBe(true);
  for(const cookie of cookies){const data=await (await SELF.fetch(base+'/api/account',{headers:{Cookie:cookie}})).json();expect(data.holdings.find(h=>h.symbol==='YZU').shares).toBe(1);}
 });
 it('guest login provides instant disposable account with market-based cash and recharge works', async () => {
  const res = await post('/api/auth/guest', { nickname: '巨鯨' });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('Set-Cookie').split(';')[0];
  const accRes = await SELF.fetch(base + '/api/account', { headers: { Cookie: cookie } });
  const accData = await accRes.json();
  expect(accData.ok).toBe(true);
  const stocks = (await env.DB.prepare("SELECT price, liquidity FROM stocks WHERE symbol IN ('2330','2317','2454','3711','YZU','YOUJIAN')").all()).results;
  const expected = Math.max(100000, Math.round(stocks.reduce((s, r) => s + Number(r.price) * (Number(r.liquidity) || 0), 0) / 1000));
  expect(accData.account.cash).toBe(expected);
  expect(accData.account.cash).toBe(accData.account.initial_cash);
  expect(accData.account.name).toContain('巨鯨');

  const recharge = await post('/api/account/recharge', {}, cookie);
  expect(recharge.status).toBe(200);
 });
});
