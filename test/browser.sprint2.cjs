// Opt-in local browser smoke test; point only at a disposable Wrangler database.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const answers=[];
  page.on('dialog',dialog=>dialog.accept(answers.shift() || '10'));
  const origin=process.env.E2E_ORIGIN||'http://127.0.0.1:8789';
  await page.goto(origin+'/');
  await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===6);
  await page.waitForFunction(()=>document.querySelectorAll('#book tr').length===5);
  assert((await page.locator('#rows').textContent()).includes('右鍵'));
  assert(!(await page.locator('#rows').textContent()).includes('2330'));
  assert(!(await page.locator('body').textContent()).includes('Cloudflare Worker'));
  const before=await (await page.request.get(origin+'/api/account?id=1')).json();
  const stock=page.locator('#rows tr').filter({hasText:'GG'});
  await stock.getByRole('button',{name:'買進',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('成交 10 股'));
  await page.waitForFunction(()=>document.querySelector('#holdings').textContent.includes('GG'));
  const after=await (await page.request.get(origin+'/api/account?id=1')).json();
  assert.equal(after.holdings.find(h=>h.symbol==='2330').shares,(before.holdings.find(h=>h.symbol==='2330')?.shares||0)+10);
  assert(after.account.cash<before.account.cash);
  await page.waitForFunction(()=>!document.querySelector('#msg').textContent.includes('成交 10 股') || document.querySelector('#msg').className==='');
  await stock.getByRole('button',{name:'賣出',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('成交 10 股')&&document.querySelector('#msg').className.includes('show'));
  await page.waitForFunction(()=>!document.querySelector('#holdings').textContent.includes('GG'));
  const result=await (await page.request.get(origin+'/api/account?id=1')).json();
  assert.equal(result.holdings.find(h=>h.symbol==='2330')?.shares||0,before.holdings.find(h=>h.symbol==='2330')?.shares||0);
  await page.waitForSelector('#chart polyline');
  answers.push('2','41');
  await page.locator('#rows tr').filter({hasText:'元智 AI'}).getByRole('button',{name:'限價買'}).click();
  await page.waitForFunction(()=>document.querySelector('#orders').textContent.includes('等待成交'));
  assert((await page.locator('#available').textContent()).includes('82'));
  await page.locator('#orders tr').filter({hasText:'等待成交'}).getByRole('button',{name:'取消'}).click();
  await page.waitForFunction(()=>!document.querySelector('#orders').textContent.includes('等待成交'));
  assert((await page.locator('#available').textContent()).includes('凍結 0'));
  assert.deepEqual(errors,[]);
  console.log('PASS: Chrome shows six stocks and book; actual buy/sell updates D1 account and UI without exceptions');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
