const fs = require('fs');
const ROOT = 'D:/software/Projects/stock-market-sim';
let failures = 0;
function edit(p, pairs, all) {
  p = ROOT + '/' + p;
  let s = fs.readFileSync(p, 'utf8');
  const NL = s.includes('\r\n') ? '\r\n' : '\n';
  for (const [old0, new0] of pairs) {
    const old = old0.split('\n').join(NL), nw = new0.split('\n').join(NL);
    const c = s.split(old).length - 1;
    if (c < 1 || (!all && c !== 1)) { console.error('FAIL ' + p + ' COUNT=' + c + ' :: ' + JSON.stringify(old.slice(0, 70))); failures++; continue; }
    s = s.split(old).join(nw);
  }
  fs.writeFileSync(p, s);
  console.log('OK ' + p);
}

// orders.js: 刪除未使用的 BROKER export
edit('src/domain/orders.js', [
  ["// 大樹證券：手續費 0.1425% 打 2.8 折 = 0.0399%，向上取到 0.01 元。\r\nexport const BROKER = { name: '大樹證券', feeRate: 0.000399, listFeeRate: 0.001425, discount: '2.8折' };\r\n",
   "// 大樹證券：手續費 0.1425% 打 2.8 折 = 0.0399%，向上取到 0.01 元（UI 文案見 page.js broker-note）。\r\n"],
]);

// index.js: /api/live 的 fills/histories 查詢加上 upgraded 防護
edit('src/index.js', [
  ["    const bookResult = await book(env.DB, symbol);\n\n    const fills = (await env.DB.prepare(`",
   "    const bookResult = await book(env.DB, symbol);\n\n    const fills = upgraded ? (await env.DB.prepare(`"],
  ["      ORDER BY f.id DESC LIMIT 60\n    `).all()).results;\n    const stockSymbols = ['2330','2317','2454','3711','YZU','YOUJIAN'];",
   "      ORDER BY f.id DESC LIMIT 60\n    `).all()).results : [];\n    const stockSymbols = ['2330','2317','2454','3711','YZU','YOUJIAN'];"],
  ["    const queriesList = stockSymbols.map(sym => env.DB.prepare(\"SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 100\").bind(sym));\n\n    const histRows = queriesList.length ? await env.DB.batch(queriesList) : [];",
   "    const queriesList = upgraded ? stockSymbols.map(sym => env.DB.prepare(\"SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 100\").bind(sym)) : [];\n\n    const histRows = queriesList.length ? await env.DB.batch(queriesList) : [];"],
  ["    const histories = Object.fromEntries(stockSymbols.map((sym, i) => [sym, histRows[i].results.reverse()]));",
   "    const histories = upgraded ? Object.fromEntries(stockSymbols.map((sym, i) => [sym, histRows[i].results.reverse()])) : {};"],
]);

// SPEC: §4.8 數量區間、§10 account_id 註記、§8.3 FK 說明、§4.2 機器人帳戶註記
edit('docs/SPEC.md', [
  ['| 散戶雜訊 | 每奇數 tick | 對隨機一檔市價買／賣 35～89 股 |', '| 散戶雜訊 | 每奇數 tick | 對隨機一檔市價買／賣 35～79 股 |'],
  ['| 巨鯨波動 | 每 5 tick | 對隨機一檔市價買／賣 40～89 股 |', '| 巨鯨波動 | 每 5 tick | 對隨機一檔市價買／賣 40～85 股 |'],
  ['{ "account_id": 1, "symbol": "YZU", "side": "BUY", "type": "LIMIT", "price": 45.5, "shares": 100 }',
   '{ "symbol": "YZU", "side": "BUY", "type": "LIMIT", "price": 45.5, "shares": 100 }\n（`account_id` 以 session 為準，body 內帶入會被忽略）'],
  ['- 所有 `account_id`、`symbol`、`order_id` 都有 FK', '- 所有 `account_id`、`symbol`、`order_id`、`maker_order_id`、`taker_order_id`、`buyer_id`、`seller_id` 都有 FK'],
  ['關鍵設計：**機器人也是 `accounts` 的一列**，`is_bot = 1`。',
   '關鍵設計：**機器人也是 `accounts` 的一列**，`is_bot = 1`。\n\n> 註：「散戶雜訊」委託寄生於 1000001（動能派）帳戶發送；「巨鯨波動」寄生於 1000002（價值派）帳戶，共用資金與持股池。'],
]);

// README: 說明資料庫保留 8 檔、UI 只顯示 6 檔
edit('README.md', [
  ['舊規格書中「不登入」及 10 秒 tick 的敘述已被本段更新取代。',
   '舊規格書中「不登入」及 10 秒 tick 的敘述已被本段更新取代。資料庫保留舊種子股票（0050/2603）共 8 檔，UI 與指數只顯示交易中的 6 檔。'],
]);

// 測試：recharge 併發衝突耗盡時回 409 CONFLICT
edit('test/integration.auth.test.js', [
  ["it('allows repeated guest logins with the same nickname',async()=>{",
   "it('recharge 在 CAS 重試耗盡時回傳 409 CONFLICT',async()=>{\n const login=await post('/api/auth/guest',{nickname:'conflict-user'});\n const cookie=login.headers.get('Set-Cookie').split(';')[0];\n await env.DB.exec(\"CREATE TRIGGER force_conflict BEFORE UPDATE ON market_state BEGIN UPDATE market_state SET match_seq=match_seq+1; END;\");\n try{\n  const res=await post('/api/account/recharge',{},cookie);\n  expect(res.status).toBe(409);\n  expect((await res.json()).code).toBe('CONFLICT');\n }finally{\n  await env.DB.exec('DROP TRIGGER IF EXISTS force_conflict;');\n }\n});\n\nit('allows repeated guest logins with the same nickname',async()=>{"],
]);

if (failures) { console.error('FAILURES=' + failures); process.exit(1); }
console.log('PART A DONE');
