// Quotes are real funded orders. Requote and tick claim commit in one D1 batch.

const BOT = 1000000;

// 有人瀏覽時市場才推進；沒人請求就完全靜止，不燒 D1 寫入額度。
// 有人看盤時 tick 固定 15 秒（效能不變，見 activity.js）。

export const TICK_INTERVAL_MS = 15000;

const round = n => Math.round(n * 100) / 100;

export async function maybeTick(db, now = Date.now(), intervalMs = TICK_INTERVAL_MS) {

  let state;
  try {
    state = await db.prepare('SELECT * FROM market_state WHERE id=1').first();
  } catch (err) {
    if (String(err).includes('market_state')) return false;
    throw err;
  }
  if (!state || now - state.last_tick_at < intervalMs) return false;
  const stocks=(await db.prepare('SELECT * FROM stocks ORDER BY symbol').all()).results;
  const maker=await db.prepare('SELECT cash FROM accounts WHERE id=1000000').first();
  if(!maker) throw new Error('Market maker account is missing');
  const inventory=(await db.prepare('SELECT symbol,shares FROM holdings WHERE account_id=1000000').all()).results;
  const inventoryBySymbol=new Map(inventory.map(h=>[h.symbol,Number(h.shares)]));
  let remainingCash=Math.round(Number(maker.cash)*100);
  const date=new Date(now+8*3600000).toISOString().slice(0,10);

  // 每四輪才重新報價一次：D1 rows written 是硬額度，報價改為 in-place 更新
  // （保住 order id 與 FIFO 時間優先），大幅降低每次 tick 的寫入量。
  const requote=Number(state.tick_count)%4===0;

  const prepared=[
    db.prepare('UPDATE market_state SET match_seq=match_seq+1,tick_count=tick_count+1,last_tick_at=? WHERE id=1 AND match_seq=? AND last_tick_at=?').bind(now,state.match_seq,state.last_tick_at),
    db.prepare('INSERT INTO transaction_guard(value) SELECT changes()'),
  ];
  if(requote){
    prepared.push(db.prepare('UPDATE accounts SET frozen_cash=0 WHERE id=?').bind(BOT));
    prepared.push(db.prepare('UPDATE holdings SET frozen_shares=0 WHERE account_id=?').bind(BOT));
  }
  let totalCash=0;
  const refBySymbol=new Map();

  for(const stock of stocks){
    const reference=stock.ref_date===date?stock.ref_price:stock.price;
    refBySymbol.set(stock.symbol,Number(reference));
    const low=Math.ceil(Math.round(reference*100)*0.9)/100,high=Math.floor(Math.round(reference*100)*1.1)/100;
    // Quote center stays separate from the last executed stock price.
    const previous=Number(stock.price),fair=Number(stock.fair_price)||previous;
    const symbolSeed=Array.from(stock.symbol).reduce((n,c)=>n+c.charCodeAt(0),0);
    const randomUnit=Math.sin((Number(state.tick_count)+1)*431+symbolSeed*17)*43758.5453;
    const vol = Math.max(Number(stock.volatility || 0), (['YZU','YOUJIAN'].includes(stock.symbol) ? 0.035 : (['3711','2317'].includes(stock.symbol) ? 0.02 : 0.012)));
    const noise=((randomUnit-Math.floor(randomUnit))*2-1)*vol;
    const movement=Math.max(-0.06,Math.min(0.06,-0.05*(previous-fair)/fair+noise));
    const center=previous*(1+movement);
    if(Number(stock.ref_price)!==Number(reference)||stock.ref_date!==date)prepared.push(db.prepare('UPDATE stocks SET ref_price=?,ref_date=? WHERE symbol=?').bind(reference,date,stock.symbol));
    let reservedShares=0, remainingShares=inventoryBySymbol.get(stock.symbol)??0;
    if(requote){
      const buyLevels=[],sellLevels=[];
      for(const [offset,factor] of [[0.001,0.2],[0.003,0.5],[0.008,1],[0.015,1.5],[0.025,2]]){
        const qty=Math.max(1,Math.floor(stock.liquidity*factor));
        const buy=Math.min(high,Math.max(0.01,Math.max(low,round(center*(1-offset)))));
        const sell=Math.min(high,Math.max(0.01,round(center*(1+offset))));
        const buyCents=Math.round(buy*100);
        const feeFor=q=>Math.ceil(buyCents*q*399/1000000);
        let buyQty=Math.min(qty,Math.floor(remainingCash/buyCents));
        while(buyQty>0&&buyCents*buyQty+feeFor(buyQty)>remainingCash)buyQty--;
        const sellQty=Math.min(qty,remainingShares);
        if(buyQty>0){const reserved=buyCents*buyQty+feeFor(buyQty);remainingCash-=reserved;totalCash=round(totalCash+reserved/100);buyLevels.push({price:buy,qty:buyQty});}
        if(sellQty>0){remainingShares-=sellQty;reservedShares+=sellQty;sellLevels.push({price:sell,qty:sellQty});}
      }
      // In-place requote：沿用既有委託 id（保住時間優先），不足才補新單，多的撤掉。
      const existing=(await db.prepare("SELECT id,side,status,filled_shares FROM orders WHERE account_id=? AND symbol=? AND status IN ('OPEN','PARTIAL') ORDER BY id").bind(BOT,stock.symbol).all()).results;
      // 只有全新未成交的 OPEN 單可以 in-place 更新（保住 id 與時間優先）；
      // PARTIAL 單撤銷後補新單，避免 filled_shares 被重設造成非法狀態。
      const bySide={BUY:[],SELL:[]};
      for(const o of existing){
        if(o.status==='OPEN'&&Number(o.filled_shares)===0)bySide[o.side].push(o);
        else prepared.push(db.prepare("UPDATE orders SET status='CANCELLED' WHERE id=?").bind(o.id));
      }
      for(const side of ['BUY','SELL']){
        const levels=side==='BUY'?buyLevels:sellLevels, rows=bySide[side];
        for(let i=0;i<Math.max(levels.length,rows.length);i++){
          const level=levels[i], row=rows[i];
          if(level&&row)prepared.push(db.prepare("UPDATE orders SET price=?,shares=? WHERE id=? AND status='OPEN'").bind(level.price,level.qty,row.id));
          else if(level)prepared.push(db.prepare("INSERT INTO orders(account_id,symbol,side,type,price,shares,status,fee_scheme) VALUES(?,? ,?,'LIMIT',?,?,'OPEN',1)").bind(BOT,stock.symbol,side,level.price,level.qty));
          else if(row)prepared.push(db.prepare("UPDATE orders SET status='CANCELLED' WHERE id=?").bind(row.id));
        }
      }
      prepared.push(db.prepare('UPDATE holdings SET frozen_shares=? WHERE account_id=? AND symbol=?').bind(reservedShares,BOT,stock.symbol));
    }
  }
  if(requote)prepared.push(db.prepare('UPDATE accounts SET frozen_cash=? WHERE id=?').bind(totalCash,BOT));
  // 六檔流動性加權指數（以當日參考價為基期 1000），每 tick 記一筆歷史供圖表。
  const indexSymbols=['2330','2317','2454','3711','YZU','YOUJIAN'];
  let base=0,cur=0;
  for(const stock of stocks){
    if(!indexSymbols.includes(stock.symbol))continue;
    const w=Number(stock.liquidity)||0;
    base+=w*(refBySymbol.get(stock.symbol)??Number(stock.price));
    cur+=w*Number(stock.price);
  }
  const index=base>0?round(1000*cur/base):1000;
  prepared.push(db.prepare("INSERT INTO index_history(value) VALUES(?)").bind(index));
  prepared.push(db.prepare('DELETE FROM transaction_guard'));
  try { await db.batch(prepared);return true; }
  catch(e){if(String(e).includes('market_revision_guard'))return false;throw e;}
}
