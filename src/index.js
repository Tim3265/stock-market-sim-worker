// HTTP adapter：只做兩件事
//   1. request  → 參數
//   2. 領域結果 → HTTP 狀態碼
//
// 商業規則在 src/domain/*，SQL 在 src/db/queries.js，前端在 src/page.js。

import * as queries from "./db/queries.js";
import { snapshot } from "./domain/portfolio.js";
import { fail, ok } from "./http.js";
import { PAGE_HTML } from "./page.js";
import { book, placeMarketOrder, listOrders, cancelOrder, matchCrossed } from './domain/orders.js';
import { maybeTick } from './domain/marketMaker.js';
import * as auth from './domain/auth.js';
import { runBotActivity } from './domain/botActivity.js';
import { noteRequest, tickIntervalMs, pollMs } from './domain/activity.js';
import { getActiveEvents } from './domain/events.js';

const DEFAULT_TRADE_LIMIT = 20;
const upgradedCache = new WeakMap();
async function isUpgraded(db) {
  if (upgradedCache.has(db)) return upgradedCache.get(db);
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='market_state'").first();
  upgradedCache.set(db, !!row);
  return !!row;
}
const MAX_TRADE_LIMIT = 100;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      // 不要把 stack 丟給使用者；log 留給 wrangler tail。
      console.error("unhandled error", err);
      return fail("INTERNAL", "伺服器錯誤，請稍後再試");
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const upgraded = path.startsWith('/api/') && await isUpgraded(env.DB);
  noteRequest();
  if (upgraded) { await maybeTick(env.DB, Date.now(), tickIntervalMs()); await matchCrossed(env.DB); await runBotActivity(env.DB); }
  if (path.startsWith('/api/') && !['GET','HEAD'].includes(request.method)) {
    const origin=request.headers.get('Origin');
    if(origin && origin!==url.origin)return Response.json({ok:false,code:'FORBIDDEN',message:'請從本站操作'}, {status:403});
  }
  if (path === '/api/auth/guest' && request.method === 'POST') {
    if(!await auth.allowAttempt(env.DB,request))return fail('RATE_LIMITED','操作太頻繁，請五分鐘後再試');
    const input = await request.json().catch(() => ({}));
    const result = await auth.guestLogin(env.DB, input.nickname);
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return Response.json({ ok: true, username: result.username }, {
      headers: { 'Set-Cookie': 'stock_session=' + result.token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800' + secure }
    });
  }
  if (path === '/api/account/recharge' && request.method === 'POST') {
    if (!await auth.allowAttempt(env.DB, request, 'recharge')) return fail('RATE_LIMITED', '操作太頻繁，請五分鐘後再試');
    const current = await auth.session(env.DB, request);
    if (!current) return fail('UNAUTHENTICATED', '請先登入');
    const initialCash = await auth.marketInitialCash(env.DB);
    // 只補現金，不動 initial_cash，報酬率基準維持不變。先撤銷未成交委託、清空凍結，避免 frozen_cash > cash 觸發 CHECK。
    let done = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const version = await env.DB.prepare('SELECT match_seq FROM market_state WHERE id=1').first();
      try {
        await env.DB.batch([
          env.DB.prepare('UPDATE market_state SET match_seq=match_seq+1 WHERE id=1 AND match_seq=?').bind(version.match_seq),
          env.DB.prepare('INSERT INTO transaction_guard(value) SELECT changes()'),
          env.DB.prepare("UPDATE orders SET status='CANCELLED' WHERE account_id=? AND status IN ('OPEN','PARTIAL')").bind(current.account_id),
          env.DB.prepare('UPDATE accounts SET frozen_cash=0 WHERE id=?').bind(current.account_id),
          env.DB.prepare('UPDATE holdings SET frozen_shares=0 WHERE account_id=?').bind(current.account_id),
          env.DB.prepare('UPDATE accounts SET cash=? WHERE id=?').bind(initialCash, current.account_id),
          env.DB.prepare('DELETE FROM transaction_guard'),
        ]);
        done = true;
        break;
      } catch (e) { if (String(e).includes('market_revision_guard')) continue; throw e; }
    }
    if (!done) return fail('CONFLICT', '市場正在更新，請重試');
    return ok({ message: '已重設資金為 $' + initialCash.toLocaleString('en-US') });
  }
  if (path === '/api/live' && request.method === 'GET') {
    const symbol = url.searchParams.get('symbol') || '2330';
    const light = url.searchParams.get('light') === '1'; // 市場分頁只拿看盤需要的資料
    const tradeSide = url.searchParams.get('trade_side') || '';
    if (tradeSide && !['BUY', 'SELL'].includes(tradeSide)) return fail('INVALID_INPUT','篩選條件錯誤');
    let stocks = await queries.listStocks(env.DB);
    if (upgraded) {
      stocks = (await env.DB.prepare("SELECT symbol,name,nickname,price,ref_price FROM stocks WHERE symbol IN ('2330','2317','2454','3711','YZU','YOUJIAN') ORDER BY symbol").all()).results;
    }
    const session = await auth.session(env.DB, request);
    let account = null, holdings = [], orders = [], trades = [];
    if (session) {
      const snap = await snapshot(env.DB, session.account_id);
      if (snap.ok) {
        account = snap.account;
        holdings = snap.holdings;
        if (upgraded) {
          const frozen = (await env.DB.prepare('SELECT symbol,frozen_shares FROM holdings WHERE account_id=?').bind(session.account_id).all()).results;
          const bySymbol = Object.fromEntries(frozen.map(row => [row.symbol, row.frozen_shares]));
          const nickBySymbol = Object.fromEntries(stocks.map(s => [s.symbol, s.nickname]));
          for (const h of holdings) { h.frozen_shares = bySymbol[h.symbol] || 0; h.nickname = nickBySymbol[h.symbol]; }
        }
      }
      if (!light) {
        const ordResult = await listOrders(env.DB, session.account_id);
        if (ordResult.ok) {
          orders = ordResult.orders;
          if (account) {
            account.frozen_cash = ordResult.frozenCash;
            account.available_cash = ordResult.availableCash;
          }
        }
        trades = await queries.listTrades(env.DB, session.account_id, 30, 0, {side: tradeSide});
      } else if (account) {
        account.frozen_cash = account.frozenCash;
        account.available_cash = account.availableCash;
      }
    }
    const bookResult = await book(env.DB, symbol);
    const fills = upgraded && !light ? (await env.DB.prepare(`
      SELECT f.id, f.symbol, s.name as stock_name, s.nickname, f.shares, f.price, f.amount, f.created_at,
             b.name as buyer_name, b.is_bot as buyer_is_bot,
             se.name as seller_name, se.is_bot as seller_is_bot
      FROM order_fills f
      JOIN stocks s ON s.symbol = f.symbol
      JOIN accounts b ON b.id = f.buyer_id
      JOIN accounts se ON se.id = f.seller_id
      ORDER BY f.id DESC LIMIT 30
    `).all()).results : [];
    const stockSymbols = ['2330','2317','2454','3711','YZU','YOUJIAN'];
    const queriesList = upgraded ? stockSymbols.map(sym => env.DB.prepare("SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 24").bind(sym)) : [];
    const histRows = queriesList.length ? await env.DB.batch(queriesList) : [];
    const state = upgraded ? await env.DB.prepare('SELECT tick_count FROM market_state WHERE id=1').first() : null;
    const index = upgraded ? await computeIndex(env.DB) : null;
    const indexHistory = upgraded ? (await env.DB.prepare("SELECT value AS price, created_at FROM index_history WHERE created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 60").all()).results.reverse() : [];
    const events = getActiveEvents(state?.tick_count || 0);
    const histories = upgraded ? Object.fromEntries(stockSymbols.map((sym, i) => [sym, histRows[i].results.reverse()])) : {};
    return ok({
      stocks,
      account,
      holdings,
      ...(light?{}:{orders,trades}),
      bookSymbol: symbol,
      bids: bookResult.bids || [],
      asks: bookResult.asks || [],
      ...(light?{}:{fills}),
      events,
      index,
      indexHistory,
      pollMs: pollMs(),
      histories,
      username: session ? session.username : null
    });
  }
  if (path === '/api/index' && request.method === 'GET') {

    const index = await computeIndex(env.DB);
    const history = (await env.DB.prepare("SELECT value AS price, created_at FROM index_history WHERE created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 120").all()).results.reverse();
    return ok({ index, history });
  }
  if (path === '/api/events' && request.method === 'GET') {
    const state = upgraded ? await env.DB.prepare('SELECT tick_count FROM market_state WHERE id=1').first() : null;
    return ok({ events: getActiveEvents(state?.tick_count || 0) });
  }
  if (path === '/api/market-activity' && request.method === 'GET') {
    const fills = upgraded ? (await env.DB.prepare(`
      SELECT f.id, f.symbol, s.name as stock_name, s.nickname, f.shares, f.price, f.amount, f.created_at,
             b.name as buyer_name, b.is_bot as buyer_is_bot,
             se.name as seller_name, se.is_bot as seller_is_bot
      FROM order_fills f
      JOIN stocks s ON s.symbol = f.symbol
      JOIN accounts b ON b.id = f.buyer_id
      JOIN accounts se ON se.id = f.seller_id
      ORDER BY f.id DESC LIMIT 30
    `).all()).results : [];
    return ok({ fills });
  }
  if (path === '/api/tick' && request.method === 'POST') {
    // 開發／demo 用：需要登入，避免匿名請求推進市場、燒 D1 寫入額度。
    const current = await auth.session(env.DB, request);
    if (!current) return Response.json({ ok: false, code: 'UNAUTHENTICATED', message: '請先登入' }, { status: 401 });
    if (env.DEV_SECRET && request.headers.get('Authorization') !== 'Bearer ' + env.DEV_SECRET)
      return Response.json({ ok: false, code: 'FORBIDDEN', message: '需要開發金鑰' }, { status: 403 });
    if (!await auth.allowAttempt(env.DB, request, 'dev')) return fail('RATE_LIMITED', '操作太頻繁，請五分鐘後再試');
    if (upgraded) {
      // 手動 tick 強制推進一輪（用未來時間戳繞過 15 秒間隔），結束後把時鐘拉回現在。
      const state = await env.DB.prepare('SELECT last_tick_at FROM market_state WHERE id=1').first();
      await maybeTick(env.DB, Math.max(Date.now(), (state?.last_tick_at || 0) + 15000), 0);
      await env.DB.prepare('UPDATE market_state SET last_tick_at=? WHERE id=1').bind(Date.now()).run();
      await matchCrossed(env.DB);
      await runBotActivity(env.DB);
    }
    return ok({ message: 'tick processed' });
  }
  if(path==='/api/auth/register' && request.method==='POST'){
    if(!await auth.allowAttempt(env.DB,request))return fail('RATE_LIMITED','操作太頻繁，請五分鐘後再試');
    const input=await request.json().catch(()=>({}));
    const result=await auth.register(env.DB,input.username,input.password);
    return result.error?fail('INVALID_INPUT',result.error):ok({username:result.username});
  }
  if(path==='/api/auth/login' && request.method==='POST'){
    if(!await auth.allowAttempt(env.DB,request))return fail('RATE_LIMITED','操作太頻繁，請五分鐘後再試');
    const input=await request.json().catch(()=>({}));
    const result=await auth.login(env.DB,input.username,input.password);
    if(!result)return fail('UNAUTHENTICATED','帳號或密碼錯誤');
    const secure=url.protocol==='https:'?'; Secure':'';
    return Response.json({ok:true,username:result.username},{headers:{'Set-Cookie':'stock_session='+result.token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'+secure}});
  }
  if(path==='/api/auth/logout' && request.method==='POST'){
    await auth.logout(env.DB,request);
    return Response.json({ok:true},{headers:{'Set-Cookie':'stock_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}});
  }
  if(path==='/api/auth/session' && request.method==='GET'){
    const current=await auth.session(env.DB,request);
    return current?ok({username:current.username}):fail('UNAUTHENTICATED','請先登入');
  }
  const protectedPath=path==='/api/account'||path==='/api/trades'||path==='/api/trades/export'||path==='/api/trade'||path==='/api/orders'||/^\/api\/orders\/\d+$/.test(path);
  const current=protectedPath?await auth.session(env.DB,request):null;
  if(protectedPath&&!current)return Response.json({ok:false,code:'UNAUTHENTICATED',message:'請先登入'},{status:401});

  if (path === '/api/histories' && request.method === 'GET') {
    const stocks = (await env.DB.prepare("SELECT symbol FROM stocks WHERE symbol IN ('2330','2317','2454','3711','YZU','YOUJIAN') ORDER BY symbol").all()).results;
    const queries = stocks.map(stock => env.DB.prepare("SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 500").bind(stock.symbol));
    const rows = queries.length ? await env.DB.batch(queries) : [];
    return ok({ histories: Object.fromEntries(stocks.map((stock,i)=>[stock.symbol,rows[i].results.reverse()])) });
  }
  if(path==='/api/bots' && request.method==='GET'){
    const bots=(await env.DB.prepare("SELECT id,name,bot_kind,ROUND(cash,2) cash FROM accounts WHERE is_bot=1 ORDER BY id").all()).results;
    const holdings=(await env.DB.prepare(`SELECT h.account_id,a.name bot_name,h.symbol,s.nickname,h.shares,h.frozen_shares
      FROM holdings h JOIN accounts a ON a.id=h.account_id JOIN stocks s ON s.symbol=h.symbol
      WHERE a.is_bot=1 AND h.shares>0 ORDER BY h.account_id,h.symbol`).all()).results;
    return ok({bots,holdings});
  }
  if(path==='/api/volume' && request.method==='GET'){
    const symbol=url.searchParams.get('symbol')||'';
    if(!symbol)return fail('INVALID_INPUT','請提供 symbol');
    const rows=(await env.DB.prepare(`SELECT strftime('%Y-%m-%d %H:%M',created_at) minute, SUM(shares) volume, COUNT(*) trades
      FROM order_fills WHERE symbol=? AND created_at>=datetime('now','-6 hours')
      GROUP BY minute ORDER BY minute`).bind(symbol).all()).results;
    return ok({symbol,volume:rows});
  }
  if(path==='/api/trades/export' && request.method==='GET'){
    const rows=(await env.DB.prepare(`SELECT t.id,t.symbol,s.name,t.side,t.shares,t.price,t.amount,t.fee_amount,t.created_at
      FROM trades t JOIN stocks s ON s.symbol=t.symbol WHERE t.account_id=? ORDER BY t.id`).bind(current.account_id).all()).results;
    const header='id,symbol,name,side,shares,price,amount,fee,created_at';
    const esc=v=>{const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
    const csv=[header,...rows.map(r=>[r.id,r.symbol,r.name,r.side,r.shares,r.price,r.amount,r.fee_amount,r.created_at].map(esc).join(','))].join('\r\n');
    return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="trades.csv"'}});
  }
  if(path==='/api/leaderboard' && request.method==='GET'){
    const rows=await env.DB.prepare(`SELECT COALESCE(c.username,a.name) username,a.is_bot,ROUND(a.cash+COALESCE(SUM(h.shares*s.price),0),2) total_assets
      FROM accounts a LEFT JOIN player_credentials c ON c.account_id=a.id
      LEFT JOIN holdings h ON h.account_id=a.id LEFT JOIN stocks s ON s.symbol=h.symbol
      WHERE a.is_bot=0 GROUP BY a.id ORDER BY total_assets DESC,username LIMIT 100`).all();
    return ok({players:rows.results});
  }

  if (path === '/api/history' && request.method === 'GET') {
    const symbol = url.searchParams.get('symbol') || '';
    const stock = await env.DB.prepare('SELECT symbol, price FROM stocks WHERE symbol=?').bind(symbol).first();
    if (!stock) return fail('NOT_FOUND', '沒有這檔股票');
    const rows = await env.DB.prepare("SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 500").bind(symbol).all();
    const fills = await env.DB.prepare(`SELECT f.id,f.shares,f.price,f.amount,f.created_at,b.name buyer_name,se.name seller_name
      FROM order_fills f JOIN accounts b ON b.id=f.buyer_id JOIN accounts se ON se.id=f.seller_id
      WHERE f.symbol=? AND f.created_at>=datetime('now','-6 hours') ORDER BY f.id DESC LIMIT 20`).bind(symbol).all();
    return ok({ stock, history: rows.results.reverse(), fills: fills.results });
  }

  if (path === '/api/orderbook' && request.method === 'GET') {
    const depthRaw=Number(url.searchParams.get('depth')??10);
    const depth=Number.isInteger(depthRaw)?Math.min(Math.max(depthRaw,1),20):10;
    const result=await book(env.DB,url.searchParams.get('symbol')??'',depth);
    return result.ok ? ok(result) : fail(result.code,result.message);
  }
  if (path === '/api/market/fast-forward' && request.method === 'POST') {
    // 開發／demo 用：需要登入；若環境設定 DEV_SECRET 則需帶 Authorization: Bearer。
    const current = await auth.session(env.DB, request);
    if (!current) return Response.json({ ok: false, code: 'UNAUTHENTICATED', message: '請先登入' }, { status: 401 });
    if (env.DEV_SECRET && request.headers.get('Authorization') !== 'Bearer ' + env.DEV_SECRET)
      return Response.json({ ok: false, code: 'FORBIDDEN', message: '需要開發金鑰' }, { status: 403 });
    if (!await auth.allowAttempt(env.DB, request, 'dev')) return fail('RATE_LIMITED', '操作太頻繁，請五分鐘後再試');
    let input;try{input=await request.json();}catch{return fail('INVALID_INPUT','請求內容必須是 JSON');}
    const ticks=Math.min(Math.max(Math.trunc(Number(input.ticks??1)),1),60);
    for(let i=0;i<ticks;i++){
      await maybeTick(env.DB,Date.now()+i*15000,0);
      await matchCrossed(env.DB);
      await runBotActivity(env.DB);
    }
    // 快轉會把 last_tick_at 推到未來，結束後重置為現在，避免市場停擺。
    if (upgraded) await env.DB.prepare('UPDATE market_state SET last_tick_at=? WHERE id=1').bind(Date.now()).run();
    return ok({message:`已快轉 ${ticks} 輪`,ticks});
  }
  if (path === '/api/orders' && request.method === 'GET') {
    const result=await listOrders(env.DB,current.account_id,url.searchParams.get('status')||'');
    return result.ok ? ok(result) : fail(result.code,result.message);
  }
  const cancelMatch=path.match(/^\/api\/orders\/(\d+)$/);
  if (cancelMatch && request.method === 'DELETE') {
    const result=await cancelOrder(env.DB,current.account_id,Number(cancelMatch[1]));
    return result.ok ? ok(result) : fail(result.code,result.message);
  }
  if (path === '/api/orders' && request.method === 'POST') {
    let input;try{input=await request.json();}catch{return fail('INVALID_INPUT','請求內容必須是 JSON');}
    const result=await placeMarketOrder(env.DB,{...input,account_id:current.account_id});
    return result.ok ? ok(result) : fail(result.code,result.message);
  }

  if (path === "/api/stocks" && request.method === "GET") {
    return listStocks(env);
  }
  if (path === "/api/account" && request.method === "GET") {
    return getAccount(env, current.account_id, upgraded);
  }
  if (path === "/api/trades" && request.method === "GET") {
    return getTrades(env, url, current.account_id);
  }
  if (path === "/api/trade" && request.method === "POST") {
    // The old direct-settlement route would bypass order-book reservations.
    return fail('INVALID_INPUT','請使用委託簿下單');
  }

  // 未知的 /api/* 要回 404 JSON，不要回網頁，
  // 否則前端會拿到 HTML、解析失敗後卡住。
  if (path.startsWith("/api/")) {
    return fail("NOT_FOUND", `找不到 API：${path}`);
  }

  return new Response(PAGE_HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// ---------- GET /api/stocks ----------
async function listStocks(env) {
  const stocks = await isUpgraded(env.DB)
    ? (await env.DB.prepare("SELECT symbol,name,nickname,price,ref_price FROM stocks WHERE symbol IN ('2330','2317','2454','3711','YZU','YOUJIAN') ORDER BY symbol").all()).results
    : await queries.listStocks(env.DB);
  return ok({ stocks });
}

// ---------- GET /api/account（帳戶由 session 決定） ----------
async function getAccount(env, accountId, upgraded) {
  if (accountId === null) return fail("INVALID_INPUT", "帳戶編號錯誤");

  const result = await snapshot(env.DB, accountId);
  if (!result.ok) return fail(result.code, result.message);
  if (upgraded) {
    result.account.frozen_cash = result.account.frozenCash;
    result.account.available_cash = result.account.availableCash;
    const frozen=(await env.DB.prepare('SELECT symbol,frozen_shares FROM holdings WHERE account_id=?').bind(accountId).all()).results;
    const bySymbol=Object.fromEntries(frozen.map(row=>[row.symbol,row.frozen_shares]));
    for(const holding of result.holdings)holding.frozen_shares=bySymbol[holding.symbol]||0;
  }

  return ok({
    account: result.account,
    holdings: result.holdings,
    summary: result.summary,
  });
}

// ---------- GET /api/trades?limit=20（帳戶由 session 決定） ----------
async function getTrades(env, url, accountId) {
  if (accountId === null) return fail("INVALID_INPUT", "帳戶編號錯誤");

  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_TRADE_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_TRADE_LIMIT)
    : DEFAULT_TRADE_LIMIT;

  const rawOffset=Number(url.searchParams.get('offset')||0);
  const offset=Number.isSafeInteger(rawOffset)&&rawOffset>=0?Math.min(rawOffset,100000):0;
  const symbol=url.searchParams.get('symbol')||'',side=url.searchParams.get('side')||'',from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'';
  if((side&&!['BUY','SELL'].includes(side))||(from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)))return fail('INVALID_INPUT','篩選條件錯誤');
  const trades = await queries.listTrades(env.DB, accountId, limit+1, offset,{symbol,side,from,to});
  return ok({ trades:trades.slice(0,limit),hasMore:trades.length>limit,offset });
}

// ---------- 六檔加權指數 ----------
// 以流動性為權重、當日參考價為基期（1000點），反映六檔整體漲跌。
async function computeIndex(db) {
  const stocks = (await db.prepare("SELECT symbol,price,ref_price,ref_date,liquidity FROM stocks WHERE symbol IN ('2330','2317','2454','3711','YZU','YOUJIAN')").all()).results;
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  let base = 0, cur = 0;
  for (const s of stocks) {
    const w = Number(s.liquidity) || 0;
    const ref = s.ref_date === date ? Number(s.ref_price) : Number(s.price);
    base += w * ref;
    cur += w * Number(s.price);
  }
  return base > 0 ? Math.round(1000 * cur / base * 100) / 100 : 1000;
}

