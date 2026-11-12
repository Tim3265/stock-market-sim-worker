-- 修正 0007 的兩個觸發器（council round 3 稽核發現）：
-- 1) trg_trade_buy_guard：掛單買方的資金在成交當下仍屬 frozen_cash，
--    同一個 batch 會接著釋放凍結，因此觸發器應檢查「總現金」而非「可用現金」，
--    否則資金全凍結的掛單買方永遠無法成交。
-- 2) trg_order_buy_guard：手續費應與應用層一致，以「整體股數」計算後一次向上取整，
--    不能逐股取整後再乘股數（會高估預扣金額）。

DROP TRIGGER IF EXISTS trg_order_buy_guard;
CREATE TRIGGER trg_order_buy_guard
BEFORE INSERT ON orders
WHEN NEW.side='BUY' AND NEW.type='LIMIT' AND NEW.status IN ('OPEN','PARTIAL')
 AND (SELECT (cash - frozen_cash)*100 FROM accounts WHERE id=NEW.account_id)
     < (CAST(ROUND(NEW.price*100) AS INTEGER) * (NEW.shares - NEW.filled_shares)
        + CAST(CEIL(NEW.price*100*(NEW.shares - NEW.filled_shares)*399/1000000) AS INTEGER))
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_CASH');
END;

DROP TRIGGER IF EXISTS trg_trade_buy_guard;
CREATE TRIGGER trg_trade_buy_guard
BEFORE INSERT ON trades
WHEN NEW.side = 'BUY'
 AND (SELECT cash*100 FROM accounts WHERE id = NEW.account_id) < CAST(ROUND((NEW.amount + NEW.fee_amount)*100) AS INTEGER)
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_CASH');
END;
