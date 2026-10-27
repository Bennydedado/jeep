'use strict';
// t3.js - talking to the T3 from anywhere in Heep: over Bluetooth (Bluefy) or, when the T3 is on your hotspot,
// through the relay with commands signed by your sheet key. Also the T3 settings and Diagnostics sheets.
// Message list: T3.md.

const t3TempF = () => !!Number(store.get('t3', {}).tf);

// ---------------------------------------------------------------- one way in for every T3 message (Bluetooth or relay)
function t3Message(m, via) {
  if (m.t === 'live') {
    LIVE.v = m; LIVE.at = Date.now();
    if (m.lat != null && m.lon != null) store.set('lastPos', { lat: m.lat, lon: m.lon, hdg: m.hdg, at: Date.now() });
    updateLive();
  } else if (m.t === 'hi') { LIVE.fw = String(m.fw || ''); LIVE.t3 = m; LIVE.t3At = Date.now(); if (LIVE.onHi) LIVE.onHi(); else if (S.tab === 'live') render(); }
  else if (m.t === 'cfg') { if (LIVE.onCfg) LIVE.onCfg(m); else toast('Saved on the T3', m.reset ? 'Settings back to new' : 'It uses them from now on'); }
  else if (m.t === 'trip' && via === 'bt') saveTrip(m);
  else if (m.t === 'scr') { if (LIVE.onScr) LIVE.onScr(m); }
  else if (m.t === 'scrd') { if (LIVE.onScrd) LIVE.onScrd(m); }
  else if (m.t === 'diag') { LIVE.diag = m; LIVE.diagAt = Date.now(); if (LIVE.onDiag) LIVE.onDiag(); }
  else if (m.t === 'wifi') { LIVE.wifi = m; LIVE.wifiAt = Date.now(); if (LIVE.onWifi) LIVE.onWifi(); }
  else if (m.t === 'ota') { if (LIVE.onOta) LIVE.onOta(m); }
}

// can a command reach the T3 right now?
function t3Via() {
  if (LIVE.mode === 'bt' && LIVE.rx) return 'bt';
  if (NET.ws && NET.ws.readyState === 1 && NET.at && Date.now() - NET.at < 15000) return 'net';
  return null;
}
const t3CanSend = () => !!t3Via();

// send one command: Bluetooth if connected, otherwise the relay (signed). Secrets never go over the relay.
let t3Nonce = 0;
async function t3Send(obj) {
  const via = t3Via();
  if (via === 'bt') { await send(obj); return true; }
  if (via !== 'net' || !S.conn) return false;
  const safe = Object.assign({}, obj);
  for (const k of ['wifi', 'u', 'k', 'tru', 'trk']) delete safe[k];
  const m = JSON.stringify(safe);
  t3Nonce = Math.max(Date.now(), t3Nonce + 1);
  const n = t3Nonce;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(S.conn.k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(n + '|' + m)));
  const hmac = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  const payload = new TextEncoder().encode(JSON.stringify({ n, m, h: hmac }));
  const topic = NET.topic.replace(/\/live$/, '/cmd');
  try { NET.ws.send(mqPacket(0x30, [...mqStr(topic), ...payload])); } catch (e) { return false; }
  return true;
}

// trip controls, page changes, marks: the same names the wheel buttons use
function t3Trip(what) { return t3Send({ c: 'trip', do: what }); }
function t3Act(a) { return t3Send({ c: 'act', a }); }

// ---------------------------------------------------------------- settings
// everything kept on this phone under 't3' and sent as one cfg message
const T3_DEFAULTS = { fc: 100, dc: 100, ss: 60, pk: 90, br: 2, bn: 0, nf: -1, nt: 7, tz: -420, sp: 0, lw: 1, spd: 0, hm: 5, h16: 0, hh: 1, tf: 0, to: 0,
  gb: 0, li: 1, lis: 10, lfl: 5, sdm: 90, rot: 0, rf: 250, bm: 'prev,home;mark,pause;next,end', io4: 0, obd: '' };
