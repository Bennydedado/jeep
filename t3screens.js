'use strict';
// t3screens.js - the T3's screens: the same text format as firmware/T3/screens.h, a pixel preview of the
// 128x64 display, and the editor (Live > Screens & buttons).
//
// To add a value the T3 can show: add it to FIELDS here AND in firmware/T3/fields.h (same id), then give it a
// value in fieldText()/fieldNumber() in firmware/T3/display.ino. SAMPLE gives the preview something to draw.

const SCR_W = 128, SCR_H = 64, MAX_SCREENS = 12, MAX_WIDGETS = 10;

// id, label on the T3, unit, decimals (-1 text), group in the editor
const FIELDS = [
  ['kmh', 'Speed', 'km/h', 0, 'Driving'], ['kmhg', 'GPS spd', 'km/h', 0, 'Driving'], ['kmho', 'OBD spd', 'km/h', 0, 'Driving'],
  ['hdg', 'Heading', '', -1, 'Driving'], ['hdgd', 'Course', 'deg', -1, 'Driving'], ['otemp', 'Outside', 'C', 1, 'Driving'],
  ['clock', 'Time', '', -1, 'Driving'], ['date', 'Date', '', -1, 'Driving'],
  ['rpm', 'RPM', '', 0, 'Engine'], ['boost', 'Boost', 'psi', 1, 'Engine'], ['bmax', 'Peak bst', 'psi', 1, 'Engine'], ['ect', 'Coolant', 'C', 0, 'Engine'],
  ['iat', 'Intake', 'C', 0, 'Engine'], ['volt', 'Battery', 'V', 1, 'Engine'], ['load', 'Load', '%', 0, 'Engine'], ['lph', 'Fuel', 'L/h', 1, 'Engine'],
  ['econ', 'Now', 'L/100', 1, 'Engine'],
  ['tstate', 'Trip', '', -1, 'Trip'], ['tkm', 'Trip', 'km', 1, 'Trip'], ['ttime', 'Time', '', -1, 'Trip'], ['tl', 'Diesel', 'L', 2, 'Trip'],
  ['tavg', 'Trip avg', 'L/100', 1, 'Trip'], ['tavgs', 'Avg spd', 'km/h', 0, 'Trip'], ['tvmax', 'Top spd', 'km/h', 0, 'Trip'], ['tidle', 'Idle', '', -1, 'Trip'],
  ['totkm', 'All km', 'km', 0, 'Trip'], ['totl', 'All L', 'L', 0, 'Trip'], ['totavg', 'All avg', 'L/100', 1, 'Trip'],
  ['gfix', 'GPS', '', -1, 'GPS'], ['sats', 'Sats', '', -1, 'GPS'], ['hdop', 'HDOP', '', 1, 'GPS'], ['alt', 'Altitude', 'm', 0, 'GPS'],
  ['lat', 'Lat', '', 5, 'GPS'], ['lon', 'Lon', '', 5, 'GPS'],
  ['obd', 'iCar', '', -1, 'Status'], ['ble', 'Phone', '', -1, 'Status'], ['wifi', 'Wi-Fi', '', -1, 'Status'], ['nano', 'Wheel', '', -1, 'Status'],
  ['sd', 'SD', '', -1, 'Status'], ['sdfree', 'SD free', 'MB', 0, 'Status'], ['logn', 'Logged', '', 0, 'Status'], ['queue', 'Waiting', '', 0, 'Status'],
  ['fw', 'T3', '', -1, 'Status'], ['up', 'Up', '', -1, 'Status'], ['heap', 'Memory', 'KB', 0, 'Status'], ['btn', 'Button', '', -1, 'Status'],
].map(([id, label, unit, dp, group]) => ({ id, label, unit, dp, group }));
const FIELD = Object.fromEntries(FIELDS.map(f => [f.id, f]));

// what the preview draws when there are no live numbers
const SAMPLE = { kmh: 87, kmhg: 86, kmho: 87, hdg: 'NE', hdgd: '047°', otemp: -12.5, clock: '18:42', date: '2026-10-27', rpm: 1850, boost: 14.2, bmax: 21.6,
  ect: 86, iat: 8, volt: 14.1, load: 52, lph: 7.4, econ: 8.5, tstate: 'RUNNING', tkm: 42.7, ttime: '0:38', tl: 3.94, tavg: 9.2, tavgs: 67, tvmax: 104,
  tidle: '0:03', totkm: 15204, totl: 1421, totavg: 9.3, gfix: '3D FIX', sats: '9/14', hdop: 0.9, alt: 702, lat: 56.24650, lon: -120.84760,
  obd: 'reading', ble: 'Heep on', wifi: 'Ben iPhone', nano: 'ok', sd: 'logging', sdfree: 29811, logn: 2311, queue: 0, fw: '2.0', up: '0:41', heap: 92, btn: '3S' };

