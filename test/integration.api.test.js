// 遺留交易領域邏輯與資料庫測試；現行委託 API 測試位於 orderbook/auth 整合測試。

import { describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { executeTrade } from '../src/domain/trading.js';
import { snapshot } from '../src/domain/portfolio.js';
import { listTrades } from '../src/db/queries.js';
import { statusOf } from '../src/http.js';

const ORIGIN = "https://example.com";

function get(path) {
  return SELF.fetch(ORIGIN + path);
}

async function postTrade(body) {
  const result=await executeTrade(env.DB,body);
  return {status:result.ok?200:statusOf(result.code),body:result};
}

async function getAccount(id = 1) {
  const body=await snapshot(env.DB,id);
  return {status:body.ok?200:statusOf(body.code),body};
}

async function getTrades(query = "") {
  const raw=new URLSearchParams(query).get('limit');
  const limit=Math.min(Math.max(Number(raw||20),1),100);
  return {status:200,body:{trades:await listTrades(env.DB,1,limit)}};
}

describe("GET /api/stocks", () => {
  it("回傳種子資料的 5 檔股票", async () => {
    const res = await get("/api/stocks");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.stocks).toHaveLength(5);
    expect(body.stocks.map((s) => s.symbol)).toContain("2330");
    expect(body.stocks[0]).toMatchObject({
      symbol: expect.any(String),
      name: expect.any(String),
      price: expect.any(Number),
    });
  });
});

describe("POST /api/trade — 買進", () => {
  it("扣款、增加持股、寫入交易紀錄", async () => {
    const result = await postTrade({
      account_id: 1,
      symbol: "2330",
      side: "BUY",
      shares: 10,
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.trade).toMatchObject({
      symbol: "2330",
      side: "BUY",
      shares: 10,
      price: 980,
      amount: 9800,
    });

    const account = await getAccount();
    expect(account.body.summary.cash).toBe(90200);
    expect(account.body.holdings).toHaveLength(1);
    expect(account.body.holdings[0]).toMatchObject({ symbol: "2330", shares: 10 });

    const trades = await getTrades();
    expect(trades.body.trades).toHaveLength(1);
    expect(trades.body.trades[0]).toMatchObject({ side: "BUY", shares: 10, amount: 9800 });
  });
});

describe("POST /api/trade — 賣出", () => {
  it("入帳、減少持股、寫入交易紀錄", async () => {
    await postTrade({ account_id: 1, symbol: "2330", side: "BUY", shares: 10 });

    const result = await postTrade({
      account_id: 1,
      symbol: "2330",
      side: "SELL",
      shares: 4,
    });

    expect(result.status).toBe(200);
    expect(result.body.trade.amount).toBe(3920);

    const account = await getAccount();
    expect(account.body.summary.cash).toBe(94120);
    expect(account.body.holdings[0].shares).toBe(6);

    const trades = await getTrades();
    expect(trades.body.trades).toHaveLength(2);
    expect(trades.body.trades[0].side).toBe("SELL"); // 時間倒序
  });
});

describe("交易失敗", () => {
  it("現金不足時回 400，且不寫入任何資料", async () => {
    const result = await postTrade({
      account_id: 1,
      symbol: "2330",
      side: "BUY",
      shares: 1000,
    });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ ok: false, code: "INSUFFICIENT_CASH" });

    const account = await getAccount();
    expect(account.body.summary.cash).toBe(100000);
    expect(account.body.holdings).toHaveLength(0);

    const trades = await getTrades();
    expect(trades.body.trades).toHaveLength(0);
  });

  it("持股不足時回 400，且不寫入任何資料", async () => {
    const result = await postTrade({
      account_id: 1,
      symbol: "2330",
      side: "SELL",
      shares: 1,
    });

    expect(result.status).toBe(400);
    expect(result.body.code).toBe("INSUFFICIENT_SHARES");

    const account = await getAccount();
    expect(account.body.summary.cash).toBe(100000);
    expect(account.body.holdings).toHaveLength(0);
  });

  it("參數錯誤時回 400 INVALID_INPUT", async () => {
    for (const body of [
      { symbol: "2330", side: "BUY", shares: 0 },
      { symbol: "2330", side: "HOLD", shares: 10 },
      { symbol: "", side: "BUY", shares: 10 },
    ]) {
      const result = await postTrade({ account_id: 1, ...body });
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("INVALID_INPUT");
    }
  });

  it("股票不存在時回 404", async () => {
    const result = await postTrade({
      account_id: 1,
      symbol: "9999",
      side: "BUY",
      shares: 1,
    });

    expect(result.status).toBe(404);
    expect(result.body.code).toBe("NOT_FOUND");
  });
});

describe("查詢", () => {
  it("帳戶不存在時回 404", async () => {
    const result = await getAccount(999);
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("NOT_FOUND");
  });

  it("未知的 API 回 404 JSON，不是 HTML", async () => {
    const res = await get("/api/nope");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

});

describe("資料庫層的最後防線", () => {
  it("直接 INSERT 一筆現金不足的交易會被 Trigger 擋下", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO trades (account_id, symbol, side, shares, price, amount)
         VALUES (1, '2330', 'BUY', 1000, 980, 980000)`
      ).run()
    ).rejects.toThrow(/INSUFFICIENT_CASH/);

    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM trades").all();
    expect(results[0].n).toBe(0);
  });

  it("直接 INSERT 一筆超賣的交易會被 Trigger 擋下", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO trades (account_id, symbol, side, shares, price, amount)
         VALUES (1, '2330', 'SELL', 1, 980, 980)`
      ).run()
    ).rejects.toThrow(/INSUFFICIENT_SHARES/);
  });
});
