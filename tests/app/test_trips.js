// test_trips.js - the Map page's numbers, on made-up tracks (node tests/app/test_trips.js)
'use strict';
const T = require('../../trips.js');
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } };
const near = (a, b, eps, msg) => ok(a != null && Math.abs(a - b) <= eps, msg + ' (got ' + a + ', want ' + b + '±' + eps + ')');
const head = 'ms,up,tq,lat,lon,fix,sats,hdop,alt,kmh,crs,obd_kmh,rpm,boost,ect,iat,volt,load,lph,otemp,trip_km,ev';
const row = (o) => [o.ms ?? '', o.up, o.tq ?? (o.ms ? 'g' : '-'), o.lat ?? '', o.lon ?? '', 4, 9, o.hdop ?? 0.9, 700, o.kmh ?? '', '', '', '', o.boost ?? '', '', '', '', '', '', o.ot ?? '', '', o.ev ?? ''].join(',');

// 1. straight north at 36 km/h (10 m/s) for 100 s = 1.0 km
{
  const lines = [head];
  for (let s = 0; s <= 100; s++) lines.push(row({ ms: 1.7e12 + s * 1000, up: 5000 + s * 1000, lat: 56 + s * 10 / 110574, lon: -120, kmh: 36, ot: -5 + s / 100 }));
  const { rows } = T.parseTrack(lines.join('\n'));
  const s = T.tripStats(rows);
  near(s.km, 1.0, 0.01, 'straight 1 km');
  ok(s.gaps.length === 0 && s.segs.length === 1, 'one piece, no gaps');
  near(s.durS, 100, 0.01, 'duration');
  near(s.avgMoving, 36, 0.5, 'average moving speed');
  ok(s.vmax === 36, 'top speed');
  near(s.tmin, -5, 0.001, 'min temp'); near(s.tmax, -4, 0.001, 'max temp');
  ok(s.timeKnown && !s.est, 'times are real GPS times');
  ok(s.stops.length === 0, 'no stops');
}
// 2. a 60 s signal loss in the middle: the line breaks, the gap is reported, no distance across it
{
  const lines = [head];
  for (let s = 0; s <= 200; s++) {
    const gap = s > 70 && s < 130;
    lines.push(row({ ms: 1.7e12 + s * 1000, up: s * 1000, lat: gap ? null : 56 + s * 10 / 110574, lon: gap ? null : -120, kmh: gap ? null : 36 }));
  }
  const s = T.tripStats(T.parseTrack(lines.join('\n')).rows);
  ok(s.gaps.length === 1 && s.segs.length === 2, 'one gap, two pieces');
  near(s.gaps[0].sec, 60, 0.01, 'gap length');
  near(s.km, 1.4, 0.02, 'distance only where there was a fix');
}
// 3. a GPS jump (one point 5 km away) breaks the line instead of adding 10 km
{
  const lines = [head];
  for (let s = 0; s <= 20; s++) lines.push(row({ ms: 1.7e12 + s * 1000, up: s * 1000, lat: s === 10 ? 56.05 : 56 + s * 10 / 110574, lon: -120, kmh: 36 }));
  const s = T.tripStats(T.parseTrack(lines.join('\n')).rows);
  ok(s.gaps.some(g => g.why === 'GPS jump'), 'jump detected');
  ok(s.km < 0.3, 'jump not counted as distance (' + s.km.toFixed(2) + ' km)');
}
// 4. no clock until halfway: early rows get estimated times, flagged; with no clock at all, no times
{
  const lines = [head];
  for (let s = 0; s <= 10; s++) lines.push(row({ ms: s >= 5 ? 1.7e12 + s * 1000 : null, up: 9000 + s * 1000, lat: 56, lon: -120, kmh: 0 }));
  const { rows } = T.parseTrack(lines.join('\n'));
  ok(rows[0].est && rows[0].t === 1.7e12 && rows[0].tq === 'e', 'back-filled start time, marked estimated');
  ok(!rows[6].est, 'real times stay real');
  const none = [head]; for (let s = 0; s < 5; s++) none.push(row({ up: s * 1000, lat: 56, lon: -120, kmh: 0 }));
  const s = T.tripStats(T.parseTrack(none.join('\n')).rows);
  ok(!s.timeKnown && s.t0 == null, 'no clock: no made-up times');
  near(s.durS, 4, 0.001, 'but elapsed time still known from the T3');
}
// 5. stops: 3 minutes parked with GPS drift (no distance added), a 30 s pause isn't a stop
{
  const lines = [head]; let up = 0, lat = 56;
  const drive = secs => { for (let s = 0; s < secs; s++) { lat += 10 / 110574; lines.push(row({ ms: 1.7e12 + up, up, lat, lon: -120, kmh: 36 })); up += 1000; } };
  const park = secs => { for (let s = 0; s < secs; s++) { lines.push(row({ ms: 1.7e12 + up, up, lat: lat + (s % 2 ? 0.00004 : -0.00004), lon: -120, kmh: 0.4 })); up += 1000; } };
  drive(60); park(180); drive(60); park(30); drive(60);
  const s = T.tripStats(T.parseTrack(lines.join('\n')).rows);
  ok(s.stops.length === 1, 'one stop (' + s.stops.length + ')');
  near(s.stops[0] && s.stops[0].sec, 179, 1.01, 'stop length');
  near(s.km, 1.8, 0.03, 'parked drift adds nothing');
}
// 6. markers and events, simplify keeps the ends and cuts points on a straight line
{
  const lines = [head];
  for (let s = 0; s <= 300; s++) lines.push(row({ ms: 1.7e12 + s * 1000, up: s * 1000, lat: 56 + s * 10 / 110574, lon: -120, kmh: 36, ev: s === 50 ? 'mark wheel' : '' }));
  const { rows } = T.parseTrack(lines.join('\n'));
  const s = T.tripStats(rows);
  ok(s.marks.length === 1 && rows[s.marks[0]].ev === 'mark wheel', 'marker kept');
  const simp = T.simplify(rows, s.segs[0], 5);
  ok(simp.length === 2 && simp[0] === 0 && simp[1] === 300, 'straight line simplifies to 2 points');
  ok(T.nearestRow(rows, 56 + 100 * 10 / 110574, -120.00001) === 100, 'nearest point');
}
// 7. the sample drive parses and looks like a drive
{
  const s = T.tripStats(T.parseTrack(T.sampleTrack(1, 1.7e12)).rows);
  ok(s.km > 5 && s.km < 30, 'sample distance ' + s.km.toFixed(1));
  ok(s.gaps.length === 1, 'sample has its bridge gap');
  ok(s.stops.length >= 1, 'sample has a stop');
}
console.log('test_trips.js: ' + n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
