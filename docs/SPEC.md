# 股市模擬系統 — 規格書

> 狀態：草稿 v0.1 ｜ 2026-11-07
> 課程：資料庫管理實務（IM321）期末專題
> 技術：Cloudflare Workers + D1（SQLite）

---

## 1. 背景

上學期已學過 Microsoft SQL Server，本課程要求使用 SQL Server 以外的資料庫管理系統。
教師已同意本組使用 **Cloudflare D1**（SQLite 系），後端使用 **Workers**。

系統主題：**模擬股市交易**。玩家有虛擬現金，可以買賣虛擬股票，系統保存帳戶、持股與交易紀錄。

---

## 2. 目標

用一個可實際操作的系統，展示以下資料庫能力：

1. **資料模型**：正規化、主鍵／外鍵、CHECK 條件、複合主鍵
2. **交易一致性**：一次交易涉及多張表，必須同時成功或同時失敗
3. **查詢與索引**：JOIN、聚合、時間序列查詢，以及索引對效能的影響
4. **分層設計**：應用程式邏輯與資料存取分離，可測試

---

## 3. 非目標（本期不做）

- 真實下單、真實金流、實名帳戶
- 接真實股市即時報價（模擬資料即可）
- 多裝置同時登入、OAuth
- 行動版 App

---

## 4. 使用者故事

### Sprint 1：地基（已完成 v2 部分）

| ID | 故事 | 驗收條件 |
|---|---|---|
| US-01 | 玩家可以看到所有股票與目前價格 | 首頁列出代號、名稱、股價 |
| US-02 | 玩家可以用市價買進股票 | 現金足夠才成功；現金、持股、交易紀錄同時更新 |
| US-03 | 玩家可以用市價賣出股票 | 持股足夠才成功；三張表同時更新 |
| US-04 | 玩家可以看到自己的資產 | 現金、持股市值、總資產、報酬率正確 |
| US-05 | 玩家可以看到交易紀錄 | 依時間倒序，顯示買賣方向、股數、成交價、金額 |

### Sprint 2：市場會動

| ID | 故事 | 驗收條件 |
|---|---|---|
| US-06 | 玩家可以看到每檔股票的歷史價格走勢 | 折線圖顯示近 30 天，資料來自 `price_history` |
| US-07 | 系統每天會更新股價 | 呼叫一次 `POST /api/market/tick` 產生新價格；同一天不重複 |
| US-08 | 玩家下單時看到的是最新價格 | 成交價 = 當下 `stocks.price` |

### Sprint 3：多人與報表

| ID | 故事 | 驗收條件 |
|---|---|---|
| US-09 | 多個玩家各自有帳戶 | 可用帳號密碼登入，只看到自己的資料 |
| US-10 | 玩家可以看到總資產排行榜 | 以總資產排序，顯示名次、姓名、報酬率 |
| US-11 | 玩家可以看到自己的月度對帳單 | 依月份彙總買進、賣出、手續費 |

### Sprint 4：交付

| ID | 故事 | 驗收條件 |
|---|---|---|
| US-12 | 老師可以透過網址直接使用系統 | `wrangler deploy` 後可用公開網址操作 |
| US-13 | 組員可以協作開發 | GitHub repo、PR 流程、CI 語法檢查 |

---

## 5. 資料模型

```
accounts 1 ──< holdings >── 1 stocks
    │                           │
    └──────< trades >───────────┘
                                │
                          price_history
```

| 表 | 主鍵 | 說明 |
|---|---|---|
| `stocks` | `symbol` | 股票主檔：代號、名稱、現價 |
| `accounts` | `id` | 帳戶：名稱、初始本金、現金 |
| `holdings` | `(account_id, symbol)` | 持股股數（複合主鍵，避免重複） |
| `trades` | `id` | 交易紀錄：方向、股數、成交價、金額、時間 |
| `price_history`（Sprint 2） | `(symbol, date)` | 每日收盤價 |

**完整性規則**

- `cash >= 0`、`shares >= 0`、`price > 0`（CHECK）
- `trades.side IN ('BUY','SELL')`（CHECK）
- `holdings.account_id`、`trades.account_id` → `accounts.id`（FK）
- `holdings.symbol`、`trades.symbol` → `stocks.symbol`（FK）

**正規化**：所有非鍵欄位只依賴主鍵，無部分相依與遞移相依（3NF）。
`trades` 保留成交當下的 `price`，不靠 `stocks.price` 回推，避免歷史價格變動造成帳務錯誤（這是刻意的反正規化）。

---

