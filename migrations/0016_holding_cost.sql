-- 持股成本：記錄目前持股總共花了多少錢（含買進手續費），用來算均價與未實現損益。
-- 買進時加上成交金額與手續費；賣出時依賣出比例扣掉成本；重設資金刪除持股時一起消失。
ALTER TABLE holdings ADD COLUMN cost REAL NOT NULL DEFAULT 0;

-- 既有持股沒有逐筆成本紀錄，用該帳戶歷來買進的平均價估算；查不到買進紀錄就用現價。
UPDATE holdings SET cost = ROUND(shares * COALESCE(
  (SELECT SUM(t.amount + COALESCE(t.fee_amount, 0)) / SUM(t.shares)
     FROM trades t
    WHERE t.account_id = holdings.account_id AND t.symbol = holdings.symbol AND t.side = 'BUY'),
  (SELECT price FROM stocks WHERE stocks.symbol = holdings.symbol),
  0), 2)
WHERE shares > 0;
