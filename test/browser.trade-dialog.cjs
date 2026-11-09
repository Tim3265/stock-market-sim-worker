// Run against a disposable local Wrangler database: node test/browser.trade-dialog.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.E2E_ORIGIN || 'http://127.0.0.1:8790');
    await page.locator('#btn-guest-login').click();
    await page.waitForSelector('[data-chart-symbol]');
    const taipeiTime = await page.evaluate(() => formatFillTime('2026-11-08 16:00:00'));
    assert.match(taipeiTime, /2026\/11\/09.*00:00:00/);
    await page.locator('[data-chart-symbol] .chart-action').first().click();
    await page.locator('#trade-type').selectOption('LIMIT');
    await page.locator('#trade-shares').fill('3');
    await page.locator('#trade-price').fill('20');
    const range = await page.locator('#trade-price-range').textContent();
    assert.match(range, /今日限價範圍/);
    assert.match(await page.locator('#trade-summary').textContent(), /\$0\.09/);
    await page.locator('#trade-shares').fill('20');
    assert.match(await page.locator('#trade-summary').textContent(), /\$0\.57/);
    await page.locator('#trade-shares').fill('3');
    await page.evaluate(() => pollLive());
    assert.equal(await page.locator('#trade-price').inputValue(), '20');
    assert.equal(await page.locator('#trade-shares').inputValue(), '3');
    assert.equal(await page.locator('#trade-dialog').isVisible(), true);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator('#trade-price').fill('0.01');
    await page.locator('#confirm-trade').click();
    assert.match(await page.locator('#trade-error').textContent(), /限價超出今日範圍/);
    const errorBounds = await page.locator('#trade-error').boundingBox();
    assert(errorBounds.y >= 0 && errorBounds.y + errorBounds.height <= 568);
    await page.locator('#trade-type').selectOption('MARKET');
    assert.equal(await page.locator('#trade-error').textContent(), '');
    let releaseOrder;
    const pending = new Promise(resolve => { releaseOrder = resolve; });
    await page.route('**/api/orders', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      await pending;
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, message: '測試拒絕' }) });
    });
    await page.locator('#trade-shares').fill('1');
    await page.locator('#confirm-trade').click();
    await page.waitForFunction(() => isSubmitting);
    assert.equal(await page.locator('#cancel-trade').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#trade-dialog').isVisible(), true);
    releaseOrder();
    await page.waitForFunction(() => !isSubmitting);
    assert.equal(await page.locator('#cancel-trade').isDisabled(), false);
    await page.unroute('**/api/orders');
    await page.evaluate(() => {
      window.savedTestFetch = window.fetch;
      window.savedTestTimeout = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => window.savedTestTimeout(fn, ms === 20000 ? 30 : ms, ...args);
      window.fetch = (url, options) => String(url) === '/api/orders' && options?.method === 'POST'
        ? new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
        : window.savedTestFetch(url, options);
    });
    await page.locator('#confirm-trade').click();
    await page.waitForFunction(() => document.querySelector('#trade-error').textContent.includes('結果尚未確認'));
    assert.equal(await page.locator('#cancel-trade').isDisabled(), false);
    await page.evaluate(() => {
      window.fetch = (url, options) => String(url) === '/api/orders' && options?.method === 'POST'
        ? Promise.resolve({ ok: true, json: () => new Promise((resolve, reject) =>
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) })
        : window.savedTestFetch(url, options);
    });
    await page.locator('#confirm-trade').click();
    await page.waitForFunction(() => document.querySelector('#trade-error').textContent.includes('結果尚未確認'));
    assert.equal(await page.locator('#cancel-trade').isDisabled(), false);
    await page.evaluate(() => { window.fetch = window.savedTestFetch; window.setTimeout = window.savedTestTimeout; });
    await page.locator('#trade-shares').fill('1.5');
    assert.equal(await page.locator('#confirm-trade').isDisabled(), true);
    assert.equal(await page.locator('#trade-dialog').getAttribute('aria-labelledby'), 'trade-title');
    assert.equal(await page.locator('#trade-error').getAttribute('role'), 'alert');
    assert.equal(await page.locator('.quick-chips button').count(), 5);
    await page.locator('#trade-type').selectOption('LIMIT');
    const quick = await page.evaluate(() => {
      const saved = currentAccount, previous = activeTradeSide;
      currentAccount = { account: { cash: 0, frozen_cash: 0 }, holdings: [] };
      activeTradeSide = 'BUY'; setQuickShares(1);
      const noCash = { shares: document.querySelector('#trade-shares').value, error: document.querySelector('#trade-error').textContent };
      currentAccount.account.cash = 1000;
      document.querySelector('#trade-price').value = '100';
      setQuickShares(1);
      const limitShares = document.querySelector('#trade-shares').value;
      currentAccount.account.cash = 20.06;
      document.querySelector('#trade-price').value = '20.03';
      setQuickShares(1);
      const exactCentsShares = document.querySelector('#trade-shares').value;
      activeTradeSide = 'SELL'; setQuickShares(1);
      const noStock = { shares: document.querySelector('#trade-shares').value, error: document.querySelector('#trade-error').textContent };
      currentAccount = saved; activeTradeSide = previous;
      return { noCash, limitShares, exactCentsShares, noStock };
    });
    assert.equal(quick.noCash.shares, '');
    assert.match(quick.noCash.error, /資金不足/);
    assert.equal(quick.limitShares, '9');
    assert.equal(quick.exactCentsShares, '1');
    assert.equal(quick.noStock.shares, '');
    assert.match(quick.noStock.error, /沒有可賣出/);
    assert.equal(await page.locator('#confirm-trade').isDisabled(), true);
    await page.setViewportSize({ width: 320, height: 568 });
    const confirmBounds = await page.locator('#confirm-trade').boundingBox();
    assert(confirmBounds.y >= 0 && confirmBounds.y + confirmBounds.height <= 568);
    const chipBounds = await page.locator('.quick-chip').first().boundingBox();
    assert(chipBounds.width >= 44 && chipBounds.height >= 44);
    await page.locator('#trade-shares').fill('1');
    assert.equal(await page.locator('#confirm-trade').isDisabled(), false);
    assert.equal(await page.locator('#trade-error').textContent(), '');
    await page.locator('#cancel-trade').click();
    await page.locator('[data-nav="trade"]').click();
    const opener = page.locator('#rows tr').first().locator('button').first();
    const openerAction = await opener.getAttribute('onclick');
    await opener.click();
    await page.evaluate(() => pollLive());
    await page.locator('#cancel-trade').click();
    await page.waitForFunction(action => document.activeElement?.getAttribute('onclick') === action, openerAction);
    await page.locator('[data-nav="holdings"]').click();
    for (const selector of ['#btn-recharge', '#btn-sound', '#logout', '#filter-side', '#filter-apply']) {
      const bounds = await page.locator(selector).boundingBox();
      assert(bounds && bounds.width >= 44 && bounds.height >= 44, selector + ' touch target');
    }
    assert.deepEqual(errors, []);
    console.log('下單視窗：限價提示、預估手續費與刷新後輸入保留通過');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
