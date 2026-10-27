'use strict';
// t3net.js - Live > Wi-Fi & update: what Wi-Fi the T3 is on, what it can see, why one of yours won't join, and
// "Update over Bluetooth" (Heep downloads the new T3 program from GitHub and sends it over the Bluetooth link,
// for when the T3 can't get onto Wi-Fi). Messages {"c":"wifi"} and {"c":"ota"}: T3.md. T3 side: net.ino, ota.ino.

const T3_BT_UPDATE_FROM = '2.1';   // the first T3 program that answers {"c":"wifi"} and takes updates over Bluetooth
function verNewer(a, b) {
  const x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}
const verAtLeast = (a, b) => !!a && !verNewer(b, a);
const pause = ms => new Promise(r => setTimeout(r, ms));
const sigWord = r => (r >= -60 ? 'strong' : r >= -70 ? 'good' : r >= -80 ? 'weak' : 'very weak');
const ssidKey = s => String(s || '').replace(/[‘’]/g, "'").trim().toLowerCase();
const ssidLoose = s => ssidKey(s).replace(/[^a-z0-9]/g, '');
function sigBars(r) {
  const n = r == null ? 0 : r >= -60 ? 4 : r >= -70 ? 3 : r >= -80 ? 2 : 1;
  return h('span', { class: 'sig', 'aria-label': n + ' of 4 bars' }, [1, 2, 3, 4].map(i => h('i', { class: i <= n ? 'on' : '' })));
}

// ---------------------------------------------------------------- what the T3 knows about Wi-Fi, from any T3 program
function wifiModel() {
  const w = LIVE.wifi && LIVE.wifiAt && Date.now() - LIVE.wifiAt < 20000 ? LIVE.wifi : null;
  if (w) return { rich: true, fw: w.fw, state: w.state || '', on: !!w.on, ssid: w.ssid || '', rssi: w.rssi, ch: w.ch, ip: w.ip, onFor: w.onFor,
    scanning: !!w.scanning, scanAgo: w.scanAgo, seen: (w.seen || []).map(([n, r, c, o]) => ({ n, r, c, o })), saved: w.saved || [], last: w.last || null, up: w.up };
  // T3 1.5 and 2.0 only send a line of text: "Ben's iPhone (-61), shop (-80)"
  const hi = LIVE.t3 || {}, st = String(hi.wifi || '');
  const seen = String(hi.seen || '').split(', ').map(x => { const m = x.match(/^(.*) \((-?\d+)\)$/); return m ? { n: m[1], r: Number(m[2]) } : null; }).filter(Boolean);
  return { rich: false, fw: hi.fw, state: st, on: /^on /.test(st), ssid: /^on /.test(st) ? st.slice(3) : '', seen, saved: hi.ssids || [], last: null, up: hi.up,
    scanAgo: hi.seen ? 0 : -1 };
}
function wifiHeadline(m) {
  if (m.on) return ['ok', 'Connected to “' + m.ssid + '”', [m.rssi != null ? sigWord(m.rssi) + ' signal (' + m.rssi + ' dBm)' : '', m.onFor != null ? 'for ' + dur(m.onFor) : '', m.ip || ''].filter(Boolean).join(' · ')];
  const s = m.state;
  if (m.scanning || /^looking/.test(s)) return ['soon', 'Looking for your Wi-Fi…', 'Scanning the 2.4 GHz channels'];
  let x = s.match(/asking for (.*) by name$/);
  if (x) return ['soon', 'Asking for “' + x[1] + '” by name…', 'None of yours showed up in the scan, so the T3 calls it directly (a hidden iPhone hotspot can still answer)'];
  if ((x = s.match(/^joining (.*)$/))) return ['soon', 'Joining “' + x[1] + '”…', 'Takes a few seconds'];
  if (/^couldn.t join/.test(s)) return ['due', 'Couldn’t join', s.replace(/^couldn.t join /, '')];
  if (/^none of yours/.test(s)) return ['due', 'None of your networks in range', 'See what it can see below'];
  if (/^lost/.test(s)) return ['due', 'Lost the connection', s.replace(/^lost /, 'Was on ')];
  return ['', 'Wi-Fi is off right now', 'The T3 only turns Wi-Fi on when it has something to send or update, or when you tap Scan now.'];
}
function wifiTips(m) {
  const tips = [], last = m.last || {}, why = (last.res || '') + ' ' + m.state;
  const seenKeys = m.seen.map(x => ssidKey(x.n));
  const savedSeen = m.saved.filter(s => seenKeys.includes(ssidKey(s)));
  if (!m.saved.length) tips.push('No Wi-Fi saved on the T3 yet. Tap a network below to add it, or Edit networks.');
  if (/password/.test(why)) tips.push('“' + (last.ssid || m.ssid || 'That network') + '” answered but didn’t accept the password. Check it in Edit networks (capitals count), then send it again over Bluetooth.');
  if (/security|Maximize/.test(why)) tips.push('iPhone hotspot: Settings > Personal Hotspot > turn on Maximize Compatibility. Without it newer iPhones use 5 GHz or WPA3, which the T3 can’t join.');
  // a saved name that's nearly, but not exactly, one it can see
  for (const s of m.saved) {
    if (seenKeys.includes(ssidKey(s))) continue;
    const near = m.seen.find(x => ssidLoose(x.n) === ssidLoose(s));
    if (near) tips.push('The T3 sees “' + near.n + '” but you saved “' + s + '”. Names have to match: tap “' + near.n + '” below to save it with the right name.');
  }
  if (m.saved.length && m.scanAgo >= 0 && !savedSeen.length && !m.on)
    tips.push('None of your networks showed up in the last scan. For the iPhone hotspot: open Settings > Personal Hotspot and stay on that screen while you tap Scan now (iPhones hide the hotspot otherwise), with Maximize Compatibility on. The T3 only hears 2.4 GHz.');
  const weak = m.on && m.rssi != null && m.rssi < -78 ? m.ssid : (m.seen.find(x => m.saved.some(s => ssidKey(s) === ssidKey(x.n)) && x.r < -80) || {}).n;
  if (weak) tips.push('“' + weak + '” is weak where the T3 is. Below about -80 dBm it struggles: closer to the house or the phone helps.');
  return tips;
}

