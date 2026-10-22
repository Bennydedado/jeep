'use strict';
// live.js - the T3 in the Jeep over Bluetooth (Nordic UART, one JSON message per line), and a demo.
// The messages are written up in T3.md.

const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // app -> T3
const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // T3 -> app
const LIVE = { mode: null, status: '', dev: null, rx: null, buf: '', dec: null, v: {}, at: 0, fw: '', els: null, sim: null, timer: 0, tries: 0, wake: null };
const hasBT = () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice);

// what each value is, and how full its bar gets
const GAUGES = [
  ['rpm', 'RPM', 'engine', '', 0, 4500],
  ['boost', 'Boost', 'turbo', 'psi', 1, 25],
  ['ect', 'Coolant', 'temp', '°C', 0, 120],
  ['iat', 'Intake', 'temp', '°C', 0, 60],
  ['v', 'Battery', 'battery', 'V', 1, 15],
  ['load', 'Load', 'gauge', '%', 0, 100],
];

function renderLive(v) {
  const on = !!LIVE.mode;
  v.append(titleRow('Live', on ? (LIVE.mode === 'demo' ? 'Demo, made-up numbers' : LIVE.status + (LIVE.fw ? ' · T3 ' + LIVE.fw : '')) : 'Straight from the T3 in the Jeep'));
  topBanners(v);
  v.append(h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary', onclick: t3Setup }, icon('sliders'), 'Wi-Fi & setup'),
    h('button', { class: 'btn btn-glass glass', onclick: t3Guide }, icon('info'), 'Guide')));
  if (!on) {
    if (hasBT()) {
      v.append(card(h('div', { class: 'empty', style: 'padding:16px 6px' },
        h('div', { class: 'ico' }, icon('bt')), h('h3', { text: 'Connect to the T3' }),
        h('p', { text: 'Turn the key so the T3 is powered, then tap Connect and pick Jeep T3. With the T3 on your hotspot, its numbers also show up here by themselves.' }),
        h('div', { class: 'btn-row', style: 'width:100%' },
          h('button', { class: 'btn btn-primary', onclick: btConnect }, icon('bt'), 'Connect'),
          h('button', { class: 'btn btn-glass glass', onclick: demoStart }, icon('play'), 'Demo')))));
    } else {
      const link = setupLink();
      v.append(card(cardHead('Bluetooth needs Bluefy', null),
        h('p', { class: 'foot', style: 'margin:0 0 14px', text: 'With the T3 on your iPhone hotspot, its live numbers show up here by themselves (it uses a little cell data). For Bluetooth instead, use Bluefy: Apple doesn\'t let Safari talk to Bluetooth devices.' }),
        h('ol', { class: 'steps' },
          h('li', null, h('div', null, 'Install ', h('a', { class: 'link', href: 'https://apps.apple.com/app/id1492822055', target: '_blank', rel: 'noopener', text: 'Bluefy' }), ' from the App Store.')),
          h('li', null, h('div', null, 'Copy this link and open it in Bluefy. It brings your Jeep log along.',
            h('div', { class: 'copy-line', style: 'margin-top:8px' }, h('code', { text: link.replace(/#.*/, '#setup=…') }),
              h('button', { class: 'btn btn-small btn-glass glass', onclick: e => copyText(link, e.currentTarget) }, icon('copy'), 'Copy')))),
          h('li', null, h('div', { text: 'With the key on, tap Connect and pick Jeep T3.' }))),
        h('button', { class: 'btn btn-glass glass btn-wide', style: 'margin-top:16px', onclick: demoStart }, icon('play'), 'Try the demo')));
    }
  } else {
    const e = LIVE.els = {};
    const big = (k, ic, label, unit) => {
      e[k] = h('div', { class: 'v' }, '—');
      e[k + 'u'] = h('div', { class: 'u', text: unit });
      return h('div', { class: 'live-big card' }, h('div', { class: 'k' }, icon(ic), label), e[k], e[k + 'u']);
    };
    v.append(h('div', { class: 'live-hero' }, big('econ', 'drop', 'Fuel now', 'L/100 km'), big('kmh', 'speed', 'Speed', 'km/h')));
    v.append(h('div', { class: 'live-grid' }, GAUGES.map(([k, label, ic, unit]) => {
      e[k] = h('span', null, '—');
      e[k + 'b'] = h('i', { style: 'width:0%' });
      return h('div', { class: 'tile card' }, h('div', { class: 'k' }, icon(ic), label), h('div', { class: 'v num' }, e[k], unit ? h('small', { text: unit }) : null), h('div', { class: 'bar' }, e[k + 'b']));
    })));
    const tripCell = (k, label) => { e['t' + k] = h('b', { text: '—', class: 'num', style: 'font-size:20px' }); return h('div', null, h('div', { class: 'small muted', text: label }), e['t' + k]); };
    v.append(card(cardHead('This trip', null),
      h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px' }, tripCell('km', 'Distance'), tripCell('s', 'Time'), tripCell('l', 'Diesel'), tripCell('avg', 'L/100 km')),
      h('div', { class: 'btn-row', style: 'margin-top:14px' },
        LIVE.mode === 'net' ? null : h('button', { class: 'btn btn-small btn-glass glass', onclick: () => { if (LIVE.mode === 'demo') LIVE.sim.trip = { km: 0, l: 0, s: 0, idle: 0 }; else send({ c: 'reset' }); } }, 'Reset trip'),
        h('button', { class: 'btn btn-small btn-glass glass btn-danger', onclick: liveStop }, icon('stop'), LIVE.mode === 'demo' ? 'Stop demo' : LIVE.mode === 'net' ? 'Stop' : 'Disconnect'))));
    updateLive();
  }
  // trips the T3 has logged
  const trips = S.data.trip.slice().sort((a, b) => (num(b.t1) || 0) - (num(a.t1) || 0)).slice(0, 20);
  if (trips.length) {
    v.append(h('div', { class: 'month' }, h('b', { text: 'Trips' }), h('span', { text: fmt0(trips.reduce((s, t) => s + (num(t.km) || 0), 0)) + ' km' })));
    v.append(h('div', { class: 'card list' }, trips.map(t => {
      const km = num(t.km) || 0, l = num(t.lit) || 0, s = ((num(t.t1) || 0) - (num(t.t0) || 0)) / 1000;
      return h('div', { class: 'row' },
        h('div', { class: 'main' }, h('b', { text: fmtDay(num(t.t1)) + ', ' + fmtTime(num(t.t1)) }), h('span', { text: (s > 0 ? dur(s) : '') + (num(t.vmax) ? ' · top ' + num(t.vmax) + ' km/h' : '') + (num(t.idle) ? ' · idle ' + num(t.idle) + ' min' : '') })),
        h('div', { class: 'end' }, h('b', { text: fmt1(km) + ' km' }), h('span', { text: km > 0 && l > 0 ? fmt1(l / km * 100) + ' L/100 km' : '' })));
    })));
  }
}

function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function updateLive() {
  const e = LIVE.els, d = LIVE.v;
  if (!e || !document.body.contains(e.kmh)) return;
  const kmh = num(d.kmh), lph = num(d.lph);
  setText(e.kmh, kmh == null ? '—' : String(Math.round(kmh)));
  if (lph != null && kmh != null && kmh >= 5) { setText(e.econ, fmt1(Math.min(99.9, lph / kmh * 100))); setText(e.econu, 'L/100 km'); }
  else if (lph != null) { setText(e.econ, fmt1(lph)); setText(e.econu, 'L/h, idling'); }
  else setText(e.econ, '—');
  for (const [k, , , , dp, max] of GAUGES) {
    const x = num(d[k]);
    setText(e[k], x == null ? '—' : (dp ? x.toFixed(dp) : String(Math.round(x))));
    e[k + 'b'].style.width = x == null ? '0%' : Math.max(0, Math.min(100, x / max * 100)) + '%';
  }
  const t = d.trip || {};
  setText(e.tkm, t.km != null ? fmt1(t.km) : '—');
  setText(e.ts, t.s != null ? (t.s < 3600 ? Math.floor(t.s / 60) + ':' + String(Math.floor(t.s % 60)).padStart(2, '0') : dur(t.s)) : '—');
  setText(e.tl, t.l != null ? fmt1(t.l) + ' L' : '—');
  setText(e.tavg, t.km > 0.2 && t.l != null ? fmt1(t.l / t.km * 100) : '—');
}

// ---------- Bluetooth
async function btConnect() {
  try {
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'Jeep' }, { services: [NUS] }], optionalServices: [NUS] });
    LIVE.dev = dev;
    dev.addEventListener('gattserverdisconnected', onDrop);
    LIVE.tries = 0;
    await btAttach();
  } catch (err) {
    if (err && err.name === 'NotFoundError') return; // closed the picker
    toast('Couldn\'t connect to the T3', (err && err.message) || 'Try again with the key on', 'bad');
    liveStop();
  }
}
async function btAttach() {
  LIVE.mode = 'bt'; LIVE.status = 'Connecting…'; render();
  const server = await LIVE.dev.gatt.connect();
  const svc = await server.getPrimaryService(NUS);
  const tx = await svc.getCharacteristic(NUS_TX);
  LIVE.rx = await svc.getCharacteristic(NUS_RX);
  LIVE.buf = ''; LIVE.dec = new TextDecoder();
  tx.addEventListener('characteristicvaluechanged', ev => onBytes(ev.target.value));
  await tx.startNotifications();
  LIVE.status = 'Connected to ' + (LIVE.dev.name || 'the T3');
  LIVE.tries = 0;
  await send({ c: 'hello', now: Date.now(), app: VERSION });
  await send({ c: 'trips' });
  wake(true);
  render();
}
function onDrop() {
  if (LIVE.mode !== 'bt') return;
  LIVE.rx = null;
  if (LIVE.tries++ > 6) { LIVE.status = 'Lost the T3'; liveStop(); toast('Lost the T3', 'Tap Connect when it\'s back on', 'bad'); return; }
  LIVE.status = 'Reconnecting…'; render();
  setTimeout(() => { if (LIVE.mode === 'bt') btAttach().catch(onDrop); }, 1500 + LIVE.tries * 1000);
}
function onBytes(dv) {
  LIVE.buf += LIVE.dec.decode(dv, { stream: true });
  let i;
  while ((i = LIVE.buf.indexOf('\n')) >= 0) {
    const line = LIVE.buf.slice(0, i).trim();
    LIVE.buf = LIVE.buf.slice(i + 1);
    if (line) onLine(line);
  }
  if (LIVE.buf.length > 8192) LIVE.buf = '';
}
function onLine(line) {
  let m;
  try { m = JSON.parse(line); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'live') { LIVE.v = m; LIVE.at = Date.now(); updateLive(); }
  else if (m.t === 'hi') { LIVE.fw = String(m.fw || ''); LIVE.t3 = m; if (LIVE.onHi) LIVE.onHi(); else render(); }
  else if (m.t === 'cfg') toast('Saved on the T3', 'It sends trips by itself from now on');
  else if (m.t === 'trip') saveTrip(m);
}
// a finished trip from the T3: into the sheet, then tell the T3 it can forget it
function saveTrip(m) {
  const id = String(m.id || newId('t'));
  if (S.data.trip.some(t => t.id === id)) { send({ c: 'ack', id }); return; }
  const t1 = num(m.t1) || (num(m.ago) != null ? Date.now() - num(m.ago) * 1000 : Date.now());
  const t0 = num(m.t0) || (num(m.s) ? t1 - num(m.s) * 1000 : t1);
  commit({ op: 'put', tab: 'trip', row: { id, t0, t1, km: num(m.km) || 0, lit: num(m.l) == null ? '' : num(m.l), vmax: num(m.vmax) == null ? '' : num(m.vmax), idle: num(m.idle) == null ? '' : Math.round(num(m.idle) / 60), note: '' } });
  send({ c: 'ack', id });
}
async function send(obj) {
  if (!LIVE.rx) return;
  const data = new TextEncoder().encode(JSON.stringify(obj) + '\n');
  try { for (let i = 0; i < data.length; i += 20) await LIVE.rx.writeValue(data.slice(i, i + 20)); } catch (e) { /* the drop handler deals with it */ }
}

