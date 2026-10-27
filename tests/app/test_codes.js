// test_codes.js - reading trouble codes out of the adapter's raw answers (node tests/app/test_codes.js)
// The answers are written the way the T3 sends them: headers on, spaces gone, one line of the adapter's answer per '/'.
'use strict';
const C = require('../../codes.js');
const T = require('../../trips.js');
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } };
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ')');

// the code letters and digits
same(C.dtcText(0x04, 0x01), 'P0401', 'P0401');
same(C.dtcText(0x40, 0x35), 'C0035', 'chassis code');
same(C.dtcText(0x92, 0x34), 'B1234', 'body code with a 1');
same(C.dtcText(0xC1, 0x00), 'U0100', 'network code');
same(C.dtcText(0x22, 0xAB), 'P22AB', 'letters in the last digits');
ok(C.dtcText(0, 0) === null, '0000 is padding, not a code');

// the K-line diesel computer (12): light on, 2 codes stored, 1 pending; "BUS INIT" and "SEARCHING" lines ignored
{
  const it = { p: '3', a: 'BUSINIT:...OK/486B1241018207650024', b: '486B124304010234000000C9', c: '486B12470299000000000050', x: '' };
  const m = C.parseCodes(it);
  ok(m.length === 1 && m[0].src === '12', 'one computer, 12');
  ok(m[0].mil === true && m[0].count === 2, 'check-engine light on, 2 codes');
  same(m[0].stored, ['P0401', 'P0234'], 'stored codes');
  same(m[0].pending, ['P0299'], 'pending code');
}
// more than 3 codes: two lines from the same computer
{
  const m = C.parseCodes({ p: '3', a: '', b: '486B124301000101010200AA/486B1243067000000000BB', c: '' });
  same(m[0].stored, ['P0100', 'P0101', 'P0102', 'P0670'], 'four codes over two lines');
}
// the Chrysler bus (J1850 VPW): the transmission computer (18) with P0700, the engine (10) with nothing
{
  const m = C.parseCodes({ p: '2', a: '486B1041010007650011/486B184101000000003A', b: '486B10430000000000000F/486B184307000000000033', c: 'NODATA' });
  const tr = m.find(x => x.src === '18'), en = m.find(x => x.src === '10');
  ok(tr && en, 'both computers seen');
  same(tr.stored, ['P0700'], 'transmission code');
  ok(en.stored.length === 0 && en.mil === false, 'engine: no codes, light off');
}
// CAN, one frame and a multi-frame answer
{
  const m = C.parseCodes({ p: '6', a: '7E8064101820765000000', b: '7E80643020133022100' });
  same(m[0].stored, ['P0133', 'P0221'], 'CAN single frame');
  ok(m[0].src === '7E8' && m[0].mil && m[0].count === 2, 'CAN light and count');
  const m2 = C.parseCodes({ p: '6', a: '', b: '7E8100A43040133022103/7E8210004000000000000' });
  same(m2[0].stored, ['P0133', 'P0221', 'P0300', 'P0400'], 'CAN multi-frame put back together');
}
// clearing: done, and refused (engine running)
{
  ok(C.parseCodes({ p: '3', a: '', b: '', c: '', x: '486B12440B' })[0].cleared === true, 'cleared');
  ok(/refused \(engine running\?\)/.test(C.parseCodes({ p: '3', a: '', b: '', c: '', x: '486B127F04221F' })[0].cleared), 'refused while running');
}
// nothing there
same(C.parseCodes({ p: '1', a: 'NODATA', b: '', c: '' }), [], 'no answer, no computers');
same(C.parseCodes({ p: '4', a: 'BUSINIT:...ERROR', b: '' }), [], 'bus init error, no computers');

// what the codes mean
ok(/EGR flow too low/.test(C.dtcMeaning('P0401')), 'P0401 described');
ok(/Chrysler/.test(C.dtcMeaning('P1693')), 'manufacturer code');
ok(/transmission/.test(C.dtcMeaning('P0799')), 'unknown P07xx: transmission');
ok(/Network/.test(C.dtcMeaning('U0199')), 'unknown U code: network');

// trip totals by week, month, year
{
  const now = new Date(2026, 9, 28, 12).getTime();   // Wednesday 28 October 2026
  const at = (m, d, hr, mi = 0) => new Date(2026, m, d, hr, mi).getTime();
  const trips = [
    { t0: at(9, 27, 8), t1: at(9, 27, 9), km: 60, lit: 6, vmax: 100, idle: 4 },
    { t0: at(9, 26, 8), t1: at(9, 26, 8, 30), km: 20, lit: '', vmax: 80, idle: 0 },     // Monday: same week
    { t0: at(9, 25, 8), t1: at(9, 25, 8, 30), km: 10, lit: 1, vmax: 60, idle: 1 },      // Sunday: the week before
    { t0: at(8, 3, 8), t1: at(8, 3, 9), km: 100, lit: 9, vmax: 110, idle: 0 },
  ];
  const w = T.tripTotals(trips, 'w', 8, now), m = T.tripTotals(trips, 'm', 12, now), y = T.tripTotals(trips, 'y', 5, now);
  ok(w.length === 8 && new Date(w[7].start).getDay() === 1 && new Date(w[7].start).getDate() === 26, 'weeks start on Monday');
  ok(w[7].n === 2 && w[7].km === 80 && w[6].n === 1 && w[6].km === 10, 'this week and last week');
  ok(w[7].lit === 6 && w[7].litKm === 60, 'fuel only from trips that know it');
  ok(w[7].secs === 5400 && w[7].idle === 4 && w[7].vmax === 100, 'time, idling, top speed');
  ok(m[11].km === 90 && m[10].km === 100 && m[11].n === 3, 'October and September');
  ok(y[4].km === 190 && y[4].n === 4 && y[3].n === 0, 'this year, nothing last year');
}

console.log('test_codes.js: ' + n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
