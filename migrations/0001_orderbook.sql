-- Additive migration: existing accounts, holdings and legacy trades are retained.
ALTER TABLE accounts ADD COLUMN frozen_cash REAL NOT NULL DEFAULT 0 CHECK (frozen_cash >= 0 AND frozen_cash <= cash);
ALTER TABLE accounts ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1));
ALTER TABLE accounts ADD COLUMN bot_kind TEXT;
ALTER TABLE holdings ADD COLUMN frozen_shares INTEGER NOT NULL DEFAULT 0 CHECK (frozen_shares >= 0 AND frozen_shares <= shares);
ALTER TABLE stocks ADD COLUMN fair_price REAL;
ALTER TABLE stocks ADD COLUMN ref_price REAL;
ALTER TABLE stocks ADD COLUMN ref_date TEXT;
ALTER TABLE stocks ADD COLUMN volatility REAL NOT NULL DEFAULT 0.003 CHECK (volatility >= 0);
ALTER TABLE stocks ADD COLUMN liquidity INTEGER NOT NULL DEFAULT 1000 CHECK (liquidity > 0);
ALTER TABLE stocks ADD COLUMN tick_size REAL NOT NULL DEFAULT 0.01 CHECK (tick_size > 0);
ALTER TABLE stocks ADD COLUMN nickname TEXT;
UPDATE stocks SET fair_price=price, ref_price=price;
-- Keep old symbols for existing holdings; the six demo stocks are added separately.
INSERT OR IGNORE INTO stocks(symbol,name,price,fair_price,ref_price,liquidity) VALUES
 ('3711','日月光投控',165,165,165,4000),('YZU','元智智能',45,45,45,300),('YOUJIAN','右鍵',30,30,30,200);
UPDATE stocks SET liquidity=CASE symbol WHEN '2330' THEN 200000 WHEN '2317' THEN 30000 WHEN '2454' THEN 12000 WHEN '3711' THEN 4000 WHEN 'YZU' THEN 300 WHEN 'YOUJIAN' THEN 200 ELSE liquidity END;
UPDATE stocks SET nickname=CASE symbol WHEN '2330' THEN 'GG' WHEN '2317' THEN '紅海' WHEN '2454' THEN '發哥' WHEN '3711' THEN '日月潭' WHEN 'YZU' THEN '元智 AI' WHEN 'YOUJIAN' THEN '右鍵' ELSE nickname END;
INSERT INTO accounts(id,name,initial_cash,cash,is_bot,bot_kind) VALUES(1000000,'造市商',5000000000,5000000000,1,'MM');
INSERT INTO accounts(id,name,initial_cash,cash,is_bot,bot_kind) VALUES
 (1000001,'動能派',1000000,1000000,1,'MOMENTUM'),
 (1000002,'價值派',1000000,1000000,1,'VALUE'),
 (1000003,'恐慌賣壓',1000000,1000000,1,'PANIC');
INSERT INTO holdings(account_id,symbol,shares) SELECT 1000000,symbol,2000000 FROM stocks;
INSERT INTO holdings(account_id,symbol,shares) SELECT account_id,symbol,100 FROM stocks CROSS JOIN (SELECT 1000001 account_id UNION ALL SELECT 1000002 UNION ALL SELECT 1000003);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL REFERENCES stocks(symbol),
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  type TEXT NOT NULL CHECK (type IN ('MARKET','LIMIT')),
  price REAL CHECK (price > 0),
  shares INTEGER NOT NULL CHECK (shares > 0),
  filled_shares INTEGER NOT NULL DEFAULT 0 CHECK (filled_shares >= 0 AND filled_shares <= shares),
  status TEXT NOT NULL CHECK (status IN ('OPEN','PARTIAL','FILLED','CANCELLED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  request_id TEXT UNIQUE,
  CHECK ((type='LIMIT' AND price IS NOT NULL) OR type='MARKET')
);
CREATE INDEX idx_orders_book ON orders(symbol,side,status,price,id);
CREATE INDEX idx_orders_account ON orders(account_id,status,id DESC);
CREATE TABLE order_fills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maker_order_id INTEGER NOT NULL REFERENCES orders(id),
  taker_order_id INTEGER NOT NULL REFERENCES orders(id),
  buyer_id INTEGER NOT NULL REFERENCES accounts(id),
  seller_id INTEGER NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL REFERENCES stocks(symbol),
  shares INTEGER NOT NULL CHECK (shares > 0),
  price REAL NOT NULL CHECK (price > 0),
  amount REAL NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (buyer_id <> seller_id)
);
CREATE INDEX idx_fills_buyer ON order_fills(buyer_id,id DESC);
CREATE INDEX idx_fills_seller ON order_fills(seller_id,id DESC);
CREATE INDEX idx_fills_symbol ON order_fills(symbol,id DESC);
CREATE TABLE market_state (id INTEGER PRIMARY KEY CHECK (id=1),last_tick_at INTEGER NOT NULL DEFAULT 0,tick_count INTEGER NOT NULL DEFAULT 0,match_seq INTEGER NOT NULL DEFAULT 0);
INSERT INTO market_state(id) VALUES(1);
CREATE TABLE transaction_guard (value INTEGER NOT NULL CONSTRAINT market_revision_guard CHECK(value=1));
CREATE TABLE price_history (id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL REFERENCES stocks(symbol),price REAL NOT NULL CHECK(price>0),source TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE INDEX idx_price_history_symbol ON price_history(symbol,id DESC);
