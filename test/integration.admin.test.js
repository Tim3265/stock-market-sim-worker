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
 const response=await fetch('/api/admin/overview',{headers:{Authorization:'Bearer test-admin-secret-123'}});expect(response.status).toBe(200);const body=await response.json();expect(body.sections['登入紀錄（最近 100 筆）']).toEqual(expect.arrayContaining([expect.objectContaining({ip_address:'203.0.113.8',method:'guest',success:1})]));
});
it('password-free access is limited to explicitly enabled loopback development',async()=>{
 const options={...env,LOCAL_ADMIN:'1'};
 const local=await worker.fetch(new Request('http://localhost/api/admin/overview'),options);expect(local.status).toBe(200);
 const remote=await worker.fetch(new Request('https://example.com/api/admin/overview'),options);expect(remote.status).toBe(401);
 const disabled=await worker.fetch(new Request('http://localhost/api/admin/overview'),env);expect(disabled.status).toBe(401);
 const page=await worker.fetch(new Request('http://localhost/admin'),options);expect(await page.text()).toContain('data-local-admin="true"');
});
