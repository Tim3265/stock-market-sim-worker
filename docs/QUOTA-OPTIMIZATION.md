# D1 免費額度優化報告

D1 free tier（整個帳號共享，每日 UTC 00:00 重置）：**5,000,000 rows read / 100,000 rows written**。
超過上限當天所有查詢直接失敗。rows read 算「掃描」的 rows，index 進入點也算 rows written。

量測工具：`test/quota.measure.test.js`（`npx vitest run test/quota.measure.test.js` 印出 QUOTA-REPORT）。

## 效能定義（與使用者確認）

**效能不變 = 只要有玩家在看盤，tick 固定 15 秒，每個 tick 玩家都看得到。**
市場維持 lazy tick：沒人發請求就完全不推進、不燒任何額度（關掉分頁就省錢）。

## 優化前（baseline）

| 指標 | 數值 |
|---|---|
| 每 poll cycle（/api/live + /api/index）rows read | 71 |
| 每 tick rows read / written | 746 / **783** |

寫入爆點：做市商每 tick「撤單 60 + 新掛 60」，每筆 INSERT 算 6 rows written（table + index），
單 tick 造市約 600 writes → 4 ticks/min = 3,132 writes/min，**100k 上限約 32 分鐘就燒光**。

## 優化後（固定 15 秒 tick）

| 指標 | 數值 |
|---|---|
| 每 poll cycle rows read（只打 /api/live） | 59 |
| 每 tick rows read / written | 285 / **100** |

手段：

1. **做市商 in-place requote**（沿用 order id 做 UPDATE，保住 FIFO 時間優先），每 4 輪才刷新一次；PARTIAL 單撤銷重掛。
2. **stocks 表只在參考價真的變動時才 UPDATE**。
3. **機器人頻率降低**（基礎單 %2→%3、巨鯨 %5→%10、噪音 %2→%4）。
4. **讀取裁剪**：indexHistory 併入 /api/live（前端少打一個請求），LIMIT 500→120、price_history 100→40、fills 60→30。
5. **poll 頻率依人數自適應**（/api/live 回傳 `pollMs`：人少 5s、人多 10s）—— 只影響讀取額度，不影響 tick 節奏。

## 場景驗算（tick 固定 15s；寫入為全域共享，讀取 = 每人 poll + 共享 tick）

| 場景 | ticks | rows written | rows read | 結果 |
|---|---|---|---|---|
| 10 人玩 3 小時 | 720 | **72,000** | ~1.1M | 上限內 |
| 30 人玩 3 小時 | 720 | **72,000** | ~2.1M | 上限內 |
| 1 人玩一整天 |視活躍時間 | 400 writes/min | ~1.1k/min | 見下 |

**1 人整天的誠實上限**：固定 15s tick 下，100k writes ÷ 400 writes/min ≈ **連續看盤約 4.2 小時**。
12 小時連續不關分頁在 15 秒 tick 下數學上不可能（2,880 ticks × 100 = 288k writes）。
實際上 lazy tick 會在分頁關掉／沒人請求時完全暫停市場，所以「玩一整天」（有休息、關分頁）完全在額度內；只有「連續盯盤 12 小時」會超過，上限約 4.2 小時連續盯盤。

## 行為取捨

- tick 永遠 15 秒（有人看盤時），不因人數放慢。
- 做市商報價每 4 輪（60 秒）刷新一次，委託簿內容不變、FIFO 優先維持。
- 前端 poll 頻率由 server 依人數建議（5s/10s），不影響看到 tick。
