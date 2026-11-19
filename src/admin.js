import { allowAttempt } from './domain/auth.js';
import { ADMIN_HTML } from './admin-page.js';
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"};
export async function adminRoute(request,env,path){
 const u=new URL(request.url);
 const local=env.LOCAL_ADMIN==='1' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(path==='/admin' && request.method==='GET')return new Response(ADMIN_HTML.replace('data-local-admin="false"', 'data-local-admin="'+local+'"'),{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
 if(path!=='/api/admin/overview'||request.method!=='GET')return null;
 const supplied=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
 if(!local&&(!env.ADMIN_SECRET||!supplied))return Response.json({ok:false},{status:401,headers});
 if(!local&&supplied.length>512)return Response.json({ok:false},{status:401,headers});
 if(!local){const enc=new TextEncoder(),hash=x=>crypto.subtle.digest('SHA-256',enc.encode(x));const [a,b]=await Promise.all([hash(supplied),hash(env.ADMIN_SECRET)]);if(!crypto.subtle.timingSafeEqual(a,b)){const allowed=await allowAttempt(env.DB,request,'admin');return Response.json({ok:false},{status:allowed?401:429,headers});}}
 const queries=[['股票',"SELECT symbol,nickname,price,ref_price FROM stocks ORDER BY symbol"],['帳戶（最近 100 筆）',"SELECT id,name,cash,initial_cash,is_bot FROM accounts WHERE is_bot=0 ORDER BY id DESC LIMIT 100"],['委託（最近 100 筆）',"SELECT id,account_id,symbol,side,type,price,shares,filled_shares,status,created_at FROM orders ORDER BY id DESC LIMIT 100"],['成交（最近 100 筆）',"SELECT id,symbol,buyer_id,seller_id,shares,price,created_at FROM order_fills ORDER BY id DESC LIMIT 100"],['登入紀錄（最近 100 筆）',"SELECT username,method,success,ip_address,created_at FROM login_events ORDER BY id DESC LIMIT 100"]];
 const rows=await env.DB.batch(queries.map(([,sql])=>env.DB.prepare(sql)));return Response.json({ok:true,sections:Object.fromEntries(queries.map(([label],i)=>[label,rows[i].results]))},{headers});
}
export async function recordLogin(db,request,result,method,username){const ip=request.headers.get('CF-Connecting-IP');await db.prepare('INSERT INTO login_events(account_id,username,method,success,ip_address) VALUES(?,?,?,?,?)').bind(result?.accountId??null,result?.username??(typeof username==='string'?username.slice(0,40):null),method,result?1:0,ip&&ip.length<=45?ip:null).run();}
