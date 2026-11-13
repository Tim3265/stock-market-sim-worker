-- 0009 的手續費項仍用未取整的 NEW.price*100 計算 CEIL，與應用層 cents()（Math.round）
-- 在邊界價格可能差 1 分而誤殺合法委託；這裡把價格先 ROUND 到分再算手續費。
DROP TRIGGER IF EXISTS trg_order_buy_guard;
CREATE TRIGGER trg_order_buy_guard
BEFORE INSERT ON orders
WHEN NEW.side='BUY' AND NEW.type='LIMIT' AND NEW.status IN ('OPEN','PARTIAL')
 AND (SELECT CAST(ROUND((cash - frozen_cash)*100) AS INTEGER) FROM accounts WHERE id=NEW.account_id)
     < (CAST(ROUND(NEW.price*100) AS INTEGER) * (NEW.shares - NEW.filled_shares)
        + CAST(CEIL(ROUND(NEW.price*100)*(NEW.shares - NEW.filled_shares)*399/1000000) AS INTEGER))
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_CASH');
END;

DROP TRIGGER IF EXISTS trg_trade_buy_guard;
CREATE TRIGGER trg_trade_buy_guard
BEFORE INSERT ON trades
WHEN NEW.side = 'BUY'
 AND (SELECT CAST(ROUND(cash*100) AS INTEGER) FROM accounts WHERE id = NEW.account_id) < CAST(ROUND((NEW.amount + NEW.fee_amount)*100) AS INTEGER)
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_CASH');
END;
