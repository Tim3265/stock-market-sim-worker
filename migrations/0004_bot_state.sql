CREATE TABLE bot_state (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL REFERENCES stocks(symbol),
  panic_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,symbol)
);
