# D1 免費額度優化報告

D1 free tier（整個帳號共享，每日 UTC 00:00 重置）：**5,000,000 rows read / 100,000 rows written**。
超過上限當天所有查詢直接失敗。rows read 算「掃描」的 rows，index 進入點也算 rows written。

量測工具：`test/quota.measure.test.js`（`npx vitest run test/quota.measure.test.js` 印出 QUOTA-REPORT）。

## 優化前（baseline）

| 指標 | 數值 |
|---|---|
| 每 poll cycle（/api/live + /api/index）rows read | 71 |
| 每 tick rows read / written | 746 / **783** |
| 每人每分鐘 rows read（poll 5s + tick 15s） | 3,838 |

寫入爆點：做市商每 tick「撤單 60 + 新掛 60」，每筆 INSERT 算 6 rows written（table + index），
單 tick 造市約 600 writes → 4 ticks/min = 3,132 writes/min，**100k 上限約 32 分鐘就燒光**。

## 優化後

| 指標 | 數值 | 說明 |
|---|---|---|
| 每 poll cycle rows read（只打 /api/live） | 59 | indexHistory 併入 /api/live，LIMIT 500→120，price_history 100→40，fills 60→30 |
| 每 tick rows read / written | 348 / **115** | 見下方 |

寫入優化手段：

1. **做市商 in-place requote**：沿用既有 order id 做 `UPDATE price/shares`（3 writes）取代撤銷+新掛（10 writes），
   同時保住 FIFO 時間優先（id 不變）。
2. **每 3 輪才 requote 一次**（報價在輪間保留，簿深不變）。
3. **stocks 表只在參考價真的變動時才 UPDATE**（原本每 tick 6 筆無效寫入）。
4. **機器人頻率減半**（巨鯨 %5→%10、散戶噪音 %2→%4）。
5. **自適應 tick 間隔**（`src/domain/activity.js`，依最近 60 秒請求數）：
   無資料 15s；≤20 req/min → 60s；≤90 → 30s；否則 15s。符合「至少 15 秒才動一次」的規格。
6. **自適應 poll 頻率**：/api/live 回傳 `pollMs`（人少 5s、人多 10s），前端改用單次請求 + setTimeout 鏈。

## 三個目標場景驗算（寫入為全域共享，讀取 = 每人 poll + 共享 tick）

| 場景 | tick 間隔 | ticks | rows written | rows read | 上限 |
|---|---|---|---|---|---|
| 1 人玩一整天（12h） | 60s | 720 | **82,800** | ~760k | 100k / 5M |
| 10 人玩 3 小時 | 30s | 360 | **41,400** | ~762k | 100k / 5M |
| 30 人玩 3 小時 | 15s | 720 | **82,800** | ~2.16M | 100k / 5M |

三個場景全部在額度內，且留有餘裕。

## 行為取捨

- 人少時市場節奏放慢（60s/30s 一輪），人多時維持 15s；價格仍只在成交時變動。
- 做市商報價每 3 輪刷新一次，委託簿內容不變，FIFO 優先因 id 保留而維持。
- 前端 poll 頻率由 server 依人數建議（5s/10s）。
