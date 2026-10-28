// overview.js - the Overview with one full fill-up and a few T3 trips (no full tanks yet): an economy, cost per km and
// distance to empty anyway; the Distance to empty screen; and Heep sending the tank's level to a T3 2.10.
// Run from the repo root (tests/run.sh does):  node tests/app/overview.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const shots = process.env.SHOTS || '/tmp/heep-shots';
fs.mkdirSync(shots, { recursive: true });
let checks = 0, failed = 0;
const check = (ok, what) => { checks++; if (!ok) { failed++; console.log('  FAIL: ' + what); } };

const T3 = { cmds: [], bytes: [] };
let notify = async () => {};
const hi = () => ({ t: 'hi', fw: '2.10', proto: 2, obd: true, queued: 0, up: 'not yet', upd: '', wifi: 'on starlink2.4', ssids: ['starlink2.4'], nets: 1 });
async function onT3Line(line) {
  const m = JSON.parse(line);
  T3.cmds.push(m);
  if (m.c === 'hello' || m.c === 'status') await notify(hi());
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0);

const now = Date.now(), day = 864e5;
// like Ben's log today: one full fill-up, then trips from the T3 (two with diesel, 60 km in all)
const DATA = { fill: [{ id: 'f1', t: now - 5 * day, odo: 159557, lit: 70.2, cost: 120.4, full: true, station: 'Esso' }], serv: [], log: [],
  trip: [{ id: 't1', t0: now - 3 * day, t1: now - 3 * day + 1800e3, km: 35, lit: 3.5, vmax: 95, idle: 2 },
    { id: 't2', t0: now - day, t1: now - day + 1500e3, km: 25, lit: 2.75, vmax: 88, idle: 1 }], info: { tank: 77.6 } };

(async () => {
  const port = srv.address().port, errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_|Failed to load resource|broker\.emqx/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://script.google.com/**', r => r.abort());
  await page.route('**/firmware/t3.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: '2.10', url: 'x' }) }));
  await page.exposeFunction('t3Bytes', async bytes => {
    for (const b of bytes) {
      if (b !== 10) { T3.bytes.push(b); continue; }
      const line = Buffer.from(T3.bytes).toString('utf8'); T3.bytes = [];
      if (line.trim()) await onT3Line(line);
    }
  });
  notify = obj => page.evaluate(s => window.__t3notify(s), JSON.stringify(obj) + '\n');
  await page.addInitScript(([data]) => {
    if (!localStorage.getItem('jeep.data')) {
      localStorage.setItem('jeep.conn', JSON.stringify({ u: 'https://script.google.com/macros/s/TEST/exec', k: 'test-key-123', s: 'x' }));
      localStorage.setItem('jeep.data', JSON.stringify(data));
      localStorage.setItem('jeep.tab', JSON.stringify('home'));
    }
    window.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };
    const listeners = [];
    const tx = { addEventListener: (t, f) => listeners.push(f), removeEventListener() {}, startNotifications: async () => {} };
    const rx = { writeValue: async b => { await window.t3Bytes(Array.from(b)); } };
    window.__t3notify = s => { const d = new TextEncoder().encode(s); for (let i = 0; i < d.length; i += 180) { const v = new DataView(d.slice(i, i + 180).buffer); listeners.forEach(f => f({ target: { value: v } })); } };
    const dev = { name: 'Jeep T3', addEventListener() {}, gatt: { connected: true, disconnect() {}, connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async u => (/0003-/.test(u) ? tx : rx) }) }) } };
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => dev, getAvailability: async () => true } });
  }, [DATA]);
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForTimeout(900);
  let t = await page.locator('#view').innerText();
  check(/10\.4/.test(t) && /the T3 so far \(60 km\)/.test(t), 'economy from the T3 before two full tanks: 10.4 (' + (t.match(/L\/100 km[^\n]*/) || [''])[0] + ')');
  check(/\$0\.179/.test(t) && /estimate: economy × pump price/.test(t), 'cost per km: 10.42 L/100 × $1.715/L');
  const left = 77.6 - 6.25;   // full less what the T3 measured
  check(new RegExp('≈' + Math.round(left / (6.25 / 60 * 100) * 100)).test(t) && /71 L left/.test(t), 'distance to empty and litres left on the Overview');
  check(/Fuel economy by week/.test(t), 'the T3\'s economy week by week');
  await page.screenshot({ path: shots + '/overview-1.png', fullPage: true });
  await page.locator('#view button.tile', { hasText: 'To empty' }).click(); await page.waitForTimeout(500);
  const D = '.sheet.on[aria-label="Distance to empty"]';
  t = await page.locator(D).innerText();
  check(/km to empty/.test(t) && /71\.[34] of 77\.6 L/.test(t), 'Distance to empty: the big number and the tank');
  check(/Diesel the T3 measured\s+6\.3 L over 60 km/.test(t) && /Driven since\s+60 km/.test(t), 'how it was worked out');
  await page.screenshot({ path: shots + '/overview-2-dte.png' });
  await page.locator(D + ' button[aria-label="Close"]').click(); await page.waitForTimeout(300);
  // the T3 gets the tank's level when it connects
  await page.click('.tab[data-tab="live"]'); await page.waitForTimeout(400);
  check(/km to empty/.test(await page.locator('#view').innerText()), 'Live shows distance to empty too');
  await page.evaluate(() => btConnect()); await page.waitForTimeout(2600);
  const fuel = T3.cmds.find(c => c.c === 'fuel');
  check(fuel && Math.abs(fuel.l - 71.35) < 0.06 && Math.abs(fuel.e - 10.42) < 0.05 && fuel.k === 1, 'the T3 got the tank level: ' + JSON.stringify(fuel));
  await page.evaluate(() => send({ c: 'status' })); await page.waitForTimeout(2000);
  check(T3.cmds.filter(c => c.c === 'fuel').length === 1, 'and not again while nothing changed');

  check(!errors.length, 'no errors in the page: ' + errors.join(' | '));
  console.log('overview.js: ' + checks + ' checks, ' + failed + ' failed');
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
