'use strict';
// trips.js - turning a T3 track (the CSV rows it logged on its SD card) into what the Map page shows:
// points, the gaps where the GPS had no fix, distance, times, speeds, stops, temperatures.
//
// No drawing in here, so the same functions run in tests/app/test_trips.js under Node.
// The recorded track is never changed: drawing uses a simplified copy (simplify()), the numbers use every point.

const TRK = {
  gapSec: 20,        // no fix for longer than this, or points further apart in time: the line breaks (a gap)
  jumpKmh: 250,      // two fixes implying a faster speed than this: a GPS jump, the line breaks
  moveKmh: 3,        // slower than this counts as stopped
  stopSec: 120,      // stopped at least this long (within stopM metres) counts as a stop
  stopM: 60,
  maxHdop: 6,        // fixes worse than this are kept in the file but not used for distance
};

function trkNum(s) { if (s == null || s === '') return null; const n = Number(s); return isFinite(n) ? n : null; }

// metres between two points
function distM(la1, lo1, la2, lo2) {
  const r = 6371000, k = Math.PI / 180, dla = (la2 - la1) * k, dlo = (lo2 - lo1) * k;
  const a = Math.sin(dla / 2) ** 2 + Math.cos(la1 * k) * Math.cos(la2 * k) * Math.sin(dlo / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// CSV text (first line = column names) -> rows. Columns are found by name, so new columns added
// to the T3's log later don't break older Heep versions.
function parseTrack(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { rows: [], cols: [] };
  const cols = lines[0].split(',');
  const at = name => cols.indexOf(name);
  const C = { ms: at('ms'), up: at('up'), tq: at('tq'), lat: at('lat'), lon: at('lon'), fix: at('fix'), sats: at('sats'), hdop: at('hdop'), alt: at('alt'),
    kmh: at('kmh'), crs: at('crs'), okmh: at('obd_kmh'), rpm: at('rpm'), boost: at('boost'), ect: at('ect'), ot: at('otemp'), tkm: at('trip_km'), ev: at('ev'),
    iat: at('iat'), volt: at('volt'), load: at('load'), lph: at('lph') };
  const g = (r, i) => (i < 0 ? null : trkNum(r[i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i].split(',');
    if (r.length < 3) continue;
    const lat = g(r, C.lat), lon = g(r, C.lon);
    const ok = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    rows.push({ ms: g(r, C.ms), up: g(r, C.up), tq: C.tq >= 0 ? r[C.tq] : '', lat: ok ? lat : null, lon: ok ? lon : null,
      sats: g(r, C.sats), hdop: g(r, C.hdop), alt: g(r, C.alt), kmh: g(r, C.kmh), crs: g(r, C.crs), okmh: g(r, C.okmh),
      rpm: g(r, C.rpm), boost: g(r, C.boost), ect: g(r, C.ect), ot: g(r, C.ot), tkm: g(r, C.tkm), ev: C.ev >= 0 ? (r.slice(C.ev).join(',') || '') : '',
      iat: g(r, C.iat), volt: g(r, C.volt), load: g(r, C.load), lph: g(r, C.lph) });
    const last = rows[rows.length - 1];
    last.v = last.kmh != null ? last.kmh : last.okmh;   // speed: GPS, else the engine's
  }
  fillTimes(rows);
  return { rows, cols };
}

// every row gets t (epoch ms) and tq: 'g' GPS, 'n' internet, 'a' phone, 'e' estimated from the T3's own clock
// relative to a row that had a real time, or null when the whole trip had no clock at all.
function fillTimes(rows) {
  let off = null;
  for (const r of rows) if (r.ms != null && r.up != null) { off = r.ms - r.up; if (r.tq === 'g') break; }
  for (const r of rows) {
    if (r.ms != null) { r.t = r.ms; r.est = false; }
    else if (off != null && r.up != null) { r.t = r.up + off; r.est = true; r.tq = 'e'; }
    else { r.t = null; r.est = true; }
  }
}

// the track as unbroken pieces (segments) and the gaps between them
function segments(rows, o = TRK) {
  const segs = [], gaps = [];
  let cur = [], last = null, lastRow = null;
  const close = () => { if (cur.length) segs.push(cur); cur = []; };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.lat == null) continue;
    if (last) {
      const dtS = r.up != null && last.up != null ? (r.up - last.up) / 1000 : null;
      const d = distM(last.lat, last.lon, r.lat, r.lon);
      const kmh = dtS > 0 ? d / dtS * 3.6 : null;
      const why = dtS != null && dtS > o.gapSec ? 'no GPS' : kmh != null && kmh > o.jumpKmh && d > 200 ? 'GPS jump' : null;
      if (why) { gaps.push({ a: lastRow, b: i, sec: dtS, m: d, why }); close(); }
    }
    cur.push(i);
    last = r; lastRow = i;
  }
  close();
  return { segs, gaps };
}

// everything the trip page shows, from every point (not the simplified line)
function tripStats(rows, o = TRK) {
  const { segs, gaps } = segments(rows, o);
  const s = { m: 0, movingS: 0, vmax: null, vmaxAt: null, t0: null, t1: null, est: false, durS: null, fixes: 0, rows: rows.length,
    tmin: null, tmax: null, tavg: null, stops: [], gaps, segs, marks: [], a0: null, a1: null, timeKnown: false, bmax: null,
    rpmMax: null, ectMax: null, lit: null, mObd: 0, kmFrom: 'gps' };
  // time: first and last row; "estimated" if any row's time was worked out rather than read
  const timed = rows.filter(r => r.t != null);
  if (timed.length) { s.t0 = timed[0].t; s.t1 = timed[timed.length - 1].t; s.timeKnown = true; s.est = timed[0].est || timed[timed.length - 1].est; }
  const ups = rows.filter(r => r.up != null);
  if (ups.length > 1) s.durS = (ups[ups.length - 1].up - ups[0].up) / 1000;
  // distance along each segment: only while moving (standing still the fix wanders a few metres)
  for (const seg of segs) {
    for (let k = 1; k < seg.length; k++) {
      const a = rows[seg[k - 1]], b = rows[seg[k]];
      if (b.hdop != null && b.hdop > o.maxHdop) continue;
      const d = distM(a.lat, a.lon, b.lat, b.lon);
      const moving = b.kmh == null ? d > 8 : b.kmh >= o.moveKmh || a.kmh >= o.moveKmh;
      if (moving) s.m += d;
    }
  }
  let tSum = 0, tN = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.lat != null) { s.fixes++; if (!s.a0) s.a0 = [r.lat, r.lon]; s.a1 = [r.lat, r.lon]; }
    const v = r.kmh != null ? r.kmh : r.okmh;
    if (v != null && (s.vmax == null || v > s.vmax)) { s.vmax = v; s.vmaxAt = i; }
    if (r.boost != null && (s.bmax == null || r.boost > s.bmax)) s.bmax = r.boost;
    if (r.ot != null) { tSum += r.ot; tN++; s.tmin = s.tmin == null ? r.ot : Math.min(s.tmin, r.ot); s.tmax = s.tmax == null ? r.ot : Math.max(s.tmax, r.ot); }
    if (r.rpm != null && (s.rpmMax == null || r.rpm > s.rpmMax)) s.rpmMax = r.rpm;
    if (r.ect != null && (s.ectMax == null || r.ect > s.ectMax)) s.ectMax = r.ect;
    const dt = i && r.up != null && rows[i - 1].up != null ? (r.up - rows[i - 1].up) / 1000 : 0;
    if (dt > 0 && dt < o.gapSec) {
      if (v != null && v >= o.moveKmh) s.movingS += dt;
      if (r.okmh != null) s.mObd += r.okmh / 3.6 * dt;                                  // distance from the engine's speed
      if (r.lph != null && r.lph >= 0) s.lit = (s.lit || 0) + r.lph * dt / 3600;          // fuel from the engine's fuel rate
    }
    if (r.ev) s.marks.push(i);
  }
  if (tN) s.tavg = tSum / tN;
  s.km = s.m / 1000;
  // no GPS (or hardly any): the distance comes from the T3's trip meter, else the engine's speed
  if (s.m < 50 && s.fixes < 10) {
    const tk = rows.filter(r => r.tkm != null);
    const meter = tk.length > 1 ? tk[tk.length - 1].tkm - tk[0].tkm : 0;
    if (meter > 0.05) { s.km = meter; s.kmFrom = 't3'; }
    else if (s.mObd > 50) { s.km = s.mObd / 1000; s.kmFrom = 'obd'; }
  }
  s.avgMoving = s.movingS > 60 ? s.km / (s.movingS / 3600) : null;
  s.avgAll = s.durS > 60 ? s.km / (s.durS / 3600) : null;
  s.stops = findStops(rows, o);
  return s;
}