// same screens a new T3 starts with: keep in step with DEFAULT_SCREENS in firmware/T3/screens.h
const DEFAULT_SCREENS = [
  'Temp & dir|1|l,-,0,0,60,8,1,c,,0,0,HEADING|l,-,66,0,62,8,1,c,,0,0,OUTSIDE|v,hdg,0,10,62,30,4,c,,0,0,|v,otemp,66,10,62,30,4,c,u,0,0,|n,-,63,2,1,46,1,l,,0,0,|r,hdgd,0,48,62,8,1,l,,0,0,|r,gfix,0,56,128,8,1,l,l,0,0,|r,sats,66,48,62,8,1,r,l,0,0,',
  'Drive|1|v,kmh,0,0,80,40,4,l,lu,0,0,|v,hdg,82,0,46,20,2,r,,0,0,|v,otemp,82,22,46,18,1,r,u,0,0,|r,tavg,0,46,128,8,1,l,lu,0,0,|r,tkm,0,56,128,8,1,l,lu,0,0,',
  'Boost|1|v,boost,0,0,128,40,4,c,lu,0,0,|b,boost,0,42,128,12,1,l,,0,30,|r,bmax,0,56,64,8,1,l,l,0,0,|r,rpm,66,56,62,8,1,r,l,0,0,',
  'Economy|1|v,tavg,0,0,128,40,4,c,lu,0,0,|r,econ,0,44,128,8,1,l,lu,0,0,|r,tkm,0,54,128,8,1,l,lu,0,0,',
  'Trip|1|r,tstate,0,0,128,8,1,l,l,0,0,|r,tkm,0,10,128,8,1,l,lu,0,0,|r,ttime,0,19,128,8,1,l,l,0,0,|r,tl,0,28,128,8,1,l,lu,0,0,|r,tavgs,0,37,128,8,1,l,lu,0,0,|r,tvmax,0,46,128,8,1,l,lu,0,0,|r,tidle,0,55,128,8,1,l,l,0,0,',
  'Engine|1|r,rpm,0,0,128,8,1,l,l,0,0,|r,boost,0,10,128,8,1,l,lu,0,0,|r,ect,0,20,128,8,1,l,lu,0,0,|r,iat,0,30,128,8,1,l,lu,0,0,|r,volt,0,40,128,8,1,l,lu,0,0,|r,load,0,50,128,8,1,l,lu,0,0,',
  'GPS|1|r,gfix,0,0,128,8,1,l,l,0,0,|r,sats,0,9,128,8,1,l,l,0,0,|r,hdop,0,18,128,8,1,l,l,0,0,|r,kmhg,0,27,128,8,1,l,lu,0,0,|r,lat,0,36,128,8,1,l,l,0,0,|r,lon,0,45,128,8,1,l,l,0,0,|r,alt,0,54,128,8,1,l,lu,0,0,',
  'Connections|1|r,obd,0,0,128,8,1,l,l,0,0,|r,ble,0,10,128,8,1,l,l,0,0,|r,wifi,0,20,128,8,1,l,l,0,0,|r,nano,0,30,128,8,1,l,l,0,0,|r,queue,0,40,128,8,1,l,l,0,0,|r,clock,0,50,128,8,1,l,l,0,0,',
  'Logging|1|r,sd,0,0,128,8,1,l,l,0,0,|r,sdfree,0,10,128,8,1,l,lu,0,0,|r,logn,0,20,128,8,1,l,l,0,0,|r,queue,0,30,128,8,1,l,l,0,0,|r,tstate,0,40,128,8,1,l,l,0,0,',
  'System|1|r,fw,0,0,128,8,1,l,l,0,0,|r,up,0,10,128,8,1,l,l,0,0,|r,heap,0,20,128,8,1,l,lu,0,0,|r,btn,0,30,128,8,1,l,l,0,0,|r,date,0,40,128,8,1,l,l,0,0,|r,totkm,0,50,128,8,1,l,lu,0,0,',
];

// ready-made screens to start from in "Add a screen"
const SCREEN_TEMPLATES = [
  ['Blank', 'New screen|1'],
  ['Boost gauge', 'Boost|1|v,boost,0,0,128,40,4,c,lu,0,0,|b,boost,0,42,128,12,1,l,,0,30,|r,bmax,0,56,64,8,1,l,l,0,0,|r,rpm,66,56,62,8,1,r,l,0,0,'],
  ['Temperature & direction', DEFAULT_SCREENS[0].replace('Temp & dir', 'Temp & dir 2')],
  ['One big number', 'Big|1|v,kmh,0,0,128,64,4,c,lu,0,0,'],
  ['Two big numbers', 'Two|1|v,kmh,0,0,63,64,4,c,lu,0,0,|n,-,64,4,1,56,1,l,,0,0,|v,otemp,65,0,63,64,3,c,lu,0,0,'],
  ['List of six', 'List|1|r,rpm,0,0,128,8,1,l,l,0,0,|r,boost,0,11,128,8,1,l,lu,0,0,|r,ect,0,22,128,8,1,l,lu,0,0,|r,iat,0,33,128,8,1,l,lu,0,0,|r,volt,0,44,128,8,1,l,lu,0,0,|r,otemp,0,55,128,8,1,l,lu,0,0,'],
];

