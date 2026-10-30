// editor.js - the T3 screen editor end to end, against a pretend T3 on a pretend Bluetooth link.
// The pretend T3 checks every screen set with the T3's REAL screen code (firmware/T3/screens.h, compiled into
// tests/firmware/scrtool), so this proves that what you build in Heep is exactly what the T3 keeps and draws.
// Run from the repo root (tests/run.sh does):  node tests/app/editor.js <path to scrtool>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
const tool = process.argv[2];
const shots = process.env.SHOTS || '/tmp/heep-shots';
fs.mkdirSync(shots, { recursive: true });
const { DEFAULT_SCREENS, screensHash } = require(path.join(root, 't3screens.js'));
let checks = 0, failed = 0;
const check = (ok, what) => { checks++; if (!ok) { failed++; console.log('  FAIL: ' + what); } };

// ---------------------------------------------------------------- the T3's screen code
function t3Parse(list) {
  const out = execFileSync(tool, { input: list.join('\n') + '\n' }).toString().trim().split('\n');
  const hash = out.shift().split(' ')[1];
  return { hash, screens: out.map(l => { const [n, s] = l.split('\t'); return { n: n === 'BAD' ? -1 : Number(n), s }; }) };
}

// ---------------------------------------------------------------- the pretend T3
const T3 = { screens: DEFAULT_SCREENS.slice(), hash: screensHash(DEFAULT_SCREENS), pending: [], pendingN: 0, cfg: null, cmds: [], bytes: [] };
let notify = async () => {};
const hi = () => ({ t: 'hi', fw: '2.0', proto: 2, obd: true, queued: 0, up: 'not yet', upAgo: -1, totKm: 15204, upd: 'up to date (2.0)', wifi: 'off', seen: '',
  scrh: T3.hash, scrn: T3.screens.length, trk: 'not set up', fc: 1, dc: 1, ss: 60, pk: 90, br: 2, bn: 0, nf: -1, nt: 7, tz: -420, sp: 0, lw: 1, spd: 0, hm: 5,
  h16: 0, hh: 1, tf: 0, to: 0, gb: 0, li: 1, lis: 10, lfl: 5, sdm: 90, rot: 0, rf: 250, bm: 'prev,home;mark,pause;next,end', io4: 0, obdName: '', ssids: [], nets: 0, sheet: false, trkSet: false });
