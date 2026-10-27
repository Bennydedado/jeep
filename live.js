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
  ['ect', 'Coolant', 'temp', '°C', 0, 120],   // shown in °F unless T3 settings say °C (t3EngF)
  ['iat', 'Intake', 'temp', '°C', 0, 60],
  ['v', 'Battery', 'battery', 'V', 1, 15],
  ['load', 'Load', 'gauge', '%', 0, 100],
];

function renderLive(v) {
  const on = !!LIVE.mode;
  v.append(titleRow('Live', on ? (LIVE.mode === 'demo' ? 'Demo, made-up numbers' : LIVE.status + (LIVE.fw ? ' · T3 ' + LIVE.fw : '')) : 'Straight from the T3 in the Jeep'));
  topBanners(v);
  v.append(h('div', { class: 'btn-grid' },
    h('button', { class: 'btn btn-primary', onclick: t3Setup }, icon('sliders'), 'T3 settings'),
    h('button', { class: 'btn btn-glass glass', onclick: screensSheet }, icon('odo'), 'Screens'),
    h('button', { class: 'btn btn-glass glass', onclick: diagSheet }, icon('warn'), 'Diagnostics'),
    h('button', { class: 'btn btn-glass glass', onclick: t3Guide }, icon('info'), 'Guide'),
    h('button', { class: 'btn btn-glass glass', onclick: codesSheet }, icon('engine'), 'Trouble codes'),
    h('button', { class: 'btn btn-glass glass', onclick: wifiSheet }, icon('wifi'), 'Wi-Fi & update')));
  if (!on) {
    if (hasBT()) {
      v.append(card(h('div', { class: 'empty', style: 'padding:16px 6px' },
        h('div', { class: 'ico' }, icon('bt')), h('h3', { text: 'Connect to the T3' }),
        h('p', { text: 'Turn the key so the T3 is powered, then tap Connect and pick Jeep T3. With the T3 on your hotspot, its numbers also show up here by themselves.' }),
        h('div', { class: 'btn-row', style: 'width:100%' },
          h('button', { class: 'btn btn-primary', onclick: btConnect }, icon('bt'), 'Connect'),
          h('button', { class: 'btn btn-glass glass', onclick: demoStart }, icon('play'), 'Demo')))));
      v.append(wifiWaitCard(false));
    } else v.append(wifiWaitCard(true));
  } else {
    const e = LIVE.els = {};
    // what's connected, and how fresh the numbers are
    e.chips = h('div', { class: 'chips live-chips' });
    e.age = h('div', { class: 'foot live-age' });
    v.append(e.chips, e.age);
    const big = (k, ic, label, unit) => {
      e[k] = h('div', { class: 'v' }, '\u2014');
      e[k + 'u'] = h('div', { class: 'u', text: unit });
      return h('div', { class: 'live-big card' }, h('div', { class: 'k' }, icon(ic), label), e[k], e[k + 'u']);
    };
    v.append(h('div', { class: 'live-hero' }, big('hdg', 'compass', 'Heading', 'GPS'), big('ot', 'temp', 'Outside', t3TempF() ? '\u00b0F' : '\u00b0C')));
    v.append(h('div', { class: 'live-hero' }, big('kmh', 'speed', 'Speed', 'km/h'), big('econ', 'drop', 'Fuel now', 'L/100 km')));
    v.append(h('div', { class: 'live-grid' }, GAUGES.map(([k, label, ic, unit]) => {
      e[k] = h('span', null, '\u2014');
      e[k + 'b'] = h('i', { style: 'width:0%' });
      const u = (k === 'ect' || k === 'iat') && t3EngF() ? '°F' : unit;
      return h('div', { class: 'tile card' }, h('div', { class: 'k' }, icon(ic), label), h('div', { class: 'v num' }, e[k], u ? h('small', { text: u }) : null), h('div', { class: 'bar' }, e[k + 'b']));
    })));
    const tripCell = (k, label) => { e['t' + k] = h('b', { text: '\u2014', class: 'num', style: 'font-size:20px' }); return h('div', null, h('div', { class: 'small muted', text: label }), e['t' + k]); };
    const demo = LIVE.mode === 'demo';
    e.tstate = h('span', { class: 'muted' });
    e.pauseBtn = h('button', { class: 'btn btn-small btn-glass glass', onclick: () => { if (demo) { LIVE.sim.paused = !LIVE.sim.paused; updateLive(); } else t3Trip(LIVE.v.tp ? 'resume' : 'pause'); } }, icon('stop'), 'Pause');
    v.append(card(h('div', { class: 'card-head' }, h('h2', { text: 'This trip' }), e.tstate),
      h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px' }, tripCell('km', 'Distance'), tripCell('s', 'Time'), tripCell('l', 'Diesel'), tripCell('avg', 'L/100 km')),
      h('div', { class: 'btn-row', style: 'margin-top:14px;flex-wrap:wrap' },
        e.pauseBtn,
        confirmButtonSmall('End trip', 'Tap again to end it', () => { if (demo) LIVE.sim.trip = { km: 0, l: 0, s: 0, idle: 0 }; else t3Trip('end'); }),
        h('button', { class: 'btn btn-small btn-glass glass', onclick: () => { if (!demo) t3Act('mark'); toast('Marked', 'The spot is flagged in this trip\u2019s track'); } }, icon('plus'), 'Mark')),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { class: 'btn btn-small btn-glass glass', onclick: () => t3Act('prev') }, '\u25c0 Screen'),
        h('button', { class: 'btn btn-small btn-glass glass', onclick: () => t3Act('next') }, 'Screen \u25b6'),
        h('button', { class: 'btn btn-small btn-glass glass btn-danger', onclick: liveStop }, icon('stop'), demo ? 'Stop' : LIVE.mode === 'net' ? 'Stop' : 'Disconnect'))));
    updateLive();
    clearInterval(LIVE.ageTimer);
    LIVE.ageTimer = setInterval(() => { if (!LIVE.els || !document.body.contains(LIVE.els.age)) clearInterval(LIVE.ageTimer); else updateLive(); }, 1000);
  }
  // trips the T3 has logged: totals by week, month or year, then the trips themselves
  if (S.data.trip.length) tripTotalsCard(v);
  const trips = S.data.trip.slice().sort((a, b) => (num(b.t1) || 0) - (num(a.t1) || 0)).slice(0, 20);
  if (trips.length) {
    v.append(h('div', { class: 'month' }, h('b', { text: 'Recent trips' }), h('span', { text: 'tap one for its breakdown' })));
    v.append(h('div', { class: 'card list' }, trips.map(t => {
      const km = num(t.km) || 0, l = num(t.lit) || 0, s = ((num(t.t1) || 0) - (num(t.t0) || 0)) / 1000;
      return h('button', { class: 'row', onclick: () => tripSheet(t) },
        h('div', { class: 'main' }, h('b', { text: fmtDay(num(t.t1)) + ', ' + fmtTime(num(t.t1)) }), h('span', { text: (s > 0 ? dur(s) : '') + (num(t.vmax) ? ' · top ' + num(t.vmax) + ' km/h' : '') + (num(t.idle) ? ' · idle ' + num(t.idle) + ' min' : '') })),
        h('div', { class: 'end' }, h('b', { text: fmt1(km) + ' km' }), h('span', { text: km > 0 && l > 0 ? fmt1(l / km * 100) + ' L/100 km' : '' })), icon('chev', 'chev'));
    })));
  }
}

