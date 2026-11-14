import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

describe("委託簿資料庫升級", () => {
  const MIGS = env.ORDERBOOK_MIGRATIONS.filter(m => !m.name.startsWith("0000"));
  it('登入與手續費升級保留舊委託與凍結資金',async()=>{
    await env.DB.batch(MIGS[0].queries.map(sql=>env.DB.prepare(sql)));
    await env.DB.prepare("UPDATE accounts SET frozen_cash=450 WHERE id=1").run();
    await env.DB.prepare("INSERT INTO orders(account_id,symbol,side,type,price,shares,status) VALUES(1,'YZU','BUY','LIMIT',45,10,'OPEN')").run();
    for(const migration of MIGS.slice(1))await env.DB.batch(migration.queries.map(sql=>env.DB.prepare(sql)));
    expect(await env.DB.prepare('SELECT cash,frozen_cash FROM accounts WHERE id=1').first()).toEqual({cash:100000,frozen_cash:450});
    expect(await env.DB.prepare("SELECT shares,status,fee_scheme FROM orders WHERE account_id=1").first()).toEqual({shares:10,status:'OPEN',fee_scheme:0});
  });
  it("保留原有玩家、持股與交易，並建立空委託簿", async () => {
    await env.DB.prepare("UPDATE accounts SET cash=95000 WHERE id=1").run();
    await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(1,'2330',5)").run();
    await env.DB.prepare("INSERT INTO trades(account_id,symbol,side,shares,price,amount) VALUES(1,'2330','BUY',5,980,4900)").run();
    await env.DB.batch(MIGS[0].queries.map(sql => env.DB.prepare(sql)));
    expect(await env.DB.prepare('SELECT cash,frozen_cash,is_bot FROM accounts WHERE id=1').first()).toMatchObject({cash:95000,frozen_cash:0,is_bot:0});
    expect(await env.DB.prepare("SELECT shares,frozen_shares FROM holdings WHERE account_id=1 AND symbol='2330'").first()).toMatchObject({shares:5,frozen_shares:0});
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM trades').first()).toMatchObject({n:1});
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first()).toMatchObject({n:0});
  });
  it("資料庫拒絕超過現金或持股的凍結量", async () => {
    await env.DB.batch(MIGS[0].queries.map(sql => env.DB.prepare(sql)));
    await env.DB.prepare("INSERT INTO holdings(account_id,symbol,shares) VALUES(1,'2330',5)").run();
    await expect(env.DB.prepare("UPDATE accounts SET frozen_cash=cash+1 WHERE id=1").run()).rejects.toThrow();
    await expect(env.DB.prepare("UPDATE holdings SET frozen_shares=6 WHERE account_id=1 AND symbol='2330'").run()).rejects.toThrow();
    expect(await env.DB.prepare("SELECT cash,frozen_cash FROM accounts WHERE id=1").first()).toMatchObject({cash:100000,frozen_cash:0});
    expect(await env.DB.prepare("SELECT shares,frozen_shares FROM holdings WHERE account_id=1 AND symbol='2330'").first()).toMatchObject({shares:5,frozen_shares:0});
  });
  it("種子帳號衝突時整次升級回復，不覆寫既有使用者", async () => {
    await env.DB.prepare("INSERT INTO accounts(id,name,initial_cash,cash) VALUES(1000000,'existing',100,100)").run();
    await expect(env.DB.batch(MIGS[0].queries.map(sql => env.DB.prepare(sql)))).rejects.toThrow();
    expect(await env.DB.prepare('SELECT name,cash FROM accounts WHERE id=1000000').first()).toMatchObject({name:'existing',cash:100});
    const columns=await env.DB.prepare('PRAGMA table_info(accounts)').all();
    expect(columns.results.some(c=>c.name==='frozen_cash')).toBe(false);
  });
});
