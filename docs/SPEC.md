# 股市模擬系統 — 規格書

> 版本 v0.5 ｜ 2026-11-07
> 課程：資料庫管理實務（IM321）期末專題
> 技術：Cloudflare Workers + D1（SQLite）

**v0.5 變更（本版重點）**

- 成交機制從「造市者公式」改為 **委託簿撮合（order book）**
- 機器人（造市商、動能派、價值派、恐慌賣壓）**也是帳戶**，走同一條下單路徑
- 支援 **部分成交**；冷門股可能掛很久都不成交
- 價格由「最後成交價」決定，大單吃穿好幾檔 → 自然產生價格衝擊
- 流動性不再是公式參數，而是**造市商掛單的深度**
- 確定 5 檔股票（台股 4 檔 + 虛構 1 檔），另有 1 檔待確認

---

## 1. 背景

上學期已學過 Microsoft SQL Server，本課程要求使用 SQL Server 以外的資料庫管理系統。
教師已同意本組使用 **Cloudflare D1**（SQLite 系），後端使用 **Workers**。

主題：**模擬股市交易**。玩家有虛擬現金，可以買賣虛擬股票；
**玩家的買賣會推動價格**，而且**不一定保證成交**。

---

## 2. 目標

1. **資料模型**：正規化、主鍵／外鍵、CHECK、複合主鍵、部分索引
2. **交易一致性**：下單、凍結、成交、交割、持股移轉必須原子完成
3. **查詢與索引**：JOIN、聚合、時間序列、查詢計畫與索引優化
4. **市場模擬**：委託簿、價格優先／時間優先、部分成交、多種機器人
5. **分層設計**：HTTP 層薄、領域邏輯深、資料存取集中、可測試

---

## 3. 非目標

- 真實下單、真實金流、實名認證
- 高頻交易、毫秒級撮合、跨市場套利
- 行動版 App、WebSocket 即時推播
- 本學期不做登入（改用切換帳戶）

---

## 4. 市場模型

### 4.1 決策：委託簿 + 機器人（取代造市者公式）

| | A. 造市者公式（v0.4） | B. 委託簿 + 機器人（v0.5，採用） |
|---|---|---|
| 誰跟你成交 | 系統，永遠成交 | 造市商、其他機器人、其他玩家 |
| 一定成交嗎 | 一定 | **不一定**，看簿上有沒有人 |
| 冷門股 | 一樣好成交 | 掛半天沒人理 |
| 價格怎麼來 | 公式算 | 買賣撮合的結果 |
| 真實度 | 中 | 高 |
| 工作量 | 小 | 大（多約 2 倍） |

**採用 B。** 理由：這門課的考點（交易一致性、併發、索引、部分成交）
都在 B 才真正出現；而且「有錢不一定買得到」比「一定會成交」更接近真實市場。

### 4.2 參與者：所有人都是帳戶

關鍵設計：**機器人也是 `accounts` 的一列**，`is_bot = 1`。

```
accounts
  ├─ id=1  玩家            is_bot = 0
  ├─ id=2  造市商 MM       is_bot = 1  bot_kind = 'MM'
  ├─ id=3  動能派          is_bot = 1  bot_kind = 'MOMENTUM'
  ├─ id=4  價值派          is_bot = 1  bot_kind = 'VALUE'
  └─ id=5  恐慌賣壓        is_bot = 1  bot_kind = 'PANIC'
```

機器人下單時呼叫**和玩家完全相同的 `placeOrder()`**。

> 報告可以寫：「人類與機器人共用同一條交易路徑，規則一致、無法作弊。」

| 角色 | 行為 | 對市場的影響 |
|---|---|---|
| **造市商** | 在合理價上下掛多層限價買賣單，提供雙邊流動性 | 讓玩家有東西可以吃；深度決定流動性 |
| **動能派** | 連漲追買、連跌殺出 | 製造趨勢波段 |
| **價值派** | 偏離合理價就反向操作 | 把價格拉回，避免暴走 |
| **恐慌賣壓** | 低機率觸發，連續市價賣出 | 製造崩盤與反彈 |

### 4.3 委託簿與撮合規則

`orders` 表就是委託簿：狀態為 `OPEN` 或 `PARTIAL` 的限價單。