// totals of the T3's trips: this week / month / year, and a bar for each of the ones before
const TRIP_UNITS = { w: ['Week', 8, 'this week', 'Distance per week'], m: ['Month', 12, 'this month', 'Distance per month'], y: ['Year', 5, 'this year', 'Distance per year'] };
function tripPeriodName(p, unit) {
  const d = new Date(p.start);
  if (unit === 'y') return String(d.getFullYear());
  if (unit === 'm') return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  return 'Week of ' + MON[d.getMonth()] + ' ' + d.getDate();
}
function tripTotalsCard(v) {
  const unit = TRIP_UNITS[store.get('tripUnit', 'm')] ? store.get('tripUnit', 'm') : 'm';
  const [, count, nowWord, chartLabel] = TRIP_UNITS[unit];
  const per = tripTotals(S.data.trip, unit, count);
  const cur = per[per.length - 1], all = per.reduce((a, p) => a + p.km, 0);
  v.append(h('div', { class: 'month' }, h('b', { text: 'Driving' }), h('span', { text: fmt0(all) + ' km in the last ' + count + ' ' + TRIP_UNITS[unit][0].toLowerCase() + 's' })));
  v.append(seg(Object.entries(TRIP_UNITS).map(([k, x]) => [k, x[0]]), unit, k => { store.set('tripUnit', k); render(); }));
  const econ = cur.litKm > 1 ? fmt1(cur.lit / cur.litKm * 100) + ' L/100 km' : 'no fuel numbers yet';
  v.append(h('div', { class: 'tiles', style: 'margin-top:12px' },
    tile('Distance', 'road', fmt0(cur.km), 'km', nowWord + (cur.n ? ' · ' + cur.n + (cur.n > 1 ? ' trips' : ' trip') : ': no trips yet')),
    tile('Driving', 'clock', cur.secs ? dur(cur.secs) : '\u2014', null, cur.idle ? cur.idle + ' min idling' : nowWord),
    tile('Diesel', 'pump', cur.lit ? fmt1(cur.lit) : '\u2014', cur.lit ? 'L' : null, econ),
    tile('Top speed', 'speed', cur.vmax ? fmt0(cur.vmax) : '\u2014', cur.vmax ? 'km/h' : null, cur.n ? 'average ' + fmt0(cur.km / cur.n) + ' km a trip' : nowWord)));
  if (per.some(p => p.km > 0)) {
    v.append(card(cardHead(chartLabel, 'tap a bar'), barChart({
      items: per.map(p => ({ v: p.km, x: unit === 'y' ? String(new Date(p.start).getFullYear()).slice(2) : unit === 'm' ? MON[new Date(p.start).getMonth()].slice(0, 1) : MON[new Date(p.start).getMonth()].slice(0, 1) + new Date(p.start).getDate(),
        tip: tripPeriodName(p, unit) + ' · ' + p.n + (p.n === 1 ? ' trip' : ' trips') + (p.secs ? ' · ' + dur(p.secs) : '') + (p.lit ? ' · ' + fmt1(p.lit) + ' L' : '') + (p.litKm > 1 ? ' · ' + fmt1(p.lit / p.litKm * 100) + ' L/100' : '') })),
      hl: per.length - 1, fmt: n => fmt0(n) + ' km', fmtAxis: g => fmt0(g), height: 150, label: chartLabel,
    })));
  }
}