function t3Cfg() { return Object.assign({}, T3_DEFAULTS, store.get('t3', {})); }
async function t3SendSettings() {
  const v = t3Cfg();
  const via = t3Via();
  if (!via) { toast('Saved on this phone', 'Connect to the T3 (Bluetooth, or the T3 on your hotspot) and send again', 'info'); return false; }
  const msg = { c: 'cfg', fc: Math.max(30, Math.min(300, num(v.fc) || 100)) / 100, dc: Math.max(50, Math.min(200, num(v.dc) || 100)) / 100 };
  for (const k of ['ss', 'pk', 'br', 'bn', 'nf', 'nt', 'tz', 'sp', 'lw', 'spd', 'hm', 'h16', 'hh', 'tf', 'to', 'gb', 'li', 'lis', 'lfl', 'sdm', 'rot', 'rf', 'io4']) msg[k] = Number(v[k]);
  msg.bm = String(v.bm); msg.obd = String(v.obd || '');
  if (via === 'bt') {
    // the secrets only ever go over Bluetooth
    const nets = Array.isArray(v.nets) ? v.nets : [];
    msg.wifi = []; for (const [a, b] of nets) if (a) msg.wifi.push(a, b);
    if (S.conn) { msg.u = S.conn.u; msg.k = S.conn.k; }
    const trk = store.get('trk', null);
    if (trk && trk.u) { msg.tru = trk.u; msg.trk = trk.k; }
  }
  await t3Send(msg);
  if (via === 'net') toast('Sent over Wi-Fi', 'Wi-Fi passwords and links only go over Bluetooth', 'info');
  return true;
}

