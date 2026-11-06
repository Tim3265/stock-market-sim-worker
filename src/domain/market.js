// 價格相關的純函式。
// Sprint 2 會在這裡加入漲跌停、衝擊、報價中心；
// 現在只保留四捨五入與價格下限，讓其他模組可以共用。

export const MIN_PRICE = 0.01;

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function roundPrice(n) {
  return Math.max(MIN_PRICE, round2(n));
}
