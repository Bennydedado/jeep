'use strict';
// econ.js - fuel economy from both places it can come from, for the Overview and Distance to empty.
//
//  - The tank: every litre bought between two full fill-ups, over the distance between them. Exact, but only known
//    once a stretch is closed (two full tanks), and it can be weeks old by the time you look.
//  - The T3: the litres it works out while driving, trip by trip. Up to date after every drive, but an estimate
//    (the CRD doesn't report its fuel rate, so the T3 works it out from engine load and RPM).
//
// Where both cover the same full tank (the T3 logged at least half of it), the tank says how far off the T3 is, and
// the T3's litres are corrected by that ("cal", 1.10 = the T3 reads 10 % low). The answer uses what's best:
// the last few full tanks plus the T3's (corrected) driving since the last full fill-up; with no full tanks yet,
// the T3 alone. Plain functions, tested in Node (tests/app/test_econ.js).

const ECON = { recentTanks: 3, minCover: 0.5, minKm: 30, minT3Km: 5 };

// st: what calc() in core.js worked out from the fill-ups (f, tanks, lastFull, odo, tank, perKm, ppl, lastPpl)
// trips: the T3's trips (t0, t1 ms, km, lit); live: the trip going on now ({ id, km, l }), or nothing
function blendEcon(st, trips, live) {
  const n = x => (x === '' || x == null || isNaN(+x) ? null : +x);
  const T = (trips || []).map(t => ({ id: t.id, t0: n(t.t0), t1: n(t.t1), km: n(t.km) || 0, lit: n(t.lit) }))
    .filter(t => t.km > 0 && t.lit > 0 && t.t0);
  // how far off the T3 is: full tanks it logged at least half of
  const fulls = (st.f || []).filter(x => x.full && x.t);
  let wSum = 0, rSum = 0, calN = 0;
  for (let i = 1; i < fulls.length; i++) {
    const a = fulls[i - 1], b = fulls[i];
    if (!b._ || b._.econ == null || !b._.dist) continue;
    let km = 0, lit = 0;
    for (const t of T) if (t.t0 >= a.t && (t.t1 || t.t0) <= b.t) { km += t.km; lit += t.lit; }
    if (km < ECON.minKm || km < ECON.minCover * b._.dist) continue;
    rSum += km * b._.econ / (lit / km * 100); wSum += km; calN++;
  }
  const cal = calN ? Math.min(2, Math.max(0.5, rSum / wSum)) : 1;
  // the T3's driving: all of it, and since the last full fill-up
  const lf = st.lastFull && st.lastFull.t ? st.lastFull : null;
  const all = { km: 0, lit: 0, n: 0, v: null }, since = { km: 0, lit: 0, n: 0, v: null };
  for (const t of T) {
    all.km += t.km; all.lit += t.lit * cal; all.n++;
    if (!lf || t.t0 >= lf.t) { since.km += t.km; since.lit += t.lit * cal; since.n++; }
  }
  if (all.km >= ECON.minT3Km) all.v = all.lit / all.km * 100;
  if (since.km >= ECON.minT3Km) since.v = since.lit / since.km * 100;
  // the answer
  const tanks = (st.tanks || []).slice(-ECON.recentTanks);
  let tLit = 0, tKm = 0;
  for (const x of tanks) { tLit += x._.econ * x._.dist / 100; tKm += x._.dist; }
  const e = { cal, calN, all, since, tanks: tanks.length, tankKm: tKm, src: null, v: null };
  if (tKm > 0 && since.km >= ECON.minT3Km) { e.v = (tLit + since.lit) / (tKm + since.km) * 100; e.src = 'mix'; }
  else if (tKm > 0) { e.v = tLit / tKm * 100; e.src = 'tank'; }
  else if (all.v != null) { e.v = all.v; e.src = 't3'; }
  // cost per km: from the tanks when there are any, else the economy at the last pump price
  const price = st.lastPpl || st.ppl || null;
  if (st.perKm && e.src !== 't3') { e.perKm = st.perKm; e.perKmEst = false; }
  else if (e.v && price) { e.perKm = e.v / 100 * price; e.perKmEst = true; }
  else e.perKm = null;
  e.price = price;
  // the tank now: full at the last full fill-up, plus top-ups since, less what's been used since
  if (e.v && lf && st.tank) {
    let topped = 0;
    for (const x of st.f || []) if (x.odo > lf.odo && !x.full) topped += x.lit || 0;
    let liveKm = 0, liveL = 0;
    if (live && n(live.km) > 0 && !(trips || []).some(t => t.id === live.id)) { liveKm = n(live.km); liveL = (n(live.l) || 0) * cal; }
    const driven = Math.max(0, (st.odo || 0) - lf.odo);            // st.odo already counts the T3's trips since
    const otherKm = Math.max(0, driven - since.km);                // driven without the T3 measuring the diesel
    const used = since.lit + liveL + otherKm * e.v / 100;
    e.fuelL = Math.max(0, Math.min(st.tank, st.tank + topped - used));
    e.fuelPct = e.fuelL / st.tank;
    e.left = e.fuelL / e.v * 100;
    e.range = st.tank / e.v * 100;
    e.used = { measuredKm: since.km + liveKm, measuredL: since.lit + liveL, otherKm, otherL: otherKm * e.v / 100, topped,
      driven: driven + liveKm, from: lf, liveKm };
  }
  return e;
}

if (typeof module !== 'undefined') module.exports = { ECON, blendEcon };