// ---------------------------------------------------------------- the text format (screens.h)
const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const cleanText = (s, n) => String(s || '').replace(/[|,\n\r]/g, ' ').replace(/[^\x20-\x7e]/g, '').slice(0, n);
function newWidget(o) {
  return Object.assign({ type: 'v', field: 'kmh', x: 0, y: 0, w: 128, h: 16, size: 1, align: 'l', label: true, unit: true, frame: false, invert: false, mn: 0, mx: 100, text: '' }, o || {});
}
function parseWidget(s) {
  const p = String(s).split(',');
  if (p.length < 6 || !'vrbln'.includes(p[0]) || !p[0]) return null;
  const w = newWidget({ type: p[0], field: p[1] || '-' });
  w.x = clampI(p[2], 0, SCR_W - 1); w.y = clampI(p[3], 0, SCR_H - 1);
  w.w = clampI(p[4], 1, SCR_W); w.h = clampI(p[5], 1, SCR_H);
  w.size = p.length > 6 ? clampI(p[6], 1, 4) : 1;
  w.align = p[7] === 'c' || p[7] === 'r' ? p[7] : 'l';
  const fl = p[8] || '';
  w.label = fl.includes('l'); w.unit = fl.includes('u'); w.frame = fl.includes('f'); w.invert = fl.includes('i');
  w.mn = Number(p[9]) || 0; w.mx = Number(p[10]) || 0;
  w.text = (p[11] || '').slice(0, 12);
  if (w.x + w.w > SCR_W) w.w = SCR_W - w.x;
  if (w.y + w.h > SCR_H) w.h = SCR_H - w.y;
  if (w.mx <= w.mn) w.mx = w.mn + 1;
  return w;
}
function parseScreen(s) {
  const p = String(s || '').split('|');
  if (p.length < 2 || !p[0]) return null;
  const sc = { name: p[0].slice(0, 12), on: p[1] !== '0', w: [] };
  for (const x of p.slice(2)) { if (!x || sc.w.length >= MAX_WIDGETS) continue; const w = parseWidget(x); if (w) sc.w.push(w); }
  return sc;
}
const fmtNum = v => (v === Math.trunc(v) ? String(v) : String(+v.toPrecision(6)));
function writeScreen(sc) {
  let s = cleanText(sc.name, 12) + '|' + (sc.on ? 1 : 0);
  for (const w of sc.w) {
    const fl = (w.label ? 'l' : '') + (w.unit ? 'u' : '') + (w.frame ? 'f' : '') + (w.invert ? 'i' : '');
    const field = w.type === 'l' || w.type === 'n' ? (FIELD[w.field] ? w.field : '-') : (w.field || '-');
    s += '|' + [w.type, field, w.x, w.y, w.w, w.h, w.size, w.align, fl, fmtNum(w.mn), fmtNum(w.mx), cleanText(w.text, 12)].join(',');
  }
  return s;
}
// the fingerprint the T3 checks (FNV-1a over the screens joined by newlines) - same as fnv1a() in screens.h
function fnv1a(str) {
  let h = 0x811c9dc5;
  const b = new TextEncoder().encode(str);
  for (const c of b) { h ^= c; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const screensHash = list => fnv1a(list.join('\n')).toString(16);

// ---------------------------------------------------------------- the preview: draws like the T3 does
const PREVIEW_FONT = { 1: ['600 8px ui-monospace, Menlo, monospace', 8], 2: ['600 16px ui-monospace, Menlo, monospace', 16], 3: ['700 17px Helvetica, Arial, sans-serif', 17], 4: ['700 25px Helvetica, Arial, sans-serif', 25] };
function fieldShown(id, live) {
  const f = FIELD[id];
  if (!f) return '?';
  let v = live && live[id] !== undefined ? live[id] : SAMPLE[id];
  if (v == null || v === '') return '--';
  if (f.dp >= 0 && typeof v === 'number') return v.toFixed(f.dp);
  return String(v);
}
function drawScreen(ctx, sc, scale, live, sel) {
  const S2 = scale;
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SCR_W * S2, SCR_H * S2);
  ctx.scale(S2, S2);
  ctx.textBaseline = 'top';
  const fit = (t, w, size) => { while (size > 1) { ctx.font = PREVIEW_FONT[size][0]; if (ctx.measureText(t).width <= w) break; size--; } ctx.font = PREVIEW_FONT[size][0]; return size; };
  const text = (t, x, y, w, h, align, size, col) => {
    size = fit(t, w, size);
    const tw = ctx.measureText(t).width, th = PREVIEW_FONT[size][1];
    const cx = align === 'c' ? x + (w - tw) / 2 : align === 'r' ? x + w - tw : x;
    ctx.fillStyle = col; ctx.fillText(t, Math.max(x, cx), y + Math.max(0, (h - th) / 2));
  };
  sc.w.forEach((w, i) => {
    const f = FIELD[w.field];
    let fg = '#7fd4ff';
    if (w.invert) { ctx.fillStyle = fg; ctx.fillRect(w.x, w.y, w.w, w.h); fg = '#000'; }
    ctx.strokeStyle = fg; ctx.lineWidth = 1 / S2 * 1.5;
    if (w.frame) ctx.strokeRect(w.x + .5, w.y + .5, w.w - 1, w.h - 1);
    const label = w.text || (f ? f.label : '?');
    const unit = f && w.unit ? (w.field === 'otemp' && t3TempF() ? 'F' : f.unit) : '';
    let v = f ? fieldShown(w.field, live) : '?';
    if (w.type === 'n') { ctx.fillStyle = fg; if (w.w >= w.h) ctx.fillRect(w.x, w.y, w.w, 1); else ctx.fillRect(w.x, w.y, 1, w.h); }
    else if (w.type === 'l') text(w.text, w.x, w.y, w.w, w.h, w.align, w.size, fg);
    else if (w.type === 'r') {
      if (unit && v !== '--') v += ' ' + unit;
      ctx.font = PREVIEW_FONT[1][0]; ctx.fillStyle = fg;
      const ty = w.y + (w.h - 8) / 2;
      if (w.label) { ctx.fillText(label, w.x, ty); ctx.fillText(v, w.x + w.w - ctx.measureText(v).width, ty); }
      else text(v, w.x, w.y, w.w, w.h, w.align, 1, fg);
    } else if (w.type === 'b') {
      let top = w.y;
      if (unit && v !== '--') v += ' ' + unit;
      if (w.label && w.h >= 14) { ctx.font = PREVIEW_FONT[1][0]; ctx.fillStyle = fg; ctx.fillText(label, w.x, w.y); ctx.fillText(v, w.x + w.w - ctx.measureText(v).width, w.y); top += 9; }
      const bh = Math.max(3, w.y + w.h - top);
      ctx.strokeRect(w.x + .5, top + .5, w.w - 1, bh - 1);
      const x = Number(live && live[w.field] != null ? live[w.field] : SAMPLE[w.field]);
      if (isFinite(x)) { const fr = Math.max(0, Math.min(1, (x - w.mn) / (w.mx - w.mn))); ctx.fillStyle = fg; ctx.fillRect(w.x + 1, top + 1, (w.w - 2) * fr, bh - 2); }
    } else {
      let top = w.y, hh = w.h;
      if (w.label) { text(label, w.x, w.y, w.w, 8, w.align, 1, fg); top += 9; hh -= 9; }
      if (unit && v !== '--' && w.size >= 2) {
        ctx.font = PREVIEW_FONT[1][0];
        const uw = ctx.measureText(unit).width + 2;
        const sz = fit(v, w.w - uw, w.size);
        const tw = ctx.measureText(v).width, th = PREVIEW_FONT[sz][1], total = tw + uw;
        const cx = Math.max(w.x, w.align === 'c' ? w.x + (w.w - total) / 2 : w.align === 'r' ? w.x + w.w - total : w.x);
        const cy = top + Math.max(0, (hh - th) / 2);
        ctx.fillStyle = fg; ctx.fillText(v, cx, cy);
        ctx.font = PREVIEW_FONT[1][0]; ctx.fillText(unit, cx + tw + 2, cy + th - 8);
      } else text(unit && v !== '--' ? v + ' ' + unit : v, w.x, top, w.w, hh, w.align, w.size, fg);
    }
    if (i === sel) { ctx.strokeStyle = '#ff9f0a'; ctx.lineWidth = 1 / S2 * 2; ctx.setLineDash([2, 1.5]); ctx.strokeRect(w.x + .25, w.y + .25, w.w - .5, w.h - .5); ctx.setLineDash([]); }
  });
  ctx.restore();
}
// live numbers from the T3 in the preview's terms (falls back to SAMPLE per value)
function previewLive() {
  const d = LIVE && LIVE.mode && LIVE.mode !== 'demo' ? LIVE.v : null;
  if (!d) return null;
  const o = {};
  if (d.kmh != null) o.kmh = d.kmh;
  if (d.gkmh != null) o.kmhg = d.gkmh;
  for (const k of ['rpm', 'boost', 'ect', 'iat', 'load', 'lph', 'sats', 'hdop']) if (d[k] != null) o[k] = d[k];
  if (d.v != null) o.volt = d.v;
  if (d.ot != null) o.otemp = t3TempF() ? d.ot * 9 / 5 + 32 : d.ot;
  if (d.hdg != null) o.hdg = (d.hdgAge > 3 ? '(' : '') + compass(d.hdg) + (d.hdgAge > 3 ? ')' : '');
  if (d.trip) { o.tkm = d.trip.km; o.tl = d.trip.l; o.tvmax = d.trip.vmax; }
  return o;
}
function compass(deg) { if (deg == null || deg < 0) return '--'; return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }

// ---------------------------------------------------------------- the screen set on this phone
// t3scr = { list: [screen text...], sentHash, ackHash, ackAt, t3Hash }
function scrState() {
  const s = store.get('t3scr', null);
  if (s && Array.isArray(s.list) && s.list.length) return s;
  return { list: DEFAULT_SCREENS.slice(), sentHash: null, ackHash: null, ackAt: 0 };
}
function scrSave(st) { store.set('t3scr', st); }
function scrStatus(st) {
  const mine = screensHash(st.list);
  const t3 = LIVE.t3 && LIVE.t3.scrh;
  if (t3 && t3 === mine) return ['ok', 'On the T3 ✓ (it has exactly these screens)'];
  if (st.ackHash === mine) return ['ok', 'The T3 confirmed these screens ' + ago(st.ackAt)];
  if (st.sentHash === mine) return ['soon', 'Sent; waiting for the T3 to confirm'];
  if (t3) return ['due', 'Saved on this phone. The T3 has different screens: send them'];
  return ['soon', 'Saved on this phone, not sent to the T3 yet'];
}

// send the whole set; resolves true when the T3 says it has them
function sendScreens(st) {
  return new Promise(resolve => {
    if (!t3CanSend()) { toast('Not connected to the T3', 'Connect over Bluetooth, or have the T3 on your hotspot', 'bad'); resolve(false); return; }
    const list = st.list.slice(0, MAX_SCREENS);
    const hash = screensHash(list);
    st.sentHash = hash; scrSave(st);
    let done = false, timer = null;
    const giveUp = () => { if (done) return; done = true; LIVE.onScr = null; toast('The T3 didn\'t confirm', 'Check it\'s on and connected, then send again', 'bad'); resolve(false); };
    LIVE.onScr = m => {
      if (done) return;
      done = true; clearTimeout(timer); LIVE.onScr = null;
      if (m.ok && m.h === hash) { st.ackHash = hash; st.ackAt = Date.now(); scrSave(st); if (LIVE.t3) LIVE.t3.scrh = hash; toast('Screens are on the T3', list.length + ' screens'); resolve(true); }
      else { toast('The T3 refused the screens', m.why || 'fingerprint different', 'bad'); resolve(false); }
    };
    toast('Sending ' + list.length + ' screens…', 'Keep Heep open until the T3 confirms', 'info');
    (async () => {
      for (let i = 0; i < list.length; i++) await t3Send({ c: 'scr', i, n: list.length, d: list[i] });
      await t3Send({ c: 'scrok', n: list.length, h: hash });
      // a big set takes a few seconds over Bluetooth: the wait for the answer starts once it's all sent
      if (!done) timer = setTimeout(giveUp, 15000);
    })();
  });
}
// ask the T3 for the screens it has (replaces the phone's copy)
function loadScreensFromT3() {
  return new Promise(resolve => {
    if (!t3CanSend()) { toast('Not connected to the T3', '', 'bad'); resolve(null); return; }
    const got = [];
    const timer = setTimeout(() => { LIVE.onScrd = null; resolve(null); toast('The T3 didn\'t answer', '', 'bad'); }, 12000);
    LIVE.onScrd = m => {
      got[m.i] = m.d;
      if (got.filter(Boolean).length === m.n) { clearTimeout(timer); LIVE.onScrd = null; resolve(got); }
    };
    t3Send({ c: 'getscr' });
  });
}

// ---------------------------------------------------------------- the editor
function screensSheet() {
  const st = scrState();
  openSheet({
    title: 'T3 screens & buttons',
    build(b) {
      const paint = () => {
        b.textContent = '';
        const [kind, words] = scrStatus(st);
        const list = h('div', { class: 'card list' });
        st.list.forEach((txt, i) => {
          const sc = parseScreen(txt) || { name: '?', on: false, w: [] };
          const cv = h('canvas', { width: SCR_W * 2, height: SCR_H * 2, class: 'scr-thumb' });
          drawScreen(cv.getContext('2d'), sc, 2, null, -1);
          const move = d => { const j = i + d; if (j < 0 || j >= st.list.length) return; [st.list[i], st.list[j]] = [st.list[j], st.list[i]]; scrSave(st); paint(); };
          list.append(h('div', { class: 'row scr-row' },
            h('button', { class: 'scr-open', onclick: () => screenEditor(st, i, paint) }, cv,
              h('div', { class: 'main' }, h('b', { text: (i + 1) + '. ' + sc.name }), h('span', { text: sc.w.length + ' widgets' + (sc.on ? '' : ' · hidden') + (i === (LIVE.t3 && LIVE.t3.sp) ? ' · key-on screen' : '') }))),
            h('div', { class: 'scr-tools' },
              switchEl(sc.on, v => { sc.on = v; st.list[i] = writeScreen(sc); scrSave(st); paint(); }),
              h('button', { class: 'mini', 'aria-label': 'Move up', onclick: () => move(-1), disabled: i === 0 }, '▲'),
              h('button', { class: 'mini', 'aria-label': 'Move down', onclick: () => move(1), disabled: i === st.list.length - 1 }, '▼'))));
        });
        put(b,
          h('div', { class: 'card list' }, h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: 'Status' }), h('span', { text: words })), h('span', { class: 'pill ' + kind }, h('i')))),
          h('div', { class: 'label', text: 'Screens (the wheel buttons go through the ones that are on, in this order)' }),
          list,
          st.list.length < MAX_SCREENS ? h('button', { class: 'btn btn-glass glass btn-wide', onclick: () => addScreen(st, paint) }, icon('plus'), 'Add a screen') : h('div', { class: 'foot', text: 'That’s the most the T3 keeps (' + MAX_SCREENS + ').' }),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-primary', onclick: async () => { await sendScreens(st); paint(); } }, icon('bt'), 'Send to the T3'),
            h('button', { class: 'btn btn-glass glass', onclick: async () => { const got = await loadScreensFromT3(); if (got) { st.list = got; st.ackHash = screensHash(got); st.ackAt = Date.now(); scrSave(st); paint(); toast('Loaded the T3’s screens', got.length + ' screens'); } } }, icon('sync'), 'Load from T3')),
          h('div', { class: 'foot', text: 'Changes are kept on this phone as you make them. "Send to the T3" puts them on the T3 and waits for it to confirm it has exactly the same set.' }),
          h('div', { class: 'label', text: 'Steering wheel buttons' }), buttonsCard(),
          h('div', { class: 'label', text: 'Display' }), displayCard(),
          confirmButton('Go back to the default screens', 'Tap again: the default screens replace yours on this phone', () => { st.list = DEFAULT_SCREENS.slice(); scrSave(st); paint(); toast('Default screens', 'Send them to the T3 to use them'); }));
      };
      paint();
    },
  });
}

