// heat_map.js - Trips > the flame button: every trip drawn at once, brighter where trips overlap (sample trips, no
// track store). Run from the repo root (tests/run.sh does):  node tests/app/heat_map.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const shots = process.env.SHOTS || '/tmp/heep-shots';
fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0);
let n = 0, fails = 0;
const check = (ok, what) => { n++; if (!ok) { fails++; console.log('FAIL ' + what); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://tile.openstreetmap.org/**', r => r.abort());
  await page.goto('http://localhost:' + srv.address().port + '/index.html');
  await page.waitForTimeout(600);
  await page.evaluate(() => { go('map'); });
  await page.waitForTimeout(1500);
  const btn = page.locator('.map-tools button[aria-label*="heat map"]');
  check(await btn.count() === 1, 'heat map button on Trips');
  await btn.click();
  await page.waitForTimeout(2500);
  const lit = await page.evaluate(() => {
    const c = document.querySelector('.heat-canvas');
    if (!c) return { canvas: false };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0, max = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) { on++; if (d[i - 1] > max) max = d[i - 1]; }
    return { canvas: true, on, max, lines: HEAT.lines.size, trips: heatTrips().length, stored: store.get('heatOn', false) };
  });
  check(lit.canvas, 'heat canvas on the map');
  check(lit.lines === lit.trips && lit.trips === 3, 'every sample trip loaded: ' + JSON.stringify(lit));
  check(lit.on > 2000, 'tracks drawn: ' + lit.on + ' pixels');
  check(lit.max > 150, 'overlapping roads brighter (blue channel reaches yellow/white): ' + lit.max);
  check(lit.stored === true, 'remembered on this phone');
  check(/Every trip at once \(3\)/.test(await page.textContent('.map-legend')), 'legend says how many');
  check(await page.evaluate(() => document.querySelector('.mapbox').classList.contains('heat')), 'streets dimmed');
  await page.screenshot({ path: shots + '/trips_heat.png' });
  // opening a trip hides it, closing brings it back
  await page.evaluate(() => openTrip('sample-1'));
  await page.waitForTimeout(800);
  check(await page.locator('.heat-canvas').count() === 0, 'hidden while a trip is open');
  await page.evaluate(() => closeTrip());
  await page.waitForTimeout(800);
  check(await page.locator('.heat-canvas').count() === 1, 'back after closing the trip');
  await page.locator('.map-tools button[aria-label="Hide every trip"]').click();
  await page.waitForTimeout(500);
  check(await page.locator('.heat-canvas').count() === 0, 'off again');
  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  await browser.close(); srv.close();
  console.log('heat_map.js: ' + n + ' checks, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
