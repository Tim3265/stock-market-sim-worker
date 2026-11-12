-- Legacy v1 bootstrap for a brand-new empty database only; existing tables cause an error.
-- 生產環境與測試的完整 schema 以 migrations/ 目錄為準（0001~0009），本檔僅供課程初期示範種子資料。
-- 股票主檔
CREATE TABLE stocks (
  symbol TEXT PRIMARY KEY,           -- 股票代號，例如 2330
  name   TEXT NOT NULL,              -- 名稱
  price  REAL NOT NULL CHECK (price > 0)
);

-- 玩家帳戶
CREATE TABLE accounts (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  initial_cash REAL NOT NULL CHECK (initial_cash > 0),  -- 初始本金（算報酬率用）
  cash         REAL NOT NULL CHECK (cash >= 0)          -- 目前現金，不能是負的
);

-- 持股（帳戶 × 股票，複合主鍵）
CREATE TABLE holdings (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  symbol     TEXT    NOT NULL REFERENCES stocks(symbol),
  shares     INTEGER NOT NULL CHECK (shares >= 0),
  PRIMARY KEY (account_id, symbol)
);

-- 交易紀錄（買進 / 賣出都會寫一筆）
CREATE TABLE trades (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  symbol     TEXT    NOT NULL REFERENCES stocks(symbol),
  side       TEXT    NOT NULL CHECK (side IN ('BUY', 'SELL')),
  shares     INTEGER NOT NULL CHECK (shares > 0),
  price      REAL    NOT NULL CHECK (price > 0),
  amount     REAL    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 索引①：查「某個帳戶最近的交易」→ 帳戶 + 時間倒序
CREATE INDEX idx_trades_account ON trades(account_id, id DESC);

-- 索引②：查「某檔股票的所有交易」
CREATE INDEX idx_trades_symbol ON trades(symbol);

-- ============================================================
--  Trigger：資料庫層的最後防線
--
--  應用層（trading.js）會先檢查一次，是為了給人看得懂的錯誤訊息。
--  但「檢查」與「寫入」之間仍有極小的競態窗口；
--  這兩個 Trigger 確保就算兩個請求同時進來，
--  也不可能出現負現金或超賣。
--
--  注意：寫入順序必須是「先 INSERT trades，再更新餘額／持股」，
--  這樣 Trigger 讀到的是交易前的狀態。
-- ============================================================

CREATE TRIGGER trg_trade_buy_guard
BEFORE INSERT ON trades
WHEN NEW.side = 'BUY'
 AND (SELECT cash FROM accounts WHERE id = NEW.account_id) < NEW.amount
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_CASH');
END;

CREATE TRIGGER trg_trade_sell_guard
BEFORE INSERT ON trades
WHEN NEW.side = 'SELL'
 AND COALESCE(
       (SELECT shares FROM holdings
         WHERE account_id = NEW.account_id AND symbol = NEW.symbol),
       0
     ) < NEW.shares
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_SHARES');
END;

-- 種子資料
INSERT INTO stocks (symbol, name, price) VALUES
  ('2330', '台積電',       980),
  ('2317', '鴻海',         205),
  ('2454', '聯發科',      1290),
  ('0050', '元大台灣50',   190),
  ('2603', '長榮',         198);

INSERT INTO accounts (id, name, initial_cash, cash) VALUES
  (1, '示範帳號', 100000, 100000);
