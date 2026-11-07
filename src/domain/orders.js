import { matchOrders } from './orderbook.js';
import { maybeTick } from './marketMaker.js';
const cents=x=>Math.round(Number(x)*100);
const money=x=>x/100;
const err=(code,message)=>({ok:false,code,message});
const prepare=(db,sql,...values)=>db.prepare(sql).bind(...values);
export async function book(db,symbol){
 await maybeTick(db);
 const stock=await prepare(db,'SELECT symbol,price,ref_price FROM stocks WHERE symbol=?',symbol).first();
 if(!stock)return err('NOT_FOUND','沒有這檔股票');
 const rows=(await prepare(db,"SELECT side,price,SUM(shares-filled_shares) quantity FROM orders WHERE symbol=? AND status IN ('OPEN','PARTIAL') GROUP BY side,price",symbol).all()).results;
 return {ok:true,stock,bids:rows.filter(x=>x.side==='BUY').sort((a,b)=>b.price-a.price).slice(0,5),asks:rows.filter(x=>x.side==='SELL').sort((a,b)=>a.price-b.price).slice(0,5)};
}
export async function placeMarketOrder(db,input){
 const accountId=Number(input.account_id??input.accountId??1),symbol=String(input.symbol??'').trim(),side=String(input.side??'').toUpperCase(),shares=Number(input.shares);
 const requestId=String(input.request_id??crypto.randomUUID());
 if(!Number.isSafeInteger(accountId)||accountId<1||!symbol||!['BUY','SELL'].includes(side)||!Number.isSafeInteger(shares)||shares<1||shares>10000000||!/^[-a-zA-Z0-9_]{16,100}$/.test(requestId))return err('INVALID_INPUT','委託資料錯誤');
 await maybeTick(db);
 if(input.type==='LIMIT'){
  const limit=Number(input.price),stock=await prepare(db,'SELECT ref_price FROM stocks WHERE symbol=?',symbol).first();
  if(!stock)return err('NOT_FOUND','沒有這檔股票');
  if(!Number.isFinite(limit)||limit<=0)return err('INVALID_INPUT','限價必須大於零');
  if(cents(limit)<Math.ceil(cents(stock.ref_price)*0.9)||cents(limit)>Math.floor(cents(stock.ref_price)*1.1))return err('PRICE_LIMIT','限價超出漲跌停範圍');
  return err('INVALID_INPUT','玩家限價掛單將於後續版本開放');
 }
 if((input.type??'MARKET')!=='MARKET')return err('INVALID_INPUT','委託類型錯誤');
 for(let attempt=0;attempt<4;attempt++){
  const prior=await prepare(db,'SELECT * FROM orders WHERE request_id=?',requestId).first();
  if(prior){if(prior.account_id!==accountId||prior.symbol!==symbol||prior.side!==side||prior.shares!==shares)return err('CONFLICT','重複識別碼的交易資料不一致');return readResult(db,prior);}
  const version=await db.prepare('SELECT match_seq FROM market_state WHERE id=1').first();
  const stock=await prepare(db,'SELECT * FROM stocks WHERE symbol=?',symbol).first();
  const account=await prepare(db,'SELECT * FROM accounts WHERE id=?',accountId).first();
  if(!stock||!account)return err('NOT_FOUND','找不到股票或帳戶');
  const held=await prepare(db,'SELECT * FROM holdings WHERE account_id=? AND symbol=?',accountId,symbol).first();
  if(side==='SELL'&&Number(held?.shares??0)-Number(held?.frozen_shares??0)<shares)return err('INSUFFICIENT_SHARES','可用持股不足');
  const opposite=side==='BUY'?'SELL':'BUY',asc=side==='BUY'?'ASC':'DESC';
  const rows=(await prepare(db,`SELECT id,account_id accountId,side,price,shares-filled_shares remaining FROM orders WHERE symbol=? AND side=? AND type='LIMIT' AND status IN ('OPEN','PARTIAL') AND account_id<>? ORDER BY price ${asc},id ASC LIMIT 50`,symbol,opposite,accountId).all()).results;
  const lower=cents(stock.ref_price)*0.9,upper=cents(stock.ref_price)*1.1;
  const eligible=rows.filter(o=>cents(o.price)>=Math.ceil(lower)&&cents(o.price)<=Math.floor(upper));
  const plan=matchOrders({accountId,side,shares},eligible),filled=shares-plan.remaining;
  const total=plan.fills.reduce((sum,f)=>sum+cents(f.price)*f.shares,0);
  if(side==='BUY'&&cents(account.cash-account.frozen_cash)<total)return err('INSUFFICIENT_CASH','可用現金不足以支付可成交數量');
  const status=plan.remaining?'CANCELLED':'FILLED';
  const ops=[
   prepare(db,'UPDATE market_state SET match_seq=match_seq+1 WHERE id=1 AND match_seq=?',version.match_seq),
   db.prepare('INSERT INTO transaction_guard(value) SELECT changes()'),
   prepare(db,"INSERT INTO orders(account_id,symbol,side,type,shares,filled_shares,status,request_id) VALUES(?,?,?,'MARKET',?,?,?,?)",accountId,symbol,side,shares,filled,status,requestId),
  ];
  for(const f of plan.fills){
   const buyer=side==='BUY'?accountId:f.accountId,seller=side==='SELL'?accountId:f.accountId;
   const amount=money(cents(f.price)*f.shares);
   // Legacy per-account trade rows retain the existing portfolio/history API.
   ops.push(prepare(db,"INSERT INTO trades(account_id,symbol,side,shares,price,amount) VALUES(?,?,'BUY',?,?,?)",buyer,symbol,f.shares,f.price,amount));
   ops.push(prepare(db,"INSERT INTO trades(account_id,symbol,side,shares,price,amount) VALUES(?,?,'SELL',?,?,?)",seller,symbol,f.shares,f.price,amount));
   if(side==='BUY'){
    ops.push(prepare(db,'UPDATE accounts SET cash=ROUND(cash-?,2) WHERE id=?',amount,buyer));
    ops.push(prepare(db,'UPDATE holdings SET shares=shares-?,frozen_shares=frozen_shares-? WHERE account_id=? AND symbol=?',f.shares,f.shares,seller,symbol));
   }else{
    ops.push(prepare(db,'UPDATE accounts SET cash=ROUND(cash-?,2),frozen_cash=ROUND(frozen_cash-?,2) WHERE id=?',amount,amount,buyer));
    ops.push(prepare(db,'UPDATE holdings SET shares=shares-? WHERE account_id=? AND symbol=?',f.shares,seller,symbol));
   }
   ops.push(prepare(db,'UPDATE accounts SET cash=ROUND(cash+?,2) WHERE id=?',amount,seller));
   ops.push(prepare(db,'INSERT INTO holdings(account_id,symbol,shares) VALUES(?,?,?) ON CONFLICT(account_id,symbol) DO UPDATE SET shares=shares+excluded.shares',buyer,symbol,f.shares));
   ops.push(prepare(db,"UPDATE orders SET filled_shares=filled_shares+?,status=CASE WHEN filled_shares+?=shares THEN 'FILLED' ELSE 'PARTIAL' END WHERE id=?",f.shares,f.shares,f.orderId));
   ops.push(prepare(db,'INSERT INTO order_fills(maker_order_id,taker_order_id,buyer_id,seller_id,symbol,shares,price,amount) VALUES(?,(SELECT id FROM orders WHERE request_id=?),?,?,?,?,?,?)',f.orderId,requestId,buyer,seller,symbol,f.shares,f.price,amount));
   ops.push(prepare(db,'UPDATE stocks SET price=? WHERE symbol=?',f.price,symbol));
   ops.push(prepare(db,"INSERT INTO price_history(symbol,price,source) VALUES(?,?,'TRADE')",symbol,f.price));
  }
  ops.push(db.prepare('DELETE FROM transaction_guard'));
  try{await db.batch(ops);return readResult(db,await prepare(db,'SELECT * FROM orders WHERE request_id=?',requestId).first());}
  catch(e){const message=String(e);if(message.includes('market_revision_guard')||message.includes('UNIQUE constraint failed: orders.request_id'))continue;throw e;}
 }
 return err('CONFLICT','市場正在更新，請重試');
}
async function readResult(db,order){
 const fills=(await prepare(db,'SELECT maker_order_id orderId,price,shares,amount FROM order_fills WHERE taker_order_id=? ORDER BY id',order.id).all()).results;
 const total=fills.reduce((n,f)=>n+cents(f.price)*f.shares,0);
 return {ok:true,orderId:order.id,status:order.status,filledShares:order.filled_shares,remaining:order.shares-order.filled_shares,avgPrice:order.filled_shares?money(Math.round(total/order.filled_shares)):null,amount:money(total),fills};
}