| 規則 | 內容 |
|---|---|
| **價格優先** | 買單取最高價、賣單取最低價 |
| **時間優先** | 同價格時，`id` 小的先成交（FIFO） |
| **成交價** | 以**掛單方（maker）的價格**成交 |
| **部分成交** | 可以只吃掉一部分，剩餘留在簿上 |
| **市價單** | 吃到沒有對手為止，剩下**直接取消**（IOC） |
| **限價單** | 吃到沒對手為止，剩下**掛在簿上** |
| **不自成交** | 跳過與自己同帳戶的掛單 |

### 4.4 價格與漲跌停

- `stocks.price` = **最後一筆成交價**；沒有成交就不變
- 每次成交寫一列 `price_history`（source = `TRADE`）
- 漲跌停：以 `stocks.ref_price`（當日基準價）為中心 **±10%**
- 超出範圍的限價單直接拒絕（`PRICE_LIMIT`）
- 市價單最多吃到漲跌停價為止
- 「當日」以台灣時間（UTC+8）換日；當天第一個請求把 `ref_price` 設為最新價

> 台股 ±10% 的規則剛好可以解釋「為什麼一筆大單不會把價格打到 0」。

### 4.5 流動性：由造市商的掛單深度決定

`stocks.liquidity` 的定義仍然是：

> **讓價格變動 1% 所需吃掉的股數。**

但現在它不是公式參數，而是**造市商報價的深度**：

```
第 1 檔：偏離 mid ±0.1%，掛 liquidity × 0.2 股
第 2 檔：偏離 mid ±0.3%，掛 liquidity × 0.5 股
第 3 檔：偏離 mid ±0.8%，掛 liquidity × 1.0 股
```

- `liquidity` 大 → 每檔掛很多 → 買 10 張幾乎不動
- `liquidity` 小 → 一吃就穿好幾檔 → 價格大幅跳動
- 冷門股連造市商都掛很少 → **可能完全吃不到**

### 4.6 時間模型：有人玩才動（lazy tick）

```
任何 API 請求進來
  → 讀 market_state.last_tick_at
  → 若 now − last_tick_at ≥ 10 秒
       → 用樂觀鎖搶「這一輪」
       → 跑一次 tick：機器人報價、動能判斷、恐慌判定
       → 寫 price_history（每檔一列）
       → 更新 last_tick_at = now
  → 回傳最新價格
```

- **沒人使用 → 完全靜止**，不寫任何資料
- **有人使用 → 每 10 秒市場動一次**
- **不補跑、不回溯**：落後就只跑一輪，避免一次跳太遠

**併發保護（課程重點）**

```sql
UPDATE market_state
   SET last_tick_at = ?, tick_count = tick_count + 1
 WHERE id = 1 AND last_tick_at < ?
```

只有 `changes = 1` 的請求負責跑 tick，其他請求直接讀現價。
這是**樂觀鎖（optimistic locking）**。

> 為什麼不用 Cron？因為沒人看的時候不需要跑，白燒 D1 寫入額度。

### 4.7 沒有成交時，價格怎麼動？

嚴格來說「沒有成交就沒有新價格」。但為了讓圖表有東西看，
tick 時会對 `stocks.price` 做極小幅度的「報價中價漂移」：

```
deviation = (price − fair_price) / fair_price
drift     = −0.05 × deviation        -- 偏離 10% 拉回 0.5%
noise     = N(0, volatility)         -- 約 0.3%
change    = drift + noise
中價       = price × (1 + change)，限制 ±3%
```

這個中價只用來**移動造市商的報價中心**；真正的 `price` 仍然只由成交改變。
圖表記的是「最後成交價」，若整段時間沒成交，線會是平的——這是真實市場的樣子。

> 也就是說：**有成交才有價格**。機器人只負責讓「有成交」這件事發生。

### 4.8 機器人行為細節

| 機器人 | 觸發 | 行為 |
|---|---|---|
| 造市商 | 每 tick | 取消自己所有掛單 → 以中價為中心重掛 3 層買賣單 |
| 動能派 | 每 3 tick | 近 5 筆成交價連漲 > 2% → 市價買；連跌 > 2% → 市價賣 |
| 價值派 | 每 5 tick | `price < fair × 0.97` → 限價買；`price > fair × 1.03` → 限價賣 |
| 恐慌賣壓 | 每 tick 0.5% 機率 | 進入恐慌 5 個 tick，每 tick 市價賣出持股的 20% |

