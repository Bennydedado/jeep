// codes_trips.js - Live > Trouble codes against a pretend T3 2.7, the Driving totals (week / month / year), a trip's
// breakdown sheet, and Live in Safari (no Bluetooth: the Wi-Fi card, not a "needs Bluefy" dead end).
// Run from the repo root (tests/run.sh does):  node tests/app/codes_trips.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const shots = process.env.SHOTS || '/tmp/heep-shots';
fs.mkdirSync(shots, { recursive: true });
let checks = 0, failed = 0;
const check = (ok, what) => { checks++; if (!ok) { failed++; console.log('  FAIL: ' + what); } };

const T3 = { cmds: [], codes: [], bytes: [] };
let notify = async () => {};
const hi = () => ({ t: 'hi', fw: '2.7', proto: 2, obd: true, queued: 0, wifi: 'on starlink2.4', ssids: ['starlink2.4'], nets: 1, opr: 3, lw: 1 });
// what a 2006 Liberty CRD might say: the diesel computer (12) on the K-line with the light on, the transmission (18) on the Chrysler bus
const ANSWERS = {
  '3': { a: 'BUSINIT:...OK/486B1241018207650024', b: '486B124304010234000000C9', c: '486B12470299000000000050' },
  '2': { a: '486B184101000000003A', b: '486B184307000000000033', c: 'NODATA' },
};
async function onT3Line(line) {
  const m = JSON.parse(line);
  T3.cmds.push(m.c);
  if (m.c === 'hello' || m.c === 'status') await notify(hi());
  else if (m.c === 'codes') {
    T3.codes.push(m);
    const ps = String(m.p).split('');
    await notify({ t: 'codes', start: true, n: ps.length, clear: m.clear ? 1 : 0 });
    for (let i = 0; i < ps.length; i++) {
      await new Promise(r => setTimeout(r, 250));
      const a = ANSWERS[ps[i]] || { a: 'NODATA', b: '', c: '' };
      await notify(Object.assign({ t: 'codes', i, n: ps.length, p: ps[i], x: m.clear ? (ps[i] === '3' ? '486B12440B' : '486B18440B') : '' }, a));
    }
    await notify({ t: 'codes', done: true });
  }
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0);

// trips: two this week, one last month, one last year
const now = Date.now(), day = 864e5;
const TRIPS = [
  { id: 't9-1', t0: now - 2 * 3600e3, t1: now - 1.5 * 3600e3, km: 42.5, lit: 4.1, vmax: 104, idle: 3, note: '' },
  { id: 't9-2', t0: now - 3 * 3600e3, t1: now - 2.8 * 3600e3, km: 8.2, lit: '', vmax: 60, idle: 0, note: '' },
  { id: 't8-1', t0: now - 40 * day, t1: now - 40 * day + 3600e3, km: 120, lit: 11, vmax: 110, idle: 5, note: '' },
  { id: 't7-1', t0: now - 400 * day, t1: now - 400 * day + 1800e3, km: 30, lit: 3, vmax: 90, idle: 0, note: '' },
];
const SCAN = { running: false, n: 6, at: now - day, items: [
  { p: '2', a: '486B184100800000003A' }, { p: '3', a: '486B124100BE3EB81311' }, { p: '5', a: 'BUSINIT:...ERROR' } ] };

