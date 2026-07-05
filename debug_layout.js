const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  // We need to serve the file or use file:// protocol.
  const path = require('path');
  const fileUrl = 'file://' + path.resolve('/Users/davemasorn/AntiGravity/baduk-notes/analytics/index.html');
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  
  const layout = await page.evaluate(() => {
    return {
      grid: document.querySelector('.dashboard-grid')?.getBoundingClientRect(),
      widget: document.querySelector('.widget')?.getBoundingClientRect(),
      three: document.querySelector('#three-container')?.getBoundingClientRect(),
      cssLayer: document.querySelector('#css-layer')?.getBoundingClientRect(),
      stones: Array.from(document.querySelectorAll('.lens-btn')).map(el => el.getBoundingClientRect()).slice(0, 5),
      playerCard: document.querySelector('.player-card')?.getBoundingClientRect()
    };
  });
  console.log(JSON.stringify(layout, null, 2));
  await browser.close();
})();
