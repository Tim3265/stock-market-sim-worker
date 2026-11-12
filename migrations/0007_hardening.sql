-- Hardening: partial index for the live order book, time-range index for price history,
-- and DB-level guards on order placement (last line of defense behind app checks).

-- 只索引活躍委託，避免歷史 FILLED/CANCELLED 委託撐爆索引；查詢可直接依 price,id 走索引。
CREATE INDEX IF NOT EXISTS idx_orders_active ON orders(symbol, side, price, id)
  WHERE status IN ('OPEN','PARTIAL') AND type='LIMIT';

-- 走勢圖依時間範圍查詢，補 (symbol, created_at) 索引。
CREATE INDEX IF NOT EXISTS idx_price_history_symbol_time ON price_history(symbol, created_at);

-- 下限價買單時，資料庫層保證：可用現金（cash - frozen_cash）足以支付價款+手續費預扣。
CREATE TRIGGER IF NOT EXISTS trg_order_buy_guard
BEFORE INSERT ON orders
WHEN NEW.side='BUY' AND NEW.type='LIMIT' AND NEW.status IN ('OPEN','PARTIAL')
 AND (SELECT (cash - frozen_cash)*100 FROM accounts WHERE id=NEW.account_id)
     < (CAST(ROUND(NEW.price*100) AS INTEGER) + CAST(CEIL(NEW.price*100*399/1000000) AS INTEGER)) * (NEW.shares - NEW.filled_shares)
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_CASH');
END;

-- 成交寫入時，買方觸發器需把手續費納入檢查（含凍結資金）。
DROP TRIGGER IF EXISTS trg_trade_buy_guard;
CREATE TRIGGER trg_trade_buy_guard
BEFORE INSERT ON trades
WHEN NEW.side = 'BUY'
 AND (SELECT (cash - frozen_cash)*100 FROM accounts WHERE id = NEW.account_id) < CAST(ROUND((NEW.amount + NEW.fee_amount)*100) AS INTEGER)
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_CASH');
END;
