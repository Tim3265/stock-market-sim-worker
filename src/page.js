// 電玩像素風前端：純原生 JS + SVG 走勢圖，資料來自 /api/*。
// 版面：登入畫面（暱稱即可開始）→ 六檔平等網格 + 大盤指數 → 個股十檔盤口下單。

export const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>股市模擬大戶 — PIXEL Trader</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0d0f1a; --panel:#171a2b; --panel2:#1f2338; --line:#2e3352;
    --txt:#e8ecff; --dim:#8a90b8; --green:#3ddc78; --red:#ff5470;
    --gold:#ffd23f; --blue:#4db2ff; --px:4px;
  }
  *{box-sizing:border-box; margin:0; padding:0;}
  html,body{height:100%;}
  body{
    background:var(--bg);
    background-image:
      linear-gradient(rgba(46,51,82,.25) 1px, transparent 1px),
      linear-gradient(90deg, rgba(46,51,82,.25) 1px, transparent 1px);
    background-size:32px 32px;
    color:var(--txt);
    font-family:'Press Start 2P', monospace;
    font-size:12px; line-height:1.7;
    image-rendering:pixelated;
  }
  .hidden{display:none !important;}
  button,input{font-family:inherit; font-size:12px;}
  button{
    background:var(--gold); color:#1a1a2e; border:0; padding:10px 14px; cursor:pointer;
    box-shadow:0 var(--px) 0 #b8860b; font-weight:bold;
  }
  button:active{transform:translateY(var(--px)); box-shadow:none;}
  button.ghost{background:var(--panel2); color:var(--txt); box-shadow:0 var(--px) 0 var(--line);}
  button.buy{background:var(--green); box-shadow:0 var(--px) 0 #1d7a44;}
  button.sell{background:var(--red); color:#fff; box-shadow:0 var(--px) 0 #8f2438;}
  input{
    background:#0a0c16; color:var(--txt); border:2px solid var(--line); padding:10px; width:100%;
  }
  input:focus{outline:none; border-color:var(--gold);}
  .panel{background:var(--panel); border:2px solid var(--line); box-shadow:6px 6px 0 rgba(0,0,0,.45);}

  /* ===== 登入畫面 ===== */
  #login-screen{
    min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:24px; text-align:center; padding:24px;
  }
  #login-screen h1{
    font-size:clamp(22px,5vw,44px); color:var(--gold);
    text-shadow:4px 4px 0 #b8860b, 8px 8px 0 rgba(0,0,0,.5);
  }
  #login-screen .sub{color:var(--dim); font-size:11px;}
  #login-box{width:min(420px,92vw); padding:24px; display:flex; flex-direction:column; gap:14px;}
  #login-box .hint{color:var(--dim); font-size:10px;}

  /* ===== 主畫面 ===== */
  header{
    display:flex; align-items:center; gap:16px; flex-wrap:wrap;
    padding:12px 16px; border-bottom:2px solid var(--line); background:var(--panel);
  }
  /* 分頁標籤 + 下單列固定在頂部 */
  .sticky-top{
    position:sticky; top:0; z-index:10;
    background:var(--bg);
    padding:10px 0; display:flex; flex-direction:column; gap:8px;
    border-bottom:2px solid var(--line);
  }
  header .logo{color:var(--gold); font-size:14px; text-shadow:2px 2px 0 #b8860b;}
  #index-chip{display:flex; align-items:center; gap:10px; padding:6px 12px; background:var(--panel2); border:2px solid var(--line);}
  #index-chip .up{color:var(--green);} #index-chip .down{color:var(--red);}
  header .spacer{flex:1;}
  #cash-chip{color:var(--green);}
  main{max-width:1200px; margin:0 auto; padding:16px; display:flex; flex-direction:column; gap:16px;}

  nav.tabs{display:flex; gap:8px; flex-wrap:wrap;}
  nav.tabs button{background:var(--panel2); color:var(--dim); box-shadow:0 var(--px) 0 var(--line);}
  nav.tabs button.active{background:var(--blue); color:#08131f; box-shadow:0 var(--px) 0 #1d5f8f;}

  /* 六檔平等網格 */
  #stock-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px;}
  .stock-card{padding:14px; cursor:pointer; transition:transform .08s;}
  .stock-card:hover{transform:translate(-2px,-2px); border-color:var(--gold);}
  .stock-card .sym{color:var(--blue); font-size:10px;}
  .stock-card .name{font-size:13px; margin:4px 0;}
  .stock-card .price{font-size:16px;}
  .stock-card .chg.up{color:var(--green);} .stock-card .chg.down{color:var(--red);}
  .stock-card svg{width:100%; height:48px; display:block; margin-top:8px;}

  /* 個股面板 */
  #stock-detail{padding:16px; display:flex; flex-direction:column; gap:14px;}
  #stock-detail h2{font-size:16px; color:var(--gold);}
  #detail-chart{width:100%; height:180px; background:#0a0c16; border:2px solid var(--line);}
  .book-wrap{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
  @media(max-width:720px){
    .book-wrap{grid-template-columns:1fr;}
    input{font-size:16px;} /* iOS 聚焦時會自動放大，字級小於 16px 會造成畫面跳動 */
    button{touch-action:manipulation;} /* 手機點擊不延遲 */
  }
  .book-col h3{font-size:11px; margin-bottom:8px; color:var(--dim);}
  .book-row{display:flex; justify-content:space-between; padding:3px 6px; font-size:10px;}
  .book-row .bid{color:var(--green);} .book-row .ask{color:var(--red);}
  .book-row .bar{height:6px; margin-top:2px;}
  .bar.bid{background:rgba(61,220,120,.35);} .bar.ask{background:rgba(255,84,112,.35);}

  #order-form{display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:10px;}
  #order-form input{width:110px;}
  #order-msg{font-size:10px; min-height:18px;}
  #order-msg.ok{color:var(--green);} #order-msg.err{color:var(--red);}

  table{width:100%; border-collapse:collapse; font-size:10px;}
  th,td{padding:6px 8px; text-align:right; border-bottom:1px solid var(--line);}
  th:first-child,td:first-child{text-align:left;}
  th{color:var(--dim);}
  .up{color:var(--green);} .down{color:var(--red);}
  .section-title{font-size:13px; color:var(--gold); margin-bottom:10px;}
  .row-actions button{padding:4px 8px; font-size:10px;}
  #broker-note{color:var(--dim); font-size:10px;}
  footer{color:var(--dim); font-size:9px; text-align:center; padding:18px;}
</style>
</head>
<body>

<!-- 登入 -->
<div id="login-screen">
  <h1>股市模擬大戶</h1>
  <div class="sub">PIXEL STOCK TRADER · 六檔虛擬市場 · 大樹證券 2.8 折</div>
  <div id="login-box" class="panel">
    <input id="nickname" maxlength="12" placeholder="輸入暱稱（可留空）">
    <button id="btn-play" style="font-size:14px; padding:14px;">▶ 開始交易</button>
    <div class="hint">訪客模式：暱稱即可開戶，初始資金依市場總市值計算</div>
  </div>
</div>

<!-- 主畫面 -->
<div id="app" class="hidden">
  <header>
    <span class="logo">▚▞ 股市模擬大戶</span>
    <span id="index-chip">大盤指數 <b id="index-val">----</b> <span id="index-chg"></span></span>
    <span id="cash-chip">現金 $<span id="cash-val">-</span></span>
    <span class="spacer"></span>
    <span id="user-chip" style="color:var(--dim)"></span>
    <button class="ghost" id="btn-recharge">重設資金</button>
    <button class="ghost" id="btn-logout">登出</button>
  </header>
  <main>
    <div class="sticky-top">
      <nav class="tabs">
        <button data-tab="market" class="active">市場</button>
        <button data-tab="portfolio">持股資產</button>
        <button data-tab="orders">我的委託</button>
        <button data-tab="fills">市場成交</button>
        <button data-tab="leaderboard">排行榜</button>
        <button data-tab="bots">機器人</button>
      </nav>
      <div id="order-form" class="panel">
        <span id="ord-sym" style="color:var(--blue); font-size:10px;"></span>
        <input id="ord-shares" type="number" min="1" placeholder="股數" inputmode="numeric">
        <input id="ord-price" type="number" step="0.01" placeholder="限價（市價留空）" inputmode="decimal">
        <button class="buy" id="btn-buy">買進</button>
        <button class="sell" id="btn-sell">賣出</button>
        <span id="order-msg"></span>
      </div>
    </div>

    <section id="tab-market">
      <div id="stock-grid"></div>
      <div id="stock-detail" class="panel hidden">
        <h2 id="detail-title"></h2>
        <svg id="detail-chart" viewBox="0 0 600 180" preserveAspectRatio="none"></svg>
        <div class="book-wrap">
          <div class="book-col panel" style="padding:10px"><h3>賣出（十檔）</h3><div id="asks-rows"></div></div>
          <div class="book-col panel" style="padding:10px"><h3>買入（十檔）</h3><div id="bids-rows"></div></div>
        </div>
      </div>
    </section>

    <section id="tab-portfolio" class="hidden">
      <div class="panel" style="padding:16px">
        <div class="section-title">資產總覽</div>
        <div id="portfolio-summary" style="display:flex; gap:24px; flex-wrap:wrap; margin-bottom:14px;"></div>
        <table id="holdings-table"><thead><tr><th>股票</th><th>持有股數</th><th>現價</th><th>市值</th><th>凍結</th></tr></thead><tbody></tbody></table>
        <div class="section-title" style="margin-top:18px">交易紀錄 <a id="csv-link" href="/api/trades/export" style="color:var(--blue); font-size:10px">下載 CSV</a></div>
        <table id="trades-table"><thead><tr><th>時間</th><th>股票</th><th>買賣</th><th>股數</th><th>價格</th><th>金額</th><th>手續費</th></tr></thead><tbody></tbody></table>
      </div>
    </section>

    <section id="tab-orders" class="hidden">
      <div class="panel" style="padding:16px">
        <div class="section-title">進行中委託（限價單掛簿時會凍結資金/股票，成交或取消即解凍）</div>
        <table id="orders-table"><thead><tr><th>股票</th><th>買賣</th><th>類型</th><th>價格</th><th>股數</th><th>已成交</th><th>狀態</th><th></th></tr></thead><tbody></tbody></table>
      </div>
    </section>

    <section id="tab-fills" class="hidden">
      <div class="panel" style="padding:16px">
        <div class="section-title">最新市場成交</div>
        <table id="fills-table"><thead><tr><th>時間</th><th>股票</th><th>股數</th><th>價格</th><th>買方</th><th>賣方</th></tr></thead><tbody></tbody></table>
      </div>
    </section>

    <section id="tab-leaderboard" class="hidden">
      <div class="panel" style="padding:16px">
        <div class="section-title">大戶排行榜（總資產）</div>
        <table id="lb-table"><thead><tr><th>#</th><th>玩家</th><th>總資產</th></tr></thead><tbody></tbody></table>
      </div>
    </section>

    <section id="tab-bots" class="hidden">
      <div class="panel" style="padding:16px">
        <div class="section-title">機器人動向（造市商提供流動性，其餘製造趨勢與波動）</div>
        <div id="bots-wrap"></div>
      </div>
    </section>

    <div id="broker-note" class="panel" style="padding:10px 14px">手續費：大樹證券 0.1425% 打 2.8 折 = 0.0399%（向上取到 0.01）｜漲跌停 ±10%｜市價單吃不到剩餘即取消</div>
  </main>
  <footer>股市模擬大戶 · Cloudflare Workers + D1 · 有人瀏覽時市場每 15 秒推進一輪</footer>
</div>

<script>
const $=s=>document.querySelector(s);
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const pct=(a,b)=>b?((a-b)/b*100):0;
let state=null, selected='2330', tab='market', timer=null;

function sparkline(points,w,h,color){
  if(!points||points.length<2)return '';
  const vals=points.map(p=>Number(p.price));
  const min=Math.min(...vals),max=Math.max(...vals),span=(max-min)||1;
  const step=w/(vals.length-1);
  const pts=vals.map((v,i)=>((i*step).toFixed(1))+','+((h-4-((v-min)/span)*(h-8))).toFixed(1)).join(' ');
  return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="2"/></svg>';
}

async function api(path,opts){
  const r=await fetch(path,opts);
  if(path==='/api/trades/export')return r;
  return r.json();
}

async function login(){
  const nickname=$('#nickname').value.trim();
  const r=await api('/api/auth/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname})});
  if(r.ok){$('#login-screen').classList.add('hidden');$('#app').classList.remove('hidden');start();}
}

$('#btn-play').onclick=login;

async function poll(){
  state=await api('/api/live?symbol='+selected);
  render();
}

function start(){
  $('#nickname').addEventListener('keydown',e=>{if(e.key==='Enter')login();});
  $('#btn-logout').onclick=async()=>{await api('/api/auth/logout',{method:'POST'});location.reload();};
  $('#btn-recharge').onclick=async()=>{await api('/api/account/recharge',{method:'POST'});poll();};
  $('#btn-buy').onclick=()=>place('BUY');
  $('#btn-sell').onclick=()=>place('SELL');
  document.querySelectorAll('nav.tabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;
    document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.toggle('active',x===b));
    ['market','portfolio','orders','fills','leaderboard','bots'].forEach(t=>$('#tab-'+t).classList.toggle('hidden',t!==tab));
    render();
  });
  poll();
  timer=setInterval(()=>{if(!document.hidden)poll();},5000);
}

function render(){
  if(!state)return;
  $('#user-chip').textContent=state.username||'';
  $('#cash-val').textContent=fmt(state.account?state.account.cash:0);
  if(state.index!=null){
    $('#index-val').textContent=fmt(state.index);
    const h=state.histories&&state.histories.IDX;
    const chgEl=$('#index-chg');
    if(h&&h.length>1){
      const c=pct(state.index,h[0].price);
      chgEl.textContent=(c>=0?'+':'')+c.toFixed(2)+'%';
      chgEl.className=c>=0?'up':'down';
    }
  }
  renderMarket();renderPortfolio();renderOrders();renderFills();
  if(tab==='leaderboard')renderLeaderboard();
  if(tab==='bots')renderBots();
}

function renderMarket(){
  const grid=$('#stock-grid');
  grid.innerHTML=state.stocks.map(s=>{
    const hist=state.histories[s.symbol]||[];
    const chg=pct(s.price,s.ref_price);
    const cls=chg>=0?'up':'down';
    const color=chg>=0?'var(--green)':'var(--red)';
    return '<div class="stock-card panel" data-sym="'+s.symbol+'">'
      +'<div class="sym">'+s.symbol+'</div>'
      +'<div class="name">'+s.name+(s.nickname?' · '+s.nickname:'')+'</div>'
      +'<div class="price">$'+fmt(s.price)+'</div>'
      +'<div class="chg '+cls+'">'+(chg>=0?'+':'')+chg.toFixed(2)+'%</div>'
      +sparkline(hist,200,48,color)
      +'</div>';
  }).join('');
  grid.querySelectorAll('.stock-card').forEach(c=>c.onclick=()=>{selected=c.dataset.sym;poll();});
  renderDetail();
}

function renderDetail(){
  const s=state.stocks.find(x=>x.symbol===selected);
  const d=$('#stock-detail');
  if(!s){d.classList.add('hidden');return;}
  d.classList.remove('hidden');
  const hist=state.histories[selected]||[];
  const chg=pct(s.price,s.ref_price);
  const color=chg>=0?'var(--green)':'var(--red)';
  // 只更新標題、走勢圖與盤口；下單表單維持不動，避免輪詢時搶走輸入框焦點
  $('#detail-title').innerHTML=s.name+' '+s.symbol+' $'+fmt(s.price)+' <span class="'+(chg>=0?'up':'down')+'">'+(chg>=0?'+':'')+chg.toFixed(2)+'%</span>';
  $('#ord-sym').textContent='下單：'+s.symbol+' '+s.name;
  $('#detail-chart').innerHTML=hist.length>1?(()=>{const vals=hist.map(p=>Number(p.price));const min=Math.min(...vals),max=Math.max(...vals),span=(max-min)||1;
    const pts=vals.map((v,i)=>(i*(600/(vals.length-1))).toFixed(1)+','+(170-((v-min)/span)*160).toFixed(1)).join(' ');
    return '<polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="3"/>';})():'<polyline points="" fill="none"/>';
  const maxQ=Math.max(1,...[...state.bids,...state.asks].map(b=>b.quantity));
  const row=(b,side)=>'<div class="book-row"><span class="'+side+'">$'+fmt(b.price)+'</span><span>'+b.quantity+'</span></div>'
    +'<div class="bar '+side+'" style="width:'+Math.round(b.quantity/maxQ*100)+'%"></div>';
  $('#asks-rows').innerHTML=state.asks.slice().reverse().map(b=>row(b,'ask')).join('');
  $('#bids-rows').innerHTML=state.bids.map(b=>row(b,'bid')).join('');
}

async function place(side){
  const shares=Math.floor(Number($('#ord-shares').value));
  const price=$('#ord-price').value?Number($('#ord-price').value):null;
  const msg=$('#order-msg');
  if(!Number.isInteger(shares)||shares<1){msg.className='err';msg.textContent='請輸入股數';return;}
  const body={symbol:selected,side,shares,request_id:'web-'+Date.now()+'-'+Math.random().toString(16).slice(2,10)};
  if(price){body.type='LIMIT';body.price=price;}
  const r=await api('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(r.ok){
    msg.className='ok';
    msg.textContent=r.status==='CANCELLED'?('成交 '+r.filledShares+' 股，剩餘 '+r.remaining+' 股無對手已取消 (IOC)'):('成交 '+r.filledShares+' 股 @ $'+fmt(r.avgPrice)+'，手續費 $'+fmt(r.fee));
    poll();
  }else{msg.className='err';msg.textContent=r.message||'下單失敗';}
}

function renderPortfolio(){
  const a=state.account;
  $('#portfolio-summary').innerHTML=a?[
    ['可用現金','$'+fmt(a.available_cash!=null?a.available_cash:a.cash)],
    ['凍結現金','$'+fmt(a.frozen_cash||0)],
    ['持股市值','$'+fmt((a.cash||0)+ (state.holdings||[]).reduce((s,h)=>s+h.market_value,0) - (a.cash||0))],
    ['總資產','$'+fmt((a.cash||0)+(state.holdings||[]).reduce((s,h)=>s+h.market_value,0))]
  ].map(p=>'<div><div style="color:var(--dim); font-size:10px">'+p[0]+'</div><div style="color:var(--green)">'+p[1]+'</div></div>').join(''):'請先登入';
  const hb=$('#holdings-table tbody');
  hb.innerHTML=(state.holdings||[]).map(h=>'<tr><td>'+h.symbol+' '+h.name+'</td><td>'+h.shares+'</td><td>$'+fmt(h.price)+'</td><td>$'+fmt(h.market_value)+'</td><td>'+(h.frozen_shares||0)+'</td></tr>').join('')||'<tr><td colspan="5" style="color:var(--dim)">無持股</td></tr>';
  const tb=$('#trades-table tbody');
  tb.innerHTML=(state.trades||[]).map(t=>'<tr><td>'+t.created_at+'</td><td>'+t.symbol+'</td><td class="'+(t.side==='BUY'?'up':'down')+'">'+(t.side==='BUY'?'買':'賣')+'</td><td>'+t.shares+'</td><td>$'+fmt(t.price)+'</td><td>$'+fmt(t.amount)+'</td><td>$'+fmt(t.fee_amount||0)+'</td></tr>').join('')||'<tr><td colspan="7" style="color:var(--dim)">無交易紀錄</td></tr>';
}

function renderOrders(){
  const ob=$('#orders-table tbody');
  const open=(state.orders||[]).filter(o=>o.status==='OPEN'||o.status==='PARTIAL');
  ob.innerHTML=open.map(o=>'<tr><td>'+o.symbol+'</td><td class="'+(o.side==='BUY'?'up':'down')+'">'+(o.side==='BUY'?'買':'賣')+'</td><td>'+o.type+'</td><td>'+(o.price?('$'+fmt(o.price)):'市價')+'</td><td>'+o.shares+'</td><td>'+o.filled_shares+'</td><td>'+o.status+'</td><td class="row-actions"><button class="ghost" data-cancel="'+o.id+'">取消</button></td></tr>').join('')||'<tr><td colspan="8" style="color:var(--dim)">無進行中委託</td></tr>';
  ob.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{await api('/api/orders/'+b.dataset.cancel,{method:'DELETE'});poll();});
}

function renderFills(){
  const fb=$('#fills-table tbody');
  fb.innerHTML=(state.fills||[]).slice(0,30).map(f=>'<tr><td>'+f.created_at+'</td><td>'+f.symbol+'</td><td>'+f.shares+'</td><td>$'+fmt(f.price)+'</td><td>'+f.buyer_name+(f.buyer_is_bot?' 🤖':'')+'</td><td>'+f.seller_name+(f.seller_is_bot?' 🤖':'')+'</td></tr>').join('')||'<tr><td colspan="6" style="color:var(--dim)">無成交</td></tr>';
}

async function renderLeaderboard(){
  const r=await api('/api/leaderboard');
  $('#lb-table tbody').innerHTML=(r.players||[]).map((p,i)=>'<tr><td>'+(i+1)+'</td><td>'+p.username+'</td><td>$'+fmt(p.total_assets)+'</td></tr>').join('');
}

async function renderBots(){
  const r=await api('/api/bots');
  $('#bots-wrap').innerHTML=(r.bots||[]).map(b=>{
    const hs=(r.holdings||[]).filter(h=>h.account_id===b.id);
    return '<div class="panel" style="padding:12px; margin-bottom:10px"><b style="color:var(--blue)">'+b.name+'</b> ('+b.bot_kind+') 現金 $'+fmt(b.cash)
      +'<div style="color:var(--dim); font-size:10px; margin-top:6px">'
      +(hs.map(h=>h.symbol+' '+h.shares+' 股').join('｜')||'無持股')+'</div></div>';
  }).join('');
}

// 瀏覽器記得登入狀態（session cookie 有效）時，重新整理直接進入同一帳號
api('/api/auth/session').then(r=>{if(r.ok){$('#login-screen').classList.add('hidden');$('#app').classList.remove('hidden');start();}});
</script>
</body>
</html>`;
