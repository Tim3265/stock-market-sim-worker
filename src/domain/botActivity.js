import { placeMarketOrder } from './orders.js';
const symbols=['2330','2317','2454','3711','YZU','YOUJIAN'];
// Funded bots use the same order path as players. Unique request IDs make
// retries safe when several visitors trigger the same lazy tick.
export async function runBotActivity(db){
 const state=await db.prepare('SELECT tick_count FROM market_state WHERE id=1').first();
 const tick=Number(state?.tick_count||0);
 if(tick<2)return;
 const requestId='bot-activity-tick-'+tick;
 const slot=Math.floor(tick/2)-1,symbol=symbols[slot%symbols.length],side=Math.floor(slot/symbols.length)%2?'SELL':'BUY';
 async function submit(account,side,shares,type='MARKET',price=null,suffix='base',orderSymbol=symbol){
  const id=suffix==='base'?requestId:'bot-'+suffix+'-'+orderSymbol+'-tick-'+tick;
  if(await db.prepare('SELECT id FROM orders WHERE request_id=?').bind(id).first())return;
  await placeMarketOrder(db,{account_id:account,symbol:orderSymbol,side,shares,type,price,request_id:id});
 }
 const stock=await db.prepare('SELECT price,fair_price FROM stocks WHERE symbol=?').bind(symbol).first();
 if(!stock)return;
 if(tick > 2 && tick % 4 === 3){
  const noiseSymbol = symbols[tick % symbols.length];
  const noiseSide = (tick % 8 < 4) ? 'BUY' : 'SELL';
  const noiseStock = await db.prepare('SELECT price FROM stocks WHERE symbol=?').bind(noiseSymbol).first();
  if(noiseStock){
   const noiseQty = (['YZU','YOUJIAN'].includes(noiseSymbol) ? 35 : 55) + (tick % 25);
   await submit(1000001, noiseSide, noiseQty, 'MARKET', null, 'retail', noiseSymbol);
  }
 }
 if(tick%3===0)await submit(1000001,side,1);
 if(tick%10===0){
  const whaleSym = symbols[(tick*2)%symbols.length];
  const whaleSide = (Math.floor(tick/10)%2===0)?'BUY':'SELL';
  const whaleQty = (['YZU','YOUJIAN'].includes(whaleSym)?40:70) + (tick%20);
  await submit(1000002, whaleSide, whaleQty, 'MARKET', null, 'whale-surge', whaleSym);
 }
 if(tick%6===0){
  const history=(await db.prepare('SELECT price FROM price_history WHERE symbol=? ORDER BY id DESC LIMIT 5').bind(symbol).all()).results.reverse().map(x=>Number(x.price));
  if(history.length===5){
   const up=history.every((p,i)=>i===0||p>history[i-1])&&history[4]>=history[0]*1.02;
   const down=history.every((p,i)=>i===0||p<history[i-1])&&history[4]<=history[0]*0.98;
   if(up||down)await submit(1000001,up?'BUY':'SELL',1,'MARKET',null,'momentum');
  }
 }
 if(tick%10===0 && stock.fair_price){
  const ratio=Number(stock.price)/Number(stock.fair_price);
  if(ratio<0.97 || ratio>1.03){
   const buy=ratio<0.97,price=Math.round(Number(stock.price)*(buy?0.999:1.001)*100)/100;
   await submit(1000002,buy?'BUY':'SELL',1,'LIMIT',price,'value');
  }
 }
 const random=Math.sin(tick*1827+slot*93)*43758.5453;
 if(random-Math.floor(random)<0.005){
  await db.prepare('INSERT INTO bot_state(account_id,symbol,panic_until) VALUES(1000003,?,?) ON CONFLICT(account_id,symbol) DO UPDATE SET panic_until=MAX(panic_until,excluded.panic_until)').bind(symbol,tick+4).run();
 }
 const active=(await db.prepare('SELECT symbol FROM bot_state WHERE account_id=1000003 AND panic_until>=? ORDER BY symbol').bind(tick).all()).results;
 for(const item of active){
  const holding=await db.prepare('SELECT shares,frozen_shares FROM holdings WHERE account_id=1000003 AND symbol=?').bind(item.symbol).first();
  const available=Number(holding?.shares||0)-Number(holding?.frozen_shares||0);
  if(available>0)await submit(1000003,'SELL',Math.max(1,Math.floor(available*0.2)),'MARKET',null,'panic',item.symbol);
 }
}
