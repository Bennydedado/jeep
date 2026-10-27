'use strict';
// core.js - the Jeep log on this phone, syncing with the Google Sheet, and the numbers.

const VERSION = '1.1.8';
const TANK_DEFAULT = 77.6; // 2006 Liberty CRD: 20.5 US gal
const PERSONAL = 'Personal tank'; // the Station value for fill-ups from the tank at home

// ---------- this phone's copy (the sheet is the real one)
const store = {
  get(k, d) { try { const v = localStorage.getItem('jeep.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('jeep.' + k, JSON.stringify(v)); } catch (e) { /* private mode or full */ } },
  del(k) { try { localStorage.removeItem('jeep.' + k); } catch (e) { /* ignore */ } },
};

const TABS = ['fill', 'serv', 'log', 'trip'];
const EMPTY = () => ({ fill: [], serv: [], log: [], trip: [], info: {} });

const S = {
  conn: store.get('conn', null),   // { u: web app URL, k: key, s: spreadsheet id }
  data: store.get('data', null) || EMPTY(),
  queue: store.get('queue', []),   // changes not in the sheet yet
  syncedAt: store.get('syncedAt', 0),
  prefs: Object.assign({ theme: 'system', vehicle: '2006 Liberty CRD', priceMode: 'total' }, store.get('prefs', {})),
  tab: store.get('tab', 'home'),
  sync: { busy: false, state: 'idle', msg: '' }, // idle ok busy pending offline unreachable error key
  sample: false,
};
let STATS = null;

function persist() {
  if (S.sample) return;
  store.set('conn', S.conn);
  store.set('data', S.data);
  store.set('queue', S.queue);
  store.set('syncedAt', S.syncedAt);
}
function savePrefs() { store.set('prefs', S.prefs); }

function newId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// the same changes the sheet's script makes, applied here first so the app never waits
function applyLocal(d, op) {
  if (op.op === 'info') { Object.assign(d.info, op.set); return; }
  const arr = d[op.tab];
  if (!arr) return;
  const i = arr.findIndex(x => x.id === (op.op === 'del' ? op.id : op.row.id));
  if (op.op === 'put') {
    if (i >= 0) arr[i] = Object.assign({}, arr[i], op.row); else arr.push(Object.assign({}, op.row));
  } else if (op.op === 'del' && i >= 0) arr.splice(i, 1);
}

// every change goes through here: on screen now, into the sheet as soon as there's signal
function commit(...ops) {
  for (const op of ops) {
    op.q = newId('q');
    applyLocal(S.data, op);
    if (!S.sample) S.queue.push(op);
  }
  persist();
  render();
  if (!S.sample) sync('change');
}

function normalize(j) {
  const d = EMPTY();
  for (const k of TABS) d[k] = Array.isArray(j[k]) ? j[k].filter(x => x && x.id) : [];
  d.info = (j.info && typeof j.info === 'object') ? j.info : {};
  return d;
}

let syncAgain = false, retryTimer = 0;
async function sync(why) {
  if (!S.conn || S.sample) return;
  if (S.sync.busy) { syncAgain = true; return; }
  S.sync.busy = true;
  setSync('busy');
  const ops = S.queue.slice(0, 40);
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), 35000);
  try {
    // text/plain keeps this a "simple" request, which Apps Script accepts from any site
    const res = await fetch(S.conn.u, { method: 'POST', body: JSON.stringify({ k: S.conn.k, ops }), signal: ctl ? ctl.signal : undefined, cache: 'no-store', redirect: 'follow' });
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { const err = new Error('not-json'); err.notJson = true; throw err; }
    const done = new Set((j.done || []).filter(Boolean));
    if (done.size) S.queue = S.queue.filter(op => !done.has(op.q));
    if (!j.ok) {
      setSync(j.error === 'key' ? 'key' : 'error', j.error === 'key' ? '' : String(j.error || ''));
    } else {
      S.data = normalize(j);
      for (const op of S.queue) applyLocal(S.data, op); // changes made while this was on its way
      S.syncedAt = Date.now();
      setSync(S.queue.length ? 'pending' : 'ok');
      if (S.queue.length && done.size) syncAgain = true;
    }
    persist();
    render();
  } catch (e) {
    if (e && e.notJson) setSync('error', 'The sheet answered with something that isn\'t the Jeep log. Check the script is deployed as a web app with access for Anyone.');
    else setSync(navigator.onLine === false ? 'offline' : 'unreachable');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!document.hidden) sync('retry'); }, 30000);
  } finally {
    clearTimeout(timer);
    S.sync.busy = false;
    if (syncAgain) { syncAgain = false; setTimeout(() => sync('again'), 60); }
  }
}

