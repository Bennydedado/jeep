// wifi_update.js - Update over Wi-Fi with a T3 2.8+, which restarts first and updates before Bluetooth starts
// (firmware/T3/update.ino). Against a pretend T3 on a pretend Bluetooth link that drops while it updates:
//   1. it works: Heep keeps reconnecting, then sees the new version
//   2. it doesn't: Heep shows the reason the T3 gives after its restart (the whole text, numbers included)
// Run from the repo root (tests/run.sh does):  node tests/app/wifi_update.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const shots = process.env.SHOTS || '/tmp/heep-shots';
fs.mkdirSync(shots, { recursive: true });
let checks = 0, failed = 0;
const check = (ok, what) => { checks++; if (!ok) { failed++; console.log('  FAIL: ' + what); } };

const T3 = { fw: '2.8', upd: '', down: false, cmds: [], bytes: [], outcome: 'ok' };
let notify = async () => {}, dropLink = async () => {};
const hi = () => ({ t: 'hi', fw: T3.fw, lw: 1, proto: 2, obd: false, queued: 0, up: 'not yet', upd: T3.upd, wifi: 'on starlink2.4', seen: '', ssids: ['starlink2.4'], nets: 1, scrh: '0', scrn: 10, sheet: true });
const wifi = () => ({ t: 'wifi', fw: T3.fw, state: 'on starlink2.4', on: true, ssid: 'starlink2.4', rssi: -16, ch: 11, ip: '192.168.1.122', onFor: 60, scanning: false, scanAgo: 30,
  seen: [['starlink2.4', -18, 11, 1]], saved: ['starlink2.4'], relay: 0, up: 'not yet', upd: T3.upd, queued: 0 });
async function onT3Line(line) {
  const m = JSON.parse(line);
  T3.cmds.push(m);
  if (m.c === 'hello' || m.c === 'status') await notify(hi());
  else if (m.c === 'wifi') await notify(wifi());
  else if (m.c === 'update') {
    // like update.ino: say so, restart, update (Bluetooth is off meanwhile), start up again
    T3.upd = 'restarting to update over Wi-Fi';
    await notify({ t: 'upd', phase: 'restart', pct: -1, v: '', text: T3.upd, fw: T3.fw });
    setTimeout(async () => {
      T3.down = true; await dropLink();
      setTimeout(() => {
        if (T3.outcome === 'ok') { T3.fw = '2.9'; T3.upd = ''; }
        else T3.upd = "couldn't reach GitHub: connection refused (-16 dBm, 62 KB free)";
        T3.down = false;
      }, 3000);
    }, 400);
  }
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff' };
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
  await page.route('**/firmware/t3.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: '2.9', url: 'x' }) }));
  await page.exposeFunction('t3Down', () => T3.down);
  await page.exposeFunction('t3Bytes', async bytes => {
    for (const b of bytes) {
      if (b !== 10) { T3.bytes.push(b); continue; }
      const line = Buffer.from(T3.bytes).toString('utf8'); T3.bytes = [];
      if (line.trim()) await onT3Line(line);
    }
  });
  notify = obj => page.evaluate(s => window.__t3notify(s), JSON.stringify(obj) + '\n');
  dropLink = () => page.evaluate(() => window.__t3drop());
  await page.addInitScript(() => {
    const listeners = [], drops = [];
    const tx = { addEventListener: (t, f) => listeners.push(f), removeEventListener() {}, startNotifications: async () => {} };
    const rx = { writeValue: async b => { await window.t3Bytes(Array.from(b)); } };
    window.__t3notify = s => { const d = new TextEncoder().encode(s); for (let i = 0; i < d.length; i += 180) { const v = new DataView(d.slice(i, i + 180).buffer); listeners.forEach(f => f({ target: { value: v } })); } };
    const gatt = { connected: false, disconnect() { gatt.connected = false; },
      connect: async () => {
        if (await window.t3Down()) throw new Error('GATT Server is disconnected');   // the T3 is busy updating: Bluetooth isn't up
        gatt.connected = true; listeners.length = 0;
        return { getPrimaryService: async () => ({ getCharacteristic: async u => (/0003-/.test(u) ? tx : rx) }) };
      } };
    const dev = { name: 'Jeep T3', gatt, addEventListener: (t, f) => { if (t === 'gattserverdisconnected') drops.push(f); } };
    window.__t3drop = () => { gatt.connected = false; drops.forEach(f => f()); };
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => dev, getAvailability: async () => true } });
  });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForTimeout(800);
  const W = '.sheet.on[aria-label="Wi-Fi & update"]';
  const text = () => page.locator(W).innerText();
  await page.click('.tab[data-tab="live"]'); await page.waitForTimeout(400);
  await page.evaluate(() => btConnect()); await page.waitForTimeout(700);
  check(/T3 2\.9 is ready/.test(await page.locator('#view').innerText()), 'Live says a newer T3 program is ready (2.9+ only updates when asked)');
  await page.locator('button', { hasText: 'Wi-Fi & update' }).click(); await page.waitForTimeout(900);

  // ---- 1. it works
  await page.locator(W + ' button', { hasText: 'Update over Wi-Fi to 2.9' }).click(); await page.waitForTimeout(600);
  check(T3.cmds.some(c => c.c === 'update'), 'the request reached the T3');
  let t = await text();
  check(/updating itself over Wi-Fi/.test(t) && /screen shows how far/.test(t), 'says the T3 restarted to update and where to watch');
  await page.waitForTimeout(3000);
  check(await page.evaluate(() => LIVE.mode === 'bt'), 'Heep keeps trying while the T3 is busy (doesn\'t give up on Bluetooth)');
  await page.screenshot({ path: shots + '/wifiupd-1-restart.png' });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000 && !/running 2\.9 ✓/.test(await text())) await page.waitForTimeout(300);
  check(/running 2\.9 ✓/.test(await text()), 'after the T3 is back Heep reconnects and sees 2.9');
  check(await page.evaluate(() => !(LIVE.updWaitUntil > Date.now())), 'stops waiting once it\'s done');
  await page.screenshot({ path: shots + '/wifiupd-2-done.png' });

  // ---- 2. it doesn't: the T3 says why after its fresh start
  await page.locator(W + ' button[aria-label="Close"]').click(); await page.waitForTimeout(400);
  T3.fw = '2.8'; T3.outcome = 'fail'; T3.upd = '';
  await page.evaluate(() => send({ c: 'status' })); await page.waitForTimeout(400);
  await page.locator('button', { hasText: 'Wi-Fi & update' }).click(); await page.waitForTimeout(900);
  await page.locator(W + ' button', { hasText: 'Update over Wi-Fi to 2.9' }).click();
  const t1 = Date.now();
  while (Date.now() - t1 < 25000 && !/Didn’t update/.test(await text())) await page.waitForTimeout(300);
  t = await text();
  check(/Didn’t update/.test(t) && /connection refused \(-16 dBm, 62 KB free\)/.test(t), 'the T3\'s reason is shown in full: ' + (t.match(/couldn.t reach[^\n]*/) || [''])[0]);
  check(await page.evaluate(() => LIVE.mode === 'bt' && !!LIVE.rx), 'and Bluetooth is back');
  await page.screenshot({ path: shots + '/wifiupd-3-fail.png' });

  check(!errors.length, 'no errors in the page: ' + errors.join(' | '));
  console.log('wifi_update.js: ' + checks + ' checks, ' + failed + ' failed');
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
