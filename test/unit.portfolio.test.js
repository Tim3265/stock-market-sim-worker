import { describe, expect, it } from "vitest";
import { computeSummary } from "../src/domain/portfolio.js";

describe("computeSummary", () => {
  it("沒有持股時，總資產等於現金", () => {
    const result = computeSummary({ cash: 100000, initialCash: 100000, holdings: [] });
    expect(result).toEqual({
      cash: 100000,
      marketValue: 0,
      totalAssets: 100000,
      profit: 0,
      profitPct: 0,
    });
  });

  it("加總持股市值並計算報酬率", () => {
    const result = computeSummary({
      cash: 90200,
      initialCash: 100000,
      holdings: [{ shares: 10, price: 980, market_value: 9800 }],
    });

    expect(result.marketValue).toBe(9800);
    expect(result.totalAssets).toBe(100000);
    expect(result.profit).toBe(0);
    expect(result.profitPct).toBe(0);
  });

  it("沒有 market_value 時用 shares × price 計算", () => {
    const result = computeSummary({
      cash: 0,
      initialCash: 1000,
      holdings: [
        { shares: 2, price: 100 },
        { shares: 3, price: 50 },
      ],
    });

    expect(result.marketValue).toBe(350);
    expect(result.totalAssets).toBe(350);
    expect(result.profit).toBe(-650);
    expect(result.profitPct).toBe(-65);
  });

  it("初始本金為 0 時報酬率為 0，不會除以零", () => {
    const result = computeSummary({ cash: 100, initialCash: 0, holdings: [] });
    expect(result.profitPct).toBe(0);
  });
});