// one trip: the T3's totals right away, and the full breakdown (charts, map) from the track store when it has it
function tripSheet(t) {
  const km = num(t.km) || 0, l = num(t.lit) || 0, s = ((num(t.t1) || 0) - (num(t.t0) || 0)) / 1000, idle = num(t.idle) || 0;
  const conf = typeof trkConf === 'function' && trkConf(), idx = store.get('trkIndex', null);
  const have = conf && idx && (idx.trips || []).some(x => x.id === t.id);
  openSheet({
    title: 'Trip',
    build(b, sheet) {
      const cell = (k, val, sub) => h('div', { class: 'tile card' }, h('div', { class: 'k', text: k }), h('div', { class: 'v num', text: val }), sub ? h('div', { class: 's', text: sub }) : null);
      const moving = s - idle * 60;
      put(b, h('div', { class: 'foot', style: 'margin:0 0 10px', text: fmtDay(num(t.t0) || num(t.t1), true) + ', ' + fmtTime(num(t.t0) || num(t.t1)) + (num(t.t1) && num(t.t0) ? ' to ' + fmtTime(num(t.t1)) : '') }),
        h('div', { class: 'tiles' },
          cell('Distance', fmt1(km) + ' km', 'from the T3\u2019s trip meter'),
          cell('Time', s > 0 ? dur(s) : '\u2014', idle ? 'idling ' + idle + ' min' : null),
          cell('Average speed', moving > 60 && km > 0 ? fmt0(km / (moving / 3600)) + ' km/h' : '\u2014', s > 60 && km > 0 ? fmt0(km / (s / 3600)) + ' km/h with stops' : null),
          cell('Top speed', num(t.vmax) ? fmt0(num(t.vmax)) + ' km/h' : '\u2014', null),
          cell('Diesel', l ? fmt1(l) + ' L' : '\u2014', l && km > 1 ? fmt1(l / km * 100) + ' L/100 km' : 'needs the engine\u2019s fuel rate'),
          cell('Cost', l && STATS && STATS.ppl ? money(l * STATS.ppl, 2) : '\u2014', l && STATS && STATS.ppl ? 'at $' + STATS.ppl.toFixed(3) + '/L' : null)));
      if (have) put(b, h('button', { class: 'btn btn-primary btn-wide', style: 'margin-top:14px', onclick: () => { sheet.close(); go('map'); openTrip(t.id); } }, icon('map'), 'Full breakdown: speed, RPM, boost, coolant\u2026'));
      else if (conf) put(b, card(h('p', { class: 'foot', style: 'margin:0 0 10px', text: 'The full breakdown (speed, RPM, boost, coolant and fuel over the trip, and the route once there\u2019s a GPS) shows up once the T3 uploads this trip\u2019s track. It does that on Wi-Fi with the Jeep parked.' }),
        h('button', { class: 'btn btn-glass glass btn-wide', onclick: () => { sheet.close(); go('map'); openTrip(t.id); } }, icon('sync'), 'Look for it now')));
      else put(b, card(h('p', { class: 'foot', style: 'margin:0 0 10px', text: 'For the full breakdown of every trip (speed, RPM, boost, coolant and fuel over the trip, and the route once there\u2019s a GPS), set up track storage once. It\u2019s free, in your own Google Drive, about 5 minutes.' }),
        h('button', { class: 'btn btn-primary btn-wide', onclick: () => { sheet.close(); trackStoreSheet(); } }, icon('map'), 'Set up track storage')));
    },
  });
}

