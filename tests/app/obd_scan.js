// obd_scan.js - Diagnostics > Scan the Jeep, against a pretend T3 on a pretend Bluetooth link that answers like a
// 2006 Liberty CRD might: the Chrysler bus (J1850 VPW) with 3 values, the diesel computer on the K-line (KWP2000) with many.
// Checks the results show who answered and what they offer, the best is marked, and "Use this one" sends the protocol.
// Run from the repo root (tests/run.sh does):  node tests/app/obd_scan.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const shots = process.env.SHOTS || '/tmp/heep-shots';
fs.mkdirSync(shots, { recursive: true });
let checks = 0, failed = 0;
const check = (ok, what) => { checks++; if (!ok) { failed++; console.log('  FAIL: ' + what); } };

const T3 = { cmds: [], cfg: null, bytes: [] };
let notify = async () => {};
const hi = () => ({ t: 'hi', fw: '2.5', proto: 2, obd: true, queued: 0, wifi: 'on starlink2.4', ssids: ['starlink2.4'], nets: 1, opr: T3.cfg ? T3.cfg.opr : 0 });
const diag = () => ({ t: 'diag', fw: '2.5', upS: 100, boot: 3, reset: 'power on', heap: 120000, heapMin: 90000, clock: 'n', gps: { state: 0 }, temp: { state: 0 }, nano: { state: 'none' },
  wifi: { state: 'on starlink2.4' }, ble: { phone: 1, icar: 1, icarAge: 0 }, sd: { ok: 1, totalMB: 30000, usedMB: 10, rows: 5, err: 0, waiting: 0 }, up: { sheet: 'not yet', queued: 0 },
  obd: { proto: 'A2', known: 1, data: 1, sup: '01 0C 11', boost: '-', map: null, baro: null, miss: '0D', raw: { '0100': 'SEARCHING...410080108000', '0C': '410C0BD0', '0B': '' } } });
const SCAN = [
  { p: '2', a: 'SEARCHING...486B104100801080001E', b: '', c: '', d: 'A2' },
  { p: '5', a: '83F1104100BE3EB813C1', b: '83F1104120800180018E', c: '83F1104140440000005A', d: 'A5' },
  { p: '4', a: 'BUSINIT:...ERROR', b: '', c: '', d: 'A0' },
  { p: '3', a: 'BUSINIT:...ERROR', b: '', c: '', d: 'A0' },
  { p: '1', a: 'NODATA', b: '', c: '', d: 'A0' },
  { p: '6', a: 'CANERROR', b: '', c: '', d: 'A0' },
];
async function onT3Line(line) {
  const m = JSON.parse(line);
  T3.cmds.push(m.c);
  if (m.c === 'hello' || m.c === 'status') await notify(hi());
  else if (m.c === 'diag') await notify(diag());
  else if (m.c === 'cfg') { T3.cfg = m; await notify({ t: 'cfg', ok: true }); await notify(hi()); }
  else if (m.c === 'obdscan') {
    await notify({ t: 'obdscan', start: true, n: SCAN.length });
    for (let i = 0; i < SCAN.length; i++) { await new Promise(r => setTimeout(r, 300)); await notify(Object.assign({ t: 'obdscan', i, n: SCAN.length }, SCAN[i])); }
    await notify({ t: 'obdscan', done: true });
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
  await page.exposeFunction('t3Bytes', async bytes => {
    for (const b of bytes) {
      if (b !== 10) { T3.bytes.push(b); continue; }
      const line = Buffer.from(T3.bytes).toString('utf8'); T3.bytes = [];
      if (line.trim()) await onT3Line(line);
    }
  });
  notify = obj => page.evaluate(s => window.__t3notify(s), JSON.stringify(obj) + '\n');
  await page.addInitScript(() => {
    const listeners = [];
    const tx = { addEventListener: (t, f) => listeners.push(f), removeEventListener() {}, startNotifications: async () => {} };
    const rx = { writeValue: async b => { await window.t3Bytes(Array.from(b)); } };
    window.__t3notify = s => { const d = new TextEncoder().encode(s); for (let i = 0; i < d.length; i += 180) { const v = new DataView(d.slice(i, i + 180).buffer); listeners.forEach(f => f({ target: { value: v } })); } };
    const dev = { name: 'Jeep T3', addEventListener() {}, gatt: { connected: true, disconnect() {}, connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async u => (/0003-/.test(u) ? tx : rx) }) }) } };
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => dev, getAvailability: async () => true } });
  });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForTimeout(800);
  await page.click('.tab[data-tab="live"]'); await page.waitForTimeout(400);
  await page.evaluate(() => btConnect()); await page.waitForTimeout(700);
  await page.locator('button', { hasText: 'Diagnostics' }).click(); await page.waitForTimeout(1500);
  const D = '.sheet.on[aria-label="Diagnostics"]';
  await page.locator(D + ' button', { hasText: 'Scan the Jeep' }).click();
  await page.waitForTimeout(800);
  check(T3.cmds.includes('obdscan'), 'the scan request reached the T3');
  check(/Scanning: protocol \d of 6/.test(await page.locator(D).innerText()), 'shows progress while scanning');
  await page.waitForTimeout(2600);
  const t = await page.locator(D).innerText();
  check(/J1850 VPW \(Chrysler bus\)/.test(t) && /Computer 10 \(engine\?\): 3 values/.test(t), 'VPW: computer 10 with 3 values');
  check(/KWP2000 fast \(K-line\)\s+★ most/.test(t) && /Computer 10 \(engine\?\): 22 values/.test(t), 'KWP2000 fast: 22 values, marked as the most');
  check(/Intake pressure \(boost\) \(0B\)/.test(t) && /Coolant temp \(05\)/.test(t) && /Outside air temp \(46\)/.test(t), 'names the values (boost, coolant, outside temp)');
  check((t.match(/No answer/g) || []).length >= 4, 'protocols that didn\'t answer say so');
  await page.locator(D + ' .sheet-body').evaluate(e => { const x = [...e.querySelectorAll('.label')].find(l => /Scan the Jeep/.test(l.textContent)); if (x) x.scrollIntoView(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shots + '/scan-1-results.png' });
  // use the K-line
  await page.locator(D + ' button', { hasText: 'Use this one' }).nth(1).click();
  await page.waitForTimeout(1500);
  check(T3.cfg && T3.cfg.opr === 5, 'Use this one sends protocol 5 (KWP2000 fast) to the T3: ' + (T3.cfg && T3.cfg.opr));
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('jeep.t3')).opr) === 5, 'saved on the phone too');
  await page.waitForTimeout(2200);
  check(/Using this one/.test(await page.locator(D).innerText()), 'the scan card shows which one is in use');
  check(await page.evaluate(() => !!JSON.parse(localStorage.getItem('jeep.obdscan') || 'null')), 'the scan is kept on the phone for later');
  check(!errors.length, 'no errors in the page: ' + errors.join(' | '));
  console.log('obd_scan.js: ' + checks + ' checks, ' + failed + ' failed');
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
