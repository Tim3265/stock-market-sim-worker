// 背景行情：沒有人上線時，由 Cloudflare 排程（cron，每 5 分鐘）讓股價繼續走，走勢圖才會是連續的。
//
// 有人在看盤時，市場照原本的方式每 15 秒推進一次（造市商報價、機器人下單、真的成交）。
// 那一套每輪要寫約 100 列，24 小時跑會寫掉 50 多萬列，遠超過每天 10 萬列的免費額度。
// 所以背景行情只做最便宜的事：每檔股票依「回歸合理價＋隨機波動」走一步，記一筆價格歷史與指數，
// 每輪約寫 46 列（含索引），一天 288 輪約 13,000 列（免費額度的 13%）。
//
// 保護上課時的額度：今天的寫入已超過免費額度的一定比例，就停止背景行情，留給玩家用。

import { indexBaseFor, taipeiDate } from './indexBase.js';
import { FREE_ROWS_READ, FREE_ROWS_WRITTEN } from '../usage.js';

// 最近幾分鐘內有人在玩（市場有正常推進），就不需要背景行情。
export const IDLE_AFTER_MS = 4 * 60000;
// 今天（UTC 日，台灣時間早上 8 點換日）用量超過這個比例就暫停背景行情。
export const BUDGET_SHARE = 0.6;

const INDEX_SYMBOLS = ['2330', '2317', '2454', '3711', 'YZU', 'YOUJIAN'];
const round = n => Math.round(n * 100) / 100;

function volatility(stock) {
  const base = ['YZU', 'YOUJIAN'].includes(stock.symbol) ? 0.035 : (['3711', '2317'].includes(stock.symbol) ? 0.02 : 0.012);
  return Math.max(Number(stock.volatility || 0), base);
}

// 回傳 { ran: true } 或 { ran: false, reason }
export async function idleTick(db, now = Date.now(), random = Math.random) {
  let state;
  try { state = await db.prepare('SELECT * FROM market_state WHERE id=1').first(); }
  catch (err) { if (String(err).includes('market_state')) return { ran: false, reason: 'not-upgraded' }; throw err; }
  if (!state) return { ran: false, reason: 'not-upgraded' };
  if (now - Number(state.last_tick_at) < IDLE_AFTER_MS) return { ran: false, reason: 'players-active' };

  const dayStartMs = Math.floor(now / 86400000) * 86400000;
  let used = { rows_read: 0, rows_written: 0 };
  try {
    used = await db.prepare('SELECT COALESCE(SUM(rows_read),0) AS rows_read, COALESCE(SUM(rows_written),0) AS rows_written FROM usage_minutes WHERE minute>=?').bind(Math.floor(dayStartMs / 60000)).first();
  } catch (err) { if (!String(err).includes('usage_minutes')) throw err; }
  if (Number(used.rows_written) >= FREE_ROWS_WRITTEN * BUDGET_SHARE || Number(used.rows_read) >= FREE_ROWS_READ * BUDGET_SHARE) return { ran: false, reason: 'budget' };

  const stocks = (await db.prepare('SELECT * FROM stocks ORDER BY symbol').all()).results;
  const date = taipeiDate(now);
  // 版本號 +1：背景行情和玩家下單、市場推進同時發生時，只有一邊會成功，不會互相覆蓋股價。
  // tick_count 補到 4 的倍數：下次有人上線的第一輪，造市商會依新股價重新報價，委託簿不會停在舊價位。
  const ops = [
    db.prepare('UPDATE market_state SET match_seq=match_seq+1, tick_count=((tick_count+3)/4)*4 WHERE id=1 AND match_seq=? AND last_tick_at=?').bind(state.match_seq, state.last_tick_at),
    db.prepare('INSERT INTO transaction_guard(value) SELECT changes()'),
  ];
  let base = 0, cur = 0;
  for (const stock of stocks) {
    const reference = stock.ref_date === date ? Number(stock.ref_price) : Number(stock.price);
    if (Number(stock.ref_price) !== reference || stock.ref_date !== date) ops.push(db.prepare('UPDATE stocks SET ref_price=?, ref_date=? WHERE symbol=?').bind(reference, date, stock.symbol));
    // 漲跌停：參考價 ±10%（和真的市場推進同一套規則）
    const low = Math.ceil(Math.round(reference * 100) * 0.9) / 100, high = Math.floor(Math.round(reference * 100) * 1.1) / 100;
    const previous = Number(stock.price), fair = Number(stock.fair_price) || previous;
    // 每 5 分鐘走一步，幅度取平常的一半，免得一個晚上就從漲停走到跌停。
    const noise = (random() * 2 - 1) * volatility(stock) * 0.5;
    const movement = Math.max(-0.03, Math.min(0.03, -0.05 * (previous - fair) / fair + noise));
    const price = Math.max(0.01, Math.min(high, Math.max(low, round(previous * (1 + movement)))));
    if (price !== previous) {
      ops.push(db.prepare('UPDATE stocks SET price=? WHERE symbol=?').bind(price, stock.symbol));
      ops.push(db.prepare("INSERT INTO price_history(symbol, price, source) VALUES(?, ?, 'IDLE')").bind(stock.symbol, price));
    }
    if (INDEX_SYMBOLS.includes(stock.symbol)) {
      const w = Number(stock.liquidity) || 0;
      base += w * reference;
      cur += w * price;
    }
  }
  const indexBase = await indexBaseFor(db, state, date);
  if (indexBase.isNewDay) ops.push(db.prepare('UPDATE market_state SET index_base=?, index_base_date=? WHERE id=1').bind(indexBase.value, date));
  ops.push(db.prepare('INSERT INTO index_history(value) VALUES(?)').bind(base > 0 ? round(indexBase.value * cur / base) : indexBase.value));
  ops.push(db.prepare('DELETE FROM transaction_guard'));
  try { await db.batch(ops); }
  catch (err) { if (String(err).includes('market_revision_guard')) return { ran: false, reason: 'conflict' }; throw err; }
  return { ran: true };
}
