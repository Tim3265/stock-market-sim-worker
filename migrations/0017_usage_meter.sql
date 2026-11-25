-- D1 用量計：每分鐘一列，記錄網站讀、寫了幾列（D1 免費額度的計算單位），後台用來顯示今天還剩多少。
CREATE TABLE IF NOT EXISTS usage_minutes (
  minute INTEGER PRIMARY KEY,           -- Unix 時間 ÷ 60 秒
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0
);

-- 下單後回傳成交明細要用 taker_order_id 查詢；沒有索引時每次下單都要掃過整張成交表（上千列）。
CREATE INDEX IF NOT EXISTS idx_fills_taker ON order_fills(taker_order_id);

-- 後台可以把測試帳號、不當暱稱從排行榜隱藏（不刪除交易紀錄，帳目保持完整）。
ALTER TABLE accounts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1));