async function onT3Line(line) {
  const m = JSON.parse(line);
  T3.cmds.push(m.c);
  if (m.c === 'hello' || m.c === 'status') await notify(hi());
  else if (m.c === 'scr') { if (m.i === 0) T3.pending = []; T3.pendingN = m.n; T3.pending[m.i] = m.d; }
  else if (m.c === 'scrok') {
    // what firmware/T3/phone.ino does: all there, same fingerprint, every screen parses
    const list = T3.pending.slice(0, m.n);
    const t = t3Parse(list);
    let why = '';
    if (m.n !== T3.pendingN || list.filter(x => x).length !== m.n) why = 'count';
    else if (t.hash !== m.h) why = 'fingerprint';
    else if (t.screens.some(s => s.n < 0)) why = "won't parse";
    if (!why) { T3.screens = list; T3.hash = t.hash; T3.saved = t; }
    await notify(why ? { t: 'scr', ok: false, why } : { t: 'scr', ok: true, h: T3.hash, n: list.length });
  } else if (m.c === 'getscr') {
    const t = t3Parse(T3.screens);
    for (let i = 0; i < t.screens.length; i++) await notify({ t: 'scrd', i, n: t.screens.length, d: t.screens[i].s });
  } else if (m.c === 'kw') { T3.kw = (T3.kw || []).concat(m.x); await notify({ t: 'kw', x: m.x, ok: true, nano: 'saved' });
  } else if (m.c === 'cfg') { T3.cfg = m; await notify({ t: 'cfg', ok: true }); await notify(hi()); }
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
  // bytes Heep writes to the T3, 20 at a time like the real link (with a little Bluetooth delay)
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
    const rx = { writeValue: async b => { if (b.length > 20) throw new Error('write longer than 20 bytes'); await new Promise(r => setTimeout(r, 6)); await window.t3Bytes(Array.from(b)); } };
    window.__t3notify = s => { const d = new TextEncoder().encode(s); for (let i = 0; i < d.length; i += 180) { const v = new DataView(d.slice(i, i + 180).buffer); listeners.forEach(f => f({ target: { value: v } })); } };
    const dev = { name: 'Jeep T3', addEventListener() {}, gatt: { connected: true, disconnect() {}, connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async u => (/0003-/.test(u) ? tx : rx) }) }) } };
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => dev, getAvailability: async () => true } });
  });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForTimeout(800);
  const click = async (text, scope) => { await page.locator((scope || '') + ' button', { hasText: text }).last().click(); await page.waitForTimeout(250); };

  // connect over (pretend) Bluetooth and open the editor from the Live tab
  await page.click('.tab[data-tab="live"]'); await page.waitForTimeout(500);
  await page.evaluate(() => btConnect()); await page.waitForTimeout(600);
  check(T3.cmds.includes('hello'), 'Heep says hello to the T3');
  await click('Screens'); await page.waitForTimeout(400);
  check(await page.locator('text=On the T3 ✓').count() > 0, 'status says the T3 has the same (default) screens');

  // a new screen from a template, then change it
  await click('Add a screen'); await click('Two big numbers'); await page.waitForTimeout(400);
  const ED = '.sheet[aria-label="Edit screen"]', LIST = '.sheet[aria-label="T3 screens & buttons"]';
  const nameBox = page.locator(ED + ' input').first();
  await nameBox.fill('Ben,"x"|2');                // quotes, commas and pipes must not break the format
  await page.locator(ED + ' .chip').first().click();
  await page.locator(ED + ' select').first().selectOption('boost');
  await click('3', ED + ' .seg');                  // size 3
  // drag the second value 10 px left (3 px on screen per T3 pixel)
  const cv = page.locator('canvas.scr-edit'); const box = await cv.boundingBox();
  const sx = box.width / 128;
  await page.mouse.move(box.x + 100 * sx, box.y + 32 * sx); await page.mouse.down();
  await page.mouse.move(box.x + 95 * sx, box.y + 32 * sx, { steps: 3 }); await page.mouse.move(box.x + 90 * sx, box.y + 32 * sx, { steps: 3 }); await page.mouse.up();
  // a bar for RPM and a text label
  await click('Add', ED + ' .chips');
  await click('Bar', ED + ' .seg');
  await page.locator(ED + ' select').first().selectOption('rpm');
  await page.locator(ED + ' label:has-text("Bar to") input').fill('4500'); await page.locator(ED + ' label:has-text("Bar to") input').dispatchEvent('change');
  await click('Add', ED + ' .chips');
  await click('Text', ED + ' .seg');
  await page.locator(ED + ' label:has-text("Text") input').fill('ÜBER, |x|"');
  await page.waitForTimeout(300);
  await page.screenshot({ path: shots + '/editor-1-edited.png', fullPage: true });
  const st = await page.evaluate(() => scrState());
  const mine = st.list[st.list.length - 1];
  check(mine.startsWith('Ben "x" 2|1|'), 'name cleaned of separators: ' + mine.slice(0, 30));
  check(mine.split('|').length === 2 + 5, 'the new screen has 5 widgets: ' + mine);
  check(/\|v,boost,/.test(mine) && /\|b,rpm,.*,0,4500,/.test(mine) && /\|l,.*,BER   x "$/.test(mine), 'boost value, an RPM bar to 4500 and a text (Ü, commas and pipes cleaned): ' + mine);
  check(/v,otemp,(5[0-9]|6[0-5]),/.test(mine), 'drag moved the second value left (x was 65): ' + mine);

  // send everything; the pretend T3 checks it with the firmware's own parser
  await click('Send all', ED); await page.waitForTimeout(4000);
  check(T3.saved && T3.hash === screensHash(st.list), 'the T3 accepted the set with the same fingerprint');
  for (const [i, sc] of (T3.saved ? T3.saved.screens : []).entries()) {
    check(sc.n === st.list[i].split('|').length - 2, 'screen ' + (i + 1) + ': the T3 keeps every widget (' + sc.n + ')');
    // what the T3 writes back, parsed again by Heep and written out, is the same text: one format, both sides
    const back = await page.evaluate(x => writeScreen(parseScreen(x)), sc.s);
    check(back === sc.s, 'screen ' + (i + 1) + ' reads back the same in Heep: ' + back + ' vs ' + sc.s);
  }
  check(await page.locator('text=Screens are on the T3').count() > 0, 'Heep says the screens are on the T3');

  // back on the list: status, reorder, hide one, send again
  await page.locator(ED + ' button[aria-label="Close"]').click(); await page.waitForTimeout(700);
  await page.screenshot({ path: shots + '/editor-2-list.png', fullPage: true });
  check(await page.locator(LIST + ' .scr-row').count() === DEFAULT_SCREENS.length + 1, 'the list shows the new screen');
  await page.locator(LIST + ' button[aria-label="Move up"]').last().dispatchEvent('click'); await page.waitForTimeout(200);
  await page.locator(LIST + ' .scr-row [role="switch"]').first().evaluate(e => e.click()); await page.waitForTimeout(200);
  await click('Send to the T3', LIST); await page.waitForTimeout(4000);
  const st2 = await page.evaluate(() => scrState());
  check(T3.hash === screensHash(st2.list) && st2.list[0].split('|')[1] === '0' && st2.list[st2.list.length - 2].startsWith('Ben'), 'reordered, first screen hidden, and the T3 has that set: ' + [T3.hash, screensHash(st2.list), st2.list[0].slice(0, 20), st2.list[st2.list.length - 2].slice(0, 12)].join(' / '));

  // load them back from the T3
  await page.evaluate(() => { const s = scrState(); s.list = s.list.slice(0, 2); scrSave(s); });
  const got = await page.evaluate(() => loadScreensFromT3());
  check(Array.isArray(got) && got.length === T3.screens.length, 'Load from T3 brings back every screen');

  // twelve full screens (the most the T3 keeps) still go across in one go
  await page.evaluate(() => { const s = scrState(); const full = 'Full|1' + '|r,rpm,0,0,128,8,1,l,lufi,-1000,100000,ABCDEFGHIJKL'.repeat(10); s.list = Array(12).fill(full).map((x, i) => x.replace('Full', 'Full ' + i)); scrSave(s); });
  const t0 = Date.now();
  const ok = await page.evaluate(() => sendScreens(scrState()));
  check(ok && T3.screens.length === 12 && T3.saved.screens.every(s => s.n === 10), '12 screens x 10 widgets accepted (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');

  // buttons: a change goes to the T3 with the settings; secrets only travel over Bluetooth
  await page.locator(LIST + ' label:has-text("Press") select').first().selectOption('sleep');
  await page.locator(LIST + ' button', { hasText: 'Send settings to the T3' }).first().click(); await page.waitForTimeout(1500);
  check(T3.cfg && /^sleep,/.test(T3.cfg.bm), 'button 1 press = screen off/on reached the T3: ' + (T3.cfg && T3.cfg.bm));
  check(T3.cfg && Array.isArray(T3.cfg.wifi), 'over Bluetooth the Wi-Fi list is included');
  check(T3.cfg && T3.cfg.wb === 'V+,V+;AN,HU;V-,V-|PP,NX,PV,SI|11|FFFF', 'Nano settings go too (default): ' + (T3.cfg && T3.cfg.wb));

  // right buttons (the Nano): top tap = play/pause, middle hold = a Kenwood code typed in
  const R = LIST + ' .group:has(b:text-is("Right top"))', M = LIST + ' .group:has(b:text-is("Right middle"))';
  await page.locator(R + ' label:has-text("Tap") select').selectOption('PP');
  await page.locator(M + ' label:has-text("Hold") select').selectOption('K');
  await page.locator(M + ' label:has-text("Hold") input').fill('89');
  await page.locator(LIST + ' .group:has(b:text-is("Right bottom"))').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shots + '/right-buttons.png' });
  await page.locator(LIST + ' button', { hasText: /^Send settings$/ }).click(); await page.waitForTimeout(1500);
  check(T3.cfg && T3.cfg.wb === 'PP,V+;AN,K89;V-,V-|PP,NX,PV,SI|11|FFFF', 'right-button map reached the T3: ' + (T3.cfg && T3.cfg.wb));
  await notify({ t: 'live', wbs: 'saved', nano: 'ok' }); await page.waitForTimeout(1200);
  check(/Saved on the Nano ✓/.test(await page.locator(LIST).innerText()), 'says when the Nano has it');

  // the pedal, headlight mode without the left middle button, and the answer code
  const P = LIST + ' .group:has(b:text-is("Pedal"))', HL = LIST + ' .group:has(b:text-is("Headlight mode: left middle button"))', C = LIST + ' .group:has(b:text-is("Stereo codes you’ve found"))';
  await page.locator(P + ' label:has-text("1 click") select').selectOption('MU');
  await page.locator(HL + ' label:has-text("Switches the beams") select').selectOption('0');
  await page.locator(C + ' label:has-text("Hang up") input').fill('92');
  // the code tester: ▶ sends the next code; "Use as Answer" keeps it
  const codeBox = page.locator(LIST + ' input[aria-label="Code to test"]');
  await codeBox.fill('88'); await codeBox.dispatchEvent('change');
  await page.locator(LIST + ' button[aria-label="Next code"]').click(); await page.waitForTimeout(600);
  check(T3.kw && T3.kw[T3.kw.length - 1] === '89', 'code tester sent the next code: ' + (T3.kw || []).join(','));
  check(/Sent 89/.test(await page.locator(LIST).innerText()), 'says it was sent');
  // finding codes: Nothing / Save step on to the next code not tried yet (skipping known ones like 0E)
  await codeBox.fill('0D'); await codeBox.dispatchEvent('change');
  await page.locator(LIST + ' button', { hasText: 'Nothing → next' }).click(); await page.waitForTimeout(500);
  check(T3.kw[T3.kw.length - 1] === '0F', 'Nothing skips the known play/pause (0E) and sends 0F: ' + T3.kw.slice(-2).join(','));
  await page.locator(LIST + ' input[aria-label="What the code did"]').fill('band');
  await page.locator(LIST + ' button', { hasText: 'Save → next' }).click(); await page.waitForTimeout(500);
  check(T3.kw[T3.kw.length - 1] === '10' && /0F\s+band/.test(await page.locator(LIST).innerText()), 'Save keeps the note and sends the next');
  check(await page.evaluate(() => JSON.stringify(store.get('kwLog', {})) === '{"0D":"","0F":"band"}'), 'notes kept on the phone');
  await page.locator(LIST + ' button', { hasText: 'Copy the list' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: shots + '/code-finder.png' });
  check((await page.locator(LIST).innerText()).match(/0F\s+band/g).length === 1, 'the found list is drawn once');
  await codeBox.fill('89'); await codeBox.dispatchEvent('change');
  await page.locator(LIST + ' button', { hasText: 'Use as Answer' }).click();
  await page.locator(P).scrollIntoViewIfNeeded();
  await page.screenshot({ path: shots + '/nano-card.png' });
  await page.locator(LIST + ' button', { hasText: /^Send settings$/ }).click(); await page.waitForTimeout(1500);
  check(T3.cfg && T3.cfg.wb === 'PP,V+;AN,K89;V-,V-|MU,NX,PV,SI|01|8992', 'whole Nano setup reached the T3: ' + (T3.cfg && T3.cfg.wb));
  // T3 button map default has the wheel settings menu on button 2 hold
  check(T3.cfg && T3.cfg.bm.split(';')[1] !== undefined, 'button map sent');

  // a change made with the wheel menu on the T3 comes back into Heep
  await page.evaluate(() => { const v = store.get('t3', {}); v.br = 2; store.set('t3', v); });
  await notify(Object.assign(hi(), { br: 0, nf: -2, mc: 3 })); await page.waitForTimeout(400);
  check(await page.evaluate(() => store.get('t3', {}).br === 0 && store.get('t3', {}).nf === -2), 'wheel-menu changes are taken into Heep');

  check(!errors.length, 'no errors in the page: ' + errors.join(' | '));
  console.log('editor.js: ' + checks + ' checks, ' + failed + ' failed');
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

