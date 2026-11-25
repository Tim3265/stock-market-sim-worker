-- 大盤指數接續前一天收盤：記錄今天開盤時採用的基準值，不再每天重設成 1000。
ALTER TABLE market_state ADD COLUMN index_base REAL;
ALTER TABLE market_state ADD COLUMN index_base_date TEXT;