機器人也有現金與持股，**不能超賣、不能透支**。
造市商種子持股足以應付報價；其他機器人初始持股由種子資料決定。

---

## 5. 股票清單

| 代號 | 公司 | 綽號 | 產業 | 初始價 | liquidity | 玩家體驗 |
|---|---|---|---|---|---|---|
| 2330 | 台積電 | **GG** | 半導體 | 980 | 200,000 | 買 10 張無感，要很大一筆才推得動 |
| 2317 | 鴻海 | **紅海** | 電子代工 | 205 | 30,000 | 中大型，10 萬元小有感覺 |
| 2454 | 聯發科 | **發哥** | IC 設計 | 1,290 | 12,000 | 波動大，適合做波段 |
| 3711 | 日月光投控 | **日月潭** | 封測 | 165 | 4,000 | 中小型，一般玩家推得動 |
| YZU | 元智智能（虛構） | **元智 AI** | AI 伺服器 | 45 | 300 | **超低流動性，常常掛不到** |
| ? | 右間 | **右間** | 待確認 | 待確認 | 待確認 | 使用者指定名稱，公司與代號待補 |

> 目前確定 5 檔。`右間` 待補公司與代號，可作為第 6 檔，或替換上表其中一檔。

**設計意圖**

- GG／紅海：示範「大公司要很多人才能撼動」
- 發哥／日月潭：示範「一般玩家就能影響」
- 元智 AI：示範「有錢也買不到」與部分成交

---

## 6. 資料來源：TWSE OpenAPI

| 方案 | 來源 | 費用 | 備註 |
|---|---|---|---|
| 台股日線 | **TWSE OpenAPI** | 免費、免金鑰 | 官方 |
| 台股即時 | TWSE 即時報價 | 免費 | 延遲 20 秒，不適合高頻 |

**用途：只拿來校準參數，不畫進圖表。**

1. 抓最近 30 天日線 + 最新收盤價
2. 計算三個起始參數：

| 參數 | 怎麼算 | 用途 |
|---|---|---|
| `fair_price` | 30 日均價 | 均值回歸基準、造市商報價中心 |
| `volatility` | 日報酬率標準差 | 報價中價的噪音大小 |
| `liquidity` | 日均成交量 × 0.5% | 造市商每檔掛單深度 |

3. 寫入 `stocks`
4. 虛構股（元智 AI）用人工參數

**為什麼不把日線畫進圖表？**
時間尺度不同（日線每天一點、tick 10 秒一點），硬放會出現「前面很平、後面很抖」。

---

## 7. 使用者故事

### Sprint 1｜地基（重構 + 測試，不加功能）

| ID | 故事 | 驗收條件 |
|---|---|---|
| US-01 | 玩家可以看到所有股票與價格 | 首頁列出代號、名稱、股價 |
| US-02 | 玩家可以用市價買進 | 現金足夠才成功；三張表同時更新 |
| US-03 | 玩家可以用市價賣出 | 持股足夠才成功；三張表同時更新 |
| US-04 | 玩家可以看到資產 | 現金、市值、總資產、報酬率正確 |
| US-05 | 玩家可以看到交易紀錄 | 預設最近 20 筆，時間倒序 |
| US-06 | 改程式不怕弄壞功能 | 單元測試 + 整合測試，一行指令跑完 |
| US-07 | 每次 PR 自動檢查 | GitHub Actions 跑測試，紅燈不能合併 |

### Sprint 2｜委託簿與造市商

| ID | 故事 | 驗收條件 |
|---|---|---|
| US-08 | 系統有一本委託簿 | 可看到每檔股票的最佳 5 檔買賣價與數量 |
| US-09 | 我的市價單會吃掉簿上的掛單 | 成交價可能是好幾檔的混合 |
| US-10 | 我的市價單可能吃不飽 | 剩餘股數直接取消，並回報成交量 |
| US-11 | 造市商會自動掛單 | 每 10 秒重新報價；深度依 `liquidity` 不同 |
| US-12 | 大單會推價、小單不會 | 買 10 張元智 AI 明顯推價；買 10 張 GG 幾乎不動 |
| US-13 | 價格有漲跌停 | 限價超出 ±10% 被拒絕 |

### Sprint 3｜玩家的限價單

