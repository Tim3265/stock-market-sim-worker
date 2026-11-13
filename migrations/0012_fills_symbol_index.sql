-- K 線圖「歷史成交紀錄」依 symbol 查詢，加 partial-free 複合 index 避免 full scan 吃 D1 rows read
CREATE INDEX IF NOT EXISTS idx_fills_symbol ON order_fills(symbol, id DESC);
