-- 補上 schema.sql 有但遷移路徑缺席的賣方最後防線觸發器。
-- 與 0009 買方版語義一致：檢查「總持股」而非 shares-frozen_shares，
-- 因為成交當下賣方的 frozen_shares 尚未釋放，扣掉會誤殺合法成交。
DROP TRIGGER IF EXISTS trg_trade_sell_guard;
CREATE TRIGGER trg_trade_sell_guard
BEFORE INSERT ON trades
WHEN NEW.side = 'SELL'
 AND COALESCE((SELECT shares FROM holdings WHERE account_id = NEW.account_id AND symbol = NEW.symbol), 0) < NEW.shares
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_SHARES');
END;
