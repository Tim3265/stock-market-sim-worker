const fs = require('fs');
const ROOT = 'D:/software/Projects/stock-market-sim';
const p = ROOT + '/src/index.js';
let s = fs.readFileSync(p, 'utf8');
const NL = s.includes('\r\n') ? '\r\n' : '\n';
let failures = 0;
function rep(old0, new0, expect) {
  const old = old0.split('\n').join(NL), nw = new0.split('\n').join(NL);
  const c = s.split(old).length - 1;
  if (c !== expect) { console.error('FAIL COUNT=' + c + ' expected ' + expect + ' :: ' + JSON.stringify(old.slice(0, 60))); failures++; return; }
  s = s.split(old).join(nw);
}
rep('    const fills = (await env.DB.prepare(`', '    const fills = upgraded ? (await env.DB.prepare(`', 2);
rep("    const histories = Object.fromEntries(stockSymbols.map((sym, i) => [sym, histRows[i].results.reverse()]));",
    "    const histories = upgraded ? Object.fromEntries(stockSymbols.map((sym, i) => [sym, histRows[i].results.reverse()])) : {};", 1);
if (failures) process.exit(1);
fs.writeFileSync(p, s);
console.log('PART C DONE');