| ID | 故事 | 驗收條件 |
|---|---|---|
| US-14 | 我可以下限價單 | 掛單後狀態 `OPEN`，現金或持股被凍結 |
| US-15 | 我的限價單會排隊 | 價格優先、時間優先；可部分成交 |
| US-16 | 我可以取消限價單 | 狀態 `CANCELLED`，凍結的資金／持股釋放 |
| US-17 | 我看得到自己的委託 | 狀態、已成交股數、剩餘股數 |

### Sprint 4｜更多機器人與報表

| ID | 故事 | 驗收條件 |
|---|---|---|
| US-18 | 動能派會追漲殺跌 | 連續上漲後出現額外買盤 |
| US-19 | 價值派會逢低承接 | 偏離合理價 3% 時出現反向掛單 |
| US-20 | 偶爾會恐慌崩盤 | 觸發後價格快速下跌，數個 tick 後回穩 |
| US-21 | 我看到價格走勢圖 | 近 6 小時最後成交價折線圖 |
| US-22 | 交易紀錄可以篩選與分頁 | 股票、買賣、日期；每頁 20 筆 |
| US-23 | 排行榜 | 依總資產排序（含機器人） |

### Sprint 5｜交付

| ID | 故事 | 驗收條件 |
|---|---|---|
| US-24 | 老師可以透過網址操作 | 部署後可公開存取 |
| US-25 | 報告有索引實驗 | 10 萬筆下，有索引 vs 沒索引的查詢時間 |

---

## 8. 資料模型

### 8.1 ER 圖

```
accounts 1 ──< holdings >── 1 stocks
    │                           │
    ├──< orders >───────────────┤
    │        │                  │
    │        └──< trades >──────┤
    │                           │
    └──< bot_state >────────────┤
                                │
                          price_history

market_state（單列，全域時鐘與鎖）
```

### 8.2 資料表

| 表 | 主鍵 | 說明 |
|---|---|---|
| `stocks` | `symbol` | 代號、名稱、綽號、現價、`fair_price`、`ref_price`、`volatility`、`liquidity`、`tick_size` |
| `accounts` | `id` | 名稱、本金、現金、`frozen_cash`、`is_bot`、`bot_kind` |
| `holdings` | `(account_id, symbol)` | 股數、`frozen_shares` |
| `orders` | `id` | 委託：方向、型態、價格、股數、已成交、狀態 |
| `trades` | `id` | 成交：買方、賣方、價格、股數、金額、吃單方 |
| `price_history` | `id` | 每次成交或 tick 的價格（`symbol, ts` 索引） |
| `market_state` | `id` | 單列：`last_tick_at`、`tick_count`、`match_seq` |
| `bot_state` | `(account_id, symbol)` | 機器人狀態（如恐慌剩餘 tick） |

**`orders` 狀態機**

```
        ┌──────────── 部分成交 ────────────┐
        ▼                                  │
  OPEN ──► PARTIAL ──► FILLED              │
    │           │                          │
    └───────────┴──► CANCELLED ◄───────────┘
```

**`trades` 為什麼一筆成交只寫一列？**

一筆成交同時有買方與賣方。寫一列（`buyer_id`、`seller_id`）比寫兩列更正規化，
也避免「同一筆成交被重複計算」。查某人的成交時：

```sql
SELECT ...,
       CASE WHEN buyer_id = ? THEN 'BUY' ELSE 'SELL' END AS side
  FROM trades
 WHERE buyer_id = ? OR seller_id = ?
 ORDER BY id DESC
 LIMIT ? OFFSET ?
```

### 8.3 完整性規則（CHECK / FK / Trigger）

- `cash >= 0`、`frozen_cash >= 0`、`cash >= frozen_cash`
- `shares >= 0`、`frozen_shares >= 0`、`frozen_shares <= shares`
- `price > 0`、`shares > 0`、`filled_shares <= shares`
- `side IN ('BUY','SELL')`
- `type IN ('MARKET','LIMIT')`
- `status IN ('OPEN','PARTIAL','FILLED','CANCELLED','REJECTED')`
- `type = 'MARKET'` → `price IS NULL`；`type = 'LIMIT'` → `price > 0`
- 所有 `account_id`、`symbol`、`order_id` 都有 FK

**Trigger（資料庫層的最後防線）**

