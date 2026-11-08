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
  button:disabled { opacity:.45; cursor:wait; }
  .buy { background:#2563eb; } .buy:hover { background:#1d4ed8; }
  .sell { background:#dc2626; } .sell:hover { background:#b91c1c; }
  .tag { font-size:11px; padding:2px 7px; border-radius:999px; }
  .tag.BUY { background:#1e3a8a; color:#bfdbfe; }
  .tag.SELL { background:#7f1d1d; color:#fecaca; }
  .pos { color:#f87171; } .neg { color:#4ade80; }
  #msg { position:fixed; left:50%; bottom:24px; transform:translateX(-50%);
         padding:10px 18px; border-radius:8px; font-size:13.5px; opacity:0;
         transition:opacity .2s; pointer-events:none; }
  #msg.show { opacity:1; }
  #msg.ok { background:#14532d; color:#dcfce7; }
  #msg.err { background:#7f1d1d; color:#fee2e2; }
  .empty { color:#aab2c5; font-size:13px; padding:14px 12px; }
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
  .navigation { display:flex; flex-wrap:wrap; gap:8px; margin:18px 0; }
  .navigation button { background:#273044; padding:10px 16px; }
  .navigation button[aria-current="page"] { background:#2563eb; }
  .table-wrap { width:100%; overflow-x:auto; }
  .table-wrap table { min-width:520px; }
  .table-wrap th,.table-wrap td { white-space:nowrap; }
  button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
  #auth-form label { display:block; margin:12px 0 5px; }
  #auth-form input,dialog input,dialog select { min-height:44px; font-size:16px; width:100%; border:1px solid #46516a; border-radius:6px; background:#0f1115; color:#fff; padding:10px; }
  #auth-form button { margin-top:14px; }
  #data-status { padding:10px 12px; margin:12px 0; background:#482b12; border-radius:8px; }
  #trade-summary { padding:12px; background:#202735; border-radius:8px; line-height:1.7; }
  #msg { z-index:20; width:min(520px,calc(100vw - 32px)); pointer-events:auto; }
  @media(max-width:640px) { body { padding:12px; } button { min-height:44px; } .navigation { display:grid; grid-template-columns:repeat(2,1fr); } .navigation button { margin:0; } }
  /* A calm, light trading workspace with one strong accent. */
  :root { color-scheme:light; --ink:#17201a; --muted:#68736c; --line:#e7ebe7; --accent:#c7f46b; }
  body { background:#fafbf9; color:var(--ink); padding:0 28px 56px; }
  .wrap { max-width:1160px; }
  h1 { font-size:22px; font-weight:800; letter-spacing:-.05em; margin:0; }
  h2 { color:var(--ink); font-weight:700; font-size:18px; letter-spacing:-.03em; margin:34px 0 16px; }
  .site-header { display:flex; align-items:center; gap:12px; padding:26px 0; border-bottom:1px solid var(--line); }
  .brand-mark { display:grid; place-items:center; width:34px; height:34px; border-radius:50%; background:var(--accent); color:#182310; font-weight:900; }
  .brand-caption { color:var(--muted); font-size:12px; letter-spacing:.04em; }
  #app-panel > p:first-child { color:var(--muted); font-size:13px; text-align:right; margin:12px 0 0; }
  #logout { color:var(--ink); background:transparent; text-decoration:underline; }
  .navigation { gap:28px; margin:0 0 30px; border-bottom:1px solid var(--line); }
  .navigation button { background:transparent; border-radius:0; color:var(--muted); padding:16px 0; font-size:14px; font-weight:650; margin:0; border-bottom:2px solid transparent; }
  .navigation button[aria-current="page"] { background:transparent; color:var(--ink); border-color:var(--ink); }
  .cards { gap:14px; }
  .card,.chart { background:#fff; border:1px solid var(--line); border-radius:16px; box-shadow:0 8px 25px rgba(20,35,22,.035); }
  .card { padding:22px; }
  .card .label,.chart-note { color:var(--muted); }
  .card .value { color:var(--ink); font-size:25px; letter-spacing:-.04em; }
  .chart { padding:22px; }
  .chart h3 { font-size:18px; letter-spacing:-.03em; }
  .chart-price { font-size:27px; font-weight:750; letter-spacing:-.04em; margin:2px 0; }
  .chart.no-history svg { height:70px; border-bottom:1px dashed #dce4dc; margin-bottom:12px; }
  .chart-action { margin:14px 0 0; background:transparent; border:1px solid #dce4dc; }
  .chart svg { height:145px; }
  .chart-grid { gap:16px; }
  table { background:#fff; border:1px solid var(--line); border-radius:14px; }
  th,td { border-color:var(--line); padding:14px 16px; font-size:14px; }
  th { color:var(--muted); }
  button { color:var(--ink); background:#eef1ed; font-size:14px; font-weight:650; padding:9px 15px; border-radius:999px; }
  button:hover { filter:brightness(.96); }
  .buy,.buy:hover { background:var(--accent); color:#172014; }
  .sell,.sell:hover { background:#e9eeeb; color:#18221b; }
  .tag.BUY { background:#e9f9cf; color:#285412; }
  .tag.SELL { background:#edf1ee; color:#46534a; }
  .pos { color:#d34242; } .neg { color:#13804c; }
  .empty { color:var(--muted); }
  #data-status { background:#fff5dd; color:#70490b; }
  #auth-panel { max-width:460px; margin:8vh auto; padding:32px; }
  #auth-panel h2 { font-size:28px; margin:0 0 10px; }
  #auth-form input,dialog input,dialog select { background:#f6f8f5; color:var(--ink); border:1px solid #dce3dc; }
  #auth-form input:focus,dialog input:focus,dialog select:focus { border-color:#577f28; }
  dialog { background:#fff; color:var(--ink); border:1px solid var(--line); border-radius:20px; box-shadow:0 24px 80px rgba(0,0,0,.2); padding:26px; }
  dialog h2 { font-size:22px; margin:0 0 18px; }
  #trade-summary { background:#f5f8f2; color:#354237; }
  .summary-row { display:flex; justify-content:space-between; gap:12px; padding:3px 0; font-size:13px; }
  .summary-row span:first-child { color:#68736c; }
  .summary-note { color:#68736c; font-size:12px; line-height:1.45; margin:9px 0 0; }
  .dialog-error { color:#ba2929; }
  #msg.ok { background:#1e3020; color:#fff; } #msg.err { background:#8f2828; color:#fff; }
  @media(max-width:640px) {
    body { padding:0 16px 40px; }
    .site-header { padding:18px 0; }
    .navigation { display:flex; gap:20px; overflow-x:auto; white-space:nowrap; margin-bottom:18px; }
    .navigation button { flex:none; padding:12px 0; }
    .chart-grid { grid-template-columns:1fr; }
    .chart { padding:18px; }
    #auth-panel { margin:24px 0; padding:24px; }
  }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<div class="wrap">
  <header class="site-header"><span class="brand-mark" aria-hidden="true">小</span><div><h1>小市場</h1><div class="brand-caption">STOCK MARKET SIMULATOR</div></div></header>
  <div id="auth-panel" class="card">
    <h2>登入或註冊</h2>
    <p class="chart-note">首次使用請註冊：帳號使用 3～24 個英文字母、數字或底線；密碼至少 8 個字元。</p>
    <form id="auth-form"><label for="username">帳號</label> <input id="username" autocomplete="username" required minlength="3" maxlength="24">
      <label for="password">密碼</label> <input id="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128">
      <button class="buy" type="submit">登入</button><button class="buy" id="register" type="button">註冊</button><p id="auth-error" role="status"></p></form>
  </div>
  <div id="app-panel" hidden>
  <p>登入帳號：<span id="username-label"></span> <button id="logout" type="button">登出</button></p>
  <div id="data-status" role="status" hidden></div>
  <p class="chart-note" id="last-refresh">資料載入中</p>
  <nav class="navigation" aria-label="主要選單"><button type="button" data-page="market" aria-current="page">行情</button><button type="button" data-page="trade">下單</button><button type="button" data-page="portfolio">我的資產</button><button type="button" data-page="ranking">排行榜</button></nav>

  <section id="page-portfolio" hidden>
  <div class="cards">
    <div class="card"><div class="label">現金（含凍結）</div><div class="value" id="cash">—</div><div class="chart-note" id="available">可用 —</div></div>
    <div class="card"><div class="label">持股市值</div><div class="value" id="mv">—</div></div>
    <div class="card"><div class="label">總資產</div><div class="value" id="total">—</div></div>
    <div class="card"><div class="label">報酬率</div><div class="value" id="pct">—</div></div>
  </div>
  </section>

  <section id="page-trade" hidden>
  <h2>選擇股票下單</h2>
  <p class="chart-note">每筆成交手續費為成交金額的 0.1425%，向上計至 0.01；限價買單會多凍結預估手續費，未使用的金額會在成交或取消時釋放。</p>
  <table>
    <thead><tr>
      <th>名稱</th><th class="num">股價</th><th>操作</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
  </section>

  <section id="page-market">
  <h2>市場行情</h2><p class="chart-note">探索六間公司 · 圖表顯示最近六小時的實際成交</p>
  <div id="charts" class="chart-grid"></div>
  </section>
  <section id="page-orders" hidden>
  <h2>委託簿 <small id="book-symbol">選擇股票</small></h2>
  <table><thead><tr><th>買價</th><th>買量</th><th>賣價</th><th>賣量</th></tr></thead><tbody id="book"></tbody></table>
  <h2>我的委託</h2>
  <table><thead><tr><th>股票</th><th>方向</th><th>類型</th><th>價格</th><th>成交 / 股數</th><th>狀態</th><th>操作</th></tr></thead><tbody id="orders"></tbody></table>
  </section>
  <section id="page-holdings" hidden>
  <h2>持股</h2>
  <table>
    <thead><tr>
      <th>名稱</th><th class="num">股數</th>
      <th class="num">股價</th><th class="num">市值</th>
    </tr></thead>
    <tbody id="holdings"></tbody>
  </table>
  <h2>交易紀錄</h2>
  <div><label>股票 <select id="filter-symbol"><option value="">全部</option></select></label> <label>方向 <select id="filter-side"><option value="">全部</option><option value="BUY">買進</option><option value="SELL">賣出</option></select></label> <label>從 <input id="filter-from" type="date"></label> <label>到 <input id="filter-to" type="date"></label> <button type="button" id="filter-apply">篩選</button></div>
  <table>
    <thead><tr>
      <th>時間</th><th>動作</th><th>名稱</th>
      <th class="num">股數</th><th class="num">成交價</th><th class="num">金額</th><th class="num">手續費</th>
    </tr></thead>
    <tbody id="trades"></tbody>
  </table>
  <p><button type="button" id="trades-prev">上一頁</button><span id="trades-page">第 1 頁</span> <button type="button" id="trades-next">下一頁</button></p>
  </section>
  <section id="page-ranking" hidden><h2>排行榜</h2><table><thead><tr><th>名次</th><th>玩家</th><th>總資產</th></tr></thead><tbody id="ranking"></tbody></table></section>
</div>
</div>

<div id="msg" role="status" aria-live="polite"></div>
<dialog id="trade-dialog" aria-labelledby="trade-title">
  <form id="trade-form">
    <h2 id="trade-title"></h2>
    <label for="trade-type">委託方式</label><select id="trade-type"><option value="MARKET">市價：依目前可成交價格買賣</option><option value="LIMIT">限價：只接受指定價格或更好</option></select>
    <label for="trade-shares">交易股數（1 張 = 1,000 股）</label>
    <input id="trade-shares" type="number" min="1" step="1" required>
    <div id="price-field" hidden><label for="trade-price">每股限價</label><input id="trade-price" type="number" min="0.01" step="0.01"></div>
    <div id="trade-summary" aria-live="polite"></div>
    <p id="trade-error" class="dialog-error" role="status"></p>
    <div class="dialog-actions"><button class="buy" type="submit" id="submit-trade">確認下單</button><button type="button" id="cancel-trade">取消</button></div>
  </form>
</dialog>
<dialog id="cancel-dialog" aria-labelledby="cancel-title"><h2 id="cancel-title">確定取消這筆委託？</h2><p>取消後，等待中的股數將不再排隊成交。</p><button type="button" id="confirm-cancel" class="sell">確認取消委託</button><button type="button" id="keep-order">保留委託</button></dialog>

<script>
const fmt = n => Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
document.querySelectorAll('table').forEach(table=>{const wrap=document.createElement('div');wrap.className='table-wrap';table.before(wrap);wrap.append(table);});
let trading = false;
function setTrading(value){
  trading=value;
  document.querySelectorAll('#rows button.buy,#rows button.sell,#orders button').forEach(button=>{button.disabled=value;});
}
let selectedSymbol = '2330';
let stockNames = {};
let stockPrices = {};
let stockReferences = {};
let availableCash = 0;
let availableShares = {};
let appliedFilters={symbol:'',side:'',from:'',to:''};
let tradeIntent = null;
let signedIn=false;
let tradeOffset=0,hasMoreTrades=false;
async function refreshSession(){
 const response=await fetch('/api/auth/session');
 const data=await response.json(); signedIn=!!data.ok;
 document.getElementById('auth-panel').hidden=signedIn;
 document.getElementById('app-panel').hidden=!signedIn;
 if(signedIn){document.getElementById('username-label').textContent=data.username; await load(); await Promise.all([showBook('2330'),loadCharts()]);}
}
async function authAction(action){
 const username=document.getElementById('username').value,password=document.getElementById('password').value;
 const message=document.getElementById('auth-error'); message.textContent='';
 try{
  const r=await fetch('/api/auth/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
  const data=await r.json();
  if(!data.ok){message.textContent=data.message || '操作失敗';return;}
  if(action==='register'){message.textContent='註冊成功，請登入';return;}
  document.getElementById('password').value='';await refreshSession();
 }catch(e){if(signedIn){const status=document.getElementById('data-status');status.textContent='登入成功，但資料更新失敗，請檢查網路並重新整理。';status.hidden=false;}else message.textContent='連線失敗，請稍後再試';}
}
document.getElementById('auth-form').addEventListener('submit',event=>{event.preventDefault();authAction('login');});
document.getElementById('register').addEventListener('click',()=>authAction('register'));
document.getElementById('logout').addEventListener('click',async()=>{await fetch('/api/auth/logout',{method:'POST'});signedIn=false;await refreshSession();});
document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>{
  const page=button.dataset.page;
  for(const [id,visible] of [['market',page==='market'],['trade',page==='trade'],['orders',page==='trade'],['portfolio',page==='portfolio'],['holdings',page==='portfolio'],['ranking',page==='ranking']]) document.getElementById('page-'+id).hidden=!visible;
  document.querySelectorAll('[data-page]').forEach(item=>{if(item===button)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
}));
document.getElementById('filter-apply').addEventListener('click',()=>{for(const key of Object.keys(appliedFilters))appliedFilters[key]=document.getElementById('filter-'+key).value;tradeOffset=0;safeLoad();});
document.getElementById('trades-prev').addEventListener('click',()=>{tradeOffset=Math.max(0,tradeOffset-20);safeLoad();});
document.getElementById('trades-next').addEventListener('click',()=>{if(hasMoreTrades){tradeOffset+=20;safeLoad();}});

function toast(text, ok) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = 'show ' + (ok ? 'ok' : 'err');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = ''; }, 10000);
}

async function safeLoad(){
 try { await load(); document.getElementById('data-status').hidden=true; }
 catch(error){const status=document.getElementById('data-status');status.textContent='資料更新失敗，畫面可能不是最新資料。請檢查網路並重新整理。';status.hidden=false;}
}

async function load() {
  const filters=new URLSearchParams({limit:'20',offset:String(tradeOffset),...appliedFilters});
  const [stocksRes, acc, tr, orders, ranking] = await Promise.all([
    fetch('/api/stocks').then(r => r.json()),
    fetch('/api/account').then(r => r.json()),
    fetch('/api/trades?'+filters).then(r => r.json()),
    fetch('/api/orders').then(r => r.json()),
    fetch('/api/leaderboard').then(r => r.json())
  ]);
  if(!stocksRes.ok || !acc.ok || !tr.ok || !orders.ok || !ranking.ok) throw new Error('refresh failed');
  document.getElementById('last-refresh').textContent='最後更新 '+new Date().toLocaleTimeString('zh-TW',{hour12:false})+' · 股價為最近成交價';

  const stocks = stocksRes.stocks ?? [];
  stockNames = Object.fromEntries(stocks.map(s => [s.symbol, s.nickname || s.name]));
  stockPrices = Object.fromEntries(stocks.map(s => [s.symbol, s.price]));
  stockReferences = Object.fromEntries(stocks.map(s => [s.symbol, s.ref_price]));
  availableCash=Number(orders.availableCash ?? 0);
  availableShares=Object.fromEntries(acc.holdings.map(h=>[h.symbol,Number(h.shares)-Number(h.frozen_shares||0)]));
  const select=document.getElementById('filter-symbol');
  if(select.options.length===1)for(const stock of stocks){const option=document.createElement('option');option.value=stock.symbol;option.textContent=stockNames[stock.symbol];select.append(option);}
  const ranks=document.getElementById('ranking');ranks.replaceChildren();
  (ranking.players||[]).forEach((p,i)=>{const row=document.createElement('tr');for(const value of [String(i+1),p.username,fmt(p.total_assets)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}ranks.append(row);});
  hasMoreTrades=!!tr.hasMore;
  document.getElementById('trades-page').textContent='第 '+(Math.floor(tradeOffset/20)+1)+' 頁';
  document.getElementById('trades-prev').disabled=tradeOffset===0;
  document.getElementById('trades-next').disabled=!hasMoreTrades;
  const statusNames = {OPEN:'等待成交',PARTIAL:'部分成交',FILLED:'已成交',CANCELLED:'已取消'};
  document.getElementById('orders').innerHTML = (orders.orders || []).map(o => '<tr><td>' + (stockNames[o.symbol] || o.symbol) + '</td><td>' + (o.side==='BUY'?'買進':'賣出') + '</td><td>' + (o.type==='LIMIT'?'限價':'市價') + '</td><td>' + (o.price == null?'市價':fmt(o.price)) + '</td><td>' + fmt(o.filled_shares) + ' / ' + fmt(o.shares) + '</td><td>' + (o.status==='CANCELLED'&&o.filled_shares>0?'部分成交後取消':statusNames[o.status] || o.status) + '</td><td>' + (o.type==='LIMIT' && ['OPEN','PARTIAL'].includes(o.status) ? '<button class="sell" onclick="cancel(' + Number(o.id) + ')">取消</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="7" class="empty">還沒有委託</td></tr>';
  document.getElementById('rows').innerHTML = stocks.map(s => \`
    <tr>
      <td><button onclick="showBook('\${s.symbol}')">\${stockNames[s.symbol]}</button></td>
      <td class="num">\${fmt(s.price)}</td>
      <td>
        <button class="buy" aria-label="\${stockNames[s.symbol]} 買進" onclick="act('\${s.symbol}','BUY')">買進</button>
        <button class="sell" aria-label="\${stockNames[s.symbol]} 賣出" onclick="act('\${s.symbol}','SELL')">賣出</button>
      </td>
    </tr>\`).join('');
  setTrading(trading);

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
          <td class="num">\${fmt(t.amount)}</td><td class="num">\${fmt(t.fee_amount || 0)}</td>
        </tr>\`).join('')
    : '<tr><td colspan="7" class="empty">還沒有交易</td></tr>';
}

function updateTradeSummary(){
  if(!tradeIntent)return;
  const {symbol,side}=tradeIntent,isLimit=document.getElementById('trade-type').value==='LIMIT';
  tradeIntent.isLimit=isLimit;
  document.getElementById('price-field').hidden=!isLimit;
  const priceInput=document.getElementById('trade-price');priceInput.required=isLimit;
  const qty=Number(document.getElementById('trade-shares').value),price=isLimit?Number(priceInput.value):Number(stockPrices[symbol]);
  const ref=Number(stockReferences[symbol]);
  const box=document.getElementById('trade-summary');box.replaceChildren();
  function row(label,value){const line=document.createElement('div');line.className='summary-row';const a=document.createElement('span'),b=document.createElement('strong');a.textContent=label;b.textContent=value;line.append(a,b);box.append(line);}
  row('最新成交價',fmt(stockPrices[symbol])+' 元');
  row(side==='BUY'?'可用現金':'可賣股數',side==='BUY'?fmt(availableCash)+' 元':fmt(availableShares[symbol]||0)+' 股');
  if(ref>0)row('漲跌停範圍',fmt(Math.ceil(Math.round(ref*100)*0.9)/100)+'～'+fmt(Math.floor(Math.round(ref*100)*1.1)/100));
  if(Number.isSafeInteger(qty)&&qty>0&&price>0){const gross=qty*price,fee=Math.ceil(Math.round(price*100)*qty*1425/1000000)/100;row('預估手續費',fmt(fee)+' 元');row(side==='BUY'?'預估支付':'預估收入',fmt(side==='BUY'?gross+fee:gross-fee)+' 元'); if(isLimit&&side==='BUY'){const unit=Math.round(price*100),reserve=(unit+Math.ceil(unit*1425/1000000))*qty/100;row('預計凍結',fmt(reserve)+' 元');}}
  const note=document.createElement('p');note.className='summary-note';note.textContent=isLimit?'以限價估算；實際成交及凍結費用依委託簿為準。':'以最新成交價估算，市價可能不同；未成交股數會取消。';box.append(note);
}
function act(symbol, side, isLimit = false) {
  if (trading) return;
  const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  tradeIntent = {symbol,side,isLimit,requestId};
  document.getElementById('trade-title').textContent = (stockNames[symbol] || symbol) + ' · ' + (isLimit?'限價':'市價') + (side==='BUY'?'買進':'賣出');
  document.getElementById('trade-shares').value = '';
  document.getElementById('trade-type').value=isLimit?'LIMIT':'MARKET';
  document.getElementById('trade-price').value = stockPrices[symbol] || '';
  document.getElementById('trade-price').required = isLimit;
  document.getElementById('price-field').hidden = !isLimit;
  document.getElementById('trade-error').textContent = '';
  document.getElementById('submit-trade').textContent=side==='BUY'?'確認買進':'確認賣出';
  document.getElementById('submit-trade').className=side==='BUY'?'buy':'sell';
  updateTradeSummary();
  showBook(symbol).catch(()=>{});
  document.getElementById('trade-dialog').showModal();
}
for(const id of ['trade-type','trade-shares','trade-price'])document.getElementById(id).addEventListener('input',updateTradeSummary);

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
  setTrading(true);
  document.getElementById('submit-trade').disabled=true;
  try {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol, side, type:isLimit?'LIMIT':'MARKET', price, shares, request_id:requestId })
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('trade-dialog').close();
    const outcome=data.filledShares===0?(isLimit?'委託已送出，等待成交 '+data.remaining+' 股':'未成交，沒有可成交的對手，委託已取消'):(data.remaining?(isLimit?'部分成交，剩餘 '+data.remaining+' 股等待中':'部分成交，剩餘 '+data.remaining+' 股已取消'):'全部成交');
    toast(outcome+'；成交 '+data.filledShares+' 股，金額 '+fmt(data.amount)+' 元，手續費 '+fmt(data.fee||0)+' 元',data.filledShares>0 || isLimit);
    try { await load(); await Promise.all([showBook(symbol),loadCharts()]); }
    catch (error) { toast('委託已送出，但畫面更新失敗，請重新整理',false); }
  } else {
    document.getElementById('trade-error').textContent = data.message || data.error || '交易失敗';
  }
  } catch (error) { document.getElementById('trade-error').textContent='連線失敗，請重新整理並檢查交易紀錄，避免重複下單'; }
  finally { setTrading(false); document.getElementById('submit-trade').disabled=false; }
});

let cancelId=null;
function cancel(id){cancelId=id;document.getElementById('cancel-dialog').showModal();}
document.getElementById('keep-order').addEventListener('click',()=>document.getElementById('cancel-dialog').close());
document.getElementById('confirm-cancel').addEventListener('click',()=>{document.getElementById('cancel-dialog').close();cancelOrder(cancelId);});
async function cancelOrder(id) {
  if (trading) return;
  setTrading(true);
  try {
    const result=await (await fetch('/api/orders/'+id,{method:'DELETE'})).json();
    toast(result.ok?'委託已取消':(result.message || '取消失敗'),result.ok);
    await load(); await showBook(selectedSymbol);
  } catch (error) { toast('連線失敗，請重新整理確認委託狀態',false); }
  finally { setTrading(false); }
}

async function showBook(symbol) {
  selectedSymbol=symbol;
  const r=await fetch('/api/orderbook?symbol='+encodeURIComponent(symbol));
  const data=await r.json();
  if(symbol!==selectedSymbol)return;
  if(!data.ok){toast(data.message || '無法取得委託簿',false);return;}
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
      if(points.length<2)card.classList.add('no-history');
      const title=document.createElement('h3'); title.textContent=stockNames[symbol] || symbol;
      const price=document.createElement('div');price.className='chart-price';price.textContent=fmt(stockPrices[symbol])+' 元';
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('role','img'); svg.setAttribute('aria-label',title.textContent+'最近六小時成交價格走勢');
      const note=document.createElement('div'); note.className='chart-note';
      const action=document.createElement('button');action.type='button';action.className='chart-action';action.textContent='買進';action.setAttribute('aria-label',title.textContent+' 行情買進');
      action.addEventListener('click',()=>{document.querySelector('[data-page="trade"]').click();act(symbol,'BUY');});
      card.append(title,price,svg,note,action); container.append(card);
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
  svg.innerHTML = '<polyline fill="none" stroke="#354b3b" stroke-width="3" points="' + coords + '" />';
  const clock=t=>new Date(t).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
  note.textContent = clock(times[0])+' 至 '+clock(times[times.length-1])+' · 最低 '+fmt(min)+'、最高 '+fmt(max)+'、最新 '+fmt(prices[prices.length-1])+' 元。只顯示真實成交（最多 500 筆）。';
}

refreshSession().catch(()=>{const el=document.getElementById(signedIn?'data-status':'auth-error');el.textContent='資料更新失敗，請檢查網路並重新整理';el.hidden=false;});
setInterval(()=>{if(signedIn&&!document.hidden&&!trading&&!document.querySelector('dialog[open]')&&!document.querySelector('#rows :focus')&&!document.querySelector('#orders :focus'))safeLoad().then(()=>Promise.all([showBook(selectedSymbol),loadCharts()])).catch(()=>{});},15000);
</script>
</body>
</html>`;