// ---------- demo: a drive through town and down the highway, made up
function demoStart() {
  liveStop(true);
  LIVE.mode = 'demo'; LIVE.status = 'Demo';
  LIVE.sim = { t: 24, v: 38, ect: 71, trip: { km: 0, l: 0, s: 0, idle: 0 } };
  LIVE.timer = setInterval(demoTick, 250);
  wake(true);
  if (S.tab === 'live') render(); else go('live');
}
function demoTick() {
  const s = LIVE.sim, dt = .25;
  s.t += dt;
  const ph = s.t % 260;
  const target = ph < 14 ? 0 : ph < 70 ? 52 : ph < 82 ? 0 : ph < 205 ? 102 : ph < 235 ? 64 : 0;
  const prev = s.v;
  s.v = Math.max(0, s.v + Math.max(-3.2, Math.min(1.5, (target - s.v) * 0.09)) + (Math.random() - .5) * .3);
  const acc = (s.v - prev) / dt;
  const gear = s.v < 16 ? 1 : s.v < 32 ? 2 : s.v < 52 ? 3 : s.v < 72 ? 4 : 5;
  const ratio = [0, 118, 66, 44, 31, 19][gear];
  const rpm = s.v < 2 ? 760 + Math.random() * 20 : Math.max(900, s.v * ratio);
  const load = Math.max(8, Math.min(100, 18 + s.v * .25 + Math.max(0, acc) * 22));
  const lph = s.v < 2 ? 0.9 : 1.1 + s.v * .072 + Math.max(0, acc) * 5.5;
  s.ect = Math.min(88, s.ect + dt * .35);
  const tr = s.trip;
  tr.km += s.v * dt / 3600; tr.l += lph * dt / 3600; tr.s += dt; if (s.v < 2) tr.idle += dt;
  LIVE.v = { t: 'live', kmh: s.v, rpm, boost: Math.max(0, (load - 22) * .26), ect: s.ect, iat: 11 + load * .06, v: 14.2 + Math.random() * .05, load, lph, trip: { km: tr.km, l: tr.l, s: tr.s, idle: tr.idle } };
  updateLive();
}
function liveStop(quiet) {
  clearInterval(LIVE.timer);
  const was = LIVE.mode;
  if (was === 'net') { NET.off = true; clearTimeout(NET.retry); clearInterval(NET.ping); if (NET.ws) { try { NET.ws.close(); } catch (e) { /* gone */ } NET.ws = null; } }
  LIVE.mode = null; LIVE.v = {}; LIVE.els = null; LIVE.fw = '';
  if (LIVE.dev && LIVE.dev.gatt && LIVE.dev.gatt.connected) { try { LIVE.dev.gatt.disconnect(); } catch (e) { /* gone already */ } }
  LIVE.rx = null;
  wake(false);
  if (!quiet && was && S.tab === 'live') render();
}

