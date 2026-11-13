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

edit('src/domain/orders.js', [
  ["export const BROKER = { name: '大樹證券', feeRate: 0.000399, listFeeRate: 0.001425, discount: '2.8折' };",
   "// 手續費率見下方 feeCents；UI 文案見 page.js broker-note"],
]);

edit('src/index.js', [
  ["    const fills = (await env.DB.prepare(`",
   "    const fills = upgraded ? (await env.DB.prepare(`"],
  ["      ORDER BY f.id DESC LIMIT 60\n    `).all()).results;\n    const stockSymbols = ['2330','2317','2454','3711','YZU','YOUJIAN'];",
   "      ORDER BY f.id DESC LIMIT 60\n    `).all()).results : [];\n    const stockSymbols = ['2330','2317','2454','3711','YZU','YOUJIAN'];"],
  ["    const queriesList = stockSymbols.map(sym => env.DB.prepare(\"SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 100\").bind(sym));",
   "    const queriesList = upgraded ? stockSymbols.map(sym => env.DB.prepare(\"SELECT price, created_at FROM price_history WHERE symbol=? AND created_at >= datetime('now','-6 hours') ORDER BY id DESC LIMIT 100\").bind(sym)) : [];"],
  ["    const histories = Object.fromEntries(stockSymbols.map((sym, i) => [sym, histRows[i].results.reverse()]));",
   "    const histories = upgraded ? Object.fromEntries(stockSymbols.map((sym, i) => [sym, histRows[i].results.reverse()])) : {};"],
]);

if (failures) { console.error('FAILURES=' + failures); process.exit(1); }
console.log('PART B DONE');
