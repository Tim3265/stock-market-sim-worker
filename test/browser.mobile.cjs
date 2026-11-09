const { chromium } = require('D:/software/Project/node_modules/playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: Number(process.env.TEST_WIDTH || 320), height: 800 }, extraHTTPHeaders: { 'CF-Connecting-IP': 'test-' + Date.now() } });
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    
    await page.goto(process.env.E2E_ORIGIN || 'http://127.0.0.1:8790/');
    await page.locator('#username').fill('mob_' + Date.now());
    await page.locator('#password').fill('example-pass-123');
    await page.locator('#register').click();
    await page.waitForFunction(() => document.querySelector('#auth-error').textContent.includes('註冊成功'));
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await page.locator('#app-panel').waitFor();
    await page.waitForSelector('[data-chart-symbol]');
    
    await page.getByRole('button', { name: 'GG 行情買進' }).click();
    assert((await page.locator('#trade-title').textContent()).includes('GG'));
    await page.locator('#cancel-trade').click();
    
    for (const name of ['行情', '下單', '我的資產', '排行榜']) {
      await page.getByRole('button', { name, exact: true }).click();
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      assert(width.scroll <= width.viewport, 'page overflows on ' + name + ': ' + JSON.stringify(width));
    }
    
    await page.getByRole('button', { name: '下單', exact: true }).click();
    await page.getByRole('button', { name: 'GG 買進' }).click();
    await page.getByLabel('交易股數').fill('1');
    assert((await page.locator('#trade-summary').textContent()).includes('預估手續費'));
    assert((await page.locator('#trade-summary').textContent()).includes('市價可能不同'));
    
    await page.route('**/api/orders', async route => {
      console.log('INTERCEPTED ROUTE:', route.request().url(), route.request().method());
      if (route.request().method() === 'POST') {
        return route.fulfill({ json: { ok: true, status: 'CANCELLED', filledShares: 0, remaining: 1, amount: 0, fee: 0 } });
      }
      return route.continue();
    });
    
    console.log('About to click 確認買進...');
    await page.getByRole('button', { name: '確認買進' }).click();
    console.log('Clicked 確認買進!');

    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('委託已取消'));
    console.log('waitForFunction PASSED!');
    
    assert((await page.locator('#msg').textContent()).includes('委託已取消'));
    await page.route('**/api/account', route => route.fulfill({ status: 500, json: { ok: false } }));
    await page.getByRole('button', { name: '我的資產', exact: true }).click();
    await page.locator('#filter-apply').click();
    await page.locator('#data-status').waitFor();
    assert((await page.locator('#data-status').textContent()).includes('更新失敗'));
    console.log('PASS: ' + (process.env.TEST_WIDTH || '320') + 'px pages do not overflow; trade preview shows cost and market-price caveat');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
