// trackstore_paste.js - Trips > Set up track storage: pasting "link|key" from another browser uses that key (no new
// one), and once connected "Copy link and key" gives the same line back. Run: node tests/app/trackstore_paste.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.gs': 'text/plain' };
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const seen = [];
  // the pretend track store: accepts only the key KEY123
  await page.route('https://script.google.com/**', async r => {
    const b = JSON.parse(r.request().postData() || '{}'); seen.push(b);
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(b.k === 'KEY123' ? { ok: true, trips: [] } : { ok: false, error: 'key' }) });
  });
  await page.route('https://tile.openstreetmap.org/**', r => r.abort());
  await page.goto('http://localhost:' + srv.address().port + '/index.html');
  await page.waitForTimeout(600);
  await page.evaluate(() => trackStoreSheet());
  await page.waitForTimeout(400);
  check(await page.locator('text=Already set up in another browser').count() === 1, 'hint for another browser shown');
  await page.fill('.sheet.on textarea', 'https://script.google.com/macros/s/ABC/exec | KEY123');
  await page.click('.sheet.on button.btn-primary:has-text("Connect")');
  await page.waitForTimeout(800);
  const trk = await page.evaluate(() => store.get('trk', null));
  check(trk && trk.u === 'https://script.google.com/macros/s/ABC/exec' && trk.k === 'KEY123', 'pasted link and key saved: ' + JSON.stringify(trk));
  check(seen.length && seen[0].k === 'KEY123' && seen[0].op === 'list', 'checked with the pasted key');
  await page.reload(); await page.waitForTimeout(600);
  await page.evaluate(() => trackStoreSheet());
  await page.waitForTimeout(400);
  await page.click('.sheet.on button:has-text("Copy link and key")');
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip === 'https://script.google.com/macros/s/ABC/exec|KEY123', 'copied line: ' + clip);
  // Trips says when the T3 sends its tracks somewhere else (T3 2.27 fingerprint: first 8 hex of SHA-256 of link|key)
  await page.keyboard.press('Escape');
  const fp = require('crypto').createHash('sha256').update('https://script.google.com/macros/s/ABC/exec|KEY123').digest('hex').slice(0, 8);
  const banner = async t3 => {
    await page.evaluate(t => { store.set('t3trk', t); go('map'); render(); }, t3);
    await page.waitForTimeout(400);
    return page.evaluate(() => [...document.querySelectorAll('.banner b')].map(b => b.textContent).join(' / '));
  };
  check(/old track key/.test(await banner({ set: true, f: 'deadbeef', st: '', w: 12, at: 1 })), 'old key: warned');
  await page.screenshot({ path: (process.env.SHOTS || '/tmp/heep-shots') + '/trips_t3_old_key.png' }).catch(() => {});
  check(/no track storage/.test(await banner({ set: false, f: '', st: '', w: 12, at: 1 })), 'no store on the T3: warned');
  check(/old track key/.test(await banner({ set: true, f: null, st: 'track store key wrong', w: 3, at: 1 })), 'older T3 saying key wrong: warned');
  const same = await banner({ set: true, f: fp, st: 'sent t1', w: 12, at: 1 });
  check(/12 GPS tracks are still on the T3/.test(same) && !/old track key/.test(same), 'same store, tracks waiting: ' + same);
  check(!/T3/.test(await banner({ set: true, f: fp, st: 'sent t1', w: 0, at: 1 })), 'all sent: no banner');
  // a wrong key is refused and nothing is kept
  await page.evaluate(() => { store.del('trk'); });
  await page.reload(); await page.waitForTimeout(600);
  await page.evaluate(() => trackStoreSheet());
  await page.waitForTimeout(400);
  await page.fill('.sheet.on textarea', 'https://script.google.com/macros/s/ABC/exec|WRONG');
  await page.click('.sheet.on button.btn-primary:has-text("Connect")');
  await page.waitForTimeout(800);
  check(!(await page.evaluate(() => store.get('trk', null))), 'wrong key not kept');
  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  await browser.close(); srv.close();
  console.log('trackstore_paste.js: ' + n + ' checks, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
