// relay_live.js - Heep in plain Safari (no Bluetooth): live numbers and "Update over Wi-Fi" through the relay,
// against a pretend T3 behind a pretend relay (MQTT over WebSocket). The pretend T3 checks every command's signature
// (HMAC-SHA256 with the sheet key, like net.ino onRelay) and answers encrypted (AES-256-GCM, like net.ino relaySend).
// Run from the repo root (tests/run.sh does):  node tests/app/relay_live.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
const shots = process.env.SHOTS || '/tmp/heep-shots';
fs.mkdirSync(shots, { recursive: true });
let checks = 0, failed = 0;
const check = (ok, what) => { checks++; if (!ok) { failed++; console.log('  FAIL: ' + what); } };

const KEY = 'test-sheet-key-123';
const hex = b => Buffer.from(b).toString('hex');
const topicBase = 'heep/' + hex(crypto.createHash('sha256').update('heep-live:' + KEY).digest()).slice(0, 32);
const LIVE_T = topicBase + '/live', CMD_T = topicBase + '/cmd';
const encKey = crypto.createHash('sha256').update('heep-enc:' + KEY).digest();
function seal(obj) {   // what relaySend() does
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return JSON.stringify({ e: Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64') });
}
function mqPublish(topic, payload) {
  const t = Buffer.from(topic), p = Buffer.from(payload);
  const body = Buffer.concat([Buffer.from([t.length >> 8, t.length & 255]), t, p]);
  const len = []; let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; len.push(d); } while (n);
  return Buffer.concat([Buffer.from([0x30, ...len]), body]);
}
// one frame Heep sent: [type, topic, payload]
function mqParse(b) {
  let mul = 1, len = 0, j = 1, byte;
  do { byte = b[j++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
  const type = b[0] >> 4;
  if (type === 3) { const tl = (b[j] << 8) | b[j + 1]; return [3, b.slice(j + 2, j + 2 + tl).toString(), b.slice(j + 2 + tl, j + len).toString()]; }
  if (type === 8) { const tl = (b[j + 2] << 8) | b[j + 3]; return [8, b.slice(j + 4, j + 4 + tl).toString(), '']; }
  return [type, '', ''];
}

// ---------------------------------------------------------------- the pretend T3 (2.4) behind the relay
const T3 = { fw: '2.4', subscribed: '', cmds: [], badSig: 0, watched: 0, lastNonce: 0 };
let push = async () => {};
async function onFrame(bytes) {
  const [type, topic, payload] = mqParse(Buffer.from(bytes));
  if (type === 8) { T3.subscribed = topic; return; }
  if (type !== 3 || topic !== CMD_T) return;
  const j = JSON.parse(payload);
  const mac = hex(crypto.createHmac('sha256', KEY).update(j.n + '|' + j.m).digest());
  if (mac !== j.h || j.n <= T3.lastNonce) { T3.badSig++; return; }
  T3.lastNonce = j.n;
  const m = JSON.parse(j.m);
  T3.cmds.push(m.c);
  if (m.c === 'watch') { T3.watched++; await push({ t: 'live', rpm: 1850, kmh: 0, src: 'obd', ect: 71, g: 0, tp: 0, pg: 0, btn: '-', bn: 0, nano: 'none', sd: 1, trip: { id: 't9-1', km: 0, l: 0, s: 0, idle: 0, vmax: 0, gkm: 0 } }); }
  else if (m.c === 'status') await push({ t: 'hi', fw: T3.fw, proto: 2, obd: true, queued: 0, wifi: 'on starlink2.4', seen: '', ssids: ['starlink2.4'], nets: 1 });
  else if (m.c === 'wifi') await push({ t: 'wifi', fw: T3.fw, state: 'on starlink2.4', on: true, ssid: 'starlink2.4', rssi: -40, ch: 11, ip: '192.168.1.122', onFor: 300, scanning: false, scanAgo: 30, seen: [['starlink2.4', -40, 11, 1]], saved: ['starlink2.4'] });
  else if (m.c === 'update') {
    const up = (phase, pct, text) => push({ t: 'upd', phase, pct, v: '2.5', text, fw: T3.fw });
    await up('wait', -1, 'starting');
    setTimeout(async () => {
      await up('check', -1, 'checking GitHub');
      for (const p of [0, 25, 50, 75, 100]) { await new Promise(r => setTimeout(r, 250)); await up('download', p, 'downloading 2.5'); }
      T3.sawDownload = true;
      await up('done', 100, 'installed 2.5, restarting');
      setTimeout(async () => { T3.fw = '2.5'; await push({ t: 'hi', fw: '2.5', proto: 2, obd: true, queued: 0, wifi: 'on starlink2.4', ssids: ['starlink2.4'], nets: 1 }); }, 1500);
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
  page.on('console', m => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_|Failed to load resource|script\.google/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://script.google.com/**', r => r.abort());
  await page.route('**/firmware/t3.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: '2.5', url: 'x' }) }));
  await page.exposeFunction('relayFrame', b => onFrame(b));
  push = obj => page.evaluate(([t, s]) => window.__relayPush(t, s), [LIVE_T, seal(obj)]);
  await page.addInitScript(([key]) => {
    localStorage.setItem('jeep.conn', JSON.stringify({ u: 'https://script.google.com/macros/s/TEST/exec', k: key, s: 'x' }));
    // no Bluetooth here: Safari
    Object.defineProperty(navigator, 'bluetooth', { value: undefined });
    let sock = null;
    window.WebSocket = class {
      constructor(url, proto) { this.url = url; this.readyState = 0; sock = this; window.__wsUrl = url; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 50); }
      send(b) { window.relayFrame(Array.from(b instanceof Uint8Array ? b : new Uint8Array(b))); }
      close() { this.readyState = 3; this.onclose && this.onclose(); }
    };
    window.WebSocket.OPEN = 1;
    window.__relayPush = (topic, payload) => {
      const t = new TextEncoder().encode(topic), p = new TextEncoder().encode(payload);
      const body = [t.length >> 8, t.length & 255, ...t, ...p];
      const len = []; let n = body.length;
      do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; len.push(d); } while (n);
      const frame = new Uint8Array([0x30, ...len, ...body]);
      if (sock && sock.onmessage) sock.onmessage({ data: frame.buffer });
    };
  }, [KEY]);
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForTimeout(800);

  // ---- Live in Safari: Heep joins the relay, says it's watching (signed), and shows what the T3 sends
  await page.click('.tab[data-tab="live"]');
  await page.waitForTimeout(2500);
  check(T3.subscribed === LIVE_T, 'Heep listens on the channel made from the sheet key: ' + T3.subscribed);
  check(T3.watched >= 1 && T3.badSig === 0, 'Heep tells the T3 it is watching, correctly signed (' + T3.watched + ' watch, ' + T3.badSig + ' bad)');
  const live = await page.locator('#view').innerText();
  check(/Over Wi-Fi/.test(live), 'Live says "Over Wi-Fi"');
  check(/1850/.test(live), 'live RPM from the T3 shows (decrypted)');
  check(T3.cmds.includes('status'), 'Heep asks the T3 for its status once it hears it');
  await page.screenshot({ path: shots + '/relay-1-live.png' });

  // ---- Update over Wi-Fi with progress, from Safari
  await page.locator('button', { hasText: 'Wi-Fi & update' }).click(); await page.waitForTimeout(1200);
  const W = '.sheet.on[aria-label="Wi-Fi & update"]';
  check(/Connected to “starlink2\.4”/.test(await page.locator(W).innerText()), 'Wi-Fi page works over the relay');
  check(await page.locator(W + ' button', { hasText: 'over Bluetooth' }).count() === 0, 'no Bluetooth update offered in Safari');
  await page.locator(W + ' button', { hasText: 'Update over Wi-Fi' }).click();
  let sawPct = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const t = await page.locator(W).innerText();
    if (/Downloading 2\.5 on the T3: (25|50|75) %/.test(t)) { sawPct = true; await page.screenshot({ path: shots + '/relay-2-downloading.png' }); break; }
    await page.waitForTimeout(100);
  }
  check(T3.cmds.includes('update'), 'the update request reached the T3, signed');
  check(sawPct, 'progress bar shows the download percentage');
  await page.waitForTimeout(1500);
  check(/Installed 2\.5 ✓|running 2\.5 ✓/.test(await page.locator(W).innerText()), 'says installed');
  const t1 = Date.now();
  while (Date.now() - t1 < 8000 && !/running 2\.5 ✓/.test(await page.locator(W).innerText())) await page.waitForTimeout(300);
  check(/The T3 is running 2\.5 ✓/.test(await page.locator(W).innerText()), 'after the restart: running 2.5');
  await page.screenshot({ path: shots + '/relay-3-done.png' });

  check(!errors.length, 'no errors in the page: ' + errors.join(' | '));
  console.log('relay_live.js: ' + checks + ' checks, ' + failed + ' failed');
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
