// HTTP adapter：只做兩件事
//   1. request  → 參數
//   2. 領域結果 → HTTP 狀態碼
//
// 商業規則在 src/domain/*，SQL 在 src/db/queries.js，前端在 src/page.js。

import * as queries from "./db/queries.js";
import { executeTrade } from "./domain/trading.js";
import { snapshot } from "./domain/portfolio.js";
import { fail, ok } from "./http.js";
import { PAGE_HTML } from "./page.js";
import { book, placeMarketOrder, listOrders, cancelOrder, matchCrossed } from './domain/orders.js';
import { maybeTick } from './domain/marketMaker.js';
import * as auth from './domain/auth.js';
import { runBotActivity } from './domain/botActivity.js';
import { getActiveEvents } from './domain/events.js';

const DEFAULT_TRADE_LIMIT = 20;
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
  const upgraded = path.startsWith('/api/') && await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='market_state'").first();
  if (upgraded) { await maybeTick(env.DB); await matchCrossed(env.DB); await runBotActivity(env.DB); }
  if (path.startsWith('/api/') && !['GET','HEAD'].includes(request.method)) {
    const origin=request.headers.get('Origin');
    if(origin && origin!==url.origin)return Response.json({ok:false,code:'FORBIDDEN',message:'請從本站操作'}, {status:403});
  }
  if (path === '/api/auth/guest' && request.method === 'POST') {
    const input = await request.json().catch(() => ({}));
    const result = await auth.guestLogin(env.DB, input.nickname);
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return Response.json({ ok: true, username: result.username }, {
      headers: { 'Set-Cookie': 'stock_session=' + result.token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000' + secure }
    });
  }
  if (path === '/api/account/recharge' && request.method === 'POST') {
    const current = await auth.session(env.DB, request);
    if (!current) return Response.json({ ok: false }, { status: 401 });
    const initialCash = await auth.marketInitialCash(env.DB);
    await env.DB.prepare('UPDATE accounts SET cash=?, initial_cash=? WHERE id=?').bind(initialCash, initialCash, current.account_id).run();
    return ok({ message: '已充值千萬籌碼！' });
  }
  if (path === '/api/live' && request.method === 'GET') {
    const symbol = url.searchParams.get('symbol') || '2330';
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
          for (const h of holdings) h.frozen_shares = bySymbol[h.symbol] || 0;
        }
      }
      const ordResult = await listOrders(env.DB, session.account_id);
      if (ordResult.ok) {
        orders = ordResult.orders;
        if (account) {
          account.frozen_cash = ordResult.frozenCash;
          account.available_cash = ordResult.availableCash;
        }
      }
      trades = await queries.listTrades(env.DB, session.account_id, 30, 0, {side: tradeSide});
    }
    const bookResult = await book(env.DB, symbol);
    const fills = (await env.DB.prepare(`
      SELECT f.id, f.symbol, s.name as stock_name, s.nickname, f.shares, f.price, f.amount, f.created_at,
             b.name as buyer_name, b.is_bot as buyer_is_bot,
             se.name as seller_name, se.is_bot as seller_is_bot
      FROM order_fills f
      JOIN stocks s ON s.symbol = f.symbol
      JOIN accounts b ON b.id = f.buyer_id
      JOIN accounts se ON se.id = f.seller_id
      ORDER BY f.id DESC LIMIT 60
    `).all()).results;
    const stockSymbols = ['2330','2317','2454','3711','YZU','YOUJIAN'];
    const queriesList = stockSymbols.map(sym => env.DB.prepare("SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 100").bind(sym));
    const histRows = queriesList.length ? await env.DB.batch(queriesList) : [];
    const state = upgraded ? await env.DB.prepare('SELECT tick_count FROM market_state WHERE id=1').first() : null;
    const events = getActiveEvents(state?.tick_count || 0);
    const histories = Object.fromEntries(stockSymbols.map((sym, i) => [sym, histRows[i].results.reverse()]));
    return ok({
      stocks,
      account,
      holdings,
      orders,
      trades,
      bids: bookResult.bids || [],
      asks: bookResult.asks || [],
      fills,
      events,
      histories,
      username: session ? session.username : null
    });
  }
  if (path === '/api/events' && request.method === 'GET') {
    const state = upgraded ? await env.DB.prepare('SELECT tick_count FROM market_state WHERE id=1').first() : null;
    return ok({ events: getActiveEvents(state?.tick_count || 0) });
  }
  if (path === '/api/market-activity' && request.method === 'GET') {
    const fills = (await env.DB.prepare(`
      SELECT f.id, f.symbol, s.name as stock_name, s.nickname, f.shares, f.price, f.amount, f.created_at,
             b.name as buyer_name, b.is_bot as buyer_is_bot,
             se.name as seller_name, se.is_bot as seller_is_bot
      FROM order_fills f
      JOIN stocks s ON s.symbol = f.symbol
      JOIN accounts b ON b.id = f.buyer_id
      JOIN accounts se ON se.id = f.seller_id
      ORDER BY f.id DESC LIMIT 60
    `).all()).results;
    return ok({ fills });
  }
  if (path === '/api/tick' && request.method === 'POST') {
    if (upgraded) {
      await maybeTick(env.DB);
      await matchCrossed(env.DB);
      await runBotActivity(env.DB);
    }
    return ok({ message: 'tick processed' });
  }
  if(path==='/api/auth/register' && request.method==='POST'){
    if(!await auth.allowAttempt(env.DB,request))return Response.json({ok:false,message:'操作太頻繁，請五分鐘後再試'},{status:429});
    const input=await request.json().catch(()=>({}));
    const result=await auth.register(env.DB,input.username,input.password);
    return result.error?Response.json({ok:false,message:result.error},{status:400}):ok({username:result.username});
  }
  if(path==='/api/auth/login' && request.method==='POST'){
    if(!await auth.allowAttempt(env.DB,request))return Response.json({ok:false,message:'操作太頻繁，請五分鐘後再試'},{status:429});
    const input=await request.json().catch(()=>({}));
    const result=await auth.login(env.DB,input.username,input.password);
    if(!result)return Response.json({ok:false,message:'帳號或密碼錯誤'},{status:401});
    const secure=url.protocol==='https:'?'; Secure':'';
    return Response.json({ok:true,username:result.username},{headers:{'Set-Cookie':'stock_session='+result.token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'+secure}});
  }
  if(path==='/api/auth/logout' && request.method==='POST'){
    await auth.logout(env.DB,request);
    return Response.json({ok:true},{headers:{'Set-Cookie':'stock_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}});
  }
  if(path==='/api/auth/session' && request.method==='GET'){
    const current=await auth.session(env.DB,request);
    return current?ok({username:current.username}):Response.json({ok:false},{status:401});
  }
  const protectedPath=path==='/api/account'||path==='/api/trades'||path==='/api/trade'||path==='/api/orders'||/^\/api\/orders\/\d+$/.test(path);
  const current=protectedPath?await auth.session(env.DB,request):null;
  if(protectedPath&&!current)return Response.json({ok:false,code:'UNAUTHENTICATED',message:'請先登入'},{status:401});

  if (path === '/api/histories' && request.method === 'GET') {
    const stocks = (await env.DB.prepare("SELECT symbol FROM stocks WHERE symbol IN ('2330','2317','2454','3711','YZU','YOUJIAN') ORDER BY symbol").all()).results;
    const queries = stocks.map(stock => env.DB.prepare("SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 500").bind(stock.symbol));
    const rows = queries.length ? await env.DB.batch(queries) : [];
    return ok({ histories: Object.fromEntries(stocks.map((stock,i)=>[stock.symbol,rows[i].results.reverse()])) });
  }
  if(path==='/api/leaderboard' && request.method==='GET'){
    const rows=await env.DB.prepare(`SELECT c.username,ROUND(a.cash+COALESCE(SUM(h.shares*s.price),0),2) total_assets
      FROM player_credentials c JOIN accounts a ON a.id=c.account_id
      LEFT JOIN holdings h ON h.account_id=a.id LEFT JOIN stocks s ON s.symbol=h.symbol
      GROUP BY a.id,c.username ORDER BY total_assets DESC,c.username LIMIT 100`).all();
    return ok({players:rows.results});
  }

  if (path === '/api/history' && request.method === 'GET') {
    const symbol = url.searchParams.get('symbol') || '';
    const stock = await env.DB.prepare('SELECT symbol, price FROM stocks WHERE symbol=?').bind(symbol).first();
    if (!stock) return fail('NOT_FOUND', '沒有這檔股票');
    const rows = await env.DB.prepare("SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 500").bind(symbol).all();
    return ok({ stock, history: rows.results.reverse() });
  }

  if (path === '/api/orderbook' && request.method === 'GET') {
    const result=await book(env.DB,url.searchParams.get('symbol')??'');
    return result.ok ? ok(result) : fail(result.code,result.message);
  }
  if (path === '/api/orders' && request.method === 'GET') {
    const result=await listOrders(env.DB,current.account_id);
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
  let stocks = await queries.listStocks(env.DB);
  if(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='market_state'").first()) stocks=(await env.DB.prepare("SELECT symbol,name,nickname,price,ref_price FROM stocks WHERE symbol IN ('2330','2317','2454','3711','YZU','YOUJIAN') ORDER BY symbol").all()).results;
  return ok({ stocks });
}

// ---------- GET /api/account?id=1 ----------
async function getAccount(env, accountId, upgraded) {
  if (accountId === null) return fail("INVALID_INPUT", "帳戶編號錯誤");

  const result = await snapshot(env.DB, accountId);
  if (!result.ok) return fail(result.code, result.message);
  if (upgraded) {
    const accRow = await env.DB.prepare('SELECT frozen_cash FROM accounts WHERE id=?').bind(accountId).first();
    if (accRow) { result.account.frozen_cash = accRow.frozen_cash; }
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

// ---------- GET /api/trades?id=1&limit=20 ----------
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

// ---------- POST /api/trade ----------
async function postTrade(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_INPUT", "請求內容必須是 JSON");
  }

  const result = await executeTrade(env.DB, body);
  if (!result.ok) return fail(result.code, result.message);

  return ok({ trade: result.trade });
}

// ---------- 小工具 ----------
function parsePositiveInt(raw, fallback) {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
