import { describe, expect, it } from "vitest";
import { round2, roundPrice } from "../src/domain/market.js";

describe("round2", () => {
  it("四捨五入到兩位小數", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(980.126)).toBe(980.13);
    expect(round2(100)).toBe(100);
  });
});

describe("roundPrice", () => {
  it("價格不得低於 0.01", () => {
    expect(roundPrice(0)).toBe(0.01);
    expect(roundPrice(-5)).toBe(0.01);
    expect(roundPrice(45.678)).toBe(45.68);
  });
});