```sql
-- 買單成交前，確認現金足夠（含手續費）
CREATE TRIGGER trg_fill_buy_guard BEFORE INSERT ON trades
WHEN NEW.buyer_id IS NOT NULL
 AND (SELECT cash - frozen_cash FROM accounts WHERE id = NEW.buyer_id) < NEW.amount
BEGIN SELECT RAISE(ABORT, 'INSUFFICIENT_CASH'); END;

-- 賣單成交前，確認持股足夠
CREATE TRIGGER trg_fill_sell_guard BEFORE INSERT ON trades
WHEN NEW.seller_id IS NOT NULL
 AND COALESCE((SELECT shares - frozen_shares FROM holdings
                WHERE account_id = NEW.seller_id AND symbol = NEW.symbol), 0) < NEW.shares
BEGIN SELECT RAISE(ABORT, 'INSUFFICIENT_SHARES'); END;
```

> 應用層先檢查是為了給友善訊息；Trigger 是最後一道防線。
> **即使應用層有競態，資料庫也不會出現負現金或超賣。**

### 8.4 索引

| 索引 | 用途 |
|---|---|
| `idx_orders_book(symbol, side, status, price, id)` | 撮合：取最佳價、同價 FIFO |
| `idx_orders_account(account_id, status, id DESC)` | 我的委託 |
| `idx_trades_buyer(buyer_id, id DESC)` | 我的成交（買方） |
| `idx_trades_seller(seller_id, id DESC)` | 我的成交（賣方） |
| `idx_trades_symbol(symbol, id DESC)` | 個股成交明細 |
| `idx_history(symbol, ts DESC)` | 走勢圖 |
| `idx_holdings_account(account_id)` | 資產結算 |

**報告實驗**：以 10 萬筆成交比較
`WHERE buyer_id = ? OR seller_id = ?` 在有／無索引下的查詢計畫與時間。

### 8.5 刻意的反正規化

- `trades.price` 保存成交當下的價格，不靠 `stocks.price` 回推
- `stocks.price` 是最後成交價的快取，避免每次查詢都 `MAX(id)`
- `orders.filled_shares` 是累計值，避免每次 `SUM(trades)`

---

## 9. 撮合引擎設計

### 9.1 下單流程

```
placeOrder(db, { accountId, symbol, side, type, price, shares })
  1. 驗證參數（正整數股數、合法方向與型態、價格刻度）
  2. 讀 stocks、accounts（同一個 batch 之前）
  3. 限價單檢查漲跌停範圍
  4. 凍結：買 → frozen_cash；賣 → frozen_shares
  5. 寫入 orders（狀態 OPEN）
  6. 撮合（見 9.2）
  7. 市價單剩餘 → CANCELLED；限價單剩餘 → 留在簿上
  8. 更新 stocks.price = 最後成交價
  9. 寫入 price_history
 10. 回傳 { fills, filledShares, avgPrice, status }
```

### 9.2 撮合虛擬碼

```js
while (taker.remaining > 0) {
  const maker = await bestOppositeOrder(db, taker);
  if (!maker) break;                       // 沒對手 → 收工

  const qty = Math.min(taker.remaining, maker.remaining);
  const price = maker.price;               // 成交在掛單方價格

  await settle(db, { maker, taker, qty, price });
  taker.remaining -= qty;
}
```

`bestOppositeOrder`：

```sql
SELECT *
  FROM orders
 WHERE symbol = ?
   AND side = ?                              -- 對手方
   AND status IN ('OPEN','PARTIAL')
   AND account_id <> ?                       -- 不自成交
   AND (? IS NULL OR price <= ?)             -- 買單：賣價 <= 限價
 ORDER BY price ASC, id ASC                  -- 賣單取最低價、FIFO
 LIMIT 1;
```

賣單方向相反：`price >= 限價`、`ORDER BY price DESC, id ASC`。

### 9.3 凍結與交割

| 時機 | 買方 | 賣方 |
|---|---|---|
| 下限價買單 | `frozen_cash += 價格 × 股數` | — |
| 下限價賣單 | — | `frozen_shares += 股數` |
| 成交 | 扣 `frozen_cash`、扣 `cash`、持股增加 | 扣 `shares`、扣 `frozen_shares`、現金增加 |
| 取消 | 釋放剩餘 `frozen_cash` | 釋放剩餘 `frozen_shares` |
| 市價單 | 直接檢查可用現金，成交時扣款 | 直接檢查可用持股 |

「可用」的定義：

```
可用現金   = cash − frozen_cash
可用持股   = shares − frozen_shares
```

### 9.4 併發與 D1 限制