// Live with nothing connected: listening for the T3 over Wi-Fi (the relay), and what to check if it doesn't show up.
// In Safari this is the main way in (Safari can't do Bluetooth); in Bluefy it's the other way in.
function wifiWaitCard(main) {
  const W = LIVE.wait = { relay: h('span'), asked: h('span'), heard: h('span'), tips: h('div') };
  const row = (k, el) => h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: k })), h('div', { class: 'end' }, el));
  const c = card(cardHead(main ? 'Live over Wi-Fi' : 'Or over Wi-Fi', null),
    h('p', { class: 'foot', style: 'margin:0 0 10px', text: main
      ? 'When the T3 is powered (key on) and on a Wi-Fi it knows (home Wi-Fi or your iPhone hotspot), its live numbers show up here by themselves, a second or two behind. Leave this page open.'
      : 'With the T3 on Wi-Fi, its numbers also show up here (and in Safari) without Bluetooth.' }),
    h('div', { class: 'card list', style: 'margin:0' }, row('Relay', W.relay), row('Asked the T3 to send', W.asked), row('Heard the T3', W.heard)),
    W.tips);
  if (main) {
    const link = setupLink();
    c.append(h('details', { style: 'margin-top:12px' }, h('summary', { class: 'small', text: 'Bluetooth instead (needs the Bluefy app)' }),
      h('ol', { class: 'steps', style: 'margin-top:8px' },
        h('li', null, h('div', null, 'Install ', h('a', { class: 'link', href: 'https://apps.apple.com/app/id1492822055', target: '_blank', rel: 'noopener', text: 'Bluefy' }), ' from the App Store (Apple doesn\u2019t let Safari use Bluetooth).')),
        h('li', null, h('div', null, 'Copy this link and open it in Bluefy. It brings your Jeep log along.',
          h('div', { class: 'copy-line', style: 'margin-top:8px' }, h('code', { text: link.replace(/#.*/, '#setup=\u2026') }),
            h('button', { class: 'btn btn-small btn-glass glass', onclick: e => copyText(link, e.currentTarget) }, icon('copy'), 'Copy')))),
        h('li', null, h('div', { text: 'With the key on, tap Connect and pick Jeep T3.' })))),
      h('button', { class: 'btn btn-glass glass btn-wide', style: 'margin-top:12px', onclick: demoStart }, icon('play'), 'Try the demo'));
  }
  paintWait(true);
  return c;
}
function paintWait(fresh) {
  const W = LIVE.wait;
  if (!W || (!fresh && !document.body.contains(W.relay))) return;
  const ws = NET.ws, open = ws && ws.readyState === 1;
  setText(W.relay, !S.conn || S.sample ? 'Set up your Jeep log first' : open ? 'Connected' : NET.fails > 2 ? 'Can\u2019t reach it (no internet?)' : 'Connecting\u2026');
  setText(W.asked, NET.watchAt ? ago(NET.watchAt) : open ? 'asking\u2026' : '-');
  const last = store.get('lastHeard', 0);
  setText(W.heard, last ? ago(last) : 'not yet');
  const waiting = open && NET.openAt && Date.now() - NET.openAt > 40000;
  W.tips.textContent = '';
  if (!S.conn || S.sample) W.tips.append(h('p', { class: 'foot', style: 'margin:10px 0 0', text: 'The T3\u2019s private channel comes from your sheet key: open your setup link in this browser first.' }));
  else if (waiting) W.tips.append(h('p', { class: 'foot', style: 'margin:10px 0 0;white-space:pre-line', text: 'Nothing from the T3 yet. Check:\n\u2022 the key is on (the T3 only runs then)\n\u2022 the T3 is on Wi-Fi: within reach of home Wi-Fi, or your hotspot is on\n\u2022 Live over Wi-Fi is On in T3 settings, and the T3 is 2.4 or newer (both set over Bluetooth in Bluefy)' }));
}
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function confirmButtonSmall(label, armed, act) {
  let on = false, t = 0;
  const b = h('button', { type: 'button', class: 'btn btn-small btn-glass glass btn-danger', text: label });
  b.addEventListener('click', () => { if (!on) { on = true; b.textContent = armed; clearTimeout(t); t = setTimeout(() => { on = false; b.textContent = label; }, 4000); return; } on = false; b.textContent = label; act(); });
  return b;
}
const GPS_WORDS = ['No GPS data', 'GPS: wrong speed?', 'GPS searching', 'GPS 2D', 'GPS 3D'];
function chip(text, kind) { return h('span', { class: 'chip' }, h('i', { class: 'dot ' + (kind || '') }), text); }
function updateLive() {
  const e = LIVE.els, d = LIVE.v;
  if (!e || !document.body.contains(e.kmh)) return;
  const age = LIVE.at ? (Date.now() - LIVE.at) / 1000 : 999;
  const stale = age > 3;
  document.querySelectorAll('.live-hero, .live-grid').forEach(x => x.classList.toggle('stale', stale));
  setText(e.age, LIVE.mode === 'demo' ? 'Demo: made-up numbers' : stale ? 'No new numbers for ' + (age < 120 ? Math.round(age) + ' s' : ago(LIVE.at)) + ': these are the last ones the T3 sent' : 'Live \u00b7 updated ' + fmtTime(LIVE.at));
  // connection chips
  const g = d.g;
  const sig = [LIVE.mode === 'bt' ? 'Bluetooth' : LIVE.mode === 'net' ? 'Wi-Fi relay' : 'Demo', g == null ? null : GPS_WORDS[g] + (d.sats != null ? ' \u00b7 ' + d.sats + (d.inv != null ? '/' + d.inv : '') + ' sats' : ''),
    d.ot != null ? 'Temp probe ok' : LIVE.mode === 'demo' ? null : 'No temp probe', d.nano ? 'Wheel ' + d.nano : null, d.sd != null ? (d.sd ? 'SD logging' : 'No SD card') : null,
    d.rpm != null ? 'iCar reading' : LIVE.mode === 'demo' ? null : 'iCar not reading'].filter(Boolean).join('|');
  if (e.chips.dataset.sig !== sig) {
    e.chips.dataset.sig = sig; e.chips.textContent = '';
    e.chips.append(chip(LIVE.mode === 'bt' ? 'Bluetooth' : LIVE.mode === 'net' ? 'Wi-Fi relay' : 'Demo', 'ok'));
    if (g != null) e.chips.append(chip(GPS_WORDS[g] + (d.sats != null ? ' \u00b7 ' + d.sats + (d.inv != null ? '/' + d.inv : '') + ' sats' : ''), g >= 3 ? 'ok' : g === 2 ? 'soon' : 'bad'));
    if (LIVE.mode !== 'demo') e.chips.append(chip(d.ot != null ? 'Temp probe ok' : 'No temp probe', d.ot != null ? 'ok' : 'bad'));
    if (d.nano) e.chips.append(chip('Wheel ' + d.nano, d.nano === 'ok' ? 'ok' : 'bad'));
    if (d.sd != null) e.chips.append(chip(d.sd ? 'SD logging' : 'No SD card', d.sd ? 'ok' : 'bad'));
    if (LIVE.mode !== 'demo') e.chips.append(chip(d.rpm != null ? 'iCar reading' : 'iCar not reading', d.rpm != null ? 'ok' : 'soon'));
  }
  const kmh = num(d.kmh), lph = num(d.lph);
  setText(e.kmh, kmh == null ? '\u2014' : String(Math.round(kmh)));
  setText(e.kmhu, kmh == null ? 'km/h' : 'km/h \u00b7 ' + (d.src === 'gps' ? 'GPS' : 'iCar'));
  if (lph != null && kmh != null && kmh >= 5) { setText(e.econ, fmt1(Math.min(99.9, lph / kmh * 100))); setText(e.econu, 'L/100 km'); }
  else if (lph != null) { setText(e.econ, fmt1(lph)); setText(e.econu, 'L/h, idling'); }
  else setText(e.econ, '\u2014');
  // heading: live only while moving; a kept heading shows in brackets
  const live = d.hdg != null && d.hdgAge != null && d.hdgAge <= 3;
  setText(e.hdg, d.hdg == null ? '\u2014' : live ? compass(d.hdg) : '(' + compass(d.hdg) + ')');
  setText(e.hdgu, d.hdg == null ? (g >= 3 ? 'drive to get a heading' : 'no GPS heading') : live ? Math.round(d.hdg) + '\u00b0 \u00b7 GPS course' : 'last known \u00b7 stopped');
  const ot = num(d.ot);
  setText(e.ot, ot == null ? '\u2014' : fmt1(t3TempF() ? ot * 9 / 5 + 32 : ot));
  for (const [k, , , , dp, max] of GAUGES) {
    const f = (k === 'ect' || k === 'iat') && t3EngF();   // the T3 sends °C
    const x0 = num(d[k]), x = x0 == null ? null : f ? x0 * 9 / 5 + 32 : x0, mx = f ? max * 9 / 5 + 32 : max;
    setText(e[k], x == null ? '\u2014' : (dp ? x.toFixed(dp) : String(Math.round(x))));
    e[k + 'b'].style.width = x == null ? '0%' : Math.max(0, Math.min(100, x / mx * 100)) + '%';
  }
  const t = d.trip || {};
  setText(e.tkm, t.km != null ? fmt1(t.km) : '\u2014');
  setText(e.ts, t.s != null ? (t.s < 3600 ? Math.floor(t.s / 60) + ':' + String(Math.floor(t.s % 60)).padStart(2, '0') : dur(t.s)) : '\u2014');
  setText(e.tl, t.l != null ? fmt1(t.l) + ' L' : '\u2014');
  setText(e.tavg, t.km > 0.2 && t.l != null ? fmt1(t.l / t.km * 100) : '\u2014');
  const paused = LIVE.mode === 'demo' ? !!(LIVE.sim && LIVE.sim.paused) : !!d.tp;
  setText(e.tstate, paused ? 'Paused' : 'Running');
  setText(e.pauseBtn.lastChild, paused ? 'Resume' : 'Pause');
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
  const updating = LIVE.updWaitUntil > Date.now();   // the T3 restarted to update over Wi-Fi: keep trying until it's back
  if (LIVE.tries++ > 6 && !updating) { LIVE.status = 'Lost the T3'; liveStop(); toast('Lost the T3', 'Tap Connect when it\'s back on', 'bad'); return; }
  LIVE.status = updating ? 'The T3 is updating, reconnecting…' : 'Reconnecting…'; render();
  setTimeout(() => { if (LIVE.mode === 'bt') btAttach().catch(onDrop); }, Math.min(5000, 1500 + LIVE.tries * 1000));
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
  t3Message(m, 'bt');
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
// one message at a time: two sends overlapping (a status poll during a screen upload, say) would mix their
// bytes into one broken line on the T3, or make Bluetooth refuse a write ("operation already in progress")
let sendChain = Promise.resolve();
function send(obj) {
  // during an update over Bluetooth the T3 reads every write as program data: nothing else goes out
  if (LIVE.otaBusy) return Promise.resolve();
  const data = new TextEncoder().encode(JSON.stringify(obj) + '\n');
  const run = sendChain.then(async () => {
    if (!LIVE.rx) return;
    try { for (let i = 0; i < data.length; i += 20) await LIVE.rx.writeValue(data.slice(i, i + 20)); } catch (e) { /* the drop handler deals with it */ }
  });
  sendChain = run.catch(() => {});
  return run;
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
  if (!s.paused) { tr.km += s.v * dt / 3600; tr.l += lph * dt / 3600; tr.s += dt; if (s.v < 2) tr.idle += dt; }
  s.crs = ((s.crs || 40) + (Math.random() - .5) * 3 + 360) % 360;
  if (s.v > 5) s.hdgAt = s.t;
  LIVE.v = { t: 'live', kmh: s.v, src: 'obd', rpm, boost: Math.max(0, (load - 22) * .26), ect: s.ect, iat: 11 + load * .06, v: 14.2 + Math.random() * .05, load, lph,
    g: 4, sats: 9, inv: 14, hdop: 0.9, hdg: s.crs, hdgAge: s.hdgAt ? Math.round(s.t - s.hdgAt) : null, ot: -12.4 + Math.sin(s.t / 60) * .3, nano: 'ok', sd: 1, tp: s.paused ? 1 : 0,
    trip: { km: tr.km, l: tr.l, s: tr.s, idle: tr.idle } };
  LIVE.at = Date.now();
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

// ---------- how to put the T3 in the Jeep, start to finish
function t3Guide() {
  const steps = [
    ['What you need', 'The LilyGo T3 V1.6.1, the Vgate iCar Pro (Bluetooth 4.0), the keyed 5 V buck converter, the HGLRC M100 GPS, the DS18B20 probe with a 4.7 kOhm resistor, a microSD card (FAT32), and the Nano for the wheel buttons. No battery and no LoRa antenna needed.'],
    ['Read the wiring guide first', 'docs/HARDWARE.md in the jeep repository (and the Google Doc) has every wire, which ones are checked against LilyGo\u2019s pin table and which are still to be confirmed on your board. Wrong pins or 5 V on a T3 pin can damage it.'],
    ['Put the code on the T3 (once)', 'On the PC open bennydedado.github.io/jeep/firmware/ in Chrome or Edge, plug the T3 in, Install, pick its COM port. After that it updates itself over Wi-Fi when the Jeep is stopped, and goes back to the old program by itself if a new one fails to start.'],
    ['Power', 'Buck converter 5 V to the T3\u2019s 5V pin, ground to GND, so it only runs with the key on.'],
    ['GPS', 'M100: power (5V/VCC pad) to the T3\u2019s 3.3 V, GND to GND, TX to GPIO 34; RX stays unconnected. Go by the labels printed next to the M100\u2019s pads, not the wire colours. Mount it with a view of the sky (under plastic, not metal).'],
    ['Outside temperature', 'DS18B20 (usually red = 3.3 V, black = GND, yellow = data; check the listing): data to GPIO 4, and the 4.7 kOhm resistor from GPIO 4 to 3.3 V. Probe at the grille, out of engine heat.'],
    ['Wheel buttons', 'Nano D1 (TX) through 10 kOhm to GPIO 39, 20 kOhm from GPIO 39 to GND, Nano GND to T3 GND. Add T3Link to the Nano sketch (nano/ in the repository). The Nano keeps working with the T3 unplugged.'],
    ['Connect Heep', 'In Bluefy: Live > Connect > Jeep T3. Then T3 settings: add your Wi-Fi networks and Send settings. Set up track storage on the Map page and send settings again.'],
    ['Check it', 'Live > Diagnostics shows GPS, temperature, wheel link, SD card and Wi-Fi, each with what to look at if it isn\u2019t working.'],
    ['Using it', 'Wheel buttons go through your screens (Live > Screens to change them). Trips start at key-on and end after parking (or End trip). They upload by themselves on home Wi-Fi or your hotspot.'],
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
    NET.watchAt = 0; NET.openAt = Date.now(); NET.fails = 0; netWatch();   // tell a parked T3 someone's looking, so it starts sending
    clearInterval(NET.ping);
    NET.ping = setInterval(() => { try { ws.send(new Uint8Array([0xC0, 0])); } catch (e) { /* closing */ } }, 30000);
    if (S.tab === 'live' && !LIVE.mode) render();
  };
  ws.onmessage = e => netBytes(new Uint8Array(e.data));
  ws.onclose = () => { clearInterval(NET.ping); if (NET.ws === ws) NET.ws = null; NET.fails = (NET.fails || 0) + 1; NET.openAt = 0; paintWait(); clearTimeout(NET.retry); NET.retry = setTimeout(netCheck, 5000); };
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
// T3 2.0 encrypts what it sends through the public relay (AES-GCM, key made from your sheet key): open it here
let relayKeyP = null, relayKeyFor = '';
function relayKey() {
  if (relayKeyFor !== S.conn.k) {
    relayKeyFor = S.conn.k;
    relayKeyP = crypto.subtle.digest('SHA-256', new TextEncoder().encode('heep-enc:' + S.conn.k)).then(d => crypto.subtle.importKey('raw', d, 'AES-GCM', false, ['decrypt']));
  }
  return relayKeyP;
}
async function relayOpen(b64) {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await relayKey(), raw.slice(12));
  return new TextDecoder().decode(plain);
}
function netLine(text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (typeof m.e === 'string') { relayOpen(m.e).then(netLine, () => { /* not ours, or a different key */ }); return; }
  NET.at = Date.now();
  if (Date.now() - store.get('lastHeard', 0) > 10000) store.set('lastHeard', NET.at);
  if (m.t !== 'live') { if (LIVE.mode !== 'bt') t3Message(m, 'net'); return; }
  if (LIVE.mode === 'bt' || LIVE.mode === 'demo') return;
  const fresh = LIVE.mode !== 'net';
  LIVE.mode = 'net'; LIVE.status = 'Over Wi-Fi';
  if (fresh) { LIVE.v = m; LIVE.at = Date.now(); wake(true); t3Send({ c: 'status' }); if (S.tab === 'live') render(); } else t3Message(m, 'net');
}
// listen while Live is on screen, let go when it isn't (saves data), and drop the view when the T3 goes quiet
function netCheck() {
  if (S.tab !== 'live') NET.off = false;
  const want = S.tab === 'live' && !document.hidden && LIVE.mode !== 'bt' && LIVE.mode !== 'demo';
  if (!want) { if (NET.ws || LIVE.mode === 'net') netStop(); return; }
  if (!NET.ws) netStart();
  netWatch();
  paintWait();
  if (LIVE.mode === 'net' && Date.now() - NET.at > 15000) { LIVE.mode = null; LIVE.v = {}; LIVE.els = null; wake(false); render(); }
}
// every 30 s while Live is open: "I'm watching" (signed). A T3 2.4+ on Wi-Fi sends its live numbers for 90 s after each one,
// even parked; older ones only send while driving and for 10 minutes after key-on.
function netWatch() {
  if (!NET.ws || NET.ws.readyState !== 1 || Date.now() - (NET.watchAt || 0) < 30000) return;
  NET.watchAt = Date.now();
  relayCommand({ c: 'watch' });
}
setInterval(netCheck, 3000);
document.addEventListener('visibilitychange', netCheck);
