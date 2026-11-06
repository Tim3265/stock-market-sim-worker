import { describe, expect, it } from "vitest";
import {
  checkFunds,
  mapDbError,
  validateTradeInput,
} from "../src/domain/trading.js";

describe("validateTradeInput", () => {
  it("接受合法輸入", () => {
    const result = validateTradeInput({
      account_id: 1,
      symbol: "2330",
      side: "buy",
      shares: 10,
    });

    expect(result).toEqual({
      ok: true,
      value: { accountId: 1, symbol: "2330", side: "BUY", shares: 10 },
    });
  });

  it("拒絕缺少股票代號", () => {
    const result = validateTradeInput({ symbol: "", side: "BUY", shares: 10 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("拒絕非正整數股數", () => {
    for (const shares of [0, -1, 1.5, "abc"]) {
      const result = validateTradeInput({ symbol: "2330", side: "BUY", shares });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
    }
  });

  it("拒絕非法方向", () => {
    const result = validateTradeInput({ symbol: "2330", side: "HOLD", shares: 10 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_INPUT");
  });
});

describe("checkFunds", () => {
  it("現金足夠時回傳成交金額", () => {
    const result = checkFunds({ side: "BUY", price: 980, shares: 10, cash: 100000 });
    expect(result).toEqual({ ok: true, amount: 9800 });
  });

  it("現金不足時回傳 INSUFFICIENT_CASH", () => {
    const result = checkFunds({ side: "BUY", price: 980, shares: 1000, cash: 100000 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_CASH");
  });

  it("持股足夠時可以賣出", () => {
    const result = checkFunds({ side: "SELL", price: 100, shares: 10, held: 10 });
    expect(result).toEqual({ ok: true, amount: 1000 });
  });

  it("持股不足時回傳 INSUFFICIENT_SHARES", () => {
    const result = checkFunds({ side: "SELL", price: 100, shares: 11, held: 10 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_SHARES");
  });
});

describe("mapDbError", () => {
  it("把 Trigger 的錯誤轉成錯誤碼", () => {
    expect(mapDbError(new Error("INSUFFICIENT_CASH")).code).toBe("INSUFFICIENT_CASH");
    expect(mapDbError(new Error("INSUFFICIENT_SHARES")).code).toBe("INSUFFICIENT_SHARES");
    expect(mapDbError(new Error("其他錯誤"))).toBe(null);
  });
});
