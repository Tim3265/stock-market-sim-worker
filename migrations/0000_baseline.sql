-- Baseline base tables so `wrangler d1 migrations apply` works on a completely
-- empty database (0001+ ALTER these tables, so they must exist first).
-- IF NOT EXISTS keeps this a no-op on databases that already ran schema.sql.
CREATE TABLE IF NOT EXISTS stocks (
  symbol TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  price  REAL NOT NULL CHECK (price > 0)
);

CREATE TABLE IF NOT EXISTS accounts (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  initial_cash REAL NOT NULL CHECK (initial_cash > 0),
  cash         REAL NOT NULL CHECK (cash >= 0)
);

CREATE TABLE IF NOT EXISTS holdings (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  symbol     TEXT    NOT NULL REFERENCES stocks(symbol),
  shares     INTEGER NOT NULL CHECK (shares >= 0),
  PRIMARY KEY (account_id, symbol)
);

CREATE TABLE IF NOT EXISTS trades (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  symbol     TEXT    NOT NULL REFERENCES stocks(symbol),
  side       TEXT    NOT NULL CHECK (side IN ('BUY', 'SELL')),
  shares     INTEGER NOT NULL CHECK (shares > 0),
  price      REAL    NOT NULL CHECK (price > 0),
  amount     REAL    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
