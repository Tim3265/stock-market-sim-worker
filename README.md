# 股市模擬 — Worker + D1

資料庫管理實務 · 期末專題
Cloudflare Workers + D1（SQLite）模擬股市，玩家的買賣會推動價格。

## 文件

- [規格書 SPEC](docs/SPEC.md) — v0.5：委託簿撮合、機器人參與者、部分成交
- [待辦清單 BACKLOG](docs/BACKLOG.md) — Sprint 1～5

## 目前進度

| Sprint | 內容 | 狀態 |
|---|---|---|
| **1** | 重構成深模組、單元＋整合測試、CI | ✅ 完成 |
| 2 | 委託簿、撮合引擎、造市商機器人 | 下一步 |
| 3 | 玩家限價單、凍結、取消 | 待做 |
| 4 | 動能／價值／恐慌機器人、走勢圖、報表 | 待做 |
| 5 | 部署、索引實驗、報告 | 待做 |

> 目前畫面仍是 Sprint 1 的行為：市價買賣、持股、資產、交易紀錄。
> 委託簿與機器人會在 Sprint 2 進來。

## 功能（現在）

- 行情表：5 檔股票報價
- 買進 / 賣出：扣款、更新持股、寫交易紀錄，三件事一個 `batch`
- 資產結算：現金、持股市值、總資產、報酬率
- 交易紀錄：JOIN 股票名稱，依時間倒序
- 統一錯誤碼：`{ ok: false, code, message }`
- 資料庫 Trigger：就算應用層有競態，也不會負現金或超賣

## 股票清單（Sprint 2 會換成這一組）

| 代號 | 名稱 | 綽號 | 流動性 |
|---|---|---|---|
| 2330 | 台積電 | GG | 極高 |
| 2317 | 鴻海 | 紅海 | 高 |
| 2454 | 聯發科 | 發哥 | 中 |
| 3711 | 日月光投控 | 日月潭 | 低 |
| YZU | 元智智能（虛構） | 元智 AI | 極低，常常不成交 |
| ? | 右間 | 右間 | 待確認 |

> 目前的 `schema.sql` 還是舊的 5 檔（含 0050、2603），Sprint 2 會更新。

## 架構對照

| 課堂版本 | 這個版本 | 角色 |
|---|---|---|
| Apache + PHP | **Worker**（`src/index.js`） | 執行後端程式 |
| MySQL | **D1**（`env.DB`） | 保存資料（底層 SQLite） |
| phpMyAdmin | `wrangler d1 execute` | 看資料庫 |
| `config.php` 連線設定 | `wrangler.jsonc` 的 `d1_databases` | 接線 |

## 檔案結構

```
Project/
├─ src/
│  ├─ index.js              HTTP adapter：路由與狀態碼
│  ├─ http.js               統一 JSON 回應與錯誤碼
│  ├─ page.js               前端（原生 HTML + JS）
│  ├─ domain/
│  │  ├─ trading.js         下單：驗證、檢查、batch
│  │  ├─ portfolio.js       資產結算（純函式 + 查詢）
│  │  └─ market.js          價格工具（Sprint 2 會長大）
│  └─ db/
│     └─ queries.js         所有 SQL
├─ test/
│  ├─ setup.js              每個測試前重套 schema
│  ├─ unit.*.test.js        單元測試（純函式）
│  └─ integration.api.test.js  整合測試（真 Worker + 真 D1）
├─ schema.sql               建表 + 索引 + Trigger + 種子
├─ vitest.config.js         測試設定（Workers runtime）
└─ wrangler.jsonc           把 D1 綁定成 env.DB
```

**設計原則**：HTTP 層薄、領域邏輯深、SQL 集中。
`placeOrder()` 就是那個「一句話叫出很多服務」的深模組。

## 資料表

| 表 | 說明 |
|---|---|
| `stocks` | 股票主檔（代號、名稱、股價） |
| `accounts` | 帳戶（初始本金、現金） |
| `holdings` | 持股（複合主鍵 `account_id + symbol`） |
| `trades` | 交易紀錄（`side` 分 BUY / SELL） |

索引：

- `idx_trades_account(account_id, id DESC)` — 查某帳戶最近交易
- `idx_trades_symbol(symbol)` — 查某檔股票的所有交易

Trigger：

- `trg_trade_buy_guard` — 現金不足時擋下
- `trg_trade_sell_guard` — 超賣時擋下

## API

| 方法 | 路徑 | 作用 |
|---|---|---|
| GET | `/api/stocks` | 所有股票 |
| GET | `/api/account?id=1` | 帳戶 + 持股 + 資產結算 |
| GET | `/api/trades?id=1&limit=20` | 交易紀錄 |
| POST | `/api/trade` | 買進 / 賣出 |

`POST /api/trade` 的 body：

```json
{ "account_id": 1, "symbol": "2330", "side": "BUY", "shares": 10 }
```

成功：

```json
{ "ok": true, "trade": { "symbol": "2330", "side": "BUY", "shares": 10, "price": 980, "amount": 9800 } }
```

失敗：

```json
{ "ok": false, "code": "INSUFFICIENT_CASH", "message": "現金不足（需要 980000，現有 100000）" }
```

## 怎麼跑

```bash
npm install        # 第一次
npm run db:local   # 建本機 D1 的資料表（會重建，資料會清空）
npm run dev        # http://localhost:8787
```

## 怎麼測試

```bash
npm test           # 跑一次
npm run test:watch # 改檔案自動重跑
```

- **單元測試**：`validateTradeInput`、`checkFunds`、`computeSummary`、價格四捨五入
- **整合測試**：用 `SELF.fetch()` 打真的 API，D1 也是真的（Miniflare）
- 每個測試開始前重套 `schema.sql`，測試之間互不影響
- CI：`.github/workflows/ci.yml`，PR 會自動跑 `npm test`

## 怎麼上線（最後再做）

```bash
npx wrangler login
npx wrangler d1 create stock_sim     # 會印出 database_id
```

把 `database_id` 貼進 `wrangler.jsonc`，然後：

```bash
npm run db:remote
npm run deploy
```

## 交易一致性怎麼看

`src/domain/trading.js` 把三件事包成一個 `env.DB.batch([...])`：

1. `INSERT trades` — 先寫紀錄，讓 Trigger 檢查交易前狀態
2. `UPDATE accounts` — 扣款（買）或入帳（賣）
3. `UPDATE/INSERT holdings` — 增加或減持股

**任何一句失敗，整批回滾。**

資料庫層再用 Trigger 當最後防線：

```sql
CREATE TRIGGER trg_trade_buy_guard
BEFORE INSERT ON trades
WHEN NEW.side = 'BUY'
 AND (SELECT cash FROM accounts WHERE id = NEW.account_id) < NEW.amount
BEGIN SELECT RAISE(ABORT, 'INSUFFICIENT_CASH'); END;
```

即使兩個請求同時下單，也不可能出現負現金或超賣。

## 已知簡化（報告可以寫進去）

- 金額用 `REAL` 存，靠 `ROUND(...,2)` 控制誤差；正式系統應該用整數「分」或定點數。
- D1 沒有跨語句的互動式交易，只有 `batch()`；Sprint 2 的撮合會再加樂觀鎖。
- 目前是單一帳戶（`id = 1`），還沒有登入功能。
- 股價是固定的種子資料，Sprint 2 才會開始變動。