function t3Setup() {
  const v = t3Cfg();
  openSheet({
    title: 'T3 settings',
    onClose: () => { LIVE.onHi = null; },
    build(b) {
      const status = h('div', { class: 'card list' });
      const paint = () => {
        status.textContent = '';
        const m = LIVE.t3, via = t3Via();
        const r = (k, val) => h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: k })), h('div', { class: 'end' }, h('span', { text: val })));
        if (!via || !m) { status.append(r('T3', via ? 'Connected, waiting for it to answer' : 'Not connected: Live > Connect, or the T3 on your hotspot')); return; }
        status.append(r('T3', (via === 'bt' ? 'Bluetooth' : 'Wi-Fi relay') + ' · ' + (m.fw || '')), r('iCar', m.obd ? 'Reading the engine' : 'Looking for it'),
          r('Wi-Fi saved', m.nets ? (Array.isArray(m.ssids) && m.ssids.length ? m.ssids.join(', ') : m.nets + ' networks') : 'None yet'),
          r('Wi-Fi now', m.wifi || '-'), m.seen ? r('Networks nearby', m.seen) : null,
          r('Trips waiting', String(m.queued || 0)), r('Last send', m.up || 'not yet'), r('Track store', m.trkSet ? (m.trk || 'set') : 'not set up'), r('Program', m.upd || '-'));
      };
      LIVE.onHi = paint;
      const keep = (k, x) => { const s = store.get('t3', {}); s[k] = x; store.set('t3', s); v[k] = x; };
      const pick = (k, opts) => seg(opts, Number(v[k]), x => keep(k, x));
      const numIn = (label, k, unit) => { const i = h('input', { inputmode: 'decimal', value: String(v[k]) }); i.addEventListener('change', () => { const n = num(i.value); if (n != null) keep(k, n); }); return h('label', { class: 'gr' }, h('span', { text: label + (unit ? ' (' + unit + ')' : '') }), i); };
      const txtIn = (label, k, ph) => { const i = h('input', { value: String(v[k] || ''), placeholder: ph || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }); i.addEventListener('change', () => keep(k, i.value.trim())); return h('label', { class: 'gr' }, h('span', { text: label }), i); };
      // Wi-Fi networks, tried in this order
      const saved = store.get('t3', {});
      let nets = Array.isArray(saved.nets) ? saved.nets.slice() : [[saved.hs || '', saved.hp || ''], [saved.ps || '', saved.pp || '']].filter(x => x[0]);
      if (!nets.length) nets = [['', '']];
      const netBox = h('div', { style: 'display:grid;gap:10px' });
      const netRows = [];
      const readNets = () => { nets = netRows.map(([a, b2]) => [a.value.trim(), b2.value]); keep('nets', nets.filter(x => x[0])); };
      const drawNets = () => {
        netBox.textContent = ''; netRows.length = 0;
        nets.forEach((n, i) => {
          const name = textRow('Name', { placeholder: i === 0 ? 'Your home Wi-Fi' : 'Wi-Fi or iPhone hotspot name', value: n[0], autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
          const pass = textRow('Password', { value: n[1], autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
          name.input.addEventListener('change', readNets); pass.input.addEventListener('change', readNets);
          netRows.push([name.input, pass.input]);
          const del = h('button', { type: 'button', class: 'danger-link', style: 'padding:8px;font-size:15px', text: 'Remove', onclick: () => { readNets(); nets.splice(i, 1); if (!nets.length) nets = [['', '']]; keep('nets', nets.filter(x => x[0])); drawNets(); } });
          netBox.append(h('div', { class: 'group' }, name.row, pass.row, nets.length > 1 || n[0] ? del : null));
        });
      };
      drawNets();
      const trk = store.get('trk', null);
      put(b, status,
        h('div', { class: 'label', text: 'Wi-Fi networks (tried in this order)' }), netBox,
        h('button', { type: 'button', class: 'btn btn-glass glass btn-wide', onclick: () => { readNets(); if (nets.length < 8) { nets.push(['', '']); drawNets(); } } }, icon('plus'), 'Add a Wi-Fi network'),
        h('div', { class: 'foot', text: 'Home, the shop, your iPhone hotspot: up to 8. iPhone: Settings > Personal Hotspot > Allow Others to Join and Maximize Compatibility on (the T3 only sees 2.4 GHz). Names and passwords only ever go to the T3 over Bluetooth.' }),
        h('div', { class: 'label', text: 'Live over Wi-Fi' }), pick('lw', [[1, 'On'], [0, 'Off']]),
        h('div', { class: 'foot', text: 'On your hotspot the T3 sends its live numbers through a free relay (about 1-2 MB an hour) so Heep shows them in Safari too, and Heep can change screens and settings without Bluetooth. Commands are signed with your sheet key.' }),
        h('div', { class: 'label', text: 'GPS track storage' }),
        h('div', { class: 'card list' }, h('button', { class: 'row', onclick: () => trackStoreSheet() }, h('div', { class: 'main' }, h('b', { text: trk && trk.u ? 'Track store connected' : 'Set up track storage' }), h('span', { text: trk && trk.u ? 'Finished trips’ GPS tracks go to your Google Drive' : 'So finished trips show on the Map page' })), icon('chev', 'chev'))),
        h('div', { class: 'label', text: 'Speed and heading' }),
        pick('spd', [[0, 'Auto'], [1, 'iCar'], [2, 'GPS']]),
        h('div', { class: 'foot', text: 'Speed (and trip distance) from the iCar, from the GPS, or Auto: the iCar when it’s reading, otherwise the GPS.' }),
        h('div', { class: 'group' }, numIn('Trust heading above', 'hm', 'km/h')),
        pick('h16', [[0, '8 points (NE)'], [1, '16 points (NNE)']]),
        h('div', { class: 'label', text: 'Heading when stopped' }), pick('hh', [[1, 'Keep the last one'], [0, 'Show --']]),
        h('div', { class: 'foot', text: 'The GPS gives the direction you’re moving, not a compass: stopped, it can’t tell which way the Jeep points. A kept heading shows in brackets, like (NE).' }),
        h('div', { class: 'label', text: 'Outside temperature' }),
        pick('tf', [[0, '°C'], [1, '°F']]),
        h('div', { class: 'group' }, numIn('Probe correction', 'to', '°C')),
        h('div', { class: 'label', text: 'GPIO 4 is wired to' }), pick('io4', [[0, 'DS18B20 probe'], [1, 'Push button']]),
        h('div', { class: 'label', text: 'Trips' }),
        h('div', { class: 'group' }, numIn('Fuel correction', 'fc', '%'), numIn('Distance correction', 'dc', '%')),
        h('div', { class: 'foot', text: 'Fuel: if the T3 says 50 L after a full tank and the pump said 55 L, put 110. Distance (iCar speed only): if the T3 says 100 km when the odometer went 103, put 103.' }),
        h('div', { class: 'label', text: 'A trip ends after parking for' }), pick('pk', [[60, '1 min'], [90, '1.5 min'], [180, '3 min'], [300, '5 min'], [900, '15 min']]),
        h('div', { class: 'label', text: 'SD card logging' }),
        h('div', { class: 'group' },
          h('label', { class: 'gr' }, h('span', { text: 'Driving: a row every' }), selectNum('li', [[1, '1 s'], [2, '2 s'], [5, '5 s'], [10, '10 s']], v, keep)),
          h('label', { class: 'gr' }, h('span', { text: 'Parked: a row every' }), selectNum('lis', [[5, '5 s'], [10, '10 s'], [30, '30 s'], [60, '1 min']], v, keep)),
          h('label', { class: 'gr' }, h('span', { text: 'Write to card every' }), selectNum('lfl', [[2, '2 s'], [5, '5 s'], [10, '10 s'], [30, '30 s']], v, keep)),
          h('label', { class: 'gr' }, h('span', { text: 'Make room when over' }), selectNum('sdm', [[80, '80 % full'], [90, '90 % full'], [95, '95 % full']], v, keep))),
        h('div', { class: 'foot', text: 'The T3 has no battery, so rows wait in memory for at most the "write" time. Making room deletes the oldest tracks that are already in your track store; only a nearly full card (98 %) loses ones that aren’t.' }),
        h('div', { class: 'label', text: 'Clock and GPS' }),
        h('div', { class: 'group' },
          h('label', { class: 'gr' }, h('span', { text: 'Time zone' }), selectNum('tz', [[-480, 'Pacific (UTC-8)'], [-420, 'Mountain / Fort St. John (UTC-7)'], [-360, 'Central (UTC-6)'], [-300, 'Eastern (UTC-5)'], [0, 'UTC']], v, keep)),
          h('label', { class: 'gr' }, h('span', { text: 'GPS speed' }), selectNum('gb', [[0, 'Find it by itself'], [9600, '9600'], [38400, '38400'], [57600, '57600'], [115200, '115200']], v, keep))),
        h('div', { class: 'label', text: 'iCar' }), h('div', { class: 'group' }, txtIn('iCar name', 'obd', 'Finds it by itself')),
        h('button', { class: 'btn btn-primary btn-wide', onclick: () => t3SendSettings() }, icon('bt'), 'Send settings to the T3'),
        h('button', { class: 'btn btn-glass glass btn-wide', onclick: () => { if (!t3CanSend()) { toast('Not connected to the T3', '', 'bad'); return; } t3Send({ c: 'update' }); toast('Checking for a T3 update', 'It installs over Wi-Fi when the Jeep is stopped', 'info'); } }, icon('sync'), 'Try Wi-Fi and update now'),
        confirmButton('Put T3 settings back to new', 'Tap again: screens, units and logging go back to new; Wi-Fi and links stay', () => { const s = store.get('t3', {}); store.set('t3', { nets: s.nets }); t3Send({ c: 'cfgreset' }); }));
      paint();
      if (t3CanSend()) t3Send({ c: 'status' });
    },
  });
}
function selectNum(k, opts, v, keep) {
  const s = h('select', null, opts.map(([a, b]) => h('option', { value: String(a), text: b })));
  s.value = String(v[k]);
  s.addEventListener('change', () => keep(k, Number(s.value)));
  return s;
}

