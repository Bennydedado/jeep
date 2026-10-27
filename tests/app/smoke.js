// smoke.js - opens Heep in a headless browser (iPhone-sized), goes through every tab and the new sheets,
// and fails on any JavaScript error. Screenshots go to $SHOTS (default /tmp/heep-shots).
// Run from the repo root:  node tests/app/smoke.js   (needs Playwright + Chromium)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const shots = process.env.SHOTS || '/tmp/heep-shots';
fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.gs': 'text/plain', '.woff': 'font/woff' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0);
(async () => {
  const port = srv.address().port, errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://tile.openstreetmap.org/**', r => r.abort());   // no map pictures in the test: the offline look
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForTimeout(800);
  await page.screenshot({ path: shots + '/1-overview.png' });
  const tab = async id => { await page.click('.tab[data-tab="' + id + '"]'); await page.waitForTimeout(700); };
  await tab('live');
  await page.screenshot({ path: shots + '/2-live.png' });
  await page.evaluate(() => demoStart());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shots + '/3-live-demo.png', fullPage: true });
  await page.evaluate(() => screensSheet());
  await page.waitForTimeout(900);
  await page.screenshot({ path: shots + '/4-screens.png' });
  await page.evaluate(() => { const st = scrState(); screenEditor(st, 0, () => {}); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: shots + '/5-editor-temp.png' });
  await page.evaluate(() => { document.querySelectorAll('.sheet').forEach(s => s.remove()); document.querySelectorAll('.backdrop').forEach(s => s.remove()); });
  await page.evaluate(() => { const st = scrState(); screenEditor(st, 2, () => {}); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: shots + '/6-editor-boost.png' });
  await page.evaluate(() => { document.querySelectorAll('.sheet,.backdrop').forEach(s => s.remove()); t3Setup(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: shots + '/7-t3-settings.png' });
  await page.evaluate(() => { document.querySelectorAll('.sheet,.backdrop').forEach(s => s.remove()); diagSheet(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelectorAll('.sheet,.backdrop').forEach(s => s.remove()); liveStop(); });
  await tab('map');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shots + '/8-map-list.png', fullPage: true });
  await page.click('.card.list .row');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shots + '/9-map-trip.png', fullPage: true });
  await page.click('.play-row .btn');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shots + '/10-map-replay.png' });
  const stats = await page.evaluate(() => ({ km: MAP.stats && MAP.stats.km, gaps: MAP.stats && MAP.stats.gaps.length, layers: MAP.layer ? MAP.layer.getLayers().length : 0 }));
  console.log('map:', JSON.stringify(stats));
  for (const t of ['home', 'fills', 'service']) await tab(t);
  await browser.close(); srv.close();
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  if (!stats.km || !stats.layers) { console.log('map didn\'t draw'); process.exit(1); }
  console.log('smoke: no errors, screenshots in ' + shots);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
