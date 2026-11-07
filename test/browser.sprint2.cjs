// Opt-in local browser smoke test; point only at a disposable Wrangler database.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept('10'));
  const origin=process.env.E2E_ORIGIN||'http://127.0.0.1:8789';
  await page.goto(origin+'/');
  await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===6);
  await page.waitForFunction(()=>document.querySelectorAll('#book tr').length===5);
  assert((await page.locator('#rows').textContent()).includes('右鍵'));
  const before=await (await page.request.get(origin+'/api/account?id=1')).json();
  const stock=page.locator('#rows tr').filter({hasText:'2330'});
  await stock.locator('button.buy').click();
  await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('成交 10 股'));
  await page.waitForFunction(()=>document.querySelector('#holdings').textContent.includes('2330'));
  const after=await (await page.request.get(origin+'/api/account?id=1')).json();
  assert.equal(after.holdings.find(h=>h.symbol==='2330').shares,(before.holdings.find(h=>h.symbol==='2330')?.shares||0)+10);
  assert(after.account.cash<before.account.cash);
  await page.waitForFunction(()=>!document.querySelector('#msg').textContent.includes('成交 10 股') || document.querySelector('#msg').className==='');
  await stock.locator('button.sell').click();
  await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('成交 10 股')&&document.querySelector('#msg').className.includes('show'));
  await page.waitForFunction(()=>!document.querySelector('#holdings').textContent.includes('2330'));
  const result=await (await page.request.get(origin+'/api/account?id=1')).json();
  assert.equal(result.holdings.find(h=>h.symbol==='2330')?.shares||0,before.holdings.find(h=>h.symbol==='2330')?.shares||0);
  assert.deepEqual(errors,[]);
  console.log('PASS: Chrome shows six stocks and book; actual buy/sell updates D1 account and UI without exceptions');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