## 6. API 合約

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/stocks` | 所有股票 |
| GET | `/api/account?id=1` | 帳戶、持股、資產結算 |
| GET | `/api/trades?id=1&limit=20` | 交易紀錄 |
| POST | `/api/trade` | 買進／賣出 |
| GET | `/api/history?symbol=2330&days=30` | 歷史價格（Sprint 2） |
| POST | `/api/market/tick` | 產生新價格（Sprint 2） |

`POST /api/trade`

```json
{ "account_id": 1, "symbol": "2330", "side": "BUY", "shares": 10 }
```

| 錯誤碼 | HTTP | 意義 |
|---|---|---|
| `INVALID_INPUT` | 400 | 參數格式錯誤 |
| `INSUFFICIENT_CASH` | 400 | 現金不足 |
| `INSUFFICIENT_SHARES` | 400 | 持股不足 |
| `NOT_FOUND` | 404 | 帳戶或股票不存在 |

回應格式固定：`{ "ok": true, ... }` 或 `{ "ok": false, "code": "...", "message": "..." }`。

---

## 7. 模組設計（deep modules）

### 7.1 現況問題

`src/index.js` 目前 394 行，同時負責：

- HTTP 路由
- 參數驗證
- 業務規則（現金、持股檢查）
- SQL 與交易
- 前端 HTML／CSS／JS

任何一個改動都要碰同一個檔案，也無法單獨測試「下單」這件事。

### 7.2 目標結構

```
src/
├─ index.js          HTTP adapter：只做路由與狀態碼
├─ domain/
│  ├─ trading.js     placeOrder()  ← 深模組
│  ├─ portfolio.js   snapshot()    ← 深模組
│  └─ market.js      quotes() / history() / tick()
├─ db/
│  ├─ queries.js     所有 SQL 集中在這裡
│  └─ schema.sql
└─ page.js           前端頁面
```

### 7.3 三個深模組的介面

**Trading**

```js
placeOrder(db, { accountId, symbol, side, shares })
  → { ok: true,  trade: { side, symbol, name, shares, price, amount } }
  | { ok: false, code: "INSUFFICIENT_CASH" | "INSUFFICIENT_SHARES" | ..., message }
```

介面只有一個函式，但呼叫端不必知道：

- 要先檢查現金或持股
- 三個資料表的更新順序
- 三件事必須包在同一個 `batch`
- 金額如何四捨五入

**Portfolio**

```js
snapshot(db, accountId)
  → { cash, marketValue, totalAssets, profit, profitPct, holdings[] }
```

隱藏 JOIN、市值計算、報酬率公式。

**Market**

```js
quotes(db)                        → [{ symbol, name, price }]
history(db, symbol, days)         → [{ date, price }]
tick(db, date)                    → { updated: n }
```

### 7.4 接縫與測試

- **接縫**：`db` 由外部傳入（dependency injection），不從 `env` 直接抓
- **HTTP 層**是薄 adapter，只把 request 轉成參數、把結果轉成 HTTP
- **測試表面**就是 `placeOrder` 的介面：給定現金與持股，驗證成功／失敗與三張表的結果
- 預期測試工具：`vitest` + `@cloudflare/vitest-pool-workers`（直接跑在 Workers runtime）

> 設計原則：一個模組的介面越小，呼叫端要學的越少，改動的影響越集中。
> 刪掉 `trading.js` 的話，那些檢查與交易邏輯會散回 HTTP 層與頁面層，所以它值得存在。

---

## 8. 非功能需求

| 項目 | 要求 |
|---|---|
| 金額精度 | 顯示到小數 2 位；內部以 `ROUND(x,2)` 控制誤差 |
| 併發 | 同一帳戶同時下單不得造成負現金或超賣 |
| 效能 | 單一 API 回應 < 300ms（本機） |
| 免費額度 | Workers 每日 10 萬請求、D1 5GB 以內 |
| 可用性 | demo 期間電腦需開著；正式版部署到 Cloudflare |

**已知限制**：D1 沒有跨語句的互動式交易，只有 `batch()`。
「先檢查、後寫入」之間存在極小競態窗口，報告需說明並提出可能的解法（例如把檢查寫進 `WHERE` 條件）。

---

## 9. 待決策（grooming 要回答）

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| Q1 | 股價要用模擬還是真實資料？ | 模擬隨機漫步 / 接外部 API | 模擬（可控、可重現） |
| Q2 | 要不要真的做登入？ | 完整帳密 / 選單切換帳戶 | 先做切換，Sprint 3 再升級 |
| Q3 | 交易型態？ | 市價單 / 限價單 | 市價單即可，限價單列 P2 |
| Q4 | 走勢圖資料範圍？ | 7 天 / 30 天 / 90 天 | 30 天，可切換 |
| Q5 | 是否要手續費？ | 有 / 無 | 有（0.1425%，可講商業邏輯） |

---

## 10. 風險

| 風險 | 影響 | 對策 |
|---|---|---|
| 教師對 D1 的認可範圍有變 | 需改回 MySQL | 保留 PHP 版在 Git 歷史；隨時可回復 |
| D1 交易限制被質疑 | 報告失分 | 在報告中主動說明限制與替代方案 |
| 免費額度用盡 | demo 中斷 | 資料量控制；必要時改用本機 demo |
| 時間不足 | 功能做不完 | 以 Sprint 1 為最低可交付版本 |
