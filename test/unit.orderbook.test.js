import { describe, expect, it } from "vitest";
import { matchOrders } from "../src/domain/orderbook.js";

describe("委託簿撮合", () => {
  it("買單依賣價、同價依時間成交，並跳過自己的單", () => {
    const orders = [
      { id: 4, accountId: 2, side: "SELL", price: 102, remaining: 8 },
      { id: 3, accountId: 3, side: "SELL", price: 101, remaining: 4 },
      { id: 1, accountId: 1, side: "SELL", price: 99, remaining: 8 },
      { id: 2, accountId: 4, side: "SELL", price: 101, remaining: 3 },
    ];
    const result = matchOrders({ accountId: 1, side: "BUY", shares: 6 }, orders);
    expect(result).toEqual({ fills: [
      { orderId: 2, accountId: 4, price: 101, shares: 3 },
      { orderId: 3, accountId: 3, price: 101, shares: 3 },
    ], remaining: 0 });
    expect(orders[3].remaining).toBe(3);
  });

  it("賣單先吃最高買價，流動性不足時回報未成交數量", () => {
    expect(matchOrders({ accountId: 1, side: "SELL", shares: 9 }, [
      { id: 1, accountId: 2, side: "BUY", price: 98, remaining: 2 },
      { id: 2, accountId: 3, side: "BUY", price: 100, remaining: 3 },
    ])).toEqual({ fills: [
      { orderId: 2, accountId: 3, price: 100, shares: 3 },
      { orderId: 1, accountId: 2, price: 98, shares: 2 },
    ], remaining: 4 });
  });

  it("限價買單不會吃高於限價的賣單", () => {
    expect(matchOrders({ accountId: 1, side: "BUY", shares: 4, limitPrice: 100 }, [
      { id: 1, accountId: 2, side: "SELL", price: 100, remaining: 2 },
      { id: 2, accountId: 3, side: "SELL", price: 101, remaining: 8 },
    ])).toEqual({ fills: [{ orderId: 1, accountId: 2, price: 100, shares: 2 }], remaining: 2 });
  });
});
