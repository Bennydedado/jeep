'use strict';
// codes.js - Live > Trouble codes: reading (and clearing) the Jeep's check-engine codes through the T3 and the iCar.
// The T3 asks each computer bus (mode 01 PID 01 = light + count, 03 = stored codes, 07 = pending codes, 04 = clear)
// and sends the adapter's raw answers here, one line per '/' with headers on (firmware/T3/obd.ino, "codes").
// The decoding below is plain functions, tested in Node (tests/app/test_codes.js).

// one line of the adapter's answer -> { src, data[], can }. data starts at the service byte (43, 47, 41, 44, 7F).
//  K-line / J1850: 48 6B <src> <data...> <checksum>          e.g. 486B12 43 0401 0234 0000 C9
//  CAN 11-bit:     7E8 <PCI> <data...>                         e.g. 7E8 06 43 02 0133 0221
//  CAN 29-bit:     18DAF1<src> <PCI> <data...>
function obdLines(raw, p) {
  const out = [];
  for (const line0 of String(raw || '').split('/')) {
    const m = line0.toUpperCase().replace(/\s/g, '').match(/([0-9A-F]{6,})$/);   // "SEARCHING...", "BUS INIT: OK", "NO DATA" drop out
    if (!m) continue;
    const line = m[1];
    const can11 = p === '6' || p === '8' || ((p === '0' || p === 'A') && line.length % 2 === 1 && /^7E/.test(line));
    const can29 = p === '7' || p === '9' || ((p === '0' || p === 'A') && /^18DA/.test(line) && line.length >= 10);
    const hex = can11 ? line.slice(3) : can29 ? line.slice(8) : line;
    if (hex.length % 2) continue;
    const b = []; for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
    if (can11) out.push({ src: line.slice(0, 3), pci: b[0], b, can: true });
    else if (can29) out.push({ src: line.slice(6, 8), pci: b[0], b, can: true });
    else if (b.length >= 4) out.push({ src: hex.slice(4, 6), data: b.slice(3), can: false });
  }
  // CAN: put multi-frame answers back together (first frame 1x, then 21, 22...)
  const res = [], open = {};
  for (const f of out) {
    if (!f.can) { res.push(f); continue; }
    const t = f.pci >> 4;
    if (t === 0) res.push({ src: f.src, data: f.b.slice(1, 1 + (f.pci & 15)), can: true });
    else if (t === 1) { const len = ((f.pci & 15) << 8) | f.b[1]; open[f.src] = { src: f.src, len, data: f.b.slice(2), can: true }; res.push(open[f.src]); }
    else if (t === 2 && open[f.src]) open[f.src].data.push(...f.b.slice(1));
  }
  for (const r of res) if (r.len) r.data = r.data.slice(0, r.len);
  return res;
}

// two bytes -> "P0401" (null for the 0000 padding)
function dtcText(a, b) {
  if (!a && !b) return null;
  return 'PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16).toUpperCase() + b.toString(16).toUpperCase().padStart(2, '0');
}

// one protocol's answers -> computers: { src: { mil, count, stored[], pending[], cleared } }
function parseCodes(it) {
  const mods = {};
  const mod = src => mods[src] || (mods[src] = { src, mil: null, count: null, stored: [], pending: [], cleared: null });
  const codesIn = (f, svc) => {
    const d = f.data;
    if (d[0] !== svc) return null;
    const list = [];
    // CAN: a count byte, then the codes. K-line / J1850: three codes per line, padded with 0000, then a checksum.
    const pairs = f.can ? d.slice(2, 2 + 2 * d[1]) : d.slice(1, 7);
    for (let i = 0; i + 1 < pairs.length; i += 2) { const c = dtcText(pairs[i], pairs[i + 1]); if (c) list.push(c); }
    return list;
  };
  for (const f of obdLines(it.a, it.p)) if (f.data[0] === 0x41 && f.data[1] === 0x01 && f.data.length >= 3) { const m = mod(f.src); m.mil = !!(f.data[2] & 0x80); m.count = f.data[2] & 0x7F; }
  for (const f of obdLines(it.b, it.p)) { const l = codesIn(f, 0x43); if (l) { const m = mod(f.src); for (const c of l) if (!m.stored.includes(c)) m.stored.push(c); } }
  for (const f of obdLines(it.c, it.p)) { const l = codesIn(f, 0x47); if (l) { const m = mod(f.src); for (const c of l) if (!m.pending.includes(c)) m.pending.push(c); } }
  for (const f of obdLines(it.x, it.p)) {
    if (f.data[0] === 0x44) mod(f.src).cleared = true;
    else if (f.data[0] === 0x7F && f.data[1] === 0x04) mod(f.src).cleared = 'refused (' + (f.data[2] === 0x22 ? 'engine running?' : 'code ' + (f.data[2] || 0).toString(16).toUpperCase()) + ')';
  }
  return Object.values(mods);
}