// standard OBD-II values by PID (mode 01), for Diagnostics
const OBD_PIDS = { '01': 'Check-engine status', '03': 'Fuel system', '04': 'Engine load', '05': 'Coolant temp', '06': 'Fuel trim', '07': 'Fuel trim (long)',
  '0B': 'Intake pressure (boost)', '0C': 'RPM', '0D': 'Speed', '0E': 'Timing', '0F': 'Intake air temp', '10': 'Air flow (MAF)', '11': 'Throttle',
  '13': 'O2 sensors', '1C': 'OBD standard', '1F': 'Run time', '21': 'Distance with check-engine on', '22': 'Fuel rail pressure', '23': 'Fuel rail pressure',
  '2C': 'EGR commanded', '2D': 'EGR error', '2F': 'Fuel level', '30': 'Warm-ups since codes cleared', '31': 'Distance since codes cleared',
  '33': 'Air pressure (baro)', '42': 'Module voltage', '43': 'Absolute load', '45': 'Throttle (relative)', '46': 'Outside air temp', '49': 'Pedal position',
  '4A': 'Pedal position B', '4C': 'Throttle commanded', '51': 'Fuel type', '5C': 'Oil temp', '5E': 'Fuel rate', '61': 'Torque demanded', '62': 'Torque actual',
  '63': 'Reference torque', '70': 'Boost pressure', '87': 'Intake pressure' };