function addScreen(st, after) {
  openSheet({
    title: 'Add a screen',
    build(b, sheet) {
      put(b, h('div', { class: 'card list' }, SCREEN_TEMPLATES.map(([name, txt]) => {
        const sc = parseScreen(txt);
        const cv = h('canvas', { width: SCR_W * 2, height: SCR_H * 2, class: 'scr-thumb' });
        drawScreen(cv.getContext('2d'), sc, 2, null, -1);
        return h('button', { class: 'row scr-open', onclick: () => { st.list.push(txt); scrSave(st); sheet.close(); after(); screenEditor(st, st.list.length - 1, after); } }, cv, h('div', { class: 'main' }, h('b', { text: name })));
      })));
    },
  });
}

function screenEditor(st, idx, after) {
  const sc = parseScreen(st.list[idx]) || { name: 'Screen', on: true, w: [] };
  let sel = sc.w.length ? 0 : -1;
  const save = () => { st.list[idx] = writeScreen(sc); scrSave(st); };
  openSheet({
    title: 'Edit screen',
    onClose: () => { save(); after(); },
    build(b, sheet) {
      const SC = 3;
      const cv = h('canvas', { width: SCR_W * SC, height: SCR_H * SC, class: 'scr-edit' });
      const ctx = cv.getContext('2d');
      const props = h('div', { style: 'display:grid;gap:12px' });
      const wl = h('div', { class: 'chips' });
      const redraw = () => { drawScreen(ctx, sc, SC, previewLive(), sel); };
      const chipText = w => (w.type === 'l' ? '"' + (w.text || 'label') + '"' : w.type === 'n' ? 'line' : (FIELD[w.field] ? FIELD[w.field].label : w.field)) + (w.type === 'n' ? '' : ' · ' + ({ v: 'value', r: 'row', b: 'bar', l: 'text' })[w.type]);
      // a change only renames its own chip: rebuilding the row while a number box loses focus would eat the tap
      // that caused it (type a number, tap "+ Add": the Add button was gone before the tap landed)
      const relabel = () => { const c = wl.children[sel]; if (c && sc.w[sel]) c.textContent = chipText(sc.w[sel]); };
      const paintList = () => {
        wl.textContent = '';
        sc.w.forEach((w, i) => wl.append(h('button', { class: 'chip' + (i === sel ? ' on' : ''), onclick: () => { sel = i; paintAll(); } }, chipText(w))));
        if (sc.w.length < MAX_WIDGETS) wl.append(h('button', { class: 'chip', onclick: () => { sc.w.push(newWidget({ y: Math.min(56, sc.w.length * 10), h: 8 })); sel = sc.w.length - 1; save(); paintAll(); } }, icon('plus'), 'Add'));
      };
      const paintProps = () => {
        props.textContent = '';
        const w = sc.w[sel];
        if (!w) { props.append(h('div', { class: 'foot', text: 'Tap Add to put a value on this screen, then drag it on the preview.' })); return; }
        const set = (k, v) => { w[k] = v; if (w.x + w.w > SCR_W) w.w = SCR_W - w.x; if (w.y + w.h > SCR_H) w.h = SCR_H - w.y; save(); redraw(); relabel(); };
        const numRow = (label, k, lo, hi) => {
          const inp = h('input', { inputmode: 'numeric', value: String(w[k]) });
          inp.addEventListener('change', () => { set(k, clampI(inp.value, lo, hi)); inp.value = String(w[k]); });
          const step = d => { set(k, clampI(w[k] + d, lo, hi)); inp.value = String(w[k]); };
          return h('label', { class: 'gr' }, h('span', { text: label }), h('button', { type: 'button', class: 'mini', onclick: e => { e.preventDefault(); step(-1); } }, '−'), inp, h('button', { type: 'button', class: 'mini', onclick: e => { e.preventDefault(); step(1); } }, '+'));
        };
        const fieldSel = h('select', null, [...new Set(FIELDS.map(f => f.group))].map(g => h('optgroup', { label: g }, FIELDS.filter(f => f.group === g).map(f => h('option', { value: f.id, text: f.label + (f.unit ? ' (' + f.unit + ')' : '') + ' · ' + f.id })))));
        fieldSel.value = FIELD[w.field] ? w.field : 'kmh';
        fieldSel.addEventListener('change', () => set('field', fieldSel.value));
        const text = h('input', { value: w.text, maxlength: 12, placeholder: w.type === 'l' ? 'Text to show' : 'Own label (optional)' });
        text.addEventListener('input', () => set('text', cleanText(text.value, 12)));
        const sw = (label, k) => h('label', { class: 'gr' }, h('span', { text: label }), switchEl(w[k], v => set(k, v)));
        put(props,
          h('div', { class: 'label', text: 'Kind' }),
          seg([['v', 'Value'], ['r', 'Row'], ['b', 'Bar'], ['l', 'Text'], ['n', 'Line']], w.type, v => { set('type', v); paintProps(); }),
          w.type === 'l' || w.type === 'n' ? null : h('div', { class: 'group' }, h('label', { class: 'gr' }, h('span', { text: 'Shows' }), fieldSel)),
          w.type === 'n' ? null : h('div', { class: 'group' }, h('label', { class: 'gr' }, h('span', { text: w.type === 'l' ? 'Text' : 'Label' }), text)),
          w.type === 'v' || w.type === 'l' ? h('div', { class: 'label', text: 'Size (1 small → 4 biggest; shrinks by itself if it doesn’t fit)' }) : null,
          w.type === 'v' || w.type === 'l' ? seg([[1, '1'], [2, '2'], [3, '3'], [4, '4']], w.size, v => set('size', v)) : null,
          w.type === 'n' ? null : seg([['l', 'Left'], ['c', 'Centre'], ['r', 'Right']], w.align, v => set('align', v)),
          h('div', { class: 'label', text: 'Position and size, in T3 pixels (128 × 64)' }),
          h('div', { class: 'group' }, numRow('Left', 'x', 0, SCR_W - 1), numRow('Top', 'y', 0, SCR_H - 1), numRow('Width', 'w', 1, SCR_W), numRow('Height', 'h', 1, SCR_H)),
          w.type === 'b' ? h('div', { class: 'group' }, numRow('Bar from', 'mn', -1000, 100000), numRow('Bar to', 'mx', -1000, 100000)) : null,
          w.type === 'n' || w.type === 'l' ? null : h('div', { class: 'group' }, sw('Show the label', 'label'), sw('Show the unit', 'unit'), sw('Box around it', 'frame'), sw('White background', 'invert')),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-small btn-glass glass', onclick: () => { if (sc.w.length < MAX_WIDGETS) { sc.w.push(Object.assign({}, w, { y: Math.min(SCR_H - w.h, w.y + w.h) })); sel = sc.w.length - 1; save(); paintAll(); } } }, icon('copy'), 'Duplicate'),
            h('button', { class: 'btn btn-small btn-glass glass btn-danger', onclick: () => { sc.w.splice(sel, 1); sel = Math.min(sel, sc.w.length - 1); save(); paintAll(); } }, icon('trash'), 'Remove')));
      };
      const paintAll = () => { redraw(); paintList(); paintProps(); };
      // drag on the preview: pick the widget under the finger and move it by whole pixels
      let drag = null;
      const at = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * SCR_W, (e.clientY - r.top) / r.height * SCR_H]; };
      cv.addEventListener('pointerdown', e => {
        const [x, y] = at(e);
        let hit = -1;
        for (let i = sc.w.length - 1; i >= 0; i--) { const w = sc.w[i]; if (x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h) { hit = i; break; } }
        if (hit < 0) return;
        sel = hit; drag = { x, y, ox: sc.w[hit].x, oy: sc.w[hit].y };
        cv.setPointerCapture(e.pointerId); e.preventDefault(); paintAll();
      });
      cv.addEventListener('pointermove', e => {
        if (!drag) return;
        const [x, y] = at(e), w = sc.w[sel];
        w.x = clampI(drag.ox + x - drag.x, 0, SCR_W - w.w); w.y = clampI(drag.oy + y - drag.y, 0, SCR_H - w.h);
        redraw();
      });
      cv.addEventListener('pointerup', () => { if (drag) { drag = null; save(); paintProps(); } });
      const name = h('input', { value: sc.name, maxlength: 12 });
      name.addEventListener('input', () => { sc.name = cleanText(name.value, 12) || 'Screen'; save(); });
      put(b,
        h('div', { class: 'group' }, h('label', { class: 'gr' }, h('span', { text: 'Name' }), name)),
        h('div', { class: 'scr-frame' }, cv),
        h('div', { class: 'foot', text: (previewLive() ? 'Showing live numbers from the T3. ' : 'Showing sample numbers. ') + 'Drag a widget to move it; tap one to change it. Fonts are close to, not exactly, the T3’s.' }),
        wl, props,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-glass glass', onclick: () => { save(); t3Send({ c: 'page', i: idx }); } }, icon('play'), 'Show on T3'),
          h('button', { class: 'btn btn-primary', onclick: async () => { save(); await sendScreens(st); } }, icon('bt'), 'Send all')),
        confirmButton('Delete this screen', 'Tap again to delete it', () => { st.list.splice(idx, 1); if (!st.list.length) st.list = [DEFAULT_SCREENS[0]]; scrSave(st); sheet.close(); }));
      paintAll();
      const tick = setInterval(() => { if (!document.body.contains(cv)) clearInterval(tick); else if (!drag && previewLive()) redraw(); }, 1000);
    },
  });
}

