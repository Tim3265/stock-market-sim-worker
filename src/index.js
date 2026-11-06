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

const DEFAULT_TRADE_LIMIT = 20;
const MAX_TRADE_LIMIT = 100;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      // 不要把 stack 丟給使用者；log 留給 wrangler tail。
      console.error("unhandled error", err);
      return fail("INTERNAL", err?.message ?? "伺服器錯誤");
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/stocks" && request.method === "GET") {
    return listStocks(env);
  }
  if (path === "/api/account" && request.method === "GET") {
    return getAccount(env, url);
  }
  if (path === "/api/trades" && request.method === "GET") {
    return getTrades(env, url);
  }
  if (path === "/api/trade" && request.method === "POST") {
    return postTrade(request, env);
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
  const stocks = await queries.listStocks(env.DB);
  return ok({ stocks });
}

// ---------- GET /api/account?id=1 ----------
async function getAccount(env, url) {
  const accountId = parsePositiveInt(url.searchParams.get("id"), 1);
  if (accountId === null) return fail("INVALID_INPUT", "帳戶編號錯誤");

  const result = await snapshot(env.DB, accountId);
  if (!result.ok) return fail(result.code, result.message);

  return ok({
    account: result.account,
    holdings: result.holdings,
    summary: result.summary,
  });
}

// ---------- GET /api/trades?id=1&limit=20 ----------
async function getTrades(env, url) {
  const accountId = parsePositiveInt(url.searchParams.get("id"), 1);
  if (accountId === null) return fail("INVALID_INPUT", "帳戶編號錯誤");

  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_TRADE_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_TRADE_LIMIT)
    : DEFAULT_TRADE_LIMIT;

  const trades = await queries.listTrades(env.DB, accountId, limit);
  return ok({ trades });
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