// ---------------------------------------------------------------- the page
function wifiSheet() {
  let latest = null, latestTried = false;
  const ui = { phase: 'idle', pct: 0, text: '', v: '' };
  openSheet({
    title: 'Wi-Fi & update',
    onClose: () => { LIVE.onWifi = null; LIVE.onUpd = null; clearInterval(LIVE.wifiTimer); if (!LIVE.otaBusy) LIVE.onHi = null; },
    build(b) {
      const head = h('div'), nets = h('div'), near = h('div'), tips = h('div'), prog = h('div');
      const scanBtn = h('button', { class: 'btn btn-primary', onclick: () => scanNow() }, icon('sync'), 'Scan now');
      const paint = () => {
        const via = t3Via(), m = wifiModel();
        head.textContent = ''; nets.textContent = ''; near.textContent = ''; tips.textContent = '';
        if (!via) {
          head.append(h('div', { class: 'card' }, h('p', { class: 'foot', style: 'margin:0', text: LIVE.updWaitUntil > Date.now() ? 'The T3 is busy updating over Wi-Fi. Heep reconnects as soon as it’s back.' : 'Connect to the T3 first: Live > Connect over Bluetooth (in Bluefy), or have the T3 on your hotspot.' })));
        } else {
          const [kind, title, sub] = wifiHeadline(m);
          head.append(h('div', { class: 'card list' }, h('div', { class: 'row' },
            h('div', { class: 'main' }, h('b', { text: title }), h('span', { class: 'wrap', text: sub })),
            m.on && m.rssi != null ? sigBars(m.rssi) : h('span', { class: 'pill ' + kind }, h('i')))));
          // your networks, in the order the T3 tries them
          const seenBy = k => m.seen.find(x => ssidKey(x.n) === k);
          nets.append(h('div', { class: 'label', text: 'Your networks (tried in this order)' }));
          if (!m.saved.length) nets.append(h('div', { class: 'card' }, h('p', { class: 'foot', style: 'margin:0', text: 'None saved on the T3.' })));
          else nets.append(h('div', { class: 'card list' }, m.saved.map(s => {
            const x = seenBy(ssidKey(s)), here = m.on && ssidKey(m.ssid) === ssidKey(s);
            const lastTry = m.last && ssidKey(m.last.ssid) === ssidKey(s) ? 'Last try: ' + m.last.res + (m.last.ago != null ? ' · ' + ago(Date.now() - m.last.ago * 1000) : '') : '';
            const line = here ? 'Connected now' : x ? 'In range · ' + sigWord(x.r) + ' (' + x.r + ' dBm)' + (x.c ? ' · channel ' + x.c : '') : m.scanAgo >= 0 ? 'Not in the last scan' : 'Not scanned yet';
            return h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: s }), h('span', { class: 'wrap', text: line + (lastTry ? '\n' + lastTry : '') })),
              x || here ? sigBars(here ? m.rssi : x.r) : h('span', { class: 'pill due' }, h('i')));
          })));
          // everything nearby
          const savedKeys = m.saved.map(ssidKey);
          near.append(h('div', { class: 'label', text: 'Wi-Fi the T3 can see' + (m.scanAgo > 0 ? ' (' + ago(Date.now() - m.scanAgo * 1000) + ')' : '') }));
          if (!m.seen.length) near.append(h('div', { class: 'card' }, h('p', { class: 'foot', style: 'margin:0', text: m.scanAgo >= 0 ? 'Nothing: no 2.4 GHz Wi-Fi where the T3 is.' : 'Nothing yet: tap Scan now.' })));
          else near.append(h('div', { class: 'card list' }, m.seen.slice(0, 12).map(x => {
            const mine = savedKeys.includes(ssidKey(x.n));
            return h('button', { class: 'row', onclick: () => mine ? t3Setup() : addNetSheet(x.n) },
              h('div', { class: 'main' }, h('b', { text: x.n }), h('span', { text: (mine ? 'Saved · ' : 'Tap to add · ') + x.r + ' dBm' + (x.c ? ' · ch ' + x.c : '') + (x.o ? ' · open' : '') })),
              sigBars(x.r));
          })));
          const t = wifiTips(m);
          if (!m.rich && verNewer(T3_BT_UPDATE_FROM, m.fw || '0')) t.push('This T3 has ' + (m.fw || 'an old program') + '. From ' + T3_BT_UPDATE_FROM + ' it shows a live scan here, signal bars and the exact reason a network won’t join.');
          if (t.length) tips.append(h('div', { class: 'label', text: 'What to try' }), h('div', { class: 'card tips' }, t.map(x => h('p', { text: x }))));
        }
        scanBtn.disabled = !via || LIVE.otaBusy;
        paintProg();
      };
      const paintProg = () => {
        prog.textContent = '';
        const fw = LIVE.fw || (LIVE.t3 && LIVE.t3.fw) || '', via = t3Via();
        const canBt = via === 'bt' && verAtLeast(fw, T3_BT_UPDATE_FROM);
        const newer = latest && latest.v && fw && verNewer(latest.v, fw);
        prog.append(h('div', { class: 'label', text: 'T3 program' }), h('div', { class: 'card list' },
          h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: 'On the T3' })), h('div', { class: 'end' }, h('span', { text: fw || (via ? '…' : 'not connected') }))),
          h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: 'Newest' })), h('div', { class: 'end' }, h('span', { text: latest ? latest.v + (newer ? ' (new)' : fw && latest.v === fw ? ' ✓ up to date' : '') : latestTried ? 'phone offline?' : 'checking…' })))));
        if (ui.phase !== 'idle') {
          const bar = h('div', { class: 'bar' + (ui.phase === 'fail' ? ' due' : '') }, h('i', { style: 'width:' + Math.round(ui.pct * 100) + '%' }));
          prog.append(h('div', { class: 'card ota' }, h('b', { text: ui.title || '' }), bar, h('p', { class: 'foot', style: 'margin:0', text: ui.text }),
            ui.phase === 'send' || ui.phase === 'download' ? h('button', { class: 'btn btn-small btn-glass glass btn-danger', onclick: () => { LIVE.otaCancel = true; } }, icon('x'), 'Cancel') : null));
        }
        if (ui.phase === 'idle' || ui.phase === 'fail' || ui.phase === 'done') {
          if (canBt) {
            // two taps (the page repaints every few seconds, so the first tap is remembered here, not in the button)
            const armed = ui.armedAt && Date.now() - ui.armedAt < 6000;
            prog.append(h('button', { class: 'btn btn-primary btn-wide', onclick: () => {
              if (armed) { ui.armedAt = 0; runBtUpdate(); } else { ui.armedAt = Date.now(); paintProg(); setTimeout(paintProg, 6100); }
            } }, icon('bt'), armed ? 'Tap again to start' : newer ? 'Update to ' + latest.v + ' over Bluetooth' : 'Reinstall ' + fw + ' over Bluetooth'),
            h('p', { class: 'foot', text: 'About 2-4 minutes. Keep Heep open and the phone near the T3, with the Jeep parked. If anything goes wrong the T3 simply keeps the program it has.' }));
          }
          else if (via === 'bt' && fw) prog.append(h('p', { class: 'foot', text: 'This T3 has ' + fw + ', which can only update over Wi-Fi or USB. Once it has ' + T3_BT_UPDATE_FROM + ' or newer, updates can come over Bluetooth from here. No Wi-Fi? Plug the T3 into a computer and use the USB installer once:' }),
            h('a', { class: 'btn btn-glass glass btn-wide', href: 'firmware/', target: '_blank', rel: 'noopener' }, icon('link'), 'USB installer (Chrome on a computer)'));
          else if (via === 'net') prog.append(h('p', { class: 'foot', text: 'Updating over Bluetooth needs Heep connected to the T3 by Bluetooth (Bluefy).' }));
        }
        // ---- update over Wi-Fi: the T3 downloads it itself and reports how far it got (T3 2.4+)
        const wuBusy = ['asked', 'wait', 'check', 'download', 'done', 'restart'].includes(wu.phase) && !(wu.phase === 'done' && wu.confirmed);
        if (wu.phase !== 'idle') {
          const title = {
            asked: 'Asking the T3…', wait: 'The T3 is getting on Wi-Fi…', check: 'The T3 is checking GitHub…',
            download: 'Downloading ' + (wu.v || 'the update') + ' on the T3: ' + Math.max(0, wu.pct) + ' %',
            done: wu.confirmed ? 'The T3 is running ' + wu.v + ' ✓' : 'Installed ' + (wu.v || '') + ' ✓ restarting…', current: 'Already up to date' + (wu.v ? ' (' + wu.v + ')' : ''),
            fail: 'Didn’t update', old: 'Asked the T3 to update', quiet: 'Lost touch with the T3',
            restart: 'The T3 is updating itself over Wi-Fi…',
          }[wu.phase] || wu.phase;
          const pct = wu.phase === 'download' ? Math.max(0, wu.pct) / 100 : wu.phase === 'done' || wu.phase === 'current' ? 1 : wu.phase === 'check' ? .04 : wu.phase === 'wait' ? .02 :
            wu.phase === 'restart' ? Math.min(.9, .03 + (Date.now() - (wu.restartAt || Date.now())) / 120000) : 0;
          const text = {
            asked: 'Sent. Waiting for the T3 to answer.', wait: (wu.text || 'Getting on Wi-Fi') + '. It uses your networks above.', check: 'Looking for a newer program.',
            download: 'Keep the T3 powered. It installs and restarts by itself; Heep can close.', done: wu.confirmed ? 'Updated over Wi-Fi.' : 'Back in a few seconds' + (via === 'net' ? ' (the relay reconnects by itself)' : '') + '.',
            current: 'Nothing new on GitHub.', fail: (wu.text || 'It stopped') + '. The T3 keeps the program it has.',
            old: 'This T3 (' + (wu.from || '?') + ') doesn’t report progress: it downloads the update when it’s on Wi-Fi and restarts by itself. Watch “On the T3” above change.',
            quiet: 'No word from the T3 for a minute. If it was downloading it carries on and restarts by itself.',
            restart: 'It restarted to do it before anything else starts (so there’s memory to spare): it joins your Wi-Fi, downloads, and restarts into the new program. Its screen shows how far it is, about 1-2 minutes. Bluetooth drops meanwhile; Heep reconnects by itself.',
          }[wu.phase] || '';
          prog.append(h('div', { class: 'card ota' }, h('b', { text: title }),
            h('div', { class: 'bar' + (wu.phase === 'fail' || wu.phase === 'quiet' ? ' due' : '') }, h('i', { style: 'width:' + Math.round(pct * 100) + '%' })),
            h('p', { class: 'foot', style: 'margin:0', text })));
        }
        if (via && !wuBusy && ui.phase !== 'send' && ui.phase !== 'download') prog.append(h('button', { class: 'btn ' + (canBt ? 'btn-glass glass' : 'btn-primary') + ' btn-wide', onclick: () => {
          Object.assign(wu, { phase: 'asked', pct: 0, text: '', v: latest && latest.v, from: fw, askedAt: Date.now(), lastAt: Date.now(), confirmed: false, restartAt: 0 });
          if (verAtLeast(fw, '2.8')) LIVE.updWaitUntil = Date.now() + 300000;   // it restarts to update: keep reconnecting meanwhile
          t3Send({ c: 'update' });
          paintProg();
        } }, icon('download'), 'Update over Wi-Fi' + (newer ? ' to ' + latest.v : '')),
        h('p', { class: 'foot', text: 'The T3 downloads it itself on your Wi-Fi or hotspot. Works from Safari too (through the relay). Not while driving.' }));
      };
      const wu = { phase: 'idle', pct: 0 };
      LIVE.onUpd = m => {
        Object.assign(wu, { phase: m.phase === 'none' ? wu.phase : m.phase, pct: m.pct, text: m.text, v: m.v || wu.v, lastAt: Date.now() });
        if (m.phase === 'restart' && !wu.restartAt) wu.restartAt = Date.now();
        if (m.phase === 'fail' || m.phase === 'current') LIVE.updWaitUntil = 0;
        paintProg();
      };
      // older T3s never answer with progress; and a T3 that goes quiet mid-way is said so
      const wuWatch = () => {
        if (wu.phase === 'asked' && Date.now() - wu.askedAt > 20000) { wu.phase = 'old'; paintProg(); }
        else if (['wait', 'check', 'download'].includes(wu.phase) && Date.now() - wu.lastAt > 60000) { wu.phase = 'quiet'; paintProg(); }
        if ((wu.phase === 'done' || wu.phase === 'quiet' || wu.phase === 'old' || wu.phase === 'restart') && wu.v && LIVE.fw === wu.v && !wu.confirmed) { wu.phase = 'done'; wu.confirmed = true; LIVE.updWaitUntil = 0; paintProg(); }
        // 2.8+: after its fresh start the T3 says how it went in "hi" (upd)
        else if (wu.phase === 'restart' && wu.restartAt && LIVE.t3 && LIVE.t3At > wu.restartAt + 5000) {
          const said = String(LIVE.t3.upd || '');
          if (LIVE.fw && wu.from && LIVE.fw !== wu.from) { wu.phase = 'done'; wu.v = LIVE.fw; wu.confirmed = true; LIVE.updWaitUntil = 0; }
          else if (/^up to date/.test(said)) { wu.phase = 'current'; wu.v = LIVE.fw; LIVE.updWaitUntil = 0; }
          else if (said && !/restarting/.test(said)) { wu.phase = 'fail'; wu.text = said; LIVE.updWaitUntil = 0; }
          paintProg();
        }
        else if (wu.phase === 'restart' && wu.restartAt && Date.now() - wu.restartAt > 300000) { wu.phase = 'quiet'; LIVE.updWaitUntil = 0; paintProg(); }
        else if (wu.phase === 'restart') paintProg();
      };
      const setUi = (phase, pct, title, text) => { Object.assign(ui, { phase, pct, title, text }); paintProg(); };
      const runBtUpdate = async () => {
        wake(true);
        try { ui.v = await btUpdate(setUi); ui.confirmed = false; } catch (e) { setUi('fail', ui.pct, 'Update didn’t finish', (e && e.message) || String(e)); toast('T3 update stopped', (e && e.message) || '', 'bad'); }
      };
      const scanNow = () => {
        if (!t3CanSend()) { toast('Not connected to the T3', '', 'bad'); return; }
        if (verAtLeast(LIVE.fw, T3_BT_UPDATE_FROM)) t3Send({ c: 'wifi', scan: 1 });
        else t3Send({ c: 'update' });   // older T3s: switching Wi-Fi on (to look for an update) also scans
        toast('Scanning', 'The T3 looks for Wi-Fi and tries yours: a few seconds', 'info');
      };
      put(b, head, h('div', { class: 'btn-row' }, scanBtn, h('button', { class: 'btn btn-glass glass', onclick: () => t3Setup() }, icon('sliders'), 'Edit networks')),
        nets, near, tips, prog);
      LIVE.onWifi = paint; LIVE.onHi = paint;
      paint();
      const ask = () => { if (LIVE.otaBusy || !t3CanSend()) return; t3Send(verAtLeast(LIVE.fw, T3_BT_UPDATE_FROM) ? { c: 'wifi' } : { c: 'status' }); };
      ask();
      clearInterval(LIVE.wifiTimer);
      LIVE.wifiTimer = setInterval(() => {
        ask();
        if (ui.phase === 'done' && ui.v && LIVE.fw === ui.v && !ui.confirmed) { ui.confirmed = true; setUi('done', 1, 'The T3 is running ' + ui.v + ' ✓', 'Updated over Bluetooth and back on.'); }
        wuWatch();
        paint();
      }, 3000);
      latestT3().then(x => { latest = x; latestTried = true; paintProg(); });
    },
  });
}

