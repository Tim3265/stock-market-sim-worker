// Run only against a disposable database.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const origin=process.env.E2E_ORIGIN||'http://127.0.0.1:8790';
  async function makePlayer(suffix){
   const context=await browser.newContext(),page=await context.newPage();
   await page.goto(origin);await page.locator('#nickname').fill('user_'+Date.now()+'_'+suffix);
   await page.locator('#btn-play').click();
   await page.waitForFunction(()=>document.querySelector('#auth-error').textContent.includes('註冊成功'));
   await page.getByRole('button',{name:'登入',exact:true}).click();await page.locator('#app-panel').waitFor();
   return {context,page};
  }
  const a=await makePlayer('a'),b=await makePlayer('b');
  await a.page.getByRole('button',{name:'下單',exact:true}).click();
  await a.page.locator('#rows tr').filter({hasText:'右鍵'}).getByRole('button',{name:'右鍵 買進'}).click();
  await a.page.getByLabel('交易股數').fill('1');await a.page.getByRole('button',{name:'確認買進'}).click();
  await a.page.waitForFunction(()=>document.querySelector('#holdings').textContent.includes('右鍵'));
  await b.page.reload();await b.page.locator('#app-panel').waitFor();
  assert(!(await b.page.locator('#holdings').textContent()).includes('右鍵'));
  const own=await (await b.page.request.get(origin+'/api/account?id=1')).json();
  assert.equal(own.summary.cash,100000);
  console.log('PASS: independent browser sessions retain separate balances and holdings');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
