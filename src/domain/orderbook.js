// Pure planning only: callers must commit fills and account transfers atomically.
export function matchOrders(taker, orders) {
  const opposite = taker.side === "BUY" ? "SELL" : "BUY";
  const eligible = orders.filter(order =>
    order.side === opposite && order.accountId !== taker.accountId && order.remaining > 0 &&
    (taker.limitPrice == null || (taker.side === "BUY" ? order.price <= taker.limitPrice : order.price >= taker.limitPrice))
  ).sort((a, b) => (taker.side === "BUY" ? a.price - b.price : b.price - a.price) || a.id - b.id);
  let remaining = taker.shares;
  const fills = [];
  for (const order of eligible) {
    if (!remaining) break;
    const shares = Math.min(remaining, order.remaining);
    fills.push({ orderId: order.id, accountId: order.accountId, price: order.price, shares });
    remaining -= shares;
  }
  return { fills, remaining };
}
