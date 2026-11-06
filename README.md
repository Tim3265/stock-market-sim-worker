# 股市模擬 — Worker + D1

資料庫管理實務 · 期末專題（v2：可買可賣、有交易紀錄）

## 功能

- 行情表：5 檔股票即時報價
- 買進 / 賣出：扣款、更新持股、寫交易紀錄，三件事一個 `batch`
- 資產結算：現金、持股市值、總資產、報酬率
- 交易紀錄：JOIN 股票名稱，依時間倒序

## 架構對照

| 課堂版本 | 這個版本 | 角色 |
|---|---|---|
| Apache + PHP | **Worker**（`src/index.js`） | 執行後端程式 |
| MySQL | **D1**（`env.DB`） | 保存資料（底層 SQLite） |
| phpMyAdmin | `wrangler d1 execute` | 看資料庫 |
| `config.php` 連線設定 | `wrangler.jsonc` 的 `d1_databases` | 接線 |

## 檔案

```
Project/
├─ wrangler.jsonc    設定檔（把 D1 綁定成 env.DB）
├─ schema.sql        建表 + 索引 + 種子資料
├─ src/index.js      Worker 程式（API + 網頁）
└─ package.json      指令
```

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

`side` 只能是 `BUY` 或 `SELL`。

## 怎麼跑

```bash
npm install        # 第一次
npm run db:local   # 建本機 D1 的資料表
npm run dev        # http://localhost:8787
```

> 改了 `schema.sql` 之後要重跑 `npm run db:local`（會重建資料表，資料會清空）。

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

`src/index.js` 的 `trade()` 把三件事包成一個 `env.DB.batch([...])`：

1. `UPDATE accounts` — 扣款（買）或入帳（賣）
2. `UPDATE/INSERT holdings` — 增加或減持股
3. `INSERT trades` — 寫一筆紀錄

**任何一句失敗，整批回滾。** 這就是 D1 版的交易。

## 已知簡化（報告可以寫進去）

- 金額用 `REAL` 存，靠 `ROUND(...,2)` 控制誤差；正式系統應該用整數「分」或定點數。
- `batch` 之前有先做一次檢查（餘額、持股），但檢查與寫入之間仍有極小的競態窗口；D1 沒有跨語句的互動式交易，這是平台限制。
- 目前是單一帳戶（`id = 1`），還沒有登入功能。
- 股價是固定的種子資料，還沒有模擬漲跌。
