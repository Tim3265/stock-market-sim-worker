// 前端頁面。刻意不引入任何框架或外部套件，
// 讓 Worker 只回一個 HTML 字串，部署與測試都單純。

export const PAGE_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>股市模擬 — Worker + D1</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif;
         background:#0f1115; color:#e7e9ee; margin:0; padding:24px; }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size:21px; margin:0 0 4px; }
  h2 { font-size:14px; color:#8b93a7; font-weight:500; margin:28px 0 10px; }
  .sub { color:#8b93a7; font-size:13px; margin-bottom:22px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
           gap:12px; margin-bottom:8px; }
  .card { background:#171a21; border:1px solid #252a35; border-radius:10px; padding:14px 16px; }
  .card .label { font-size:12px; color:#8b93a7; }
  .card .value { font-size:20px; font-weight:600; margin-top:4px; font-variant-numeric:tabular-nums; }
  table { width:100%; border-collapse:collapse; background:#171a21;
          border:1px solid #252a35; border-radius:10px; overflow:hidden; }
  th, td { padding:10px 12px; text-align:left; font-size:13.5px;
           border-bottom:1px solid #252a35; }
  th { color:#8b93a7; font-weight:500; font-size:12px; }
  tr:last-child td { border-bottom:none; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  button { border:0; border-radius:6px; padding:5px 10px; cursor:pointer;
           font-size:12.5px; margin-right:6px; color:#fff; }
  .buy { background:#2563eb; } .buy:hover { background:#1d4ed8; }
  .sell { background:#dc2626; } .sell:hover { background:#b91c1c; }
  .tag { font-size:11px; padding:2px 7px; border-radius:999px; }
  .tag.BUY { background:#1e3a8a; color:#bfdbfe; }
  .tag.SELL { background:#7f1d1d; color:#fecaca; }
  .pos { color:#4ade80; } .neg { color:#f87171; }
  #msg { position:fixed; left:50%; bottom:24px; transform:translateX(-50%);
         padding:10px 18px; border-radius:8px; font-size:13.5px; opacity:0;
         transition:opacity .2s; pointer-events:none; }
  #msg.show { opacity:1; }
  #msg.ok { background:#14532d; color:#dcfce7; }
  #msg.err { background:#7f1d1d; color:#fee2e2; }
  .empty { color:#5b6478; font-size:13px; padding:14px 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>股市模擬</h1>
  <div class="sub">Cloudflare Worker + D1（SQLite）</div>

  <div class="cards">
    <div class="card"><div class="label">現金</div><div class="value" id="cash">—</div></div>
    <div class="card"><div class="label">持股市值</div><div class="value" id="mv">—</div></div>
    <div class="card"><div class="label">總資產</div><div class="value" id="total">—</div></div>
    <div class="card"><div class="label">報酬率</div><div class="value" id="pct">—</div></div>
  </div>

  <h2>行情</h2>
  <table>
    <thead><tr>
      <th>代號</th><th>名稱</th><th class="num">股價</th><th>操作</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <h2>持股</h2>
  <table>
    <thead><tr>
      <th>代號</th><th>名稱</th><th class="num">股數</th>
      <th class="num">股價</th><th class="num">市值</th>
    </tr></thead>
    <tbody id="holdings"></tbody>
  </table>

  <h2>交易紀錄</h2>
  <table>
    <thead><tr>
      <th>時間</th><th>動作</th><th>代號</th><th>名稱</th>
      <th class="num">股數</th><th class="num">成交價</th><th class="num">金額</th>
    </tr></thead>
    <tbody id="trades"></tbody>
  </table>
</div>

<div id="msg"></div>

<script>
const fmt = n => Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const ACCOUNT = 1;

function toast(text, ok) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = 'show ' + (ok ? 'ok' : 'err');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = ''; }, 2200);
}

async function load() {
  const [stocksRes, acc, tr] = await Promise.all([
    fetch('/api/stocks').then(r => r.json()),
    fetch('/api/account?id=' + ACCOUNT).then(r => r.json()),
    fetch('/api/trades?id=' + ACCOUNT + '&limit=20').then(r => r.json())
  ]);

  const stocks = stocksRes.stocks ?? [];
  document.getElementById('rows').innerHTML = stocks.map(s => \`
    <tr>
      <td>\${s.symbol}</td>
      <td>\${s.name}</td>
      <td class="num">\${fmt(s.price)}</td>
      <td>
        <button class="buy" onclick="act('\${s.symbol}','BUY')">買 10 股</button>
        <button class="sell" onclick="act('\${s.symbol}','SELL')">賣 10 股</button>
      </td>
    </tr>\`).join('');

  const s = acc.summary;
  document.getElementById('cash').textContent = fmt(s.cash);
  document.getElementById('mv').textContent = fmt(s.marketValue);
  document.getElementById('total').textContent = fmt(s.totalAssets);
  const pct = document.getElementById('pct');
  pct.textContent = (s.profit >= 0 ? '+' : '') + fmt(s.profit) +
                    '（' + (s.profitPct >= 0 ? '+' : '') + fmt(s.profitPct) + '%）';
  pct.className = 'value ' + (s.profit >= 0 ? 'pos' : 'neg');

  document.getElementById('holdings').innerHTML = acc.holdings.length
    ? acc.holdings.map(h => \`
        <tr>
          <td>\${h.symbol}</td><td>\${h.name}</td>
          <td class="num">\${fmt(h.shares)}</td>
          <td class="num">\${fmt(h.price)}</td>
          <td class="num">\${fmt(h.market_value)}</td>
        </tr>\`).join('')
    : '<tr><td colspan="5" class="empty">還沒有持股</td></tr>';

  document.getElementById('trades').innerHTML = tr.trades.length
    ? tr.trades.map(t => \`
        <tr>
          <td>\${new Date(t.created_at.replace(' ', 'T') + 'Z')
                .toLocaleString('zh-TW', { hour12: false })}</td>
          <td><span class="tag \${t.side}">\${t.side === 'BUY' ? '買進' : '賣出'}</span></td>
          <td>\${t.symbol}</td><td>\${t.name}</td>
          <td class="num">\${fmt(t.shares)}</td>
          <td class="num">\${fmt(t.price)}</td>
          <td class="num">\${fmt(t.amount)}</td>
        </tr>\`).join('')
    : '<tr><td colspan="7" class="empty">還沒有交易</td></tr>';
}

async function act(symbol, side) {
  const res = await fetch('/api/trade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account_id: ACCOUNT, symbol, side, shares: 10 })
  });
  const data = await res.json();
  if (data.ok) {
    const t = data.trade;
    toast((side === 'BUY' ? '買進 ' : '賣出 ') + t.name + ' ' +
          t.shares + ' 股，' + (side === 'BUY' ? '花費 ' : '入帳 ') + fmt(t.amount), true);
    load();
  } else {
    toast(data.message || data.error || '交易失敗', false);
  }
}

load();
</script>
</body>
</html>`;
