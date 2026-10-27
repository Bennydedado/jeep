// wifi_ota.js - Live > Wi-Fi & update, end to end against a pretend T3 on a pretend Bluetooth link:
//   - a T3 on 1.5 (old text-only Wi-Fi status): the page still shows what it can, and points to the USB installer
//   - a T3 on 2.1: networks, signal, why one won't join, tips, adding a network it can see, Scan now
//   - Update over Bluetooth: the pretend T3 follows otarx.h (loses one packet on purpose so Heep has to resend),
//     checks the SHA-256, restarts, and comes back on the new version; nothing else may be written meanwhile
// Run from the repo root (tests/run.sh does):  node tests/app/wifi_ota.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
const shots = process.env.SHOTS || '/tmp/heep-shots';
fs.mkdirSync(shots, { recursive: true });
let checks = 0, failed = 0;
const check = (ok, what) => { checks++; if (!ok) { failed++; console.log('  FAIL: ' + what); } };

// the "new program" GitHub would serve: 60 KB that starts like an ESP32 image
const BIN = Buffer.alloc(60000); for (let i = 0; i < BIN.length; i++) BIN[i] = (i * 31 + 7) & 255; BIN[0] = 0xE9;
const NEW_V = '2.2';

// ---------------------------------------------------------------- the pretend T3
const T3 = { fw: '1.5', cmds: [], cfg: null, bytes: [], junk: 0,
  ota: { on: false, size: 0, got: 0, acked: 0, sha: '', data: null, pkts: 0, dropped: false, needs: 0, lastNeed: 0, v: '' } };
let notify = async () => {}, dropLink = async () => {};
const hi = () => ({ t: 'hi', fw: T3.fw, proto: 2, obd: false, queued: 0, up: 'not yet', upd: '-', wifi: T3.fw === '1.5' ? "couldn't join Bens iPhone (password?)" : 'off (nothing to send)',
  seen: "Ben’s iPhone (-63), SHAW-1234 (-81)", ssids: ['Home', 'Bens iPhone'], nets: 2, scrh: '0', scrn: 10, sheet: true, trkSet: false, sp: 0 });
const wifi = () => ({ t: 'wifi', fw: T3.fw, state: "couldn't join Home: wrong password?", on: false, scanning: false, scanAgo: 4,
  seen: [['Home', -58, 6, 0], ['Ben’s iPhone', -63, 11, 0], ['SHAW-1234', -81, 1, 0], ['Neighbours', -88, 6, 1]],
  saved: ['Home', 'Bens iPhone'], last: { ssid: 'Home', res: 'wrong password?', reason: 15, ago: 4 }, relay: 0, up: 'not yet', upd: '-', queued: 0 });
