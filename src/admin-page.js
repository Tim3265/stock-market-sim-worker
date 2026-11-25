// 管理後台頁面：只放玩家、紀錄與系統狀態；市場價格與最近成交在遊戲首頁就看得到，不重複放。
// 注意：整段是 template literal，內嵌腳本不能使用反引號或 ${}。
export const ADMIN_HTML = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>管理後台</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;background:#10141e;color:#edf1f7;--dim:#a9b5c8;--line:#344156;--panel:#1b2331;--up:#ff7a7a;--down:#5fd39a;--warn:#ffcf70}
*{box-sizing:border-box}body{margin:0;background:#10141e}main{max-width:960px;margin:auto;padding:20px 16px 48px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}h1{font-size:22px;margin:0}h2{font-size:17px;margin:0}
a{color:#a9c9ff}.links{display:flex;gap:8px;align-items:center}
button,input,select{font:inherit;border-radius:8px;padding:10px 12px;min-height:44px}button{background:#83aaf1;color:#10141e;border:0;font-weight:700;cursor:pointer}button.ghost{background:transparent;color:#edf1f7;border:1px solid var(--line)}
input,select{background:#10141e;border:1px solid #536078;color:white;max-width:100%}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
.heading{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}.hint{color:var(--dim);font-size:12px;line-height:1.6}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:8px}.tile{background:#141b27;border:1px solid var(--line);border-radius:10px;padding:10px 12px}.tile small{display:block;color:var(--dim);font-size:12px}.tile b{display:block;font-size:18px;margin-top:4px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.tile .sub{font-size:12px;color:var(--dim);margin-top:2px}
.ok{color:var(--down)}.bad{color:var(--warn)}.up{color:var(--up)}.down{color:var(--down)}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.tools input{flex:1 1 180px}
.row{padding:12px 0;border-bottom:1px solid var(--line);display:flex;gap:12px;justify-content:space-between;align-items:flex-start}.row:last-child{border:0;padding-bottom:0}
.row.click{cursor:pointer}.row.click:hover{background:#202a3b}.row strong{display:block;font-size:15px}.row small{display:block;color:var(--dim);font-size:12px;margin-top:5px;line-height:1.5;overflow-wrap:anywhere}
.value{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.tag{display:inline-block;font-size:11px;font-weight:400;border:1px solid var(--line);border-radius:6px;padding:0 6px;margin-left:6px;color:var(--dim);vertical-align:middle}
.meter-row{margin:12px 0}.meter-top{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:14px;margin-bottom:6px}.meter-top b{font-variant-numeric:tabular-nums}
.meter{height:12px;background:#141b27;border:1px solid var(--line);border-radius:6px;overflow:hidden}.meter i{display:block;height:100%;background:var(--down)}.meter i.warn{background:var(--warn)}.meter i.bad{background:var(--up)}
.meter-row small{display:block;color:var(--dim);font-size:12px;margin-top:5px}.warn{color:var(--warn)}
.alert{background:#3a1f24;border:1px solid var(--up);color:#ffd0d0;border-radius:10px;padding:10px 12px;font-size:14px;line-height:1.6;margin:8px 0}
.spark{display:flex;align-items:flex-end;gap:2px;height:56px;margin-top:6px;border-bottom:1px solid var(--line)}.spark i{flex:1;background:#83aaf1;min-height:1px;border-radius:2px 2px 0 0}
.empty{color:var(--dim);font-size:14px;margin:10px 0 0}.error{color:#ffaaaa}#message{color:var(--dim);font-size:14px}
</style></head><body><main>
<header><div><h1>管理後台</h1><div class="hint">玩家、歷史紀錄與系統狀態</div></div><div class="links"><button class="ghost" id="refresh" type="button">重新整理</button><a href="/">返回遊戲</a></div></header>
<p id="message" role="status">正在載入…</p><div id="content"></div></main>
<script>
var message=document.querySelector('#message'),root=document.querySelector('#content');
var overviewData=null,query='',sortBy='login';
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function money(n){return '$'+Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2})}
function parseUtc(s){if(!s)return null;var d=new Date(String(s).replace(' ','T')+'Z');return Number.isNaN(d.getTime())?null:d}
function time(s){var d=parseUtc(s);return d?d.toLocaleString('zh-TW',{hour12:false}):'—'}
function ago(ms){if(!ms)return '從未';var sec=Math.max(0,Math.round((Date.now()-ms)/1000));if(sec<60)return sec+' 秒前';if(sec<3600)return Math.round(sec/60)+' 分鐘前';if(sec<86400)return Math.round(sec/3600)+' 小時前';return Math.round(sec/86400)+' 天前'}
function agoStr(s){var d=parseUtc(s);return d?ago(d.getTime()):'從未'}
function bytes(n){if(n==null)return '無法取得';return n<1048576?(n/1024).toFixed(0)+' KB':(n/1048576).toFixed(1)+' MB'}
function panel(title,hint){var box=el('section','panel'),h=el('div','heading');h.append(el('h2',null,title));if(hint)h.append(el('span','hint',hint));box.append(h);root.append(box);return box}
function tile(parent,label,value,sub,cls){var t=el('div','tile');t.append(el('small',null,label));var b=el('b',cls||null,value);t.append(b);if(sub)t.append(el('div','sub',sub));parent.append(t)}
function row(parent,name,detail,value,sub,opts){opts=opts||{};var r=el('div','row'+(opts.onclick?' click':'')),left=el('div'),right=el('div','value'),s=el('strong',null,name);if(opts.tag)s.append(el('span','tag',opts.tag));left.append(s,el('small',null,detail||''));right.append(el('strong',opts.valueClass||null,value||''),el('small',null,sub||''));r.append(left,right);if(opts.onclick){r.tabIndex=0;r.onclick=opts.onclick;r.onkeydown=function(e){if(e.key==='Enter')opts.onclick()}}parent.append(r);return r}
function empty(parent,text){parent.append(el('p','empty',text||'目前沒有資料'))}
function total(p){return Number(p.cash||0)+Number(p.stock_value||0)}
function ret(p){var init=Number(p.initial_cash||0);return init>0?(total(p)-init)/init*100:0}
function pctText(v){var t=Math.abs(v).toFixed(2);return (Number(t)===0?'':v>0?'+':'-')+t+'%'}
function trendClass(v){return Math.abs(v)<0.005?null:v>0?'up':'down'}
function methodName(m){return m==='guest'?'名字登入':m==='password'?'密碼登入':m}
async function api(path,init){var r=await fetch(path,Object.assign({cache:'no-store'},init||{}));var d=await r.json().catch(function(){return null});if(!r.ok)throw Error((d&&d.message)||'載入失敗（'+r.status+'）');return d}

var usageTimer=null;
function fmtN(n){return Number(n||0).toLocaleString('zh-TW')}
function dur(min){return min>=1440?'超過一天':min>=60?Math.floor(min/60)+' 小時 '+(min%60)+' 分鐘':min+' 分鐘'}
function level(pct){return pct>=90?'bad':pct>=70?'warn':''}
function meterRow(parent,label,used,limit,rate,left){
 var pct=limit?used/limit*100:0,w=el('div','meter-row'),top=el('div','meter-top'),bar=el('div','meter'),fill=el('i',level(pct));
 top.append(el('span',null,label),el('b',level(pct)||null,fmtN(used)+' / '+fmtN(limit)+' 列（'+pct.toFixed(1)+'%）'));
 fill.style.width=Math.min(100,pct).toFixed(1)+'%';bar.append(fill);
 w.append(top,bar,el('small',null,'最近 5 分鐘平均每分鐘 '+fmtN(rate)+' 列'+(left==null?'':' · 照這個速度約 '+dur(left)+'後用完')));parent.append(w);
}
function renderUsage(){
 var box=panel('今日資料庫免費額度','每 30 秒自動更新'),body=el('div');box.append(body);
 async function load(){
  var u;try{u=await api('/api/admin/usage')}catch(e){body.replaceChildren(el('p','error',e.message));return}
  body.replaceChildren();
  var readPct=u.used.rowsRead/u.limits.rowsRead*100,writePct=u.used.rowsWritten/u.limits.rowsWritten*100;
  var lefts=[u.minutesLeft.rowsRead,u.minutesLeft.rowsWritten].filter(function(x){return x!=null}),soon=lefts.length?Math.min.apply(null,lefts):null;
  if(readPct>=100||writePct>=100)body.append(el('p','alert','今天的免費額度已用完，網站會停到台灣時間 '+new Date(u.resetAt).toLocaleString('zh-TW',{hour12:false})+' 才恢復。'));
  else if(readPct>=70||writePct>=70||(soon!=null&&soon<30))body.append(el('p','alert','注意：額度快用完了'+(soon!=null?'，照目前速度約 '+dur(soon)+'後用完':'')+'。用完後網站會停到台灣時間早上 8 點。'));
  meterRow(body,'讀取',u.used.rowsRead,u.limits.rowsRead,u.perMinute.rowsRead,u.minutesLeft.rowsRead);
  meterRow(body,'寫入',u.used.rowsWritten,u.limits.rowsWritten,u.perMinute.rowsWritten,u.minutesLeft.rowsWritten);
  var g=el('div','tiles');body.append(g);
  tile(g,'每分鐘請求',fmtN(u.perMinute.requests)+' 次','最近 5 分鐘平均');
  tile(g,'今天累計請求',fmtN(u.used.requests)+' 次');
  tile(g,'額度歸零時間',new Date(u.resetAt).toLocaleTimeString('zh-TW',{hour12:false,hour:'2-digit',minute:'2-digit'}),'台灣時間（每天一次）');
  var recent=u.recent||[],max=Math.max.apply(null,[1].concat(recent.map(function(r){return r.requests}))),spark=el('div','spark'),byMinute={};
  recent.forEach(function(r){byMinute[r.minute]=r});
  var now=Math.floor(Date.now()/60000);
  for(var m=now-29;m<=now;m++){var r=byMinute[m],b=el('i');b.style.height=(r?Math.max(2,r.requests/max*100):0)+'%';b.title=new Date(m*60000).toLocaleTimeString('zh-TW',{hour12:false,hour:'2-digit',minute:'2-digit'})+'　請求 '+(r?r.requests:0)+'　讀取 '+(r?fmtN(r.rows_read):0)+' 列　寫入 '+(r?fmtN(r.rows_written):0)+' 列';spark.append(b)}
  body.append(el('small','hint','最近 30 分鐘每分鐘請求數（滑鼠移到長條上可看讀寫列數）'),spark);
  var o=u.official;
  body.append(el('p','hint',o&&o.ok?'Cloudflare 官方統計（整個帳號所有資料庫，約晚幾分鐘）：讀取 '+fmtN(o.rowsRead)+' 列、寫入 '+fmtN(o.rowsWritten)+' 列。':o?'Cloudflare 官方統計讀取失敗：'+o.message:'以上是本站自己記錄的數字，可能比 Cloudflare 官方統計略低一些；免費額度是整個 Cloudflare 帳號共用的。'));
 }
 clearInterval(usageTimer);usageTimer=setInterval(function(){if(!document.hidden&&box.isConnected)load()},30000);
 load();
}
function renderStatus(s){
 var box=panel('系統狀態','開啟後台的時間：'+new Date().toLocaleTimeString('zh-TW',{hour12:false})),g=el('div','tiles');box.append(g);
 tile(g,'資料庫',s.database_ok?'正常連線':'連線異常',null,s.database_ok?'ok':'bad');
 var stale=s.last_tick_at&&Date.now()-s.last_tick_at>3600000;
 tile(g,'市場最後推進',ago(s.last_tick_at),s.last_tick_at?new Date(s.last_tick_at).toLocaleString('zh-TW',{hour12:false}):null,stale?'bad':null);
 tile(g,'最後一筆成交',agoStr(s.last_fill_at),time(s.last_fill_at));
 tile(g,'今日成交',(s.fills_today||0)+' 筆','台北時間 0 點起');
 tile(g,'今日登入玩家',(s.active_today||0)+' 人','共 '+(s.players||0)+' 個玩家帳戶');
 tile(g,'24 小時登入失敗',(s.failed_logins_24h||0)+' 次',null,s.failed_logins_24h>20?'bad':null);
 tile(g,'玩家未成交委託',(s.open_player_orders||0)+' 筆');
 tile(g,'價格歷史',(s.price_points||0)+' 筆',s.history_since?'自 '+time(s.history_since):'尚無紀錄');
 tile(g,'資料庫大小',bytes(s.database_bytes),'Cloudflare D1 免費額度 5 GB');
 box.append(el('p','hint','市場只在有人打開遊戲網頁時推進，沒人瀏覽時價格會停住；這是為了節省 Cloudflare 額度，不是當機。網站錯誤紀錄需要到 Cloudflare 後台查看。'));
}
function renderPlayers(players){
 var box=panel('玩家','共 '+players.length+' 人，點選可看完整紀錄'),tools=el('div','tools'),search=el('input'),sort=el('select'),list=el('div');
 search.placeholder='搜尋玩家名字';search.value=query;search.setAttribute('aria-label','搜尋玩家名字');
 [['login','依最近登入'],['assets','依總資產'],['return','依報酬率'],['trades','依交易次數']].forEach(function(o){var op=el('option',null,o[1]);op.value=o[0];sort.append(op)});sort.value=sortBy;sort.setAttribute('aria-label','排序');
 tools.append(search,sort);box.append(tools,list);
 function draw(){list.replaceChildren();var q=query.trim().toLowerCase(),rows=players.filter(function(p){return !q||String(p.name).toLowerCase().indexOf(q)>=0});
  var key={login:function(p){return p.last_login_at||''},assets:total,'return':ret,trades:function(p){return Number(p.trade_count||0)}}[sortBy];
  rows.sort(function(a,b){var x=key(a),y=key(b);return x<y?1:x>y?-1:0});
  if(!rows.length)return empty(list,q?'找不到符合的玩家':'目前沒有玩家');
  rows.forEach(function(p){var r=ret(p);row(list,p.name,'最近登入 '+agoStr(p.last_login_at)+' · 交易 '+(p.trade_count||0)+' 次'+(p.open_orders?' · 委託中 '+p.open_orders+' 筆':''),money(total(p)),pctText(r)+' · 現金 '+money(p.cash),{tag:[p.is_guest?'訪客':'',p.hidden?'排行榜已隱藏':''].filter(Boolean).join(' · ')||null,onclick:function(){location.hash='player='+p.id}})})}
 search.oninput=function(){query=search.value;draw()};sort.onchange=function(){sortBy=sort.value;draw()};draw();
}
function renderLogins(logins,title,hint){
 var box=panel(title||'登入紀錄',hint||'最近 100 筆（從啟用記錄後開始）');
 if(!logins.length)return empty(box,'尚無登入紀錄');
 logins.forEach(function(l){row(box,l.username||'未知帳戶',time(l.created_at)+' · '+methodName(l.method),l.success?'成功':'失敗','IP '+(l.ip_address||'未提供'),{valueClass:l.success?'ok':'bad',onclick:l.account_id&&!title?function(){location.hash='player='+l.account_id}:null})});
}
async function showOverview(){
 message.textContent='正在載入…';message.className='';
 try{overviewData=await api('/api/admin/overview');root.replaceChildren();renderUsage();renderStatus(overviewData.status);renderPlayers(overviewData.players);renderLogins(overviewData.logins);message.textContent=''}
 catch(e){message.className='error';message.textContent=e.message}
}
async function showPlayer(id){
 message.textContent='正在載入玩家資料…';message.className='';
 try{var d=await api('/api/admin/player?id='+encodeURIComponent(id)),p=d.player;root.replaceChildren();message.textContent='';
  var back=el('button','ghost','← 返回玩家列表');back.type='button';back.onclick=function(){location.hash=''};root.append(back);
  var box=panel(p.name+(p.is_guest?'（訪客）':''),'帳戶 #'+p.id+' · 建立於 '+time(p.created_at)),g=el('div','tiles');box.append(g);var r=ret(p);
  var hide=el('button','ghost',p.hidden?'在排行榜顯示這位玩家':'從排行榜隱藏這位玩家');hide.type='button';
  hide.onclick=async function(){hide.disabled=true;try{await api('/api/admin/player/hidden',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:p.id,hidden:!p.hidden})});showPlayer(p.id)}catch(e){hide.disabled=false;message.className='error';message.textContent=e.message}};
  box.append(el('p','hint',p.hidden?'這位玩家目前不會出現在排行榜（資料與交易紀錄都還在）。':'測試帳號或不當暱稱可以從排行榜隱藏，不會刪除任何資料。'),hide);
  tile(g,'總資產',money(total(p)),'本金 '+money(p.initial_cash));tile(g,'報酬率',pctText(r),null,trendClass(r));tile(g,'現金',money(p.cash));tile(g,'持股市值',money(p.stock_value));tile(g,'交易次數',(p.trade_count||0)+' 次','最後 '+agoStr(p.last_trade_at));tile(g,'最近登入',agoStr(p.last_login_at),time(p.last_login_at));
  var hb=panel('目前持股',d.holdings.length+' 檔');if(!d.holdings.length)empty(hb,'沒有持股');d.holdings.forEach(function(h){row(hb,h.name,h.symbol+' · '+h.shares+' 股 · 現價 '+money(h.price),money(h.shares*h.price),'市值')});
  var tb=panel('交易紀錄','最近 200 筆');if(!d.trades.length)empty(tb,'還沒有交易');d.trades.forEach(function(t){var buy=t.side==='BUY';row(tb,(buy?'買進 ':'賣出 ')+t.name+' '+t.shares+' 股',time(t.created_at)+' · 每股 '+money(t.price)+(Number(t.fee_amount)?' · 手續費 '+money(t.fee_amount):''),(buy?'-':'+')+money(Math.abs(t.amount)),buy?'支出':'收入')});
  var ob=panel('委託紀錄','最近 100 筆'),st={OPEN:'等待成交',PARTIAL:'部分成交',FILLED:'已成交',CANCELLED:'已取消'};if(!d.orders.length)empty(ob,'沒有委託');d.orders.forEach(function(o){row(ob,(o.side==='BUY'?'買進 ':'賣出 ')+o.name,time(o.created_at)+' · '+(o.type==='MARKET'?'市價':'限價 '+money(o.price)),o.filled_shares+'/'+o.shares+' 股',st[o.status]||o.status)});
  renderLogins(d.logins,'這位玩家的登入紀錄','最近 100 筆');
 }catch(e){message.className='error';message.textContent=e.message}
}
function route(){clearInterval(usageTimer);var m=/^#player=(\\d+)$/.exec(location.hash);if(m)showPlayer(m[1]);else showOverview()}
window.onhashchange=route;document.querySelector('#refresh').onclick=route;
route();
</script></body></html>`;