// likely stops: slower than moveKmh for at least stopSec, staying within stopM of where it stopped.
// Needs the T3's clock (`up`) on each row; never guessed across a gap with no rows.
function findStops(rows, o = TRK) {
  const stops = [];
  let st = null;
  const finish = endIdx => {
    if (!st) return;
    const a = rows[st.i], b = rows[endIdx];
    const sec = (b.up - a.up) / 1000;
    if (sec >= o.stopSec && st.lat != null) stops.push({ i: st.i, j: endIdx, sec, lat: st.lat, lon: st.lon, t: a.t, est: a.est });
    st = null;
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.up == null) { finish(Math.max(0, i - 1)); continue; }
    const v = r.kmh != null ? r.kmh : r.okmh;
    if (i && rows[i - 1].up != null && (r.up - rows[i - 1].up) / 1000 > o.gapSec * 3) { finish(i - 1); }   // a hole in the log: don't stretch a stop across it
    const still = v != null && v < o.moveKmh;
    if (still) {
      if (!st) st = { i, lat: r.lat, lon: r.lon };
      else if (st.lat == null && r.lat != null) { st.lat = r.lat; st.lon = r.lon; }
      else if (r.lat != null && st.lat != null && distM(st.lat, st.lon, r.lat, r.lon) > o.stopM) { finish(i - 1); st = { i, lat: r.lat, lon: r.lon }; }
    } else finish(i - 1);
  }
  finish(rows.length - 1);
  return stops;
}