// keep the screen on while Live is showing
async function wake(on) {
  try {
    if (on) {
      if (navigator.wakeLock && !LIVE.wake) { LIVE.wake = await navigator.wakeLock.request('screen'); LIVE.wake.addEventListener('release', () => { LIVE.wake = null; }); }
      if (navigator.bluetooth && navigator.bluetooth.setScreenDimEnabled) navigator.bluetooth.setScreenDimEnabled(false); // Bluefy
    } else {
      if (LIVE.wake) await LIVE.wake.release();
      LIVE.wake = null;
      if (navigator.bluetooth && navigator.bluetooth.setScreenDimEnabled) navigator.bluetooth.setScreenDimEnabled(true);
    }
  } catch (e) { /* not allowed here */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && LIVE.mode) wake(true); });

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { const t = btn.lastChild; const old = t.textContent; t.textContent = 'Copied'; setTimeout(() => { t.textContent = old; }, 1600); }
  } catch (e) {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch (err) { /* nothing more to try */ }
    ta.remove();
  }
}

// ---------- T3 setup: Wi-Fi, the hotspot and the sheet link go to the T3 over Bluetooth, so it sends trips by itself
function t3Setup() {
  const saved = store.get('t3', {});
  openSheet({
    title: 'T3 setup',
    onClose: () => { LIVE.onHi = null; },
    build(b, sheet) {
      const status = h('div', { class: 'card list' });
      const paint = () => {
        status.textContent = '';
        const m = LIVE.t3, on = LIVE.mode === 'bt' && LIVE.rx;
        const r = (k, val) => h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: k })), h('div', { class: 'end' }, h('span', { text: val })));
        if (!on || !m) { status.append(r('T3', on ? 'Connected' : 'Not connected: Live > Connect first')); return; }
        status.append(r('T3', 'Connected · ' + (m.fw || '')), r('iCar', m.obd ? 'Reading the engine' : 'Looking for it'),
          r('Wi-Fi saved', m.nets ? (Array.isArray(m.ssids) && m.ssids.length ? m.ssids.join(', ') : m.nets + (m.nets > 1 ? ' networks' : ' network')) : 'None yet'),
          r('Wi-Fi now', m.wifi || '-'), m.seen ? r('T3 can see', m.seen) : null,
          r('Trips waiting', String(m.queued || 0)), r('Last send', m.up || 'not yet'));
      };
      LIVE.onHi = paint;
      const f = (label, key, ph) => textRow(label, { placeholder: ph, value: saved[key] || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
      // Wi-Fi networks, tried in this order (older versions saved home and hotspot separately)
      let nets = Array.isArray(saved.nets) ? saved.nets.slice() : [[saved.hs || '', saved.hp || ''], [saved.ps || '', saved.pp || '']].filter(x => x[0]);
      if (!nets.length) nets = [['', '']];
      const netBox = h('div', { style: 'display:grid;gap:10px' });
      const netRows = [];
      const drawNets = () => {
        netBox.textContent = ''; netRows.length = 0;
        nets.forEach((n, i) => {
          const name = textRow('Name', { placeholder: i === 0 ? 'Your home Wi-Fi' : 'Wi-Fi or iPhone hotspot name', value: n[0], autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
          const pass = textRow('Password', { value: n[1], autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
          netRows.push([name.input, pass.input]);
          const del = h('button', { type: 'button', class: 'danger-link', style: 'padding:8px;font-size:15px', text: 'Remove', onclick: () => { readNets(); nets.splice(i, 1); if (!nets.length) nets = [['', '']]; drawNets(); } });
          netBox.append(h('div', { class: 'group' }, name.row, pass.row, nets.length > 1 || n[0] ? del : null));
        });
      };
      const readNets = () => { nets = netRows.map(([a, b2]) => [a.value.trim(), b2.value]); };
      drawNets();
      const fuel = textRow('Fuel', { value: String(saved.fc || 100), inputmode: 'decimal' });
      const dist = textRow('Distance', { value: String(saved.dc || 100), inputmode: 'decimal' });
      const obdName = textRow('iCar name', { placeholder: 'Finds it by itself', value: saved.obd || '', autocapitalize: 'off', autocorrect: 'off' });
      const t3 = LIVE.t3 || {};
      const pick = { ss: saved.ss != null ? saved.ss : (t3.ss != null ? t3.ss : 60), br: saved.br != null ? saved.br : (t3.br != null ? t3.br : 2),
        sp: saved.sp != null ? saved.sp : (t3.sp || 0), pk: saved.pk != null ? saved.pk : (t3.pk || 90), lw: saved.lw != null ? saved.lw : (t3.lw != null ? t3.lw : 1) };
      const choose = (key, opts) => seg(opts, pick[key], v2 => { pick[key] = v2; });
      const err = h('div', { class: 'err' });
      put(b, status,
        h('div', { class: 'label', text: 'Wi-Fi networks (tried in this order)' }), netBox,
        h('button', { type: 'button', class: 'btn btn-glass glass btn-wide', onclick: () => { readNets(); if (nets.length < 8) { nets.push(['', '']); drawNets(); } } }, icon('plus'), 'Add a Wi-Fi network'),
        h('div', { class: 'foot', text: 'Add home, the shop, your iPhone hotspot: up to 8. The hotspot name is in Settings > General > About > Name; in Settings > Personal Hotspot turn on Allow Others to Join and Maximize Compatibility (the T3 only sees 2.4 GHz Wi-Fi). The iCar needs no password.' }),
        h('div', { class: 'label', text: 'Fuel correction (%)' }), h('div', { class: 'group' }, fuel.row),
        h('div', { class: 'foot', text: 'The CRD doesn’t report fuel used, so the T3 works it out. If after a full tank the T3 says 50 L and the pump said 55 L, put 110.' }),
        h('div', { class: 'label', text: 'Live numbers over Wi-Fi and hotspot' }), choose('lw', [[1, 'On'], [0, 'Off']]),
        h('div', { class: 'foot', text: 'While you drive on your hotspot, the T3 sends its live numbers through a free relay so Heep shows them in any browser. About 1 to 2 MB of cell data an hour. Bluetooth in Bluefy works either way.' }),
        h('div', { class: 'label', text: 'Screen turns off after' }), choose('ss', [[30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min'], [0, 'Never']]),
        h('div', { class: 'label', text: 'Screen brightness' }), choose('br', [[0, 'Low'], [1, 'Medium'], [2, 'High']]),
        h('div', { class: 'label', text: 'Page at key-on' }), choose('sp', [[0, 'Economy'], [1, 'Trip'], [2, 'Engine'], [3, 'Speed'], [5, 'Status']]),
        h('div', { class: 'label', text: 'A trip ends after parking' }), choose('pk', [[60, '1 min'], [90, '1.5 min'], [180, '3 min'], [300, '5 min']]),
        h('div', { class: 'label', text: 'Distance correction (%) and iCar' }), h('div', { class: 'group' }, dist.row, obdName.row),
        h('div', { class: 'foot', text: 'Distance: if the T3 says 100 km when the odometer went 103, put 103. iCar name only if it doesn\u2019t find the adapter by itself.' }),
        h('button', { class: 'btn btn-glass glass btn-wide', onclick: () => { if (LIVE.rx) { send({ c: 'update' }); toast('Checking for a T3 update', 'It installs over Wi-Fi when the Jeep is stopped', 'info'); } else err.textContent = 'Connect to the T3 first (Live > Connect).'; } }, icon('sync'), 'Try Wi-Fi and update now'),
        err,
        h('button', { class: 'btn btn-primary btn-wide', onclick: sendCfg }, icon('bt'), 'Send to the T3'));
      paint();
      if (LIVE.rx) send({ c: 'status' });
      async function sendCfg() {
        readNets();
        const v = { nets: nets.filter(x => x[0]), fc: num(fuel.input.value) || 100,
          dc: num(dist.input.value) || 100, obd: obdName.input.value.trim(), ss: pick.ss, br: pick.br, sp: pick.sp, pk: pick.pk, lw: pick.lw };
        store.set('t3', v);
        if (!(LIVE.mode === 'bt' && LIVE.rx)) { err.textContent = 'Saved on this phone. Connect to the T3 (Live > Connect) and send again.'; return; }
        if (!S.conn) { err.textContent = 'Connect Heep to your Jeep log first, so the T3 knows where to send trips.'; return; }
        err.textContent = '';
        const wifi = [];
        for (const [n2, p2] of v.nets) wifi.push(n2, p2);
        await send({ c: 'cfg', wifi, u: S.conn.u, k: S.conn.k, fc: Math.max(30, Math.min(300, v.fc)) / 100, dc: Math.max(50, Math.min(200, v.dc)) / 100,
          obd: v.obd, ss: v.ss, br: v.br, sp: v.sp, pk: v.pk, lw: v.lw });
      }
    },
  });
}
// ---------- how to put the T3 in the Jeep, start to finish
function t3Guide() {
  const steps = [
    ['What you need', 'The LilyGo T3 V1.6.1, a Vgate iCar Pro Bluetooth 4.0 (the BLE one, not Wi-Fi), the keyed 5 V buck converter, and if you like a push button. No battery, and no LoRa antenna: the T3 code keeps the radio asleep.'],
    ['Put the code on the T3 (once, ever)', 'On the PC, plug the T3 in by USB, open bennydedado.github.io/jeep/firmware/ in Chrome or Edge, click Install and pick the T3\u2019s COM port. After that it updates itself over Wi-Fi when the Jeep is stopped: no more uploading.'],
    ['Wire it in', 'Buck converter 5 V to the T3’s 5V pin, ground to GND, so it runs only with the key on. Optional button: one side to IO4, the other to GND. Mount it where you can see the screen.'],
    ['Plug in the iCar', 'Into the OBD port under the dash, left of the steering column. Turn the key: the T3 finds the iCar by itself. Its Status page says iCar reading.'],
    ['Connect Heep', 'Open Heep in Bluefy, go to Live, tap Connect and pick Jeep T3.'],
    ['T3 setup', 'Tap Wi-Fi & setup, add your Wi-Fi networks (home, hotspot, any others) and tap Send to the T3. The link to your Jeep log goes along by itself. The iCar needs no password.'],
    ['Hotspot', 'Settings > Personal Hotspot: Allow Others to Join on, Maximize Compatibility on.'],
    ['Using it', 'The screen turns off after a while (set in T3 setup); a press wakes it. Then press for the next page: Economy, Trip, Engine, Speed, All trips, Status. Hold it 1.5 s on Economy or Trip to start a new trip; hold it on Status to send trips now.'],
    ['Trips', 'Each key-on is a trip; parking 90 s with the key on ends one. Trips are saved on the T3, so nothing is lost when the key goes off. They go to your Jeep log at home, on your hotspot, or when Heep connects. Nothing to do.'],
    ['Fuel accuracy', 'After a couple of full tanks, compare the T3’s litres with the pump and set Fuel correction in T3 setup.'],
  ];
  openSheet({
    title: 'Hook-up guide',
    build(b) {
      put(b, h('ol', { class: 'steps' }, steps.map(([t, d]) => h('li', null, h('div', null, h('b', { text: t, style: 'display:block;margin-bottom:2px' }), h('span', { class: 'muted', style: 'font-size:15px', text: d }))))));
    },
  });
}

// ---------- live over Wi-Fi: when the T3 is on your hotspot (or any Wi-Fi) it sends its numbers through a free relay,
// so Heep shows them in any browser, the Home Screen app too. Bluetooth (in Bluefy) still works and wins when both are on.
const RELAY = 'wss://broker.emqx.io:8084/mqtt';
const NET = { ws: null, buf: new Uint8Array(0), ping: 0, retry: 0, at: 0, off: false, topic: '' };
// the channel name comes from your sheet key, the same way the T3 makes it
async function liveTopic() {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('heep-live:' + S.conn.k)));
  return 'heep/' + [...d.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('') + '/live';
}
const mqStr = s => { const b = new TextEncoder().encode(s); return [b.length >> 8, b.length & 255, ...b]; };
function mqPacket(type, body) {
  const len = [];
  let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; len.push(d); } while (n);
  return new Uint8Array([type, ...len, ...body]);
}
async function netStart() {
  if (NET.ws || NET.off || !S.conn || S.sample || !window.WebSocket || !(window.crypto && crypto.subtle)) return;
  let ws;
  try { NET.topic = await liveTopic(); if (NET.ws) return; ws = new WebSocket(RELAY, 'mqtt'); } catch (e) { return; }
  NET.ws = ws; ws.binaryType = 'arraybuffer'; NET.buf = new Uint8Array(0);
  ws.onopen = () => {
    ws.send(mqPacket(0x10, [...mqStr('MQTT'), 4, 0x02, 0, 60, ...mqStr('heep-' + Math.random().toString(36).slice(2, 12))]));
    ws.send(mqPacket(0x82, [0, 1, ...mqStr(NET.topic), 0]));
    clearInterval(NET.ping);
    NET.ping = setInterval(() => { try { ws.send(new Uint8Array([0xC0, 0])); } catch (e) { /* closing */ } }, 30000);
    if (S.tab === 'live' && !LIVE.mode) render();
  };
  ws.onmessage = e => netBytes(new Uint8Array(e.data));
  ws.onclose = () => { clearInterval(NET.ping); if (NET.ws === ws) NET.ws = null; clearTimeout(NET.retry); NET.retry = setTimeout(netCheck, 5000); };
  ws.onerror = () => { try { ws.close(); } catch (e) { /* gone */ } };
}
function netStop() {
  clearTimeout(NET.retry); clearInterval(NET.ping);
  const ws = NET.ws;
  NET.ws = null;
  if (ws) { try { ws.close(); } catch (e) { /* gone */ } }
  if (LIVE.mode === 'net') { LIVE.mode = null; LIVE.v = {}; LIVE.els = null; wake(false); if (S.tab === 'live') render(); }
}
// MQTT packets can arrive split or joined: keep the bytes until each one is whole
function netBytes(chunk) {
  const b = new Uint8Array(NET.buf.length + chunk.length);
  b.set(NET.buf); b.set(chunk, NET.buf.length);
  let i = 0;
  while (i < b.length) {
    let mul = 1, len = 0, j = i + 1, byte;
    do { if (j >= b.length) { NET.buf = b.slice(i); return; } byte = b[j++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
    if (j + len > b.length) { NET.buf = b.slice(i); return; }
    if ((b[i] >> 4) === 3) {
      const tl = (b[j] << 8) | b[j + 1], qos = (b[i] >> 1) & 3;
      netLine(new TextDecoder().decode(b.slice(j + 2 + tl + (qos ? 2 : 0), j + len)));
    }
    i = j + len;
  }
  NET.buf = new Uint8Array(0);
}
function netLine(text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || m.t !== 'live' || LIVE.mode === 'bt' || LIVE.mode === 'demo') return;
  NET.at = Date.now();
  const fresh = LIVE.mode !== 'net';
  LIVE.mode = 'net'; LIVE.status = 'Over Wi-Fi'; LIVE.v = m; LIVE.at = Date.now();
  if (fresh) { wake(true); if (S.tab === 'live') render(); } else updateLive();
}
// listen while Live is on screen, let go when it isn't (saves data), and drop the view when the T3 goes quiet
function netCheck() {
  if (S.tab !== 'live') NET.off = false;
  const want = S.tab === 'live' && !document.hidden && LIVE.mode !== 'bt' && LIVE.mode !== 'demo';
  if (!want) { if (NET.ws || LIVE.mode === 'net') netStop(); return; }
  if (!NET.ws) netStart();
  if (LIVE.mode === 'net' && Date.now() - NET.at > 15000) { LIVE.mode = null; LIVE.v = {}; LIVE.els = null; wake(false); render(); }
}
setInterval(netCheck, 3000);
document.addEventListener('visibilitychange', netCheck);