D1 沒有跨語句的互動式交易，只有 `batch()`（隐式交易）。
撮合是多步讀寫，因此需要**序列化**：

```sql
UPDATE market_state
   SET match_seq = match_seq + 1
 WHERE id = 1 AND match_seq = ?
```

- 只有 CAS 成功的請求可以進行撮合，其他重試
- 所有寫入放在同一個 `db.batch()`
- Trigger 保證就算有殘餘競態，也不會負現金或超賣
- 全域序列化在我們的規模（每秒 < 1 筆）完全夠用

> 進階做法：把撮合搬到 **Durable Object**（單一實例、天然序列化）。
> 本專案列為延伸課題，報告會說明取捨。

---

## 10. API 合約

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/stocks` | 行情（含最後成交價、漲跌） |
| GET | `/api/orderbook?symbol=2330&depth=5` | 委託簿（聚合後的最佳 5 檔） |
| GET | `/api/account?id=1` | 帳戶、持股、資產 |
| GET | `/api/trades?id=1&symbol=&side=&from=&to=&limit=20&offset=0` | 我的成交（篩選＋分頁） |
| GET | `/api/orders?id=1&status=OPEN` | 我的委託 |
| GET | `/api/history?symbol=2330&hours=6` | 走勢（最後成交價） |
| POST | `/api/orders` | 下單（市價或限價） |
| DELETE | `/api/orders/:id` | 取消委託 |
| POST | `/api/trade` | 市價單捷徑（相容舊版） |
| POST | `/api/market/tick` | 手動推進一輪（開發用） |
| POST | `/api/market/fast-forward?ticks=100` | 快轉產生歷史（僅開發／demo） |

`POST /api/orders`

```json
{ "account_id": 1, "symbol": "YZU", "side": "BUY", "type": "LIMIT", "price": 45.5, "shares": 100 }
```

成功回應：

```json
{
  "ok": true,
  "orderId": 42,
  "status": "PARTIAL",
  "filledShares": 60,
  "avgPrice": 45.5,
  "fills": [{ "price": 45.5, "shares": 60 }],
  "lastPrice": 45.5
}
```

| 錯誤碼 | HTTP | 意義 |
|---|---|---|
| `INVALID_INPUT` | 400 | 參數錯誤 |
| `INSUFFICIENT_CASH` | 400 | 可用現金不足 |
| `INSUFFICIENT_SHARES` | 400 | 可用持股不足 |
| `PRICE_LIMIT` | 400 | 超出漲跌停 |
| `ORDER_NOT_FOUND` | 404 | 委託不存在 |
| `NOT_YOUR_ORDER` | 403 | 不能取消別人的委託 |
| `NOT_FOUND` | 404 | 帳戶／股票不存在 |
| `CONFLICT` | 409 | 撮合鎖競爭，請重試 |

統一格式：`{ ok: true, ... }` 或 `{ ok: false, code, message }`。

---

## 11. 模組設計（deep modules）

### 11.1 現況

`src/index.js` 394 行，混合路由、驗證、業務規則、SQL、前端。無法單獨測試下單。

### 11.2 目標結構

```
src/
├─ index.js               HTTP adapter：路由與狀態碼
├─ page.js                前端（HTML + 原生 JS）
├─ http.js                統一 JSON 回應與錯誤碼 → 狀態碼
├─ domain/
│  ├─ trading.js          placeOrder()      下單、凍結、交割
│  ├─ orderbook.js        match()           撮合（價格／時間優先）
│  ├─ market.js           tick()、報價中心、漲跌停
│  ├─ portfolio.js        snapshot()        資產結算
│  └─ bots/
│     ├─ marketMaker.js
│     ├─ momentum.js
│     ├─ value.js
│     └─ panic.js
├─ db/
│  ├─ queries.js          所有 SQL 與 batch 建構
│  └─ seed.js             種子資料
└─ schema.sql
```

### 11.3 介面

```js
// trading.js
placeOrder(db, { accountId, symbol, side, type, price, shares })
  → { ok: true, fills, filledShares, avgPrice, orderId, status }
  | { ok: false, code, message }

// orderbook.js
match(db, takerOrder)
  → { fills: [{ price, shares, makerId }], remaining }

// market.js
maybeTick(db, now)
  → { ticked: boolean, prices: [{ symbol, price }] }
applyPriceLimits(stock, price)
  → { ok, price } | { ok: false, code: 'PRICE_LIMIT' }

