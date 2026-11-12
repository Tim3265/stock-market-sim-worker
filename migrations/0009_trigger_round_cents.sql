-- 修正 0008 觸發器的浮點比較：金額以 REAL 儲存，x*100 可能得到 112.99999999999999，
-- 與 CAST(ROUND(...) AS INTEGER) 比較會誤判「恰好足夠」的交易。
-- 左側同樣以 ROUND 取整到分，與應用層 cents()（Math.round）語意一致。

DROP TRIGGER IF EXISTS trg_order_buy_guard;
CREATE TRIGGER trg_order_buy_guard
BEFORE INSERT ON orders
WHEN NEW.side='BUY' AND NEW.type='LIMIT' AND NEW.status IN ('OPEN','PARTIAL')
 AND (SELECT CAST(ROUND((cash - frozen_cash)*100) AS INTEGER) FROM accounts WHERE id=NEW.account_id)
     < (CAST(ROUND(NEW.price*100) AS INTEGER) * (NEW.shares - NEW.filled_shares)
        + CAST(CEIL(NEW.price*100*(NEW.shares - NEW.filled_shares)*399/1000000) AS INTEGER))
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
