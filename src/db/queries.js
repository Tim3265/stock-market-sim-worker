// 所有 SQL 都集中在這裡。
// 好處：改 schema 時只改一個檔案；測試可以針對查詢單獨驗證。

// ---------- 股票 ----------
export async function listStocks(db) {
  const { results } = await db
    .prepare("SELECT symbol, name, price FROM stocks ORDER BY symbol")
    .all();
  return results;
}

export async function findStock(db, symbol) {
  return db
    .prepare("SELECT symbol, name, price FROM stocks WHERE symbol = ?")
    .bind(symbol)
    .first();
}

// ---------- 帳戶 ----------
export async function findAccount(db, accountId) {
  return db
    .prepare("SELECT id, name, initial_cash, cash FROM accounts WHERE id = ?")
    .bind(accountId)
    .first();
}

// ---------- 持股 ----------
export async function findHolding(db, accountId, symbol) {
  return db
    .prepare("SELECT shares FROM holdings WHERE account_id = ? AND symbol = ?")
    .bind(accountId, symbol)
    .first();
}

export async function listHoldings(db, accountId) {
  const { results } = await db
    .prepare(
      `SELECT h.symbol, s.name, h.shares, s.price,
              ROUND(h.shares * s.price, 2) AS market_value
         FROM holdings h
         JOIN stocks s ON s.symbol = h.symbol
        WHERE h.account_id = ? AND h.shares > 0
        ORDER BY market_value DESC`
    )
    .bind(accountId)
    .all();
  return results;
}

// ---------- 交易紀錄 ----------
export async function listTrades(db, accountId, limit) {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.symbol, s.name, t.side, t.shares, t.price, t.amount, t.created_at
         FROM trades t
         JOIN stocks s ON s.symbol = t.symbol
        WHERE t.account_id = ?
        ORDER BY t.id DESC
        LIMIT ?`
    )
    .bind(accountId, limit)
    .all();
  return results;
}

// ---------- 交易寫入 ----------
// 回傳一組 prepared statements，交給 db.batch() 一起執行。
//
// 順序很重要：先 INSERT trades，再更新餘額／持股。
// schema.sql 的 Trigger 會在 INSERT 時檢查「交易前」的現金與持股，
// 因此即使兩個請求同時下單，資料庫也不會出現負現金或超賣。
export function buildTradeStatements(db, { accountId, symbol, side, shares, price, amount }) {
  const statements = [
    db
      .prepare(
        `INSERT INTO trades (account_id, symbol, side, shares, price, amount)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(accountId, symbol, side, shares, price, amount),
  ];

  if (side === "BUY") {
    statements.push(
      db
        .prepare(
          "UPDATE accounts SET cash = ROUND(cash - ?, 2) WHERE id = ? AND cash >= ?"
        )
        .bind(amount, accountId, amount),
      db
        .prepare(
          `INSERT INTO holdings (account_id, symbol, shares)
           VALUES (?, ?, ?)
           ON CONFLICT(account_id, symbol)
           DO UPDATE SET shares = shares + excluded.shares`
        )
        .bind(accountId, symbol, shares)
    );
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE holdings SET shares = shares - ?
            WHERE account_id = ? AND symbol = ? AND shares >= ?`
        )
        .bind(shares, accountId, symbol, shares),
      db
        .prepare("UPDATE accounts SET cash = ROUND(cash + ?, 2) WHERE id = ?")
        .bind(amount, accountId)
    );
  }

  return statements;
}