async function onT3Line(line) {
  const m = JSON.parse(line);
  T3.cmds.push(m);
  if (m.c === 'hello' || m.c === 'status') await notify(hi());
  else if (m.c === 'wifi' && T3.fw !== '1.5') await notify(wifi());
  else if (m.c === 'cfg') { T3.cfg = m; await notify({ t: 'cfg', ok: true }); await notify(hi()); }
  else if (m.c === 'ota' && m.do === 'begin' && T3.fw !== '1.5') {
    Object.assign(T3.ota, { on: true, size: m.size, got: 0, acked: 0, sha: m.sha, data: Buffer.alloc(m.size), pkts: 0, v: m.v });
    await notify({ t: 'ota', ok: true, ready: true, chunk: 182, ack: 4096 });
  }
}
// one program packet, the way firmware/T3/otarx.h + ota.ino handle it
async function onPacket(b) {
  const o = T3.ota;
  if (b.length === 4 && b.every(x => x === 255)) { o.on = false; await notify({ t: 'ota', ok: false, why: 'cancelled in Heep' }); return; }
  if (b.length < 5) return;
  o.pkts++;
  if (o.pkts === 40 && !o.dropped) { o.dropped = true; return; }          // lost on the way: Heep has to send it again
  const off = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  if (off > o.got) { if (Date.now() - o.lastNeed > 300) { o.lastNeed = Date.now(); o.needs++; await notify({ t: 'ota', need: o.got }); } return; }
  const end = Math.min(o.size, off + b.length - 4);
  if (end <= o.got) return;
  Buffer.from(b.slice(4 + (o.got - off), 4 + (end - off))).copy(o.data, o.got);
  o.got = end;
  if (o.got - o.acked >= 4096 || o.got >= o.size) { o.acked = o.got; await notify({ t: 'ota', got: o.got }); }
  if (o.got >= o.size) {
    o.on = false;
    const sha = crypto.createHash('sha256').update(o.data).digest('hex');
    if (sha !== o.sha) { await notify({ t: 'ota', ok: false, why: "the checksum didn't match" }); return; }
    T3.installed = Buffer.from(o.data);
    await notify({ t: 'ota', done: true, v: o.v });
    setTimeout(async () => { T3.fw = o.v; await dropLink(); }, 400);       // restarts into the new program
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
  await page.route('**/firmware/t3.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: NEW_V, url: 'x' }) }));
  await page.route('**/firmware/T3.bin*', r => r.fulfill({ contentType: 'application/octet-stream', body: BIN }));
  await page.exposeFunction('t3Bytes', async bytes => {
    if (T3.ota.on) {   // every write is a packet now; a JSON line here would be read as junk by the real T3
      if (bytes[0] === 0x7B && (bytes[1] === 0x22)) T3.junk++;
      await onPacket(bytes);
      return;
    }
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
    const rx = {
      writeValue: async b => { if (b.length > 20) throw new Error('writeValue longer than 20'); await new Promise(r => setTimeout(r, 2)); await window.t3Bytes(Array.from(b)); },
      writeValueWithoutResponse: async b => { if (b.length > 182) throw new Error('packet longer than the T3 allowed'); await window.t3Bytes(Array.from(b)); },
    };
    window.__t3notify = s => { const d = new TextEncoder().encode(s); for (let i = 0; i < d.length; i += 180) { const v = new DataView(d.slice(i, i + 180).buffer); listeners.forEach(f => f({ target: { value: v } })); } };
    const gatt = { connected: false, disconnect() { gatt.connected = false; },
      connect: async () => { gatt.connected = true; listeners.length = 0; return { getPrimaryService: async () => ({ getCharacteristic: async u => (/0003-/.test(u) ? tx : rx) }) }; } };
    const dev = { name: 'Jeep T3', gatt, addEventListener: (t, f) => { if (t === 'gattserverdisconnected') drops.push(f); } };
    window.__t3drop = () => { gatt.connected = false; drops.forEach(f => f()); };
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => dev, getAvailability: async () => true } });
  });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForTimeout(800);
  const W = '.sheet.on[aria-label="Wi-Fi & update"]';
  const text = () => page.locator(W).innerText();

  // ---- a T3 still on 1.5
  await page.click('.tab[data-tab="live"]'); await page.waitForTimeout(400);
  await page.evaluate(() => btConnect()); await page.waitForTimeout(700);
  await page.locator('button', { hasText: 'Wi-Fi & update' }).click(); await page.waitForTimeout(900);
  let t = await text();
  check(/Couldn’t join/.test(t) && /Bens iPhone \(password\?\)/.test(t), 'old T3: the state line is shown');
  check(/Ben’s iPhone/.test(t) && /SHAW-1234/.test(t), 'old T3: nearby networks from its text');
  check(/you saved “Bens iPhone”/.test(t), 'old T3: spots the saved name that is nearly the one it sees');
  check(/USB installer/.test(t) && !/over Bluetooth$/m.test(t) && await page.locator(W + ' button', { hasText: 'over Bluetooth' }).count() === 0, 'old T3: no Bluetooth update, USB installer offered');
  check(/2\.2 \(new\)/.test(t), 'newest version from GitHub shown: ' + (t.match(/Newest.*\n?.*/) || [''])[0]);
  await page.screenshot({ path: shots + '/wifi-1-old.png' });
  await page.locator(W + ' button', { hasText: 'Scan now' }).click(); await page.waitForTimeout(300);
  check(T3.cmds.some(c => c.c === 'update'), 'old T3: Scan now asks it to switch Wi-Fi on (update)');
  await page.locator(W + ' button[aria-label="Close"]').click(); await page.waitForTimeout(500);

  // ---- the same T3 on 2.1
  T3.fw = '2.1';
  await page.evaluate(() => send({ c: 'status' })); await page.waitForTimeout(400);
  await page.locator('button', { hasText: 'Wi-Fi & update' }).click(); await page.waitForTimeout(900);
  t = await text();
  check(/Couldn’t join/.test(t) && /Home: wrong password\?/.test(t), '2.1: headline says why');
  check(/Last try: wrong password\?/.test(t), '2.1: the saved network shows its last try');
  check(/In range · strong \(-58 dBm\) · channel 6/.test(t), '2.1: signal and channel for a saved network');
  check(/didn’t accept the password/.test(t), '2.1: password tip');
  check(await page.locator(W + ' .sig').count() >= 4, '2.1: signal bars');
  await page.screenshot({ path: shots + '/wifi-2-new.png' });
  await page.locator(W + ' button', { hasText: 'Scan now' }).click(); await page.waitForTimeout(300);
  check(T3.cmds.some(c => c.c === 'wifi' && c.scan === 1), '2.1: Scan now sends a scan request');
  // add the network it can see, with the exact name
  await page.locator(W + ' button.row', { hasText: 'SHAW-1234' }).click(); await page.waitForTimeout(500);
  await page.locator('.sheet.on[aria-label="Add Wi-Fi"] input').fill('hunter22');
  await page.locator('.sheet.on[aria-label="Add Wi-Fi"] button', { hasText: 'Save and send' }).click(); await page.waitForTimeout(1500);
  check(T3.cfg && Array.isArray(T3.cfg.wifi) && T3.cfg.wifi.includes('SHAW-1234') && T3.cfg.wifi[T3.cfg.wifi.indexOf('SHAW-1234') + 1] === 'hunter22', 'adding a seen network sends it to the T3 over Bluetooth');

  // ---- update over Bluetooth
  const before = T3.cmds.length;
  const btn = page.locator(W + ' button', { hasText: 'over Bluetooth' });
  check(await btn.count() === 1 && /Update to 2\.2 over Bluetooth/.test(await btn.innerText()), '2.1: Bluetooth update offered');
  await btn.click(); await page.waitForTimeout(150);
  await page.locator(W + ' button', { hasText: 'Tap again to start' }).click();          // tap twice to start
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !T3.installed) await page.waitForTimeout(200);
  check(!!T3.installed && T3.installed.equals(BIN), 'the T3 got the program byte for byte (SHA-256 checked)');
  check(T3.ota.needs >= 1, 'a lost packet was asked for again and resent (' + T3.ota.needs + ' resend request)');
  check(T3.junk === 0, 'nothing else was written to the T3 during the update');
  await page.waitForTimeout(600);
  await page.screenshot({ path: shots + '/wifi-3-updated.png' });
  check(/Installed 2\.2 ✓/.test(await text()), 'Heep says it is installed');
  // the T3 restarts; Heep reconnects by itself and the page sees the new version
  const t1 = Date.now();
  while (Date.now() - t1 < 15000 && !/running 2\.2 ✓/.test(await text())) await page.waitForTimeout(300);
  check(/running 2\.2 ✓/.test(await text()), 'after the restart Heep reconnects and sees 2.2');
  check(T3.cmds.slice(before).filter(c => c.c === 'hello').length >= 1, 'reconnected with hello');
  await page.screenshot({ path: shots + '/wifi-4-running.png' });

  check(!errors.length, 'no errors in the page: ' + errors.join(' | '));
  console.log('wifi_ota.js: ' + checks + ' checks, ' + failed + ' failed (update took ' + ((T3.installedAt || Date.now()) - t0) / 1000 + ' s incl. waits)');
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
