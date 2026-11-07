// 前端頁面。刻意不引入任何框架或外部套件，
// 讓 Worker 只回一個 HTML 字串，部署與測試都單純。

export const PAGE_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>股市模擬</title>
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
  .chart { background:#171a21; border:1px solid #252a35; border-radius:10px; padding:16px; }
  .chart svg { display:block; width:100%; height:180px; }
  .chart-note { color:#aab2c5; font-size:12px; }
  .chart-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%, 300px),1fr)); gap:12px; }
  .chart h3 { margin:0 0 8px; font-size:15px; }
  dialog { background:#171a21; color:#e7e9ee; border:1px solid #46516a; border-radius:12px; padding:22px; width:min(420px,90vw); }
  dialog::backdrop { background:rgba(0,0,0,.7); }
  dialog label { display:block; margin:14px 0 5px; }
  dialog input { width:100%; padding:10px; background:#0f1115; border:1px solid #46516a; border-radius:6px; color:#fff; }
  .dialog-actions { display:flex; gap:8px; margin-top:18px; }
  .dialog-error { color:#fca5a5; min-height:1.5em; }
</style>
</head>
<body>
<div class="wrap">
  <h1>股市模擬</h1>

  <div class="cards">
    <div class="card"><div class="label">現金（含凍結）</div><div class="value" id="cash">—</div><div class="chart-note" id="available">可用 —</div></div>
    <div class="card"><div class="label">持股市值</div><div class="value" id="mv">—</div></div>
    <div class="card"><div class="label">總資產</div><div class="value" id="total">—</div></div>
    <div class="card"><div class="label">報酬率</div><div class="value" id="pct">—</div></div>
  </div>

  <h2>行情</h2>
  <table>
    <thead><tr>
      <th>名稱</th><th class="num">股價</th><th>操作</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <h2>各公司價格走勢（最近六小時的成交價）</h2>
  <div id="charts" class="chart-grid"></div>
  <h2>委託簿 <small id="book-symbol">選擇股票</small></h2>
  <table><thead><tr><th>買價</th><th>買量</th><th>賣價</th><th>賣量</th></tr></thead><tbody id="book"></tbody></table>
  <h2>我的委託</h2>
  <table><thead><tr><th>股票</th><th>方向</th><th>類型</th><th>價格</th><th>成交 / 股數</th><th>狀態</th><th>操作</th></tr></thead><tbody id="orders"></tbody></table>
  <h2>持股</h2>
  <table>
    <thead><tr>
      <th>名稱</th><th class="num">股數</th>
      <th class="num">股價</th><th class="num">市值</th>
    </tr></thead>
    <tbody id="holdings"></tbody>
  </table>

  <h2>交易紀錄</h2>
  <table>
    <thead><tr>
      <th>時間</th><th>動作</th><th>名稱</th>
      <th class="num">股數</th><th class="num">成交價</th><th class="num">金額</th>
    </tr></thead>
    <tbody id="trades"></tbody>
  </table>
</div>

<div id="msg"></div>
<dialog id="trade-dialog" aria-labelledby="trade-title">
  <form id="trade-form">
    <h2 id="trade-title"></h2>
    <label for="trade-shares">交易股數</label>
    <input id="trade-shares" type="number" min="1" step="1" required>
    <div id="price-field" hidden><label for="trade-price">每股限價</label><input id="trade-price" type="number" min="0.01" step="0.01"></div>
    <p id="trade-error" class="dialog-error" role="status"></p>
    <div class="dialog-actions"><button class="buy" type="submit" id="submit-trade">確認下單</button><button type="button" id="cancel-trade">取消</button></div>
  </form>
</dialog>

<script>
const fmt = n => Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const ACCOUNT = 1;
let trading = false;
let selectedSymbol = '2330';
let stockNames = {};
let tradeIntent = null;

function toast(text, ok) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = 'show ' + (ok ? 'ok' : 'err');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = ''; }, 2200);
}