// what a code means: the common generic ones by number, otherwise the system it belongs to
const DTC_TEXT = {
  P0016: 'Crank / cam position don’t agree', P0045: 'Turbo boost control solenoid circuit', P0087: 'Fuel rail pressure too low', P0088: 'Fuel rail pressure too high',
  P0093: 'Fuel system leak (large)', P0100: 'Air flow (MAF) sensor circuit', P0101: 'Air flow (MAF) sensor range / performance', P0102: 'Air flow (MAF) sensor low',
  P0103: 'Air flow (MAF) sensor high', P0105: 'Intake pressure (MAP) sensor circuit', P0106: 'Intake pressure (MAP) sensor range / performance',
  P0107: 'Intake pressure (MAP) sensor low', P0108: 'Intake pressure (MAP) sensor high', P0110: 'Intake air temp sensor circuit', P0112: 'Intake air temp sensor low',
  P0113: 'Intake air temp sensor high', P0115: 'Coolant temp sensor circuit', P0116: 'Coolant temp sensor range / performance', P0117: 'Coolant temp sensor low',
  P0118: 'Coolant temp sensor high', P0128: 'Coolant stays below thermostat temperature', P0180: 'Fuel temp sensor circuit', P0190: 'Fuel rail pressure sensor circuit',
  P0191: 'Fuel rail pressure sensor range / performance', P0192: 'Fuel rail pressure sensor low', P0193: 'Fuel rail pressure sensor high',
  P0201: 'Injector circuit, cylinder 1', P0202: 'Injector circuit, cylinder 2', P0203: 'Injector circuit, cylinder 3', P0204: 'Injector circuit, cylinder 4',
  P0219: 'Engine over-speed', P0234: 'Turbo overboost', P0236: 'Boost sensor range / performance', P0237: 'Boost sensor low', P0238: 'Boost sensor high', P0299: 'Turbo underboost',
  P0300: 'Random / multiple misfire', P0301: 'Misfire, cylinder 1', P0302: 'Misfire, cylinder 2', P0303: 'Misfire, cylinder 3', P0304: 'Misfire, cylinder 4',
  P0335: 'Crankshaft position sensor circuit', P0336: 'Crankshaft position sensor range / performance', P0340: 'Camshaft position sensor circuit',
  P0341: 'Camshaft position sensor range / performance', P0380: 'Glow plug circuit', P0381: 'Glow plug indicator circuit', P0400: 'EGR flow', P0401: 'EGR flow too low',
  P0402: 'EGR flow too high', P0403: 'EGR control circuit', P0404: 'EGR range / performance', P0405: 'EGR sensor low', P0406: 'EGR sensor high',
  P0420: 'Catalyst efficiency below threshold', P0480: 'Cooling fan control circuit', P0500: 'Vehicle speed sensor', P0505: 'Idle control system',
  P0520: 'Oil pressure sensor / switch circuit', P0530: 'A/C pressure sensor circuit', P0560: 'System voltage', P0562: 'System voltage low', P0563: 'System voltage high',
  P0571: 'Brake switch circuit', P0600: 'Computer communication link', P0601: 'Computer memory checksum error', P0603: 'Computer keep-alive memory error',
  P0605: 'Computer memory (ROM) error', P0606: 'Computer processor fault', P0627: 'Fuel pump control circuit', P0670: 'Glow plug module control circuit',
  P0671: 'Glow plug circuit, cylinder 1', P0672: 'Glow plug circuit, cylinder 2', P0673: 'Glow plug circuit, cylinder 3', P0674: 'Glow plug circuit, cylinder 4',
  P0683: 'Glow plug module to engine computer communication', P0700: 'Transmission computer has a code (read the transmission)', P0705: 'Transmission range sensor circuit',
  P0715: 'Transmission input speed sensor', P0720: 'Transmission output speed sensor', P0730: 'Incorrect gear ratio', P0740: 'Torque converter clutch circuit',
  P0750: 'Shift solenoid A', P0755: 'Shift solenoid B', U0001: 'CAN communication bus', U0100: 'Lost communication with the engine computer',
  U0101: 'Lost communication with the transmission computer', U0121: 'Lost communication with ABS', U0155: 'Lost communication with the instrument cluster',
};
function dtcMeaning(code) {
  if (DTC_TEXT[code]) return DTC_TEXT[code];
  const sys = { P: 'Engine / transmission', C: 'Chassis (ABS, steering, suspension)', B: 'Body (airbags, doors, lights)', U: 'Network (the computers talking to each other)' }[code[0]] || '';
  if (code[1] === '1' || code[1] === '3' && code[0] === 'P') return sys + ': Chrysler’s own code, look it up';
  if (code[0] === 'P') {
    const part = { '0': 'fuel and air', '1': 'fuel and air', '2': 'fuel and air (injectors)', '3': 'ignition / misfire', '4': 'emissions (EGR and others)', '5': 'speed, idle and inputs',
      '6': 'computer and outputs', '7': 'transmission', '8': 'transmission', '9': 'transmission' }[code[2]];
    return 'Engine / transmission: ' + (part || 'generic code');
  }
  return sys;
}
const dtcSearch = code => 'https://www.google.com/search?q=' + encodeURIComponent('Jeep Liberty CRD ' + code);

