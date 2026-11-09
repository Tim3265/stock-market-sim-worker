// Run against a disposable local Wrangler database.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(process.env.E2E_ORIGIN || 'http://127.0.0.1:8790');
    await page.locator('#btn-guest-login').click();
    await page.waitForSelector('[data-chart-symbol]');
    const result = await page.evaluate(() => {
      const card = document.querySelector('[data-chart-symbol]');
      const svg = card.querySelector('svg'), note = card.querySelector('.chart-time-note');
      renderMiniPolyline(svg, note, [
        { price: 10, created_at: '2026-11-09 01:00:00' },
        { price: 20, created_at: '2026-11-09 02:00:00' },
      ], { price: 20, ref_price: 10 });
      svg.setPointerCapture = () => {};
      const rect = svg.getBoundingClientRect();
      svg.onpointerdown({ clientX: rect.left + rect.width * .03, pointerId: 1 });
      svg.onpointerup();
      const released = note.textContent;
      svg.onpointermove({ clientX: rect.left + rect.width * .97 });
      const afterMove = note.textContent;
      clearChartInteraction(svg);
      return { released, afterMove };
    });
    assert.match(result.released, /10\.00 元/);
    assert.equal(result.afterMove, result.released);
    console.log('線圖：放手後查價點維持不變');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