// portfolio.js
snapshot(db, accountId)
  → { cash, frozenCash, availableCash, marketValue, totalAssets, profit, profitPct, holdings }
```

**為什麼這樣切**

- `orderbook` 只管「怎麼撮」，是唯一需要改撮合規則的地方
- `trading` 只管「一筆委託該不該成立、要動哪些表」
- `market` 只管「時間與價格邊界」
- `portfolio` 只管「資產怎麼算」

四者可以分別替換、分別測試。刪掉任何一個，複雜度都會散回 HTTP 層。

### 11.4 接縫與測試

- `db` 由外部注入（`placeOrder(db, ...)`），不從 `env` 直接抓
- HTTP 層只做 request → 參數、結果 → 狀態碼
- 測試表面就是 `placeOrder` 的介面
- 工具：`vitest` + `@cloudflare/vitest-pool-workers`
- 單元測試：純函式（驗證、資產計算、撮合排序）
- 整合測試：真的 Worker + 真的 D1（Miniflare）

---

## 12. 非功能需求

| 項目 | 要求 |
|---|---|
| 金額精度 | 顯示 2 位小數；內部 `ROUND(x,2)` |
| 價格精度 | 2 位小數，最低 0.01 |
| 併發 | 不得負現金、超賣；同一輪 tick 只能執行一次 |
| 效能 | 單一 API < 300ms（本機），撮合 < 50ms |
| 額度 | Workers 10 萬 req/日、D1 10 萬列寫入/日、5GB |
| 可觀測性 | 每個錯誤有穩定 `code`；結構化 log |

**活躍 2 小時的寫入估算**（6 檔股票）

| 項目 | 每 tick | tick 數 | 總寫入 |
|---|---|---|---|
| 造市商 6 檔 × 6 單 | 36 | 720 | 25,920 |
| 成交／歷史 | 約 12 | 720 | 8,640 |
| 合計 | | | **約 35,000 列／日** |

免費額度 10 萬列／日，仍在安全範圍。

---

## 13. 已決策 / 待決策

| # | 問題 | 決定 |
|---|---|---|
| Q1 | 台股還是美股 | **台股** |
| Q2 | 資料來源 | **TWSE OpenAPI**（僅校準參數） |
| Q3 | 價格形成 | **委託簿撮合 + 機器人** |
| Q4 | 登入 | **本學期不做**，改用切換帳戶 |
| Q5 | 手續費 | 有，0.1425%（Sprint 4） |
| Q6 | 走勢圖 | 近 6 小時 |
| Q7 | tick 間隔 | **10 秒，有人使用才推進** |
| Q8 | 股票檔數 | 5 檔（右間待確認可為第 6 檔） |
| Q9 | 部分成交 | 支援 |
| Q10 | 冷門股不成交 | **允許**，這是刻意設計 |

---

## 14. 風險

| 風險 | 影響 | 對策 |
|---|---|---|
| 撮合邊界太多（部分成交、同時下單） | 出現難重現的 bug | 先把撮合寫成純函式 + 大量單元測試 |
| D1 無互動式交易 | 併發不一致 | 悲觀鎖 CAS + batch + Trigger 三道防線 |
| 機器人暴走（無限下單） | 洗版、燒額度 | 每 tick 每機器人最多 N 單；保留全域開關 |
| Workers 免費 CPU 10ms | 撮合超時 | 限制單次撮合筆數（≤ 50 檔掛單） |
| 冷門股完全沒成交 | demo 畫面很無聊 | 造市商保證最低一檔掛單；快轉指令 |
| 5 檔股票工作量 | 做不完 | Sprint 1 可獨立交付；Sprint 4 可砍機器人 |

---

## 15. 里程碑

| Sprint | 主題 | 估時 | 可獨立交付 |
|---|---|---|---|
| 1 | 重構 + 測試 + CI | 1 天 | ✅ 現有功能 |
| 2 | 委託簿 + 造市商 | 2 天 | ✅ 可以買賣、會部分成交 |
| 3 | 玩家限價單 | 2 天 | ✅ 完整委託生命週期 |
| 4 | 動能／價值／恐慌 + 圖表 + 報表 | 2 天 | ✅ demo 有故事 |
| 5 | 部署、索引實驗、報告 | 3 天 | ✅ 交付 |

> Sprint 3 之後每一段都可以停下來交付，這是刻意的伸縮設計。
