-- 六檔流動性加權指數的歷史（基期 1000，以當日參考價計算）。
CREATE TABLE index_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value REAL NOT NULL CHECK (value > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