const obdNames = list => String(list || '').split(' ').filter(Boolean).map(p => OBD_PIDS[p] ? OBD_PIDS[p] + ' (' + p + ')' : p).join(', ');
function obdProtoName(p) {
  const n = { '1': 'J1850 PWM', '2': 'J1850 VPW', '3': 'ISO 9141-2', '4': 'KWP2000 (5-baud)', '5': 'KWP2000 (fast)', '6': 'CAN 11-bit 500k', '7': 'CAN 29-bit 500k', '8': 'CAN 11-bit 250k', '9': 'CAN 29-bit 250k' };
  const k = String(p).replace(/^A/, '');
  if (k === '0') return 'Not found yet: the engine hasn\u2019t answered';
  return (n[k] || p) + (/^A/.test(p) ? ' (found by itself)' : '');
}

// ---------------------------------------------------------------- diagnostics: is everything wired and working?
function diagSheet() {
  openSheet({
    title: 'Diagnostics',
    onClose: () => { LIVE.onDiag = null; clearInterval(LIVE.diagTimer); },
    build(b) {
      const body = h('div', { style: 'display:grid;gap:14px' });
      const paint = () => {
        body.textContent = '';
        const d = LIVE.diag;
        const age = LIVE.diagAt ? Math.round((Date.now() - LIVE.diagAt) / 1000) : null;
        if (!d) { body.append(h('div', { class: 'card' }, h('p', { class: 'foot', style: 'margin:0', text: t3CanSend() ? 'Asking the T3…' : 'Connect to the T3 first (Bluetooth, or the T3 on your hotspot).' }))); return; }
        const sec = (title, rows) => h('div', null, h('div', { class: 'label', text: title }), h('div', { class: 'card list' }, rows.filter(Boolean).map(([k, val, kind]) =>
          h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: k })), h('div', { class: 'end' }, h('span', { text: String(val) }), kind ? h('span', { class: 'pill ' + kind, style: 'margin-left:6px' }, h('i')) : null)))));
        const g = d.gps || {}, t = d.temp || {}, n = d.nano || {}, w = d.wifi || {}, bl = d.ble || {}, sd = d.sd || {}, up = d.up || {};
        const gState = ['No data from the GPS', 'Data, but not GPS sentences (baud?)', 'Searching for satellites', '2D fix', '3D fix'][g.state] || '?';
        put(body,
          h('div', { class: 'foot', text: age > 5 ? 'Last answer ' + age + ' s ago (stale)' : 'Live from the T3 ' + d.fw + ', updating every 2 s' }),
          sec('GPS (M100 on GPIO 34)', [['State', gState, g.state >= 3 ? 'ok' : g.state === 2 ? 'soon' : 'due'], ['Baud', g.baud], ['Bytes received', g.bytes],
            ['Good / bad sentences', g.ok + ' / ' + g.bad], ['Satellites used / in view', (g.sats >= 0 ? g.sats : '?') + ' / ' + (g.inv >= 0 ? g.inv : '?')],
            ['HDOP', g.hdop == null ? '-' : g.hdop + (g.hdop < 2 ? ' (good)' : g.hdop < 5 ? ' (fair)' : ' (poor)')], ['Last fix', g.age < 0 ? 'never' : g.age + ' s ago']]),
          sec('Outside temperature (DS18B20, GPIO 4)', [['State', ['Not found (wiring? 4.7k pull-up?)', 'Reading', 'Errors'][t.state] || '?', t.state === 1 ? 'ok' : 'due'],
            ['Reading', t.c == null ? '-' : t.c + ' °C'], ['Last good', t.age < 0 ? 'never' : t.age + ' s ago'], ['Read errors', t.err], ['Probe ID', t.rom || '-']]),
          sec('Steering wheel (Nano link, GPIO 39)', [['Link', ({ ok: 'Hearing the Nano', lost: 'Lost (was working)', none: 'Never heard it' })[n.state] || n.state, n.state === 'ok' ? 'ok' : 'due'],
            ['Baud', n.baud], ['Good / bad / repeats', n.good + ' / ' + n.bad + ' / ' + n.dups], ['Nano up', n.up ? dur(n.up) : '-'], ['Last button', n.last + (n.lastAgo >= 0 ? ' (' + n.lastAgo + ' s ago)' : '')], ['Presses', n.presses]]),
          sec('Wi-Fi and relay', [['Wi-Fi', w.state], w.rssi ? ['Signal', w.rssi + ' dBm' + (w.rssi > -60 ? ' (strong)' : w.rssi > -75 ? ' (ok)' : ' (weak)')] : null, w.ip ? ['T3 address', w.ip] : null,
            ['Networks the last scan saw', w.seen || '-'], ['Relay', w.relay ? 'Connected' : 'Not connected']]),
          sec('Bluetooth', [['Heep', bl.phone ? 'Connected' : 'Not connected'], ['iCar', bl.icar ? 'Connected' + (bl.icarAge >= 0 ? ', last answer ' + bl.icarAge + ' s ago' : '') : 'Not connected', bl.icar ? 'ok' : 'soon']]),
          d.obd ? sec('Engine (through the iCar)', [
            d.obd.data != null ? ['Engine answering', d.obd.data ? 'Yes' : 'No: is the key on?', d.obd.data ? 'ok' : 'due'] : null,
            ['Boost from', d.obd.boost === '-' ? (d.obd.known ? 'Not offered by this engine (standard OBD)' : 'Not known yet') : (OBD_PIDS[d.obd.boost] || 'PID ' + d.obd.boost) + ' · PID ' + d.obd.boost, d.obd.boost === '-' ? 'due' : 'ok'],
            ['Intake / air pressure', (d.obd.map == null ? '-' : d.obd.map + ' kPa') + ' / ' + (d.obd.baro == null ? '-' : d.obd.baro + ' kPa')],
            ['Protocol', d.obd.proto ? obdProtoName(d.obd.proto) : '-'],
            ['Offers', d.obd.known ? obdNames(d.obd.sup) : 'Not asked yet (key on, iCar connected?)'],
            d.obd.miss ? ['No answer for', obdNames(d.obd.miss)] : null,
            d.obd.raw ? ['Last answers', Object.entries(d.obd.raw).map(([k, v]) => k + ': ' + (v || '-')).join('\n')] : null]) : null,
          sec('SD card', [['Card', sd.ok ? 'Logging' : (sd.last || 'No card'), sd.ok ? 'ok' : 'due'], sd.ok ? ['Space', sd.usedMB + ' of ' + sd.totalMB + ' MB used'] : null,
            ['Rows written', sd.rows], ['Current file', sd.file || '-'], ['Write errors', sd.err], ['Tracks waiting to upload', sd.waiting]]),
          sec('Uploads', [['Trips to the sheet', up.sheet], ['Trips waiting', up.queued], ['Tracks', up.tracks], ['Program update', up.fw || '-']]),
          sec('T3', [['Program', d.fw], ['Up for', dur(d.upS)], ['Started because', d.reset], ['Starts so far', d.boot], ['Free memory', Math.round(d.heap / 1024) + ' KB (lowest ' + Math.round(d.heapMin / 1024) + ' KB)'],
            ['Clock from', ({ g: 'GPS', n: 'internet', a: 'phone', '-': 'not set yet' })[d.clock] || d.clock]]));
      };
      LIVE.onDiag = paint;
      b.append(body);
      paint();
      const ask = () => { if (t3CanSend()) t3Send({ c: 'diag' }); paint(); };
      ask();
      clearInterval(LIVE.diagTimer);
      LIVE.diagTimer = setInterval(ask, 2000);
    },
  });
}