// ---------------------------------------------------------------- buttons
const ACTIONS = [['next', 'Next screen'], ['prev', 'Previous screen'], ['home', 'Key-on screen'], ['mark', 'Mark this spot'], ['pause', 'Pause / resume trip'],
  ['end', 'End trip (start a new one)'], ['sleep', 'Screen off / on'], ['bright', 'Brightness'], ['peak', 'Reset peak boost'], ['send', 'Send / sync now'], ['none', 'Nothing']];
function parseBtnMap(s) {
  const out = [['prev', 'home'], ['mark', 'pause'], ['next', 'end']];
  String(s || '').split(';').slice(0, 3).forEach((p, i) => { const [a, b2] = p.split(','); if (a) out[i][0] = a.trim(); if (b2) out[i][1] = b2.trim(); });
  return out;
}
function buttonsCard() {
  const t3 = store.get('t3', {});
  const map = parseBtnMap(t3.bm || (LIVE.t3 && LIVE.t3.bm));
  const sel = (i, k) => {
    const s = h('select', null, ACTIONS.map(([v, l]) => h('option', { value: v, text: l })));
    s.value = map[i][k];
    s.addEventListener('change', () => { map[i][k] = s.value; const v = store.get('t3', {}); v.bm = map.map(p => p.join(',')).join(';'); store.set('t3', v); });
    return s;
  };
  const names = ['Button 1 (top)', 'Button 2 (middle)', 'Button 3 (bottom)'];
  const last = h('span', { text: LIVE.v && LIVE.v.btn && LIVE.v.btn !== '-' ? 'Last press: ' + LIVE.v.btn : 'Press a wheel button to see it here' });
  const tick = setInterval(() => { if (!document.body.contains(last)) { clearInterval(tick); return; } if (LIVE.v && LIVE.v.btn && LIVE.v.btn !== '-') last.textContent = 'Last press the T3 got: button ' + LIVE.v.btn[0] + ' ' + ({ S: 'short', L: 'long', R: 'held' })[LIVE.v.btn[1]] + ' (wheel link ' + (LIVE.v.nano || '?') + ')'; }, 500);
  return h('div', { style: 'display:grid;gap:10px' },
    names.map((n, i) => h('div', { class: 'group' }, h('div', { class: 'gr' }, h('b', { text: n })),
      h('label', { class: 'gr' }, h('span', { text: 'Press' }), sel(i, 0)), h('label', { class: 'gr' }, h('span', { text: 'Hold' }), sel(i, 1)))),
    h('div', { class: 'foot' }, last),
    h('div', { class: 'foot', text: 'Hold = 0.6 s. Holding a button set to Next or Previous keeps scrolling. When the T3’s screen is off, the first press only wakes it. Saved with T3 settings: tap "Send settings" below.' }),
    h('button', { class: 'btn btn-glass glass btn-wide', onclick: () => t3SendSettings() }, icon('bt'), 'Send settings to the T3'));
}

