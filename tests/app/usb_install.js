// usb_install.js - firmware/usb.html (the step-by-step USB installer) with a pretend esptool-js and serial port:
// the right files go to the right addresses, both connect modes, skipping the helper, and clear advice when a
// step fails. (The real flashing library is Espressif's esptool-js; this checks the page around it.)
// Run from the repo root (tests/run.sh does):  node tests/app/usb_install.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
let checks = 0, failed = 0;
const check = (ok, what) => { checks++; if (!ok) { failed++; console.log('  FAIL: ' + what); } };
const man = JSON.parse(fs.readFileSync(path.join(root, 'firmware/manifest.json'), 'utf8'));
const sizes = man.builds[0].parts.map(p => fs.statSync(path.join(root, 'firmware', p.path.split('?')[0])).size);

const FAKE = `
export class Transport { constructor(port) { this.port = port; } async disconnect() { window.__log.push('disconnect'); } }
export class ESPLoader {
  constructor(o) { this.o = o; this.chip = { CHIP_NAME: 'ESP32' }; }
  async detectChip(mode) { window.__log.push('detect:' + mode); }
  async runStub() { if (window.__failStub) throw new Error('no answer'); window.__log.push('stub'); }
  async flashSpiAttach(a) { window.__log.push('attach:' + a); }
  async writeFlash(o) {
    window.__log.push('write:' + o.fileArray.map(f => f.address.toString(16) + '/' + f.data.length).join(',') + ':' + [o.flashSize, o.flashMode, o.flashFreq, o.eraseAll, o.compress].join(','));
    for (let i = 0; i < o.fileArray.length; i++) { o.reportProgress(i, 0, 100); o.reportProgress(i, 50, 100); o.reportProgress(i, 100, 100); }
  }
  async after(m) { window.__log.push('after:' + m); }
}`;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0);

(async () => {
  const port = srv.address().port, errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://unpkg.com/esptool-js@0.5.4/bundle.js', r => r.fulfill({ contentType: 'text/javascript', body: FAKE, headers: { 'access-control-allow-origin': '*' } }));
  await page.addInitScript(() => {
    window.__log = [];
    Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => { if (window.__cancel) { const e = new Error('No port selected by the user.'); e.name = 'NotFoundError'; throw e; } return { fake: true }; } } });
  });
  const run = async (setup) => {
    await page.goto('http://localhost:' + port + '/firmware/usb.html'); await page.waitForTimeout(300);
    await page.evaluate(setup || (() => {}));
    await page.click('#go');
    await page.waitForFunction(() => !document.querySelector('#go').disabled, null, { timeout: 20000 });
    return { log: await page.evaluate(() => window.__log), msg: await page.locator('#msg').innerText(), steps: await page.evaluate(() => [...document.querySelectorAll('ol.steps li')].map(l => l.className)) };
  };

  // 1. normal: reset by the page, with the helper
  let r = await run();
  const expect = 'write:' + man.builds[0].parts.map((p, i) => p.offset.toString(16) + '/' + sizes[i]).join(',') + ':keep,keep,keep,false,true';
  check(r.log.includes('detect:default_reset') && r.log.includes('stub'), 'normal: resets the T3 and starts the helper');
  check(r.log.includes(expect), 'all four files, right addresses and sizes, nothing erased: ' + r.log.find(x => x.startsWith('write')));
  check(r.log.includes('after:hard_reset') && r.log.includes('disconnect'), 'restarts the T3 and lets go of the port');
  check(/Installed T3 2\.\d ✓/.test(r.msg) && r.steps.every(c => c === 'ok'), 'says installed, every step ticked: ' + r.msg.split('\n')[0]);
  check(await page.locator('#bar').evaluate(b => b.style.width) === '100%', 'progress bar full');
  // 2. holding BOOT, skipping the helper
  r = await run(() => { document.querySelector('input[value=boot]').checked = true; document.querySelector('#nostub').checked = true; });
  check(r.log.includes('detect:no_reset') && r.log.includes('attach:0') && !r.log.includes('stub'), 'BOOT held: no reset, built-in loader, no helper');
  check(/✓/.test(r.msg), 'BOOT path installs too');
  // 3. the helper doesn't start: advice to skip it
  r = await run(() => { window.__failStub = true; });
  check(/helper didn.t start/.test(r.msg) && /Skip the helper/.test(r.msg) && r.steps[2] === 'bad', 'helper failure: says what to tick');
  check(!r.log.some(x => x.startsWith('write')) && r.log.includes('disconnect'), 'nothing written, port let go');
  // 4. no port picked
  r = await run(() => { window.__cancel = true; });
  check(/No port picked/.test(r.msg) && !r.log.length, 'cancelled port picker: clear message, nothing touched');
  check(!errors.length, 'no page errors: ' + errors.join(' | '));
  console.log('usb_install.js: ' + checks + ' checks, ' + failed + ' failed');
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
