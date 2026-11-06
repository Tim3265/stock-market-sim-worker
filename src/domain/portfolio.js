// 資產結算。
// computeSummary 是純函式，可以單獨測試；
// snapshot 負責讀資料庫，再把結果交給純函式。

import * as queries from "../db/queries.js";
import { round2 } from "./market.js";

export function computeSummary({ cash, initialCash, holdings = [] }) {
  const marketValue = round2(
    holdings.reduce((sum, h) => {
      const value =
        h.market_value ?? Number(h.shares) * Number(h.price);
      return sum + Number(value);
    }, 0)
  );

  const cashValue = round2(cash);
  const totalAssets = round2(cashValue + marketValue);
  const initial = Number(initialCash);
  const profit = round2(totalAssets - initial);
  const profitPct = initial > 0 ? round2((profit / initial) * 100) : 0;

  return {
    cash: cashValue,
    marketValue,
    totalAssets,
    profit,
    profitPct,
  };
}

export async function snapshot(db, accountId) {
  const account = await queries.findAccount(db, accountId);
  if (!account) {
    return { ok: false, code: "NOT_FOUND", message: "找不到帳戶" };
  }

  const holdings = await queries.listHoldings(db, accountId);
  const summary = computeSummary({
    cash: account.cash,
    initialCash: account.initial_cash,
    holdings,
  });

  return { ok: true, account, holdings, summary };
}