function setSync(state, msg) {
  if (state === 'busy') { S.sync.prev = S.sync.state; }
  S.sync.state = state;
  S.sync.msg = msg || '';
  if (typeof updateSyncButtons === 'function') updateSyncButtons();
}

// ---------- the setup link: https://.../jeep/#setup=<base64url of {"u":...,"k":...,"s":...}>
function encodeSetup(c) {
  const b = btoa(unescape(encodeURIComponent(JSON.stringify({ u: c.u, k: c.k, s: c.s || '' }))));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeSetup(text) {
  const m = String(text || '').match(/setup=([A-Za-z0-9_\-]+)/);
  if (!m) return null;
  try {
    let b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const j = JSON.parse(decodeURIComponent(escape(atob(b))));
    if (j && /^https:\/\/script\.google(usercontent)?\.com\//.test(j.u) && j.k) return { u: j.u, k: String(j.k), s: j.s || '' };
  } catch (e) { /* not a setup link */ }
  return null;
}
function setupLink() {
  if (!S.conn) return location.origin + location.pathname;
  return location.origin + location.pathname + '#setup=' + encodeSetup(S.conn);
}
function connect(c) {
  const same = S.conn && S.conn.u === c.u && S.conn.k === c.k;
  S.conn = c;
  if (!same) {
    S.data = EMPTY();
    S.queue = [];
    S.syncedAt = 0;
  }
  S.sample = false;
  persist();
  return !same;
}
function forgetPhone() {
  for (const k of ['conn', 'data', 'queue', 'syncedAt']) store.del(k);
  S.conn = null; S.queue = []; S.syncedAt = 0;
  S.sample = true; S.data = sampleData();
  setSync('idle');
}

// ---------- numbers
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt0 = n => nf0.format(Math.round(n));
const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1);
const fmt2 = n => (Math.round(n * 100) / 100).toFixed(2);
function money(n, d = 2) {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (n < 0 ? '-$' : '$') + s;
}
function num(s) {
  if (typeof s === 'number') return s;
  const t = String(s == null ? '' : s).replace(/[\s,$]/g, '');
  if (t === '' || t === '.') return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayStart(t) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function fmtDay(t, long) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  const diff = Math.round((dayStart(now) - dayStart(t)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7 && !long) return DAYS[d.getDay()];
  return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== now.getFullYear() || long ? ', ' + d.getFullYear() : '');
}
function fmtDate(t) { const d = new Date(t); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
function fmtTime(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function ago(t) {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : d + ' days ago';
}
function inDays(days) {
  const d = Math.round(Math.abs(days));
  if (d < 1) return 'today';
  if (d < 45) return d + (d === 1 ? ' day' : ' days');
  const m = Math.round(d / 30.4);
  return m < 18 ? m + ' months' : (Math.round(d / 36.5) / 10) + ' years';
}
function dur(sec) {
  const m = Math.round(sec / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}
function toLocalInput(t, dateOnly) {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  const day = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  return dateOnly ? day : day + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function fromLocalInput(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).getTime();
}
function addMonths(t, n) {
  const d = new Date(t), day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.getTime();
}

// fuel economy works on full tanks: every litre bought since the last full tank, over the distance since it
function calc(d) {
  // a fill-up from the personal tank can be just the odometer: the tank is full, the litres aren't known
  const f = d.fill.filter(x => num(x.odo) > 0 && (num(x.lit) > 0 || x.full !== false))
    .map(x => { const lit = num(x.lit) || 0; return Object.assign({}, x, { odo: num(x.odo), lit, cost: num(x.cost) || 0, full: x.full !== false, unknown: !(lit > 0) }); })
    .sort((a, b) => (a.odo - b.odo) || ((a.t || 0) - (b.t || 0)));
  // each full tank closes a stretch; stretches that end in unknown litres don't count toward the averages
  let prevFull = null, prevAny = null, acc = 0, accCost = 0, lastF = null, litR = 0, distR = 0, costR = 0;
  for (const x of f) {
    x._ = { econ: null, dist: null, est: null, since: prevAny ? x.odo - prevAny.odo : null, ppl: x.lit > 0 && x.cost > 0 ? x.cost / x.lit : null };
    if (prevFull) { acc += x.lit; accCost += x.cost; }
    if (x.full) {
      if (prevFull && x.odo > prevFull.odo) {
        x._.dist = x.odo - prevFull.odo;
        if (!x.unknown) { x._.econ = acc / x._.dist * 100; litR += acc; distR += x._.dist; costR += accCost; }
      }
      prevFull = x; acc = 0; accCost = 0; lastF = x;
    }
    prevAny = x;
  }
  const st = { f, n: f.length, lit: 0, cost: 0, estLit: 0, tops: f.filter(x => !x.full).length };
  for (const x of f) { st.lit += x.lit; st.cost += x.cost; }
  if (distR > 0) { st.avg = litR / distR * 100; st.perKm = costR > 0 ? costR / distR : null; }
  if (st.avg) for (const x of f) if (x.unknown && x._.dist) { x._.est = x._.dist * st.avg / 100; st.estLit += x._.est; }
  st.tanks = f.filter(x => x._.econ != null);
  if (st.tanks.length) {
    const e = st.tanks.map(x => x._.econ);
    st.last = e[e.length - 1];
    st.best = Math.min(...e);
    st.worst = Math.max(...e);
  }
  st.dist = f.length >= 2 ? f[f.length - 1].odo - f[0].odo : 0;
  st.lastFill = f[f.length - 1] || null;
  st.lastFull = lastF;
  const priced = f.filter(x => x._.ppl && x.station !== PERSONAL);
  st.personal = { n: 0, lit: 0, cost: 0, est: false };
  for (const x of f) if (x.station === PERSONAL) { st.personal.n++; st.personal.lit += x.unknown ? (x._.est || 0) : x.lit; st.personal.est = st.personal.est || x.unknown; st.personal.cost += x.cost; }
  if (priced.length) {
    st.ppl = priced.reduce((s, x) => s + x.cost, 0) / priced.reduce((s, x) => s + x.lit, 0);
    st.lastPpl = priced[priced.length - 1]._.ppl;
  }
  // the odometer: the latest of a fill-up and a reading typed in
  const io = num(d.info.odo) || 0;
  const lf = st.lastFill;
  if (lf && lf.odo >= io) { st.odo = lf.odo; st.odoT = lf.t || null; st.odoFrom = 'fill'; }
  else { st.odo = io; st.odoT = num(d.info.odoT) || null; st.odoFrom = io ? 'typed' : null; }
  // trips the T3 logged since then move it along
  if (st.odoT) {
    let km = 0;
    for (const t of d.trip) if (num(t.t0) > st.odoT && num(t.km) > 0) km += num(t.km);
    if (km > 0) { st.tripKm = km; st.odo += km; st.odoT = Math.max(...d.trip.map(t => num(t.t1) || 0)); st.odoFrom = 'trips'; }
  }
  // how often
  const ts = f.map(x => x.t).filter(Boolean);
  if (ts.length >= 2) {
    const span = (Math.max(...ts) - Math.min(...ts)) / 864e5;
    if (span > 0) { st.daysBetween = span / (ts.length - 1); st.kmPerDay = st.dist / span; }
  }
  st.months = monthly(f);
  const now = new Date();
  st.thisMonth = st.months[st.months.length - 1];
  st.year = { cost: 0, lit: 0, n: 0 };
  for (const x of f) if (x.t && new Date(x.t).getFullYear() === now.getFullYear()) { st.year.cost += x.cost; st.year.lit += x.lit; st.year.n++; }
  // the tank
  st.tank = num(d.info.tank) || TANK_DEFAULT;
  if (st.avg) st.range = st.tank / st.avg * 100;
  if (st.avg && lastF) {
    const driven = Math.max(0, st.odo - lastF.odo);
    let topped = 0;
    for (const x of f) if (x.odo > lastF.odo && !x.full) topped += x.lit;
    st.fuelL = Math.max(0, Math.min(st.tank, st.tank + topped - driven * st.avg / 100));
    st.fuelPct = st.fuelL / st.tank;
    st.left = st.fuelL / st.avg * 100;
    st.driven = driven;
  }
  return st;
}

function monthly(f, n = 12) {
  const now = new Date(), out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: d.getFullYear() * 12 + d.getMonth(), y: d.getFullYear(), m: d.getMonth(), cost: 0, lit: 0, n: 0 });
  }
  for (const x of f) {
    if (!x.t) continue;
    const d = new Date(x.t), b = out.find(o => o.key === d.getFullYear() * 12 + d.getMonth());
    if (b) { b.cost += x.cost; b.lit += x.lit; b.n++; }
  }
  return out;
}

// what a fill-up being typed works out to, against everything else in the log
function previewFill(m, editingId) {
  const others = (STATS ? STATS.f : []).filter(x => x.id !== editingId);
  let prev = null;
  for (const x of others) if (x.odo < m.odo) prev = x;
  const out = { prev };
  if (m.odo > 0 && m.unknown) { out.personal = true; return out; }
  if (!(m.odo > 0) || !(m.lit > 0)) return out;
  if (!m.full) { out.top = true; return out; }
  let acc = m.lit, full = null;
  for (let i = others.length - 1; i >= 0; i--) {
    const x = others[i];
    if (x.odo >= m.odo) continue;
    if (x.full) { full = x; break; }
    acc += x.lit;
  }
  if (!full) { out.first = true; return out; }
  out.dist = m.odo - full.odo;
  out.econ = acc / out.dist * 100;
  if (m.cost > 0) {
    let spent = m.cost;
    for (const x of others) if (x.odo > full.odo && x.odo < m.odo) spent += x.cost;
    out.perKm = spent / out.dist;
  }
  return out;
}

// service reminders: due by distance, by time, or both - whichever comes first
function servState(s, odo, now = Date.now()) {
  const o = { kmLeft: null, daysLeft: null, nextKm: null, nextT: null, frac: 0, state: 'ok' };
  const km = num(s.km), mo = num(s.mo), lastKm = num(s.lastKm), lastT = num(s.lastT);
  if (km > 0 && lastKm != null) { o.nextKm = lastKm + km; o.kmLeft = o.nextKm - odo; o.frac = Math.max(o.frac, (odo - lastKm) / km); }
  if (mo > 0 && lastT) { o.nextT = addMonths(lastT, mo); o.daysLeft = (o.nextT - now) / 864e5; o.frac = Math.max(o.frac, (now - lastT) / Math.max(1, o.nextT - lastT)); }
  if (o.nextKm == null && o.nextT == null) o.state = 'none';
  else if ((o.kmLeft != null && o.kmLeft < 0) || (o.daysLeft != null && o.daysLeft < 0)) o.state = 'over';
  else if ((o.kmLeft != null && o.kmLeft <= 1000) || (o.daysLeft != null && o.daysLeft <= 30)) o.state = 'soon';
  o.frac = Math.max(0, Math.min(1, o.frac));
  return o;
}
const STATE_WORD = { ok: 'OK', soon: 'Due soon', over: 'Overdue', none: 'No interval' };
function servSorted(d, odo) {
  const rank = { over: 0, soon: 1, ok: 2, none: 3 };
  return d.serv.map(s => ({ s, o: servState(s, odo) })).sort((a, b) => (rank[a.o.state] - rank[b.o.state]) || (b.o.frac - a.o.frac));
}

// ---------- sample data, shown only until the app is connected to the sheet
function sampleData() {
  const d = EMPTY(), day = 864e5;
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stations = ['Esso', 'Petro-Canada', 'Co-op', 'Shell'];
  let t = dayStart(Date.now() - 196 * day) + 17.5 * 3600e3, odo = 241320;
  d.fill.push({ id: 'x0', t, odo, lit: 66.4, cost: 109.5, full: true, station: stations[0], note: '' });
  for (let i = 1; i <= 15; i++) {
    const gap = 10 + Math.floor(rnd() * 6), dist = Math.round(540 + rnd() * 170);
    const econ = 9.0 + rnd() * 1.4 + (i > 11 ? 0.5 : 0);
    const ppl = 1.64 + rnd() * 0.22;
    let lit = dist * econ / 100;
    if (i === 6 || i === 12) {
      const top = 21 + Math.round(rnd() * 6);
      d.fill.push({ id: 'xt' + i, t: t + Math.round(gap / 2) * day, odo: odo + Math.round(dist * .55), lit: top, cost: +(top * ppl).toFixed(2), full: false, station: stations[3], note: '' });
      lit -= top;
    }
    t += gap * day + Math.round(rnd() * 5) * 3600e3; odo += dist;
    d.fill.push({ id: 'x' + i, t, odo, lit: +lit.toFixed(2), cost: +(lit * ppl).toFixed(2), full: true, station: stations[Math.floor(rnd() * 3)], note: '' });
  }
  const last = d.fill[d.fill.length - 1];
  d.info = { odo: last.odo + 236, odoT: Date.now() - 2 * day, tank: TANK_DEFAULT };
  d.serv = [
    { id: 'xs1', name: 'Oil change', km: 8000, mo: 6, lastKm: last.odo - 6400, lastT: Date.now() - 128 * day, note: '' },
    { id: 'xs2', name: 'Fuel filter', km: 24000, mo: 24, lastKm: last.odo - 15200, lastT: Date.now() - 300 * day, note: '' },
    { id: 'xs3', name: 'Tire rotation', km: 10000, mo: null, lastKm: last.odo - 9480, lastT: Date.now() - 170 * day, note: '' },
  ];
  d.log = [
    { id: 'xl1', sid: 'xs1', name: 'Oil change', t: Date.now() - 128 * day, odo: last.odo - 6400, cost: 118.4, note: '5W-40 synthetic' },
    { id: 'xl2', sid: 'xs3', name: 'Tire rotation', t: Date.now() - 170 * day, odo: last.odo - 9480, cost: 0, note: '' },
    { id: 'xl3', sid: 'xs2', name: 'Fuel filter', t: Date.now() - 300 * day, odo: last.odo - 15200, cost: 64.99, note: '' },
  ];
  for (let i = 0; i < 4; i++) {
    const t1 = Date.now() - (i * 1.3 + 0.2) * day, s = 900 + Math.round(rnd() * 2400), km = s / 3600 * (55 + rnd() * 30);
    d.trip.push({ id: 'xr' + i, t0: t1 - s * 1000, t1, km: +km.toFixed(1), lit: +(km * (9 + rnd() * 2) / 100).toFixed(2), vmax: Math.round(80 + rnd() * 30), idle: Math.round(rnd() * 6), note: '' });
  }
  return d;
}