async function load() {
  const [stocksRes, acc, tr, orders] = await Promise.all([
    fetch('/api/stocks').then(r => r.json()),
    fetch('/api/account?id=' + ACCOUNT).then(r => r.json()),
    fetch('/api/trades?id=' + ACCOUNT + '&limit=20').then(r => r.json()),
    fetch('/api/orders?id=' + ACCOUNT).then(r => r.json())
  ]);

  const stocks = stocksRes.stocks ?? [];
  stockNames = Object.fromEntries(stocks.map(s => [s.symbol, s.nickname || s.name]));
  const statusNames = {OPEN:'等待成交',PARTIAL:'部分成交',FILLED:'已成交',CANCELLED:'已取消'};
  document.getElementById('orders').innerHTML = (orders.orders || []).map(o => '<tr><td>' + (stockNames[o.symbol] || o.symbol) + '</td><td>' + (o.side==='BUY'?'買進':'賣出') + '</td><td>' + (o.type==='LIMIT'?'限價':'市價') + '</td><td>' + (o.price == null?'市價':fmt(o.price)) + '</td><td>' + fmt(o.filled_shares) + ' / ' + fmt(o.shares) + '</td><td>' + (statusNames[o.status] || o.status) + '</td><td>' + (o.type==='LIMIT' && ['OPEN','PARTIAL'].includes(o.status) ? '<button class="sell" onclick="cancel(' + Number(o.id) + ')">取消</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="7" class="empty">還沒有委託</td></tr>';
  document.getElementById('rows').innerHTML = stocks.map(s => \`
    <tr>
      <td><button onclick="showBook('\${s.symbol}')">\${stockNames[s.symbol]}</button></td>
      <td class="num">\${fmt(s.price)}</td>
      <td>
        <button class="buy" onclick="act('\${s.symbol}','BUY')">買進</button>
        <button class="sell" onclick="act('\${s.symbol}','SELL')">賣出</button>
        <button class="buy" onclick="act('\${s.symbol}','BUY',true)">限價買</button>
        <button class="sell" onclick="act('\${s.symbol}','SELL',true)">限價賣</button>
      </td>
    </tr>\`).join('');

  const s = acc.summary;
  document.getElementById('cash').textContent = fmt(s.cash);
  document.getElementById('available').textContent = '可用 ' + fmt(orders.availableCash ?? s.cash) + '／凍結 ' + fmt(orders.frozenCash ?? 0);
  document.getElementById('mv').textContent = fmt(s.marketValue);
  document.getElementById('total').textContent = fmt(s.totalAssets);
  const pct = document.getElementById('pct');
  pct.textContent = (s.profit >= 0 ? '+' : '') + fmt(s.profit) +
                    '（' + (s.profitPct >= 0 ? '+' : '') + fmt(s.profitPct) + '%）';
  pct.className = 'value ' + (s.profit >= 0 ? 'pos' : 'neg');

  document.getElementById('holdings').innerHTML = acc.holdings.length
    ? acc.holdings.map(h => \`
        <tr>
          <td>\${stockNames[h.symbol] || h.name}</td>
          <td class="num">\${fmt(h.shares)}</td>
          <td class="num">\${fmt(h.price)}</td>
          <td class="num">\${fmt(h.market_value)}</td>
        </tr>\`).join('')
    : '<tr><td colspan="4" class="empty">還沒有持股</td></tr>';

  document.getElementById('trades').innerHTML = tr.trades.length
    ? tr.trades.map(t => \`
        <tr>
          <td>\${new Date(t.created_at.replace(' ', 'T') + 'Z')
                .toLocaleString('zh-TW', { hour12: false })}</td>
          <td><span class="tag \${t.side}">\${t.side === 'BUY' ? '買進' : '賣出'}</span></td>
          <td>\${stockNames[t.symbol] || t.name}</td>
          <td class="num">\${fmt(t.shares)}</td>
          <td class="num">\${fmt(t.price)}</td>
          <td class="num">\${fmt(t.amount)}</td>
        </tr>\`).join('')
    : '<tr><td colspan="6" class="empty">還沒有交易</td></tr>';
}

function act(symbol, side, isLimit = false) {
  if (trading) return;
  const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  tradeIntent = {symbol,side,isLimit,requestId};
  document.getElementById('trade-title').textContent = (stockNames[symbol] || symbol) + ' · ' + (isLimit?'限價':'市價') + (side==='BUY'?'買進':'賣出');
  document.getElementById('trade-shares').value = '10';
  document.getElementById('trade-price').value = '';
  document.getElementById('trade-price').required = isLimit;
  document.getElementById('price-field').hidden = !isLimit;
  document.getElementById('trade-error').textContent = '';
  document.getElementById('trade-dialog').showModal();
}

document.getElementById('cancel-trade').addEventListener('click',()=>document.getElementById('trade-dialog').close());
document.getElementById('trade-form').addEventListener('submit',async event => {
  event.preventDefault();
  if (trading || !tradeIntent) return;
  const {symbol,side,isLimit,requestId}=tradeIntent;
  const shares=Number(document.getElementById('trade-shares').value);
  const price=isLimit?Number(document.getElementById('trade-price').value):null;
  if (!Number.isSafeInteger(shares) || shares<1 || shares>10000000 || (isLimit && (!Number.isFinite(price) || price<=0))) {
    document.getElementById('trade-error').textContent='請輸入有效的股數及價格'; return;
  }
  trading = true;
  document.getElementById('submit-trade').disabled=true;
  try {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account_id: ACCOUNT, symbol, side, type:isLimit?'LIMIT':'MARKET', price, shares, request_id:requestId })
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('trade-dialog').close();
    toast('成交 ' + data.filledShares + ' 股，' + (isLimit?'等待成交 ':'未成交取消 ') + data.remaining + ' 股，金額 ' + fmt(data.amount), true);
    try { await load(); await Promise.all([showBook(symbol),loadCharts()]); }
    catch (error) { toast('委託已送出，但畫面更新失敗，請重新整理',false); }
  } else {
    document.getElementById('trade-error').textContent = data.message || data.error || '交易失敗';
  }
  } catch (error) { document.getElementById('trade-error').textContent='連線失敗，請重新整理並檢查交易紀錄，避免重複下單'; }
  finally { trading = false; document.getElementById('submit-trade').disabled=false; }
});

async function cancel(id) {
  if (trading) return;
  trading=true;
  try {
    const result=await (await fetch('/api/orders/'+id+'?account_id='+ACCOUNT,{method:'DELETE'})).json();
    toast(result.ok?'委託已取消':(result.message || '取消失敗'),result.ok);
    await load(); await showBook(selectedSymbol);
  } catch (error) { toast('連線失敗，請重新整理確認委託狀態',false); }
  finally { trading=false; }
}

async function showBook(symbol) {
  const r=await fetch('/api/orderbook?symbol='+encodeURIComponent(symbol));
  const data=await r.json();
  if(!data.ok){toast(data.message || '無法取得委託簿',false);return;}
  selectedSymbol=symbol;
  document.getElementById('book-symbol').textContent=stockNames[symbol] || symbol;
  const rows=Array.from({length:5},(_,i)=>{const b=data.bids[i],a=data.asks[i];return '<tr><td>'+ (b?fmt(b.price):'—') +'</td><td>'+ (b?fmt(b.quantity):'—') +'</td><td>'+ (a?fmt(a.price):'—') +'</td><td>'+ (a?fmt(a.quantity):'—') +'</td></tr>';});
  document.getElementById('book').innerHTML=rows.join('');
}

async function loadCharts() {
  const container=document.getElementById('charts');
  try {
    const response=await fetch('/api/histories');
    const data=await response.json();
    if (!response.ok || !data.ok) throw new Error('history unavailable');
    container.replaceChildren();
    for (const [symbol,points] of Object.entries(data.histories)) {
      const card=document.createElement('section');
      card.className='chart'; card.dataset.chartSymbol=symbol;
      const title=document.createElement('h3'); title.textContent=stockNames[symbol] || symbol;
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('role','img'); svg.setAttribute('aria-label',title.textContent+'最近六小時成交價格走勢');
      const note=document.createElement('div'); note.className='chart-note';
      card.append(title,svg,note); container.append(card);
      renderChart(svg,note,points);
    }
  } catch (error) { container.textContent='無法讀取價格走勢，請重新整理。'; }
}

function renderChart(svg,note,points) {
  if (points.length < 2) {
    svg.innerHTML = '';
    note.textContent = points.length ? '目前只有一筆成交，等待更多成交後顯示走勢。' : '最近六小時沒有成交紀錄，等待成交後顯示走勢。';
    return;
  }
  const prices = points.map(p => Number(p.price));
  const times = points.map(p => Date.parse(p.created_at.replace(' ', 'T') + 'Z'));
  const min = Math.min(...prices), max = Math.max(...prices), span = Math.max(max-min, 0.01);
  const start = times[0], duration = times[times.length-1]-start;
  const coords = prices.map((price,i) => (20 + (duration ? (times[i]-start)/duration : i/(prices.length-1))*760).toFixed(1) + ',' + (160-(price-min)/span*130).toFixed(1)).join(' ');
  svg.setAttribute('viewBox','0 0 800 180');
  svg.innerHTML = '<polyline fill="none" stroke="#60a5fa" stroke-width="3" points="' + coords + '" />';
  note.textContent = '最近六小時成交價（最多 500 筆）：最低 ' + fmt(min) + '，最高 ' + fmt(max) + '；沒有成交時不產生新價格。';
}

load().then(()=>Promise.all([showBook('2330'),loadCharts()]));
setInterval(()=>{if(!document.hidden)load().then(()=>Promise.all([showBook(selectedSymbol),loadCharts()]));},15000);
</script>
</body>
</html>`;
