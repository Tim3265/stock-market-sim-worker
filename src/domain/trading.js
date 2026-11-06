// 下單：這是整個系統最深的模組。
//
// 呼叫端只要說「誰、哪檔、買或賣、幾股」，
// 這裡負責：參數驗證 → 讀股票與帳戶 → 檢查餘額／持股
//           → 包成一個 db.batch() → 回傳統一結果。
//
// db 由外部注入，所以測試可以換成真的 D1 或任何相容物件。

import * as queries from "../db/queries.js";
import { round2 } from "./market.js";

export const SIDES = new Set(["BUY", "SELL"]);

function invalid(message) {
  return { ok: false, code: "INVALID_INPUT", message };
}

// 純函式：只驗證輸入形狀，不碰資料庫。
export function validateTradeInput(input = {}) {
  const accountId = Number(input.account_id ?? input.accountId ?? 1);
  const symbol = String(input.symbol ?? "").trim();
  const side = String(input.side ?? "").toUpperCase();
  const shares = Number(input.shares);

  if (!symbol) return invalid("缺少股票代號");
  if (!Number.isInteger(shares) || shares <= 0) return invalid("股數必須是正整數");
  if (!SIDES.has(side)) return invalid("side 只能是 BUY 或 SELL");
  if (!Number.isInteger(accountId) || accountId <= 0) return invalid("帳戶編號錯誤");

  return { ok: true, value: { accountId, symbol, side, shares } };
}

// 純函式：給定現價、股數、現金、持股，判斷這筆交易能不能成立。
export function checkFunds({ side, price, shares, cash, held = 0 }) {
  const amount = round2(price * shares);

  if (side === "BUY") {
    if (Number(cash) < amount) {
      return {
        ok: false,
        code: "INSUFFICIENT_CASH",
        message: `現金不足（需要 ${amount}，現有 ${cash}）`,
        amount,
      };
    }
  } else if (Number(held) < shares) {
    return {
      ok: false,
      code: "INSUFFICIENT_SHARES",
      message: `持股不足（持有 ${held} 股，想賣 ${shares} 股）`,
      amount,
    };
  }

  return { ok: true, amount };
}

// 把資料庫 Trigger 丟出來的錯誤，轉成穩定的錯誤碼。
export function mapDbError(err) {
  const message = String(err?.message ?? "");
  if (message.includes("INSUFFICIENT_CASH")) {
    return { ok: false, code: "INSUFFICIENT_CASH", message: "現金不足" };
  }
  if (message.includes("INSUFFICIENT_SHARES")) {
    return { ok: false, code: "INSUFFICIENT_SHARES", message: "持股不足" };
  }
  return null;
}

export async function executeTrade(db, input) {
  const validated = validateTradeInput(input);
  if (!validated.ok) return validated;

  const { accountId, symbol, side, shares } = validated.value;

  const stock = await queries.findStock(db, symbol);
  if (!stock) {
    return { ok: false, code: "NOT_FOUND", message: "沒有這檔股票" };
  }

  const account = await queries.findAccount(db, accountId);
  if (!account) {
    return { ok: false, code: "NOT_FOUND", message: "找不到帳戶" };
  }

  let held = 0;
  if (side === "SELL") {
    const holding = await queries.findHolding(db, accountId, symbol);
    held = holding ? Number(holding.shares) : 0;
  }

  const price = round2(stock.price);
  const checked = checkFunds({ side, price, shares, cash: account.cash, held });
  if (!checked.ok) return checked;

  try {
    await db.batch(
      queries.buildTradeStatements(db, {
        accountId,
        symbol,
        side,
        shares,
        price,
        amount: checked.amount,
      })
    );
  } catch (err) {
    const mapped = mapDbError(err);
    if (mapped) return mapped;
    throw err;
  }

  return {
    ok: true,
    trade: {
      accountId,
      symbol,
      name: stock.name,
      side,
      shares,
      price,
      amount: checked.amount,
    },
  };
}
