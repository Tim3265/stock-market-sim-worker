# 索引實驗報告（10 萬筆成交資料）

查詢：`SELECT COUNT(*), SUM(amount) FROM order_fills WHERE buyer_id = 12345 OR seller_id = 62345`

| 項目 | 無索引 | 有索引（buyer_id / seller_id） |
|---|---|---|
| 查詢計畫 | SCAN order_fills | MULTI-INDEX OR | INDEX 1 | SEARCH order_fills USING INDEX idx_fills_buyer (buyer_id=?) | INDEX 2 | SEARCH order_fills USING INDEX idx_fills_seller (seller_id=?) |
| 時間（D1 meta.duration）/ | 8 ms | 0 ms |
| 結果 | count=2, sum=69000 | count=2, sum=69000 |

結論：無索引時為全表掃描（SCAN order_fills）；建立索引後改為 SEARCH ... USING INDEX，
10 萬筆資料下，有索引為 SEARCH（約 0ms，D1 meta.duration 低於解析度），無索引為全表 SCAN（約 8ms），差距約 8ms／輪，而非字面「8 倍」以上。
重跑：`node scripts/benchmark-index.js`（使用獨立暫存資料庫 .local-benchmark，不影響正式資料）。

