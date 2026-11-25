import { beforeEach, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';
const options=()=>({...env,ADMIN_SECRET:'test-admin-secret-123'});
beforeEach(async()=>{for(const m of env.ORDERBOOK_MIGRATIONS)await env.DB.batch(m.queries.map(sql=>env.DB.prepare(sql)))});
it('admin rejects unauthenticated requests and exposes login data only to the configured administrator',async()=>{
 const fetch=(path,init={})=>worker.fetch(new Request('https://example.com'+path,init),options());
 expect((await fetch('/api/admin/overview')).status).toBe(401);
 expect((await fetch('/api/admin/overview',{headers:{Authorization:'Bearer wrong'}})).status).toBe(401);
 const login=await fetch('/api/auth/guest',{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'203.0.113.8'},body:JSON.stringify({nickname:'Tester'})});expect(login.status).toBe(200);
 const response=await fetch('/api/admin/overview',{headers:{Authorization:'Bearer test-admin-secret-123'}});expect(response.status).toBe(200);const body=await response.json();expect(body.logins).toEqual(expect.arrayContaining([expect.objectContaining({ip_address:'203.0.113.8',method:'guest',success:1})]));
 const tester=body.players.find(p=>p.name==='Tester');expect(tester).toMatchObject({is_guest:1,trade_count:0});expect(tester.last_login_at).toBeTruthy();expect(body.status).toMatchObject({database_ok:true,players:expect.any(Number)});
 const detail=await (await fetch('/api/admin/player?id='+tester.id,{headers:{Authorization:'Bearer test-admin-secret-123'}})).json();
 expect(detail.player.name).toBe('Tester');expect(detail.logins[0]).toMatchObject({ip_address:'203.0.113.8'});expect(Array.isArray(detail.trades)).toBe(true);
 expect((await fetch('/api/admin/player?id='+tester.id)).status).toBe(401);
 expect((await fetch('/api/admin/player?id=999999999',{headers:{Authorization:'Bearer test-admin-secret-123'}})).status).toBe(404);
});
it('password-free access is limited to explicitly enabled loopback development',async()=>{
 const options={...env,LOCAL_ADMIN:'1'};
 const local=await worker.fetch(new Request('http://localhost/api/admin/overview'),options);expect(local.status).toBe(200);
 const remote=await worker.fetch(new Request('https://example.com/api/admin/overview'),options);expect(remote.status).toBe(401);
 const disabled=await worker.fetch(new Request('http://localhost/api/admin/overview'),env);expect(disabled.status).toBe(401);
 const page=await worker.fetch(new Request('http://localhost/admin'),options);expect(await page.text()).toContain('data-local-admin="true"');
});
it('大盤指數接續前一天收盤，不會每天重設成 1000',async()=>{
 const get=path=>worker.fetch(new Request('https://example.com'+path),env);
 await get('/api/stocks');
 await env.DB.prepare('DELETE FROM index_history').run();
 await env.DB.prepare("INSERT INTO index_history(value) VALUES(1234.5)").run();
 await env.DB.prepare("UPDATE market_state SET last_tick_at=0,index_base=NULL,index_base_date='2000-01-01'").run();
 await env.DB.prepare("UPDATE stocks SET ref_date='2000-01-01'").run();
 const r=await (await get('/api/index')).json();
 expect(r.data?.indexBase??r.indexBase).toBe(1234.5);
 const state=await env.DB.prepare('SELECT index_base FROM market_state WHERE id=1').first();
 expect(state.index_base).toBe(1234.5);
 const latest=await env.DB.prepare('SELECT value FROM index_history ORDER BY id DESC LIMIT 1').first();
 expect(Math.abs(latest.value-1234.5)/1234.5).toBeLessThan(0.1);
});
