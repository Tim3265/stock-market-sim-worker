import { matchOrders } from './orderbook.js';
import { maybeTick } from './marketMaker.js';
const cents=x=>Math.round(Number(x)*100);
const money=x=>x/100;

// 大樹證券：手續費 0.1425% 打 2.8 折 = 0.0399%，向上取到 0.01 元。
export const BROKER = { name: '大樹證券', feeRate: 0.000399, listFeeRate: 0.001425, discount: '2.8折' };
const feeCents=(priceCents,shares)=>Math.ceil(priceCents*shares*399/1000000);
const err=(code,message)=>({ok:false,code,message});
const prepare=(db,sql,...values)=>db.prepare(sql).bind(...values);
export async function book(db,symbol,depth=10){
 await maybeTick(db);
 const stock=await prepare(db,'SELECT symbol,price,ref_price FROM stocks WHERE symbol=?',symbol).first();
 if(!stock)return err('NOT_FOUND','沒有這檔股票');
 const rows=(await prepare(db,"SELECT side,price,SUM(shares-filled_shares) quantity FROM orders WHERE symbol=? AND status IN ('OPEN','PARTIAL') AND type='LIMIT' GROUP BY side,price",symbol).all()).results;
 return {ok:true,stock,bids:rows.filter(x=>x.side==='BUY').sort((a,b)=>b.price-a.price).slice(0,depth),asks:rows.filter(x=>x.side==='SELL').sort((a,b)=>a.price-b.price).slice(0,depth)};
}
export async function listOrders(db,accountId){
 if(!Number.isSafeInteger(accountId)||accountId<1)return err('INVALID_INPUT','帳戶錯誤');
 const account=await prepare(db,'SELECT id,cash,frozen_cash FROM accounts WHERE id=?',accountId).first();
 if(!account)return err('NOT_FOUND','找不到帳戶');
 const result=await prepare(db,'SELECT id,symbol,side,type,price,shares,filled_shares,status,created_at FROM orders WHERE account_id=? ORDER BY id DESC LIMIT 100',accountId).all();
 return {ok:true,orders:result.results,frozenCash:account.frozen_cash,availableCash:money(cents(account.cash)-cents(account.frozen_cash))};
}
export async function cancelOrder(db,accountId,orderId){
 if(!Number.isSafeInteger(accountId)||accountId<1||!Number.isSafeInteger(orderId)||orderId<1)return err('INVALID_INPUT','委託資料錯誤');
 for(let attempt=0;attempt<4;attempt++){
  const version=await db.prepare('SELECT match_seq FROM market_state WHERE id=1').first();
  const order=await prepare(db,'SELECT * FROM orders WHERE id=?',orderId).first();
  if(!order)return err('ORDER_NOT_FOUND','找不到委託');
  if(order.account_id!==accountId)return err('NOT_YOUR_ORDER','不能取消其他帳戶的委託');
  if(order.type!=='LIMIT'||!['OPEN','PARTIAL'].includes(order.status))return err('INVALID_INPUT','此委託無法取消');
  const remaining=order.shares-order.filled_shares;
  const ops=[prepare(db,'UPDATE market_state SET match_seq=match_seq+1 WHERE id=1 AND match_seq=?',version.match_seq),db.prepare('INSERT INTO transaction_guard(value) SELECT changes()'),prepare(db,"UPDATE orders SET status='CANCELLED' WHERE id=?",order.id)];
  if(order.side==='BUY')ops.push(prepare(db,'UPDATE accounts SET frozen_cash=ROUND(frozen_cash-?,2) WHERE id=?',money(cents(order.price)*remaining+(order.fee_scheme?feeCents(cents(order.price),remaining):0)),accountId));
  else ops.push(prepare(db,'UPDATE holdings SET frozen_shares=frozen_shares-? WHERE account_id=? AND symbol=?',remaining,accountId,order.symbol));
  ops.push(db.prepare('DELETE FROM transaction_guard'));
  try{await db.batch(ops);return {ok:true,orderId,status:'CANCELLED'};}catch(e){if(String(e).includes('market_revision_guard'))continue;throw e;}
 }
 return err('CONFLICT','市場正在更新，請重試');
}
// New quotes can cross an existing player limit order. Settle each crossed pair
// under the same revision guard as normal orders, preserving both reservations.
export async function matchCrossed(db){
 for(let count=0;count<10;count++){
  const version=await db.prepare('SELECT match_seq FROM market_state WHERE id=1').first();
  const pair=await db.prepare(`SELECT b.id bid_id,b.account_id buyer,b.price bid,b.fee_scheme bid_fee,b.shares-b.filled_shares bid_qty,
    s.id ask_id,s.account_id seller,s.price ask,s.fee_scheme ask_fee,s.shares-s.filled_shares ask_qty,b.symbol
    FROM orders b JOIN stocks st ON st.symbol=b.symbol JOIN orders s ON s.symbol=b.symbol AND s.side='SELL' AND s.type='LIMIT'
      AND s.status IN ('OPEN','PARTIAL') AND s.price<=b.price AND s.account_id<>b.account_id
    WHERE b.side='BUY' AND b.type='LIMIT' AND b.status IN ('OPEN','PARTIAL')
      AND ROUND((CASE WHEN b.id<s.id THEN b.price ELSE s.price END)*100) BETWEEN ROUND(st.ref_price*100)*0.9 AND ROUND(st.ref_price*100)*1.1
    ORDER BY b.symbol,b.price DESC,b.id ASC,s.price ASC,s.id ASC LIMIT 1`).first();
  if(!pair)return;
  const shares=Math.min(pair.bid_qty,pair.ask_qty),price=pair.bid_id<pair.ask_id?pair.bid:pair.ask;
  const amount=money(cents(price)*shares),reserved=money(cents(pair.bid)*shares+(pair.bid_fee?feeCents(cents(pair.bid),shares):0));
  const buyerFee=pair.bid_fee?money(feeCents(cents(price),shares)):0,sellerFee=pair.ask_fee?money(feeCents(cents(price),shares)):0;
  const maker=Math.min(pair.bid_id,pair.ask_id),taker=Math.max(pair.bid_id,pair.ask_id);
  const ops=[
   prepare(db,'UPDATE market_state SET match_seq=match_seq+1 WHERE id=1 AND match_seq=?',version.match_seq),
   db.prepare('INSERT INTO transaction_guard(value) SELECT changes()'),
   prepare(db,"INSERT INTO trades(account_id,symbol,side,shares,price,amount,fee_amount) VALUES(?,?,'BUY',?,?,?,?)",pair.buyer,pair.symbol,shares,price,amount,buyerFee),
   prepare(db,"INSERT INTO trades(account_id,symbol,side,shares,price,amount,fee_amount) VALUES(?,?,'SELL',?,?,?,?)",pair.seller,pair.symbol,shares,price,amount,sellerFee),
   prepare(db,'UPDATE accounts SET cash=ROUND(cash-?-?,2),frozen_cash=ROUND(frozen_cash-?,2) WHERE id=?',amount,buyerFee,reserved,pair.buyer),
   prepare(db,'UPDATE holdings SET shares=shares-?,frozen_shares=frozen_shares-? WHERE account_id=? AND symbol=?',shares,shares,pair.seller,pair.symbol),
   prepare(db,'UPDATE accounts SET cash=ROUND(cash+?-?,2) WHERE id=?',amount,sellerFee,pair.seller),
   prepare(db,'UPDATE fee_revenue SET amount=ROUND(amount+?+?,2) WHERE id=1',buyerFee,sellerFee),
   prepare(db,'INSERT INTO holdings(account_id,symbol,shares) VALUES(?,?,?) ON CONFLICT(account_id,symbol) DO UPDATE SET shares=shares+excluded.shares',pair.buyer,pair.symbol,shares),
   prepare(db,"UPDATE orders SET filled_shares=filled_shares+?,status=CASE WHEN filled_shares+?=shares THEN 'FILLED' ELSE 'PARTIAL' END WHERE id IN (?,?)",shares,shares,pair.bid_id,pair.ask_id),
   prepare(db,'INSERT INTO order_fills(maker_order_id,taker_order_id,buyer_id,seller_id,symbol,shares,price,amount) VALUES(?,?,?,?,?,?,?,?)',maker,taker,pair.buyer,pair.seller,pair.symbol,shares,price,amount),
   prepare(db,'UPDATE stocks SET price=? WHERE symbol=?',price,pair.symbol),
   prepare(db,"INSERT INTO price_history(symbol,price,source) VALUES(?,?,'TRADE')",pair.symbol,price),
   db.prepare('DELETE FROM transaction_guard')
  ];
  try{await db.batch(ops);}catch(e){if(String(e).includes('market_revision_guard'))continue;throw e;}
 }
}
export async function placeMarketOrder(db,input){
 const accountId=Number(input.account_id??input.accountId??1),symbol=String(input.symbol??'').trim(),side=String(input.side??'').toUpperCase(),shares=Number(input.shares);
 const type=input.type??'MARKET', limit=Number(input.price);
 const requestId=String(input.request_id??crypto.randomUUID());
 if(!Number.isSafeInteger(accountId)||accountId<1||!symbol||!['BUY','SELL'].includes(side)||!Number.isSafeInteger(shares)||shares<1||shares>10000000||!/^[-a-zA-Z0-9_]{16,100}$/.test(requestId))return err('INVALID_INPUT','委託資料錯誤');
 await maybeTick(db);
 if(type==='LIMIT'){
  const stock=await prepare(db,'SELECT ref_price FROM stocks WHERE symbol=?',symbol).first();
  if(!stock)return err('NOT_FOUND','沒有這檔股票');
  if(!Number.isFinite(limit)||limit<=0||Math.abs(limit*100-Math.round(limit*100))>1e-7)return err('INVALID_INPUT','限價必須大於零且最多兩位小數');
  if(cents(limit)<Math.ceil(cents(stock.ref_price)*0.9)||cents(limit)>Math.floor(cents(stock.ref_price)*1.1))return err('PRICE_LIMIT','限價超出漲跌停範圍');
 }
 if(!['MARKET','LIMIT'].includes(type))return err('INVALID_INPUT','委託類型錯誤');
 for(let attempt=0;attempt<4;attempt++){
  const prior=await prepare(db,'SELECT * FROM orders WHERE request_id=?',requestId).first();
  if(prior){if(prior.account_id!==accountId||prior.symbol!==symbol||prior.side!==side||prior.shares!==shares||prior.type!==type||(type==='LIMIT'&&cents(prior.price)!==cents(limit)))return err('CONFLICT','重複識別碼的交易資料不一致');return readResult(db,prior);}
  const version=await db.prepare('SELECT match_seq FROM market_state WHERE id=1').first();
  const stock=await prepare(db,'SELECT * FROM stocks WHERE symbol=?',symbol).first();
  const account=await prepare(db,'SELECT * FROM accounts WHERE id=?',accountId).first();
  if(!stock||!account)return err('NOT_FOUND','找不到股票或帳戶');
  const held=await prepare(db,'SELECT * FROM holdings WHERE account_id=? AND symbol=?',accountId,symbol).first();
  if(side==='SELL'&&Number(held?.shares??0)-Number(held?.frozen_shares??0)<shares)return err('INSUFFICIENT_SHARES','可用持股不足');
  const opposite=side==='BUY'?'SELL':'BUY',asc=side==='BUY'?'ASC':'DESC';
  const rows=(await prepare(db,`SELECT id,account_id accountId,side,price,fee_scheme,shares-filled_shares remaining FROM orders WHERE symbol=? AND side=? AND type='LIMIT' AND status IN ('OPEN','PARTIAL') AND account_id<>? ORDER BY price ${asc},id ASC LIMIT 50`,symbol,opposite,accountId).all()).results;
  const lower=cents(stock.ref_price)*0.9,upper=cents(stock.ref_price)*1.1;
  const eligible=rows.filter(o=>cents(o.price)>=Math.ceil(lower)&&cents(o.price)<=Math.floor(upper));
  const plan=matchOrders({accountId,side,shares,limitPrice:type==='LIMIT'?limit:null},eligible),filled=shares-plan.remaining;
  const total=plan.fills.reduce((sum,f)=>sum+cents(f.price)*f.shares,0);
  const takerFee=plan.fills.reduce((sum,f)=>sum+feeCents(cents(f.price),f.shares),0);
  // 預扣手續費與成交時一致：用整體股數計算，避免逐股進位造成的誤差。
  const reserved=type==='LIMIT'?(cents(limit)*plan.remaining+feeCents(cents(limit),plan.remaining)):0;
  if(side==='BUY'&&cents(account.cash-account.frozen_cash)<total+takerFee+reserved)return err('INSUFFICIENT_CASH','可用現金不足');
  const status=plan.remaining?(type==='LIMIT'?(filled?'PARTIAL':'OPEN'):'CANCELLED'):'FILLED';
  const ops=[
   prepare(db,'UPDATE market_state SET match_seq=match_seq+1 WHERE id=1 AND match_seq=?',version.match_seq),
   db.prepare('INSERT INTO transaction_guard(value) SELECT changes()'),
   prepare(db,"INSERT INTO orders(account_id,symbol,side,type,price,shares,filled_shares,status,request_id,fee_scheme) VALUES(?,?,?,?,?,?,?,?,?,1)",accountId,symbol,side,type,type==='LIMIT'?limit:null,shares,filled,status,requestId),
  ];
  for(const f of plan.fills){
   const buyer=side==='BUY'?accountId:f.accountId,seller=side==='SELL'?accountId:f.accountId;
   const amount=money(cents(f.price)*f.shares);
   const makerFee=rows.find(row=>row.id===f.orderId)?.fee_scheme?money(feeCents(cents(f.price),f.shares)):0;
   const fillTakerFee=money(feeCents(cents(f.price),f.shares));
   const buyerFee=side==='BUY'?fillTakerFee:makerFee,sellerFee=side==='SELL'?fillTakerFee:makerFee;
   // Legacy per-account trade rows retain the existing portfolio/history API.
   ops.push(prepare(db,"INSERT INTO trades(account_id,symbol,side,shares,price,amount,fee_amount) VALUES(?,?,'BUY',?,?,?,?)",buyer,symbol,f.shares,f.price,amount,buyerFee));
   ops.push(prepare(db,"INSERT INTO trades(account_id,symbol,side,shares,price,amount,fee_amount) VALUES(?,?,'SELL',?,?,?,?)",seller,symbol,f.shares,f.price,amount,sellerFee));
   if(side==='BUY'){
    ops.push(prepare(db,'UPDATE accounts SET cash=ROUND(cash-?-?,2) WHERE id=?',amount,buyerFee,buyer));
    ops.push(prepare(db,'UPDATE holdings SET shares=shares-?,frozen_shares=frozen_shares-? WHERE account_id=? AND symbol=?',f.shares,f.shares,seller,symbol));
   }else{
    // 逐筆釋放時手續費要與預扣一致，用該筆成交的整體股數計算，避免逐股進位誤差。
    const reserve=money(cents(f.price)*f.shares+(makerFee?feeCents(cents(f.price),f.shares):0));
    ops.push(prepare(db,'UPDATE accounts SET cash=ROUND(cash-?-?,2),frozen_cash=ROUND(frozen_cash-?,2) WHERE id=?',amount,buyerFee,reserve,buyer));
    ops.push(prepare(db,'UPDATE holdings SET shares=shares-? WHERE account_id=? AND symbol=?',f.shares,seller,symbol));
   }
   ops.push(prepare(db,'UPDATE accounts SET cash=ROUND(cash+?-?,2) WHERE id=?',amount,sellerFee,seller));
   ops.push(prepare(db,'UPDATE fee_revenue SET amount=ROUND(amount+?+?,2) WHERE id=1',buyerFee,sellerFee));
   ops.push(prepare(db,'INSERT INTO holdings(account_id,symbol,shares) VALUES(?,?,?) ON CONFLICT(account_id,symbol) DO UPDATE SET shares=shares+excluded.shares',buyer,symbol,f.shares));
   ops.push(prepare(db,"UPDATE orders SET filled_shares=filled_shares+?,status=CASE WHEN filled_shares+?=shares THEN 'FILLED' ELSE 'PARTIAL' END WHERE id=?",f.shares,f.shares,f.orderId));
   ops.push(prepare(db,'INSERT INTO order_fills(maker_order_id,taker_order_id,buyer_id,seller_id,symbol,shares,price,amount) VALUES(?,(SELECT id FROM orders WHERE request_id=?),?,?,?,?,?,?)',f.orderId,requestId,buyer,seller,symbol,f.shares,f.price,amount));
   ops.push(prepare(db,'UPDATE stocks SET price=? WHERE symbol=?',f.price,symbol));
   ops.push(prepare(db,"INSERT INTO price_history(symbol,price,source) VALUES(?,?,'TRADE')",symbol,f.price));
  }
  if(type==='LIMIT'&&plan.remaining){
   if(side==='BUY')ops.push(prepare(db,'UPDATE accounts SET frozen_cash=ROUND(frozen_cash+?,2) WHERE id=?',money(reserved),accountId));
   else ops.push(prepare(db,'UPDATE holdings SET frozen_shares=frozen_shares+? WHERE account_id=? AND symbol=?',plan.remaining,accountId,symbol));
  }
  ops.push(db.prepare('DELETE FROM transaction_guard'));
  try{await db.batch(ops);return readResult(db,await prepare(db,'SELECT * FROM orders WHERE request_id=?',requestId).first());}
  catch(e){const message=String(e);if(message.includes('market_revision_guard')||message.includes('UNIQUE constraint failed: orders.request_id'))continue;if(message.includes('INSUFFICIENT_CASH'))return err('INSUFFICIENT_CASH','可用現金不足');if(message.includes('INSUFFICIENT_SHARES'))return err('INSUFFICIENT_SHARES','可用持股不足');if(message.includes('CHECK constraint failed'))return err('INVALID_STATE','資料違反資料庫約束，請重新整理後再試');throw e;}
 }
 return err('CONFLICT','市場正在更新，請重試');
}
async function readResult(db,order){
 const fills=(await prepare(db,'SELECT maker_order_id orderId,price,shares,amount FROM order_fills WHERE taker_order_id=? ORDER BY id',order.id).all()).results;
 const total=fills.reduce((n,f)=>n+cents(f.price)*f.shares,0);
 const fee=order.fee_scheme?fills.reduce((n,f)=>n+feeCents(cents(f.price),f.shares),0):0;
 const remaining=order.shares-order.filled_shares;
 const cancelReason=order.status==='CANCELLED'&&remaining>0?'IOC_NO_LIQUIDITY':null;
 return {ok:true,orderId:order.id,status:order.status,filledShares:order.filled_shares,remaining,avgPrice:order.filled_shares?money(Math.round(total/order.filled_shares)):null,amount:money(total),fee:money(fee),cancelReason,fills};
}