// ---------------------------------------------------------------- display settings (part of the T3 settings)
function displayCard() {
  const v = Object.assign({ ss: 60, br: 2, bn: 0, nf: -1, nt: 7, rot: 0, rf: 250, sp: 0 }, LIVE.t3 || {}, store.get('t3', {}));
  const keep = (k, x) => { const s = store.get('t3', {}); s[k] = x; store.set('t3', s); };
  const st = scrState();
  const pages = st.list.map((t, i) => [i, (parseScreen(t) || { name: '?' }).name]);
  const hours = [[-1, 'Never']].concat(Array.from({ length: 24 }, (_, i) => [i, String(i).padStart(2, '0') + ':00']));
  const sel = (k, opts) => { const s = h('select', null, opts.map(([a, b2]) => h('option', { value: String(a), text: b2 }))); s.value = String(v[k]); s.addEventListener('change', () => keep(k, Number(s.value))); return s; };
  return h('div', { style: 'display:grid;gap:10px' },
    h('div', { class: 'group' },
      h('label', { class: 'gr' }, h('span', { text: 'Key-on screen' }), sel('sp', pages)),
      h('label', { class: 'gr' }, h('span', { text: 'Screen off after' }), sel('ss', [[30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min'], [900, '15 min'], [0, 'Never']])),
      h('label', { class: 'gr' }, h('span', { text: 'Brightness' }), sel('br', [[0, 'Low'], [1, 'Medium'], [2, 'High']])),
      h('label', { class: 'gr' }, h('span', { text: 'Night from' }), sel('nf', hours)),
      h('label', { class: 'gr' }, h('span', { text: 'Night until' }), sel('nt', hours.slice(1))),
      h('label', { class: 'gr' }, h('span', { text: 'Night brightness' }), sel('bn', [[0, 'Low'], [1, 'Medium'], [2, 'High']])),
      h('label', { class: 'gr' }, h('span', { text: 'Redraw every' }), sel('rf', [[100, '0.1 s'], [250, '0.25 s'], [500, '0.5 s'], [1000, '1 s']])),
      h('label', { class: 'gr' }, h('span', { text: 'Mounted' }), sel('rot', [[0, 'Normal'], [1, 'Upside down']]))),
    h('div', { class: 'foot', text: 'Night uses the clock from the GPS (or the phone) and the time zone in T3 settings.' }),
    h('button', { class: 'btn btn-glass glass btn-wide', onclick: () => t3SendSettings() }, icon('bt'), 'Send settings to the T3'));
}

if (typeof module !== 'undefined') module.exports = { FIELDS, DEFAULT_SCREENS, SCREEN_TEMPLATES, parseScreen, writeScreen, fnv1a, screensHash, parseBtnMap };