(async () => {
  const port = srv.address().port, errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_|Failed to load resource|broker\.emqx/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://script.google.com/**', r => r.abort());
  await page.exposeFunction('t3Bytes', async bytes => {
    for (const b of bytes) {
      if (b !== 10) { T3.bytes.push(b); continue; }
      const line = Buffer.from(T3.bytes).toString('utf8'); T3.bytes = [];
      if (line.trim()) await onT3Line(line);
    }
  });
  notify = obj => page.evaluate(s => window.__t3notify(s), JSON.stringify(obj) + '\n');
  await page.addInitScript(([trips, scan]) => {
    if (!localStorage.getItem('jeep.data')) {
      localStorage.setItem('jeep.conn', JSON.stringify({ u: 'https://script.google.com/macros/s/TEST/exec', k: 'test-key-123', s: 'x' }));
      localStorage.setItem('jeep.data', JSON.stringify({ fill: [], serv: [], log: [], trip: trips, info: {} }));
      localStorage.setItem('jeep.obdscan', JSON.stringify(scan));
      localStorage.setItem('jeep.t3', JSON.stringify({ opr: 3 }));
    }
    window.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };   // the relay never answers here
    const listeners = [];
    const tx = { addEventListener: (t, f) => listeners.push(f), removeEventListener() {}, startNotifications: async () => {} };
    const rx = { writeValue: async b => { await window.t3Bytes(Array.from(b)); } };
    window.__t3notify = s => { const d = new TextEncoder().encode(s); for (let i = 0; i < d.length; i += 180) { const v = new DataView(d.slice(i, i + 180).buffer); listeners.forEach(f => f({ target: { value: v } })); } };
    const dev = { name: 'Jeep T3', addEventListener() {}, gatt: { connected: true, disconnect() {}, connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async u => (/0003-/.test(u) ? tx : rx) }) }) } };
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => dev, getAvailability: async () => true } });
  }, [TRIPS, SCAN]);
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForTimeout(800);
  await page.click('.tab[data-tab="live"]'); await page.waitForTimeout(500);

  // ---- Driving totals
  let t = await page.locator('#view').innerText();
  check(/Driving/.test(t) && /Distance per month/.test(t), 'Driving totals with a chart per month');
  check(/51\s*km/.test(t) && /2 trips/.test(t), 'this month: 51 km over 2 trips (' + (t.match(/\d+\s*km[^\n]*\n[^\n]*trips?/) || [''])[0] + ')');
  check(/4\.1\s*L/.test(t) && /9\.6 L\/100 km/.test(t), 'diesel this month and L/100 km from the trips that know it');
  await page.locator('#view .seg button', { hasText: 'Year' }).click(); await page.waitForTimeout(300);
  t = await page.locator('#view').innerText();
  check(/Distance per year/.test(t), 'switches to years');
  check(/Week/.test(t) && /Month/.test(t), 'week / month / year choice');
  await page.locator('#view .seg button', { hasText: 'Week' }).click(); await page.waitForTimeout(300);
  check(/Distance per week/.test(await page.locator('#view').innerText()), 'switches to weeks');
  await page.screenshot({ path: shots + '/trips-1-totals.png', fullPage: true });

  // ---- a trip's breakdown
  await page.locator('#view button.row', { hasText: '42.5 km' }).click(); await page.waitForTimeout(500);
  const TS = '.sheet.on[aria-label="Trip"]';
  t = await page.locator(TS).innerText();
  check(/42\.5 km/.test(t) && /4\.1 L/.test(t) && /9\.6 L\/100 km/.test(t), 'trip sheet: distance, diesel, economy');
  check(/Set up track storage/.test(t), 'points to track storage for the full breakdown');
  await page.screenshot({ path: shots + '/trips-2-sheet.png' });
  await page.locator(TS + ' button[aria-label="Close"]').click(); await page.waitForTimeout(400);

  // ---- trouble codes
  await page.evaluate(() => btConnect()); await page.waitForTimeout(700);
  await page.locator('button', { hasText: 'Trouble codes' }).click(); await page.waitForTimeout(400);
  const CS = '.sheet.on[aria-label="Trouble codes"]';
  await page.locator(CS + ' button', { hasText: 'Read the codes' }).click(); await page.waitForTimeout(300);
  check(T3.codes.length === 1 && T3.codes[0].p === '32' && !T3.codes[0].clear, 'asks the K-line (your protocol) first, then the Chrysler bus: ' + JSON.stringify(T3.codes[0]));
  check(/Reading: bus \d of 2/.test(await page.locator(CS).innerText()), 'progress while reading');
  await page.waitForTimeout(1200);
  t = await page.locator(CS).innerText();
  check(/Engine computer \(12\)/i.test(t) && /ISO 9141-2/i.test(t), 'names the engine computer and its bus');
  check(/P0401/.test(t) && /EGR flow too low/.test(t) && /P0234/.test(t) && /Turbo overboost/.test(t), 'stored codes with what they mean');
  check(/P0299 \(pending\)/.test(t), 'pending code marked');
  check(/Check-engine light[\s\S]*On/.test(t) && /2 codes it says it has/.test(t), 'light on, 2 codes');
  check(/Transmission computer \(18\)/i.test(t) && /P0700/.test(t), 'the transmission\'s code from the Chrysler bus');
  check(await page.locator(CS + ' a.row[href*="P0401"]').count() === 1, 'each code links to a search');
  check(await page.evaluate(() => !!JSON.parse(localStorage.getItem('jeep.codes') || 'null')), 'kept on the phone');
  await page.screenshot({ path: shots + '/codes-1-read.png', fullPage: true });
  // clear: two taps
  const clr = page.locator(CS + ' button', { hasText: 'Clear the codes' });
  await clr.click(); await page.waitForTimeout(200);
  check(T3.codes.length === 1, 'one tap doesn\'t clear');
  await page.locator(CS + ' button', { hasText: 'Tap again to clear' }).click(); await page.waitForTimeout(1300);
  check(T3.codes.length === 2 && T3.codes[1].clear === 1, 'second tap clears');
  check(/cleared its codes/.test(await page.locator(CS).innerText()), 'shows the computers cleared');

  // ---- Safari: no Bluetooth
  const sp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  sp.on('pageerror', e => errors.push('safari pageerror: ' + e.message));
  await sp.route('https://script.google.com/**', r => r.abort());
  await sp.addInitScript(() => {
    localStorage.setItem('jeep.conn', JSON.stringify({ u: 'https://script.google.com/macros/s/TEST/exec', k: 'test-key-123', s: 'x' }));
    Object.defineProperty(navigator, 'bluetooth', { value: undefined });
    window.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };
  });
  await sp.goto('http://localhost:' + port + '/index.html');
  await sp.waitForTimeout(800);
  await sp.click('.tab[data-tab="live"]'); await sp.waitForTimeout(700);
  t = await sp.locator('#view').innerText();
  check(/Live over Wi-Fi/.test(t) && /Relay/.test(t) && /Heard the T3/.test(t), 'Safari: Live over Wi-Fi card with the relay status');
  check(!/Bluetooth needs Bluefy/.test(t), 'Safari: no "needs Bluefy" dead end');
  check(/Bluetooth instead/.test(t), 'Bluefy steps tucked away underneath');
  await sp.screenshot({ path: shots + '/safari-live.png' });

  // ---- the Map's breakdown of a trip logged without a GPS (engine numbers through the iCar only)
  const head = 'ms,up,tq,lat,lon,fix,sats,hdop,alt,kmh,crs,obd_kmh,rpm,boost,ect,iat,volt,load,lph,otemp,trip_km,ev';
  const csv = [head].concat(Array.from({ length: 601 }, (_, s) => [now - 3600e3 + s * 1000, s * 1000, 'n', '', '', 0, 0, '', '', '', '', 60 + 20 * Math.sin(s / 60),
    1800 + 400 * Math.sin(s / 50), (8 + 6 * Math.sin(s / 40)).toFixed(1), 70 + s / 40, 20, 13.9, 55, 7.5, -3, (s / 60).toFixed(3), ''].join(','))).join('\n');
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  mp.on('pageerror', e => errors.push('map pageerror: ' + e.message));
  await mp.route('https://script.google.com/**', r => {
    const b = JSON.parse(r.request().postData() || '{}');
    if (r.request().url().includes('TRACKS') && b.op === 'get') r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: b.id, csv }) });
    else if (r.request().url().includes('TRACKS') && b.op === 'list') r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, trips: [{ id: 't9-1', t0: now - 3600e3, km: 0, t3km: 10, litres: 1.25, secs: 600, fixes: 0 }] }) });
    else r.abort();
  });
  await mp.addInitScript(([trips, at]) => {
    localStorage.setItem('jeep.conn', JSON.stringify({ u: 'https://script.google.com/macros/s/TEST/exec', k: 'test-key-123', s: 'x' }));
    localStorage.setItem('jeep.data', JSON.stringify({ fill: [], serv: [], log: [], trip: trips, info: {} }));
    localStorage.setItem('jeep.trk', JSON.stringify({ u: 'https://script.google.com/macros/s/TRACKS/exec', k: 'k' }));
    localStorage.setItem('jeep.trkIndex', JSON.stringify({ at, trips: [{ id: 't9-1', t0: at - 3600e3, km: 0, t3km: 10, litres: 1.25, secs: 600, fixes: 0 }] }));
    window.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };
  }, [TRIPS, now]);
  await mp.goto('http://localhost:' + port + '/index.html');
  await mp.waitForTimeout(800);
  await mp.click('.tab[data-tab="map"]'); await mp.waitForTimeout(500);
  t = await mp.locator('#view').innerText();
  check(/10\.0 km/.test(t) && /No GPS on this trip/.test(t), 'Map list: the T3\'s distance for a no-GPS trip, and says why there\'s no route');
  await mp.click('.tab[data-tab="live"]'); await mp.waitForTimeout(400);
  await mp.locator('#view button.row', { hasText: '42.5 km' }).click(); await mp.waitForTimeout(400);
  await mp.locator('.sheet.on button', { hasText: 'Full breakdown' }).click(); await mp.waitForTimeout(1500);
  t = await mp.locator('#view').innerText();
  check(/Distance \(T3 trip meter\)/.test(t) && /10\.0 km/.test(t), 'trip: distance from the T3\'s trip meter, not 0');
  check(/Fuel/.test(t) && /1\.3 L/.test(t) && /Top RPM|rpm/.test(t), 'trip: fuel and engine tiles');
  check(/RPM/.test(t) && /Coolant/.test(t) && /Engine load/.test(t) && /Fuel rate/.test(t) && /Speed/.test(t) && /Boost/.test(t), 'trip: charts for speed, RPM, boost, coolant, load, fuel');
  check(/No GPS/.test(t), 'trip: says there was no GPS');
  await mp.screenshot({ path: shots + '/trip-nogps.png', fullPage: true });

  check(!errors.length, 'no errors in the page: ' + errors.join(' | '));
  console.log('codes_trips.js: ' + checks + ' checks, ' + failed + ' failed');
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
