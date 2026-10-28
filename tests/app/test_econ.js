// test_econ.js - fuel economy from the tank and the T3 together (node tests/app/test_econ.js)
'use strict';
const { blendEcon } = require('../../econ.js');
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } };
const near = (a, b, eps, msg) => ok(a != null && Math.abs(a - b) <= eps, msg + ' (got ' + a + ', want ' + b + '±' + eps + ')');
const day = 864e5, T0 = Date.UTC(2026, 8, 1);
const fill = (t, odo, lit, full = true, cost = lit * 1.7) => ({ t, odo, lit, full, cost, _: {} });
const trip = (id, t0, km, lit) => ({ id, t0, t1: t0 + 3600e3, km, lit });

// 1. no fill-ups yet: the T3 alone
{
  const st = { f: [], tanks: [], lastFull: null, odo: 0, tank: 77.6 };
  const e = blendEcon(st, [trip('a', T0, 30, 3.3), trip('b', T0 + day, 20, 2.2), trip('c', T0 + 2 * day, 10, '')]);
  ok(e.src === 't3', 'no tanks: from the T3');
  near(e.v, 11, 0.01, 'T3 economy (the trip without litres doesn\'t count)');
  ok(e.cal === 1 && e.calN === 0, 'nothing to correct it with yet');
  ok(e.fuelL == null, 'no full fill-up: the tank level isn\'t known');
  const e2 = blendEcon(st, [trip('a', T0, 3, 0.5)]);
  ok(e2.v == null && e2.src == null, 'under 5 km: no number yet');
}
// 2. one full fill-up (like now): economy from the T3, the tank level from what it used since
{
  const f = [fill(T0, 159557, 1.93, true, 5.07)];
  f[0]._ = { ppl: 5.07 / 1.93 };
  const st = { f, tanks: [], lastFull: f[0], odo: 159557 + 6.23, tank: 77.6, lastPpl: 5.07 / 1.93 };
  const e = blendEcon(st, [trip('t85-1', T0 + day, 3.51, 0.73), trip('t87-1', T0 + 2 * day, 2.72, 0.31)]);
  ok(e.src === 't3', 'one fill-up: still the T3');
  near(e.v, 1.04 / 6.23 * 100, 0.01, 'economy from 6 km');
  near(e.fuelL, 77.6 - 1.04, 0.01, 'tank: full less what the T3 measured');
  near(e.left, (77.6 - 1.04) / e.v * 100, 0.1, 'distance to empty at that economy');
  ok(e.perKmEst && Math.abs(e.perKm - e.v / 100 * 5.07 / 1.93) < 1e-9, 'cost per km: economy x pump price, marked as an estimate');
  // driving the T3 didn't measure counts at the economy
  const e2 = blendEcon(Object.assign({}, st, { odo: 159557 + 106.23 }), [trip('t85-1', T0 + day, 3.51, 0.73), trip('t87-1', T0 + 2 * day, 2.72, 0.31)]);
  near(e2.used.otherKm, 100, 0.01, '100 km without the T3 measuring');
  near(e2.fuelL, 77.6 - 1.04 - 100 * e2.v / 100, 0.01, 'counted at the economy');
  // the trip going on now
  const e3 = blendEcon(st, [trip('t85-1', T0 + day, 3.51, 0.73), trip('t87-1', T0 + 2 * day, 2.72, 0.31)], { id: 't88-1', km: 10, l: 1.2 });
  near(e3.fuelL, 77.6 - 1.04 - 1.2, 0.01, 'the trip going on now counts too');
  const e4 = blendEcon(st, [trip('t85-1', T0 + day, 3.51, 0.73), trip('t87-1', T0 + 2 * day, 2.72, 0.31)], { id: 't87-1', km: 2.72, l: 0.31 });
  near(e4.fuelL, 77.6 - 1.04, 0.01, 'a live trip that is already saved isn\'t counted twice');
}
// 3. full tanks the T3 logged: the tank corrects the T3, and the answer uses both
{
  const a = fill(T0, 100000, 70), b = fill(T0 + 10 * day, 100600, 60), c = fill(T0 + 20 * day, 101200, 66);
  b._ = { econ: 10, dist: 600 }; c._ = { econ: 11, dist: 600 };
  const st = { f: [a, b, c], tanks: [b, c], lastFull: c, odo: 101300, tank: 77.6, perKm: 0.18, lastPpl: 1.7 };
  const trips = [
    trip('x1', T0 + day, 500, 40),          // tank 1: the T3 said 8, the tank 10 -> it reads low by 1.25
    trip('x2', T0 + 11 * day, 300, 26.4),   // tank 2: 8.8 vs 11 -> 1.25 again
    trip('x3', T0 + 21 * day, 100, 8),      // since the last full fill-up: 8 raw, 10 corrected
  ];
  const e = blendEcon(st, trips);
  ok(e.calN === 2, 'both tanks used to correct the T3');
  near(e.cal, 1.25, 0.001, 'the T3 reads 25 % low');
  near(e.since.v, 10, 0.001, 'since the last fill-up, corrected');
  ok(e.src === 'mix', 'tanks and the T3 together');
  near(e.v, (60 + 66 + 10) / 1300 * 100, 0.001, 'the answer: both tanks plus the corrected T3 driving since');
  ok(e.perKm === 0.18 && !e.perKmEst, 'cost per km from the tanks');
  near(e.fuelL, 77.6 - 10, 0.01, 'tank level: full less the corrected litres');
  // a tank the T3 only saw a little of doesn't count
  const e2 = blendEcon(st, [trip('x1', T0 + day, 200, 16), trip('x3', T0 + 21 * day, 100, 8)]);
  ok(e2.calN === 0 && e2.cal === 1, 'T3 covered under half a tank: no correction');
  // nothing since the last full: the tanks alone
  const e3 = blendEcon(Object.assign({}, st, { odo: 101200 }), trips.slice(0, 2));
  ok(e3.src === 'tank', 'just filled: the tanks alone');
  near(e3.v, 126 / 1200 * 100, 0.001, 'their economy');
  near(e3.fuelL, 77.6, 0.001, 'full');
}

console.log('test_econ.js: ' + n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