// add a network the T3 can see (name from the scan, so it's exactly right) and send it over Bluetooth
function addNetSheet(name) {
  openSheet({
    title: 'Add Wi-Fi',
    build(b, sheet) {
      const pass = textRow('Password', { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
      put(b, h('div', { class: 'group' }, h('div', { class: 'gr' }, h('span', { text: 'Name' }), h('b', { text: name })), pass.row),
        h('p', { class: 'foot', text: 'Saved on this phone and sent to the T3 over Bluetooth only. It tries your networks in order; this one goes last.' }),
        h('button', { class: 'btn btn-primary btn-wide', onclick: async () => {
          const s = store.get('t3', {});
          const list = (Array.isArray(s.nets) ? s.nets : []).filter(x => x && x[0] && ssidKey(x[0]) !== ssidKey(name));
          if (list.length >= 8) { toast('The T3 keeps 8 networks', 'Remove one in Edit networks first', 'bad'); return; }
          list.push([name, pass.input.value]);
          s.nets = list; store.set('t3', s);
          sheet.close();
          if (t3Via() === 'bt') { await t3SendSettings(); if (verAtLeast(LIVE.fw, T3_BT_UPDATE_FROM)) t3Send({ c: 'wifi', scan: 1 }); }
          else toast('Saved on this phone', 'Connect over Bluetooth and Send settings: Wi-Fi passwords only go over Bluetooth', 'info');
        } }, icon('bt'), 'Save and send to the T3'));
      setTimeout(() => pass.input.focus(), 300);
    },
  });
}

// ---------------------------------------------------------------- update over Bluetooth
async function latestT3() {
  try { const r = await fetch('firmware/t3.json?t=' + Date.now(), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
// one T3 message of kind "ota" in answer to `obj`
function otaAsk(obj, ms) {
  return new Promise(res => {
    const t = setTimeout(() => { LIVE.onOta = null; res({ ok: false, why: 'the T3 didn’t answer: is it on 2.1 or newer?' }); }, ms);
    LIVE.onOta = m => { clearTimeout(t); LIVE.onOta = null; res(m); };
    send(obj);
  });
}
function otaWrite(p) {
  const rx = LIVE.rx;
  if (!rx) return Promise.reject(new Error('gone'));
  return rx.writeValueWithoutResponse ? rx.writeValueWithoutResponse(p) : rx.writeValue(p);
}
// T3 2.4 and 2.5 keep Wi-Fi and the relay running, which can leave too little memory to take an update over Bluetooth.
// Switch "Live over Wi-Fi" off on the T3 for a minute (that closes Wi-Fi and frees the memory), try again, and put it back
// after the update (t3Message, on the first "hi" from the new program).
async function makeRoom(ui, begin) {
  const lw = Number(t3Cfg().lw) ? 1 : 0;
  store.set('restoreLw', lw);
  LIVE.makingRoom = true;   // until the update is over: the T3's "hi" mustn't switch it straight back on
  const quiet = LIVE.onCfg; LIVE.onCfg = () => {};
  await send({ c: 'cfg', lw: 0, lwu: 1 });   // 2.7+: only until it restarts
  LIVE.onCfg = quiet;
  const step = LIVE.otaRetryMs || 15000;
  let ready = { ok: false };
  for (let i = 0; i < 6 && !ready.ok; i++) {
    for (let t = step; t > 0; t -= 1000) {
      ui('send', 0, 'Making room on the T3', 'Its Wi-Fi is switching off for a moment so the update fits in its memory. Trying again in ' + Math.ceil(t / 1000) + ' s…');
      await pause(Math.min(1000, t));
    }
    if (!LIVE.rx) break;
    ready = await otaAsk(begin, 8000);
    if (!ready.ok && !/memory|busy/.test(ready.why || '')) break;
  }
  if (!ready.ok) { LIVE.makingRoom = false; await send({ c: 'cfg', lw }); store.del('restoreLw'); }
  return ready;
}
// download the newest program, send it in numbered packets, go back when the T3 says one went missing
async function btUpdate(ui) {
  if (t3Via() !== 'bt') throw new Error('Connect to the T3 over Bluetooth first.');
  ui('download', 0, 'Downloading', 'Getting the newest T3 program from GitHub…');
  const meta = await latestT3();
  if (!meta || !meta.v) throw new Error('Couldn’t reach GitHub. Is the phone online?');
  const r = await fetch('firmware/T3.bin?v=' + encodeURIComponent(meta.v) + '&t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('Couldn’t download the program (' + r.status + ').');
  const bin = new Uint8Array(await r.arrayBuffer());
  if (bin.length < 4096 || bin[0] !== 0xE9) throw new Error('The download isn’t a T3 program.');
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bin))].map(x => x.toString(16).padStart(2, '0')).join('');
  ui('send', 0, 'Starting', 'Asking the T3 to get ready…');
  const begin = { c: 'ota', do: 'begin', size: bin.length, sha, v: meta.v };
  let ready = await otaAsk(begin, 8000);
  if (!ready.ok && /memory/.test(ready.why || '')) ready = await makeRoom(ui, begin);
  if (!ready.ok) throw new Error('The T3 said: ' + (ready.why || 'no'));
  const body = Math.max(16, (ready.chunk || 20) - 4), WINDOW = Math.min(16384, ready.win || 16384);
  const st = { acked: 0, need: null, done: false, fail: null, last: Date.now() };
  LIVE.otaBusy = true; LIVE.otaCancel = false;
  LIVE.onOta = m => { st.last = Date.now(); if (m.got != null) st.acked = Math.max(st.acked, m.got); if (m.need != null) st.need = m.need; if (m.done) st.done = true; if (m.ok === false) st.fail = m.why || 'stopped'; };
  const t0 = Date.now();
  let off = 0, fails = 0, shown = 0;
  try {
    while (!st.done && !st.fail) {
      if (!LIVE.rx) throw new Error('Bluetooth dropped. The T3 keeps the program it has: reconnect and try again.');
      if (LIVE.otaCancel) { await otaWrite(new Uint8Array([255, 255, 255, 255])).catch(() => {}); throw new Error('Cancelled. The T3 keeps the program it has.'); }
      if (st.need != null) { off = st.need; st.need = null; }
      if (off >= bin.length || off - st.acked >= WINDOW) {
        // waiting for the T3 to catch up; if it's gone quiet, send again from what it last confirmed
        if (Date.now() - st.last > 3000) { off = st.acked; st.last = Date.now(); }
        await pause(15);
      } else {
        const n = Math.min(body, bin.length - off);
        const p = new Uint8Array(4 + n);
        new DataView(p.buffer).setUint32(0, off, true);
        p.set(bin.subarray(off, off + n), 4);
        try { await otaWrite(p); off += n; fails = 0; } catch (e) { if (++fails > 60) throw new Error('Bluetooth keeps refusing to send. Move the phone closer and try again.'); await pause(40); }
      }
      if (Date.now() - shown > 300) {
        shown = Date.now();
        const s = (Date.now() - t0) / 1000, rate = st.acked / Math.max(1, s), left = rate > 0 ? (bin.length - st.acked) / rate : 0;
        ui('send', st.acked / bin.length, 'Sending ' + meta.v + ' to the T3: ' + Math.floor(st.acked / bin.length * 100) + ' %',
          Math.round(st.acked / 1024) + ' of ' + Math.round(bin.length / 1024) + ' KB · ' + (rate / 1024).toFixed(1) + ' KB/s' + (s > 3 ? ' · about ' + dur(Math.ceil(left)) + ' left' : ''));
      }
    }
    if (st.fail) throw new Error('The T3 stopped: ' + st.fail + '. It keeps the program it has.');
  } finally { LIVE.otaBusy = false; LIVE.onOta = null; LIVE.makingRoom = false; }
  ui('done', 1, 'Installed ' + meta.v + ' ✓', 'The T3 is restarting into it and Heep reconnects by itself. If it doesn’t start properly, it goes back to the old program on its own.');
  toast('T3 updated to ' + meta.v, 'Restarting…');
  return meta.v;
}

if (typeof module !== 'undefined') module.exports = { verNewer, wifiTips, ssidKey };