// ---------------------------------------------------------------- the sheet (browser only from here)
// which buses to ask: every protocol where "Scan the Jeep" found a computer, your setting first; else your setting
function codesProtos() {
  const sc = store.get('obdscan', null);
  const cur = String(t3Cfg().opr || 0);
  const found = sc && sc.items ? sc.items.filter(it => it.p !== '0' && scanParse(it).length).map(it => String(it.p)) : [];
  const list = [...new Set([cur !== '0' && found.includes(cur) ? cur : null, ...found].filter(Boolean))];
  return list.length ? list.join('') : cur;
}
function codesMsg(m) {
  if (m.error) { toast('Couldn’t read the codes', m.error, 'bad'); if (LIVE.codes) LIVE.codes.running = false; }
  else if (m.start) LIVE.codes = { running: true, n: m.n, clear: !!m.clear, items: [], at: Date.now() };
  else if (m.p != null && LIVE.codes) { LIVE.codes.items.push(m); LIVE.codes.at = Date.now(); }
  if (m.done && LIVE.codes) {
    LIVE.codes.running = false;
    store.set('codes', LIVE.codes);
    const n = LIVE.codes.items.reduce((a, it) => a + parseCodes(it).reduce((b, md) => b + md.stored.length + md.pending.length, 0), 0);
    if (LIVE.codes.clear) toast('Clear sent', 'Read the codes again to check', 'info');
    else toast(n ? n + (n > 1 ? ' codes' : ' code') + ' found' : 'No codes', n ? 'See Trouble codes' : 'Nothing stored or pending', n ? 'bad' : 'info');
  }
  if (LIVE.onCodes) LIVE.onCodes();
}
async function codesStart(clear) {
  if (!(await t3Ready())) { if (!t3CanSend()) toast('Not connected to the T3', 'Bluetooth, or the T3 on your hotspot', 'bad'); return; }
  if (!verAtLeast(LIVE.fw, '2.7')) { toast('Update the T3 first', 'Reading codes needs T3 2.7 (Live > Wi-Fi & update)', 'bad'); return; }
  const p = codesProtos();
  LIVE.codes = { running: true, n: p.length, clear: !!clear, items: [], at: Date.now() };
  t3Send({ c: 'codes', p, clear: clear ? 1 : 0 });
  if (LIVE.onCodes) LIVE.onCodes();
}
function codesSheet() {
  openSheet({
    title: 'Trouble codes',
    onClose: () => { LIVE.onCodes = null; clearInterval(LIVE.codesTimer); },
    build(b) {
      const body = h('div', { style: 'display:grid;gap:14px' });
      const paint = () => {
        body.textContent = '';
        const cs = LIVE.codes || store.get('codes', null);
        const running = cs && cs.running && Date.now() - cs.at < 45000;
        const intro = h('div', { class: 'card ota' });
        body.append(intro);
        if (running) {
          intro.append(h('b', { text: (cs.clear ? 'Clearing' : 'Reading') + ': bus ' + Math.min(cs.items.length + 1, cs.n) + ' of ' + cs.n + '…' }),
            h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round(cs.items.length / Math.max(1, cs.n) * 100) + '%' })),
            h('p', { class: 'foot', style: 'margin:0', text: 'Live numbers pause for the 10-30 seconds this takes.' }));
        } else {
          if (cs && cs.running) intro.append(h('p', { class: 'foot', style: 'margin:0', text: 'No answer from the T3 for a while. Try again.' }));
          if (!cs) intro.append(h('p', { class: 'foot', style: 'margin:0', text: 'Key on (engine running or not). The T3 asks the engine and transmission computers through the iCar for the check-engine light, stored codes and pending codes (seen once, not confirmed yet).' }));
          intro.append(h('button', { class: 'btn btn-primary btn-wide', onclick: () => codesStart(false) }, icon('sync'), cs ? 'Read again' : 'Read the codes'));
        }
        if (!cs || !cs.items.length) return;
        let total = 0;
        for (const it of cs.items) {
          const mods = parseCodes(it);
          const busName = scanProtoName(it.p);
          if (!mods.length) { body.append(h('div', null, h('div', { class: 'label', text: busName }), h('div', { class: 'card' }, h('p', { class: 'foot', style: 'margin:0', text: 'No computer answered on this bus.' })))); continue; }
          for (const md of mods) {
            const who = MODULE_GUESS[md.src] ? MODULE_GUESS[md.src][0].toUpperCase() + MODULE_GUESS[md.src].slice(1) + ' computer' : 'Computer ' + md.src;
            const rows = [];
            rows.push(h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: 'Check-engine light' }), h('span', { text: md.count != null ? md.count + (md.count === 1 ? ' code' : ' codes') + ' it says it has' : 'didn’t say' })),
              h('div', { class: 'end' }, h('span', { text: md.mil == null ? '?' : md.mil ? 'On' : 'Off' }), h('span', { class: 'pill ' + (md.mil ? 'due' : 'ok'), style: 'margin-left:6px' }, h('i')))));
            const codeRow = (c, kind) => h('a', { class: 'row', href: dtcSearch(c), target: '_blank', rel: 'noopener' },
              h('div', { class: 'main' }, h('b', { text: c + (kind === 'pending' ? ' (pending)' : '') }), h('span', { class: 'wrap', text: dtcMeaning(c) })),
              h('span', { class: 'pill ' + (kind === 'pending' ? 'soon' : 'due') }, h('i')), icon('chev', 'chev'));
            for (const c of md.stored) rows.push(codeRow(c, 'stored'));
            for (const c of md.pending) if (!md.stored.includes(c)) rows.push(codeRow(c, 'pending'));
            total += md.stored.length + md.pending.length;
            if (!md.stored.length && !md.pending.length) rows.push(h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: 'No codes' }), h('span', { text: 'Nothing stored or pending' })), h('span', { class: 'pill ok' }, h('i'))));
            if (md.cleared != null) rows.push(h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: 'Clear' }), h('span', { text: md.cleared === true ? 'Done: the computer cleared its codes' : 'The computer said no: ' + md.cleared })),
              h('span', { class: 'pill ' + (md.cleared === true ? 'ok' : 'due') }, h('i'))));
            body.append(h('div', null, h('div', { class: 'label', text: who + ' (' + md.src + ') · ' + busName }), h('div', { class: 'card list' }, rows)));
          }
        }
        body.append(h('p', { class: 'foot', style: 'margin:0', text: (running ? '' : 'Read ' + ago(cs.at) + '. ') + 'Tap a code to look it up for a Liberty CRD.' }));
        if (!running && total) body.append(confirmButton('Clear the codes', 'Tap again to clear: key on, engine OFF. The light goes out and the readiness checks reset; a real fault brings its code back.', () => codesStart(true)));
        body.append(h('details', { class: 'card' }, h('summary', { text: 'What the Jeep said (for Claude)' }),
          h('pre', { class: 'small', style: 'white-space:pre-wrap;word-break:break-all;margin:8px 0 0', text: cs.items.map(it => 'protocol ' + it.p + '\n0101: ' + (it.a || '-') + '\n03: ' + (it.b || '-') + '\n07: ' + (it.c || '-') + (it.x ? '\n04: ' + it.x : '')).join('\n\n') })));
      };
      LIVE.onCodes = paint;
      b.append(body);
      paint();
      clearInterval(LIVE.codesTimer);
      LIVE.codesTimer = setInterval(() => { const cs = LIVE.codes; if (cs && cs.running) paint(); }, 5000);
    },
  });
}

if (typeof module !== 'undefined') module.exports = { obdLines, dtcText, parseCodes, dtcMeaning, DTC_TEXT };