// fewer points for drawing (Douglas-Peucker, tolerance in metres) - the numbers above always use all points
function simplify(rows, idx, tolM) {
  if (idx.length < 3) return idx.slice();
  const lat0 = rows[idx[0]].lat * Math.PI / 180;
  const X = i => rows[i].lon * 111320 * Math.cos(lat0), Y = i => rows[i].lat * 110540;
  const keep = new Uint8Array(idx.length);
  keep[0] = keep[idx.length - 1] = 1;
  const stack = [[0, idx.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = X(idx[a]), ay = Y(idx[a]), bx = X(idx[b]), by = Y(idx[b]);
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let best = -1, bd = 0;
    for (let k = a + 1; k < b; k++) {
      const px = X(idx[k]) - ax, py = Y(idx[k]) - ay;
      let d;
      if (L === 0) d = Math.hypot(px, py);
      else { const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L)); d = Math.hypot(px - t * dx, py - t * dy); }
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0 && bd > tolM) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return idx.filter((_, k) => keep[k]);
}

// the recorded point nearest to (lat, lon), or -1
function nearestRow(rows, lat, lon) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.lat == null) continue;
    const d = (r.lat - lat) ** 2 + ((r.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// a made-up drive (labelled "Sample" everywhere it shows) so the Map page can be tried before the GPS is in
function sampleTrack(seed = 1, startMs = Date.now() - 864e5) {
  let x = seed * 9301 + 49297;
  const rnd = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  const head = ['ms,up,tq,lat,lon,fix,sats,hdop,alt,kmh,crs,obd_kmh,rpm,boost,ect,iat,volt,load,lph,otemp,trip_km,ev'];
  let lat = 56.2465 + rnd() * 0.01, lon = -120.8476, crs = 90, v = 0, km = 0, t = 0, up = 30000;
  const legs = [[0, 20, 90], [60, 140, 90], [0, 150, 90], [80, 400, 75], [0, 40, 75], [50, 160, 0], [90, 300, 10], [0, 30, 10]];
  const rows = [];
  for (const [target, secs, dir] of legs) {
    for (let s = 0; s < secs; s++) {
      v += Math.max(-6, Math.min(3, (target - v) * 0.15)) + (rnd() - .5);
      if (v < 0.5 && target === 0) v = 0;
      crs += (dir - crs) * 0.05 + (rnd() - .5) * 2;
      const d = v / 3.6;
      lat += d * Math.cos(crs * Math.PI / 180) / 110540;
      lon += d * Math.sin(crs * Math.PI / 180) / (111320 * Math.cos(lat * Math.PI / 180));
      km += d / 1000; t += 1000; up += 1000;
      const gap = t > 420000 && t < 450000;   // half a minute under a bridge: no fix
      const jitter = v < 1 ? (rnd() - .5) * 0.00003 : 0;
      rows.push([startMs + t, up, 'g', gap ? '' : (lat + jitter).toFixed(6), gap ? '' : (lon + jitter).toFixed(6), gap ? 2 : 4, gap ? '' : 9, gap ? '' : '0.9', 690,
        gap ? '' : v.toFixed(1), gap || v < 5 ? '' : Math.round((crs + 360) % 360), Math.round(v), Math.round(800 + v * 28), Math.max(0, (v - 20) * .2).toFixed(1),
        85, 8, 14.1, 40, (1 + v * .07).toFixed(2), (-6.5 + t / 600000 + rnd() * .1).toFixed(1), km.toFixed(3), s === 5 && target === 0 && dir === 75 ? 'mark wheel' : ''].join(','));
    }
  }
  return head.concat(rows).join('\n');
}

// ---------------------------------------------------------------- totals of the T3's trips by week, month or year
// The start of the week (Monday), month or year that time t falls in, on this phone's clock.
function periodStart(t, unit) {
  const d = new Date(t);
  if (unit === 'y') return new Date(d.getFullYear(), 0, 1).getTime();
  if (unit === 'm') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7).getTime();
}
// trip summaries (the sheet's Trips rows: t0, t1, km, lit, vmax, idle in minutes) -> the last `count` periods, oldest
// first, each { start, end, n, km, secs, lit, litKm (distance of the trips that know their diesel), idle, vmax }.
function tripTotals(trips, unit, count, now = Date.now()) {
  const n = x => (x === '' || x == null || isNaN(+x) ? null : +x);
  const out = [];
  let st = periodStart(now, unit), end = unit === 'y' ? new Date(new Date(st).getFullYear() + 1, 0, 1).getTime() : unit === 'm' ? new Date(new Date(st).getFullYear(), new Date(st).getMonth() + 1, 1).getTime() : st + 7 * 864e5 + 3600e3;
  end = periodStart(end, unit);   // (a week can be 23 or 25 hours short or long at the clock changes)
  for (let i = 0; i < count; i++) { out.unshift({ start: st, end, n: 0, km: 0, secs: 0, lit: 0, litKm: 0, idle: 0, vmax: 0 }); end = st; st = periodStart(st - 1, unit); }
  for (const t of trips || []) {
    const at = n(t.t0) || n(t.t1);
    if (!at) continue;
    const p = out.find(x => at >= x.start && at < x.end);
    if (!p) continue;
    const km = n(t.km) || 0, lit = n(t.lit), s = (n(t.t1) || 0) - (n(t.t0) || 0);
    p.n++; p.km += km; if (s > 0) p.secs += s / 1000;
    if (lit != null && lit > 0) { p.lit += lit; p.litKm += km; }
    p.idle += n(t.idle) || 0; p.vmax = Math.max(p.vmax, n(t.vmax) || 0);
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { TRK, distM, parseTrack, fillTimes, segments, tripStats, findStops, simplify, nearestRow, sampleTrack, periodStart, tripTotals };
