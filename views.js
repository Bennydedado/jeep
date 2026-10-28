'use strict';
// views.js - the four tabs and every sheet.

function card(...kids) { return h('div', { class: 'card' }, ...kids); }
function cardHead(title, right, onRight) {
  return h('div', { class: 'card-head' }, h('h2', { text: title }),
    onRight ? h('button', { class: 'link', text: right, onclick: onRight }) : (right ? h('span', { class: 'muted', text: right }) : null));
}
function tile(k, ic, v, unit, s, onclick) {
  return h(onclick ? 'button' : 'div', { class: 'tile card', onclick },
    h('div', { class: 'k' }, icon(ic), k),
    h('div', { class: 'v num' }, v, unit ? h('small', { text: unit }) : null),
    s ? h('div', { class: 's', text: s }) : null);
}
function banner(ic, title, sub, onclick) {
  return h('button', { class: 'banner glass', onclick }, h('div', { class: 'ico' }, icon(ic)), h('div', null, h('b', { text: title }), h('span', { text: sub })), icon('chev', 'go'));
}
function topBanners(v) {
  if (S.sample) v.append(banner('info', 'Sample data', 'Connect your Jeep log to see your own', connectSheet));
  else if (S.sync.state === 'key') v.append(banner('warn', 'The key doesn\'t match', 'Open Settings to fix the connection', settingsSheet));
  else if (S.sync.state === 'error') v.append(banner('warn', 'Your Jeep log had a problem', S.sync.msg || 'Open Settings for details', settingsSheet));
}
function econWord(e, avg) {
  if (avg == null || e == null) return '';
  const d = e - avg;
  if (Math.abs(d) < 0.05) return 'right on average';
  return fmt1(Math.abs(d)) + (d > 0 ? ' worse' : ' better') + ' than average';
}

// ======================================================= Overview
function renderHome(v) {
  const st = STATS;
  v.append(titleRow('Heep', S.prefs.vehicle + (st.odo ? ' · ' + fmt0(st.odo) + ' km' : '')));
  topBanners(v);
  const e = st.econ || { all: {}, since: {} };
  if (!st.n && !e.v) {
    v.append(card(h('div', { class: 'empty' },
      h('div', { class: 'ico' }, icon('pump')), h('h3', { text: 'Log your first fill-up' }),
      h('p', { text: 'Tap + at the pump: the odometer, the litres and what it cost. Fuel economy shows up after two full tanks.' }),
      h('button', { class: 'btn btn-primary', onclick: () => fillSheet() }, icon('plus'), 'Add a fill-up'))));
    homeService(v, st);
    return;
  }
  // the headline: the best economy there is (econ.js: full tanks, and the T3's trips corrected by them), and the tank
  const hero = h('div', { class: 'hero' });
  const tanksWord = e.tanks + (e.tanks > 1 ? ' full tanks' : ' full tank');
  hero.append(h('div', null,
    h('div', { class: 'big', text: e.v ? fmt1(e.v) : '—' }),
    h('div', { class: 'unit', text: ({ tank: 'L/100 km · your last ' + tanksWord, mix: 'L/100 km · last ' + tanksWord + ' + the T3 since',
      t3: 'L/100 km · the T3 so far (' + fmt0(e.all.km) + ' km)' })[e.src] || 'L/100 km after two full tanks' })));
  if (st.fuelPct != null) {
    const stale = !st.odoT || Date.now() - st.odoT > 3 * 864e5;
    hero.append(h('button', { class: 'gauge-btn', 'aria-label': 'Distance to empty', onclick: () => dteSheet() },
      fuelGauge(st.fuelPct, Math.round(st.fuelPct * 100) + '%', '≈' + fmt0(st.left) + ' km', stale)));
  }
  const chips = h('div', { class: 'chips' });
  if (st.last != null) {
    const worse = st.avg != null && st.last - st.avg > 0.05, better = st.avg != null && st.avg - st.last > 0.05;
    chips.append(h('span', { class: 'chip' }, h('i', { class: 'dot', style: 'background:' + (worse ? 'var(--warn)' : better ? 'var(--good)' : 'var(--ink-3)') }),
      'Last tank ' + fmt1(st.last) + (st.avg != null ? ' · ' + econWord(st.last, st.avg).replace(' than average', '') : '')));
  }
  if (e.src === 'mix' && e.since.v != null) chips.append(h('span', { class: 'chip', text: 'Since your fill-up ' + fmt1(e.since.v) }));
  if (e.src === 't3') chips.append(h('span', { class: 'chip', text: 'Estimate: exact after two full tanks' }));
  if (st.best != null && st.tanks.length > 1) chips.append(h('span', { class: 'chip', text: 'Best ' + fmt1(st.best) }));
  if (st.avg != null && st.tanks.length > e.tanks) chips.append(h('span', { class: 'chip', text: 'All tanks ' + fmt1(st.avg) }));
  if (st.tanks.length) chips.append(h('span', { class: 'chip', text: st.tanks.length + (st.tanks.length > 1 ? ' tanks' : ' tank') }));
  if (e.calN) chips.append(h('span', { class: 'chip', text: 'T3 corrected ×' + e.cal.toFixed(2) }));
  hero.append(chips);
  v.append(card(hero));

  // four numbers worth glancing at
  const m = st.thisMonth;
  v.append(h('div', { class: 'tiles' },
    tile('Cost per km', 'dollar', e.perKm ? '$' + e.perKm.toFixed(3) : '—', null, e.perKm ? (e.perKmEst ? 'estimate: economy × pump price' : 'diesel only') : 'after a fill-up with a price'),
    tile('This month', 'calendar', money(m.cost, 0), null, m.n ? m.n + (m.n > 1 ? ' fill-ups · ' : ' fill-up · ') + fmt0(m.lit) + ' L' : 'no fill-ups yet'),
    tile('Diesel', 'pump', st.lastPpl ? '$' + st.lastPpl.toFixed(3) : '—', '/L', st.ppl ? 'average $' + st.ppl.toFixed(3) : 'last price'),
    tile('To empty', 'road', st.left != null ? '≈' + fmt0(st.left) : '—', st.left != null ? 'km' : null,
      st.fuelL != null ? fmt0(st.fuelL) + ' L left · tap for more' : 'after a full fill-up', () => dteSheet())));

  // fuel economy for each full tank
  if (st.tanks.length) {
    const tanks = st.tanks.slice(-12);
    v.append(card(cardHead('Fuel economy', 'L/100 km, last ' + tanks.length + (tanks.length > 1 ? ' tanks' : ' tank')),
      barChart({
        items: tanks.map(x => ({ v: x._.econ, x: MON[new Date(x.t).getMonth()] + ' ' + new Date(x.t).getDate(), tip: fmtDay(x.t, true) + ' · ' + fmt0(x._.dist) + ' km' })),
        avg: st.avg, avgLabel: st.avg ? 'avg ' + fmt1(st.avg) : '', fmt: fmt1, fmtAxis: g => (g % 1 ? g.toFixed(1) : String(g)), label: 'Fuel economy per tank',
      }),
      h('div', { class: 'foot', text: 'Every litre since the last full tank, over the distance since it. Lower is better.' })));
  }
  // the T3's trips, week by week (corrected by the tanks when it can be)
  if (e.all.n && typeof tripTotals === 'function') {
    const wk = tripTotals(S.data.trip, 'w', 8);
    const items = wk.map(p => ({ v: p.litKm > 1 ? p.lit / p.litKm * 100 * e.cal : 0, x: MON[new Date(p.start).getMonth()].slice(0, 1) + new Date(p.start).getDate(),
      tip: 'Week of ' + MON[new Date(p.start).getMonth()] + ' ' + new Date(p.start).getDate() + ' · ' + fmt0(p.km) + ' km' + (p.lit ? ' · ' + fmt1(p.lit * e.cal) + ' L' : '') }));
    if (items.some(x => x.v > 0)) v.append(card(cardHead('Fuel economy by week', 'from the T3' + (e.calN ? ', corrected' : '')),
      barChart({ items, hl: items.length - 1, fmt: fmt1, fmtAxis: g => (g % 1 ? g.toFixed(1) : String(g)), label: 'Fuel economy per week from the T3' }),
      h('div', { class: 'foot', text: e.calN ? 'The T3 works the diesel out from the engine; your full tanks show it reads ' + Math.abs(Math.round((e.cal - 1) * 100)) + ' % ' + (e.cal >= 1 ? 'low' : 'high') + ', so these are corrected.' :
        'The T3 works the diesel out from the engine. After two full tanks it gets checked against the pump and corrected.' })));
  }
  homeService(v, st);

  // the odometer
  v.append(h('button', { class: 'card row tap', style: 'padding:14px 16px', onclick: odoSheet },
    h('div', { class: 'banner', style: 'padding:0;width:auto' }, h('div', { class: 'ico' }, icon('odo'))),
    h('div', { class: 'main' }, h('b', { text: 'Odometer' }),
      h('span', { text: st.odo ? (st.odoFrom === 'fill' ? 'from your fill-up ' : st.odoFrom === 'trips' ? 'with T3 trips, ' : 'updated ') + ago(st.odoT) : 'tap to set it' })),
    h('div', { class: 'end' }, h('b', { text: st.odo ? fmt0(st.odo) : '—' }), h('span', { text: 'km' })),
    icon('chev', 'chev')));

  // money over the year
  if (st.months.some(x => x.cost > 0)) {
    const cur = st.months.length - 1;
    v.append(card(cardHead('Spending', money(st.months.reduce((s, x) => s + x.cost, 0), 0) + ' in 12 months'),
      barChart({
        items: st.months.map(x => ({ v: x.cost, x: MON[x.m].slice(0, 1) === MON[x.m] ? MON[x.m] : MON[x.m].slice(0, 3), tip: MONTHS[x.m] + ' ' + x.y + ' · ' + x.n + (x.n === 1 ? ' fill-up' : ' fill-ups') + ' · ' + fmt0(x.lit) + ' L' })),
        hl: cur, fmt: n => money(n, 0), fmtAxis: g => '$' + fmt0(g), height: 160, label: 'Spending per month',
      })));
  }
  // what diesel has cost
  const priced = st.f.filter(x => x._.ppl && x.t && x.station !== PERSONAL);
  if (priced.length >= 2) {
    v.append(card(cardHead('Pump price', '$/L at each station fill-up'),
      lineChart({ pts: priced.map(x => ({ t: x.t, v: x._.ppl, tip: fmtDay(x.t, true) + (x.station ? ' · ' + x.station : '') })), fmt: n => '$' + n.toFixed(3), fmtAxis: n => '$' + n.toFixed(2), minStep: 0.05, label: 'Diesel price per litre' })));
  }
  // all-time numbers
  const rows = [
    ['Distance logged', fmt0(st.dist) + ' km'],
    ['Diesel bought', (st.estLit ? '≈' : '') + fmt0(st.lit + st.estLit) + ' L'],
    ['Spent on diesel', money(st.cost)],
    ['Fill-ups', st.n + (st.tops ? ' (' + st.tops + (st.tops > 1 ? ' top-ups)' : ' top-up)') : '')],
    ['Average fill-up', fmt1(st.lit / st.n) + ' L · ' + money(st.cost / st.n, 0)],
  ];
  if (st.daysBetween) rows.push(['Days between fill-ups', fmt1(st.daysBetween)], ['Distance per day', fmt0(st.kmPerDay) + ' km']);
  if (e.all && e.all.n) rows.push(['Logged by the T3', fmt0(e.all.km) + ' km · ' + e.all.n + (e.all.n > 1 ? ' trips' : ' trip') + (e.all.v ? ' · ' + fmt1(e.all.v) + ' L/100 km' : '')]);
  if (st.best != null && st.tanks.length > 1) rows.push(['Best and worst tank', fmt1(st.best) + ' · ' + fmt1(st.worst) + ' L/100 km']);
  if (st.personal.n) rows.push(['From your personal tank', st.personal.n + (st.personal.n > 1 ? ' fill-ups · ' : ' fill-up · ') + fmt0(st.personal.lit) + ' L' + (st.personal.cost ? ' · ' + money(st.personal.cost, 0) : '')]);
  if (st.year.n) rows.push([new Date().getFullYear() + ' so far', money(st.year.cost, 0) + ' · ' + fmt0(st.year.lit) + ' L']);
  v.append(h('div', { class: 'card list' }, rows.map(([k, val]) => h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: k })), h('div', { class: 'end' }, h('span', { text: val, style: 'font-size:15px' }))))));
}

// ======================================================= iPhone widget (the free Scriptable app runs widget/Heep.js)
function widgetSheet() {
  openSheet({
    title: 'iPhone widget',
    build(b) {
      const step = (n, title, text, ...extra) => h('li', null, h('div', null, h('b', { text: title, style: 'display:block;margin-bottom:2px' }),
        h('span', { class: 'muted', style: 'font-size:15px', text }), ...extra));
      // fetched now, so the button copies straight away (Safari only lets a tap copy, not something that finishes later)
      let script = null;
      fetch('widget/Heep.js?t=' + Date.now(), { cache: 'no-store' }).then(r => (r.ok ? r.text() : null)).then(t => { script = t; }, () => {});
      const copyScript = e => {
        if (script) copyText(script, e.currentTarget);
        else toast('Getting the script…', 'Needs signal: try again in a moment', 'info');
      };
      put(b, h('p', { class: 'foot', style: 'margin:0 0 12px', text: 'Distance to empty, fuel economy, cost per km, this week, your last trip, the next service and more, on your Home Screen, in the Today View (swipe right from your first Home Screen page) and on the Lock Screen. Small, medium and large, and you choose what each shows. Free, through the Scriptable app.' }),
        h('ol', { class: 'steps' },
          step(1, 'Get Scriptable', 'Free on the App Store.', h('div', { style: 'margin-top:8px' }, h('a', { class: 'btn btn-small btn-glass glass', style: 'text-decoration:none;color:inherit', href: 'https://apps.apple.com/app/scriptable/id1405459188', target: '_blank', rel: 'noopener' }, icon('download'), 'App Store'))),
          step(2, 'Add the script', 'Copy it, open Scriptable, tap +, paste, tap the title and call it Heep, then Done.',
            h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn btn-small btn-primary', onclick: copyScript }, icon('copy'), 'Copy the script'))),
          step(3, 'Connect it', S.sample ? 'Connect Heep to your Jeep log first (Settings > Connect your Jeep log); until then the widget shows made-up numbers.' :
            'Copy your setup link, then tap Heep in Scriptable: it finds the link and connects. It stays on your phone.',
            S.sample ? null : h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn btn-small btn-glass glass', onclick: e => copyText(setupLink(), e.currentTarget) }, icon('link'), 'Copy your setup link'))),
          step(4, 'Choose what it shows', 'Tap Heep in Scriptable any time: preview every size, and pick what each one shows (the first is the big one).'),
          step(5, 'Add the widget', 'Touch and hold an empty spot (Home Screen or Today View) > Edit > Add Widget > Scriptable > pick a size > Add. Tap the new widget > Script: Heep (whatever you named it). Lock Screen: touch and hold it > Customize > Lock Screen > the widget row > Scriptable.')),
        h('div', { class: 'label', text: 'Different blocks on one widget' }),
        h('div', { class: 'card' }, h('p', { class: 'foot', style: 'margin:0', text: 'While editing, tap the widget > Parameter, and type the blocks you want, first one big, e.g.  dte,econ,week\n\n' +
          'dte to empty · econ fuel economy · cost cost per km · week · month · trip last trip · odo odometer · service next service · fill last fill-up · chart driving by week (medium, large)' })),
        h('p', { class: 'foot', text: 'The widget gets its updates from here by itself. iPhone refreshes widgets when it wants (often every 15-30 minutes); tap one to open Heep.' }));
    },
  });
}

// ======================================================= Distance to empty
// The tank: full at your last full fill-up, plus top-ups, less the diesel the T3 measured since (corrected by your
// full tanks) and, for driving it didn't measure, the distance at your economy (econ.js). With the T3 connected the
// drive going on now counts too, and it updates as you go.
function dteSheet() {
  openSheet({
    title: 'Distance to empty',
    onClose: () => clearInterval(S.dteTimer),
    build(b) {
      const body = h('div', { style: 'display:grid;gap:14px' });
      const paint = () => {
        body.textContent = '';
        const st = STATS = calc(S.data);
        const live = typeof LIVE !== 'undefined' && LIVE.mode && LIVE.mode !== 'demo' && LIVE.v && LIVE.v.trip && LIVE.v.trip.id ? LIVE.v.trip : null;
        const e = blendEcon(st, S.data.trip, live);
        if (!e.v || e.fuelL == null) {
          body.append(card(h('div', { class: 'empty', style: 'padding:14px 6px' }, h('div', { class: 'ico' }, icon('road')), h('h3', { text: 'Not known yet' }),
            h('p', { text: !st.lastFull ? 'Log a fill-up where you filled it to the top: from then on the tank is counted down.' :
              'Needs an economy: some driving with the T3 logging, or two full tanks.' }))));
          return;
        }
        const u = e.used, low = e.fuelPct < .15;
        body.append(card(h('div', { class: 'dte' },
          fuelGauge(e.fuelPct, Math.round(e.fuelPct * 100) + '%', fmt0(e.fuelL) + ' L', false),
          h('div', null, h('div', { class: 'big' + (low ? ' bad' : ''), text: '≈' + fmt0(e.left) }), h('div', { class: 'unit', text: 'km to empty' }),
            h('div', { class: 'small muted', text: fmt1(e.fuelL) + ' of ' + fmt1(st.tank) + ' L at ' + fmt1(e.v) + ' L/100 km' + (live ? ' · live' : '') })))));
        const rows = [
          ['Last full fill-up', fmtDay(u.from.t, true) + ' · ' + fmt0(u.from.odo) + ' km'],
          ['Driven since', fmt0(u.driven) + ' km' + (u.liveKm ? ' (' + fmt1(u.liveKm) + ' km this drive)' : '')],
          ['Diesel the T3 measured', fmt1(u.measuredL) + ' L over ' + fmt0(u.measuredKm) + ' km' + (e.calN ? ' (corrected ×' + e.cal.toFixed(2) + ')' : '')],
          u.otherKm > 0.5 ? ['Driving it didn’t measure', fmt0(u.otherKm) + ' km ≈ ' + fmt1(u.otherL) + ' L at your economy'] : null,
          u.topped > 0 ? ['Top-ups since', fmt1(u.topped) + ' L'] : null,
          ['Economy', fmt1(e.v) + ' L/100 km · ' + ({ tank: 'your full tanks', mix: 'full tanks + the T3 since', t3: 'the T3 so far (estimate)' })[e.src]],
          ['A full tank goes', '≈' + fmt0(e.range) + ' km (' + fmt1(st.tank) + ' L)'],
        ].filter(Boolean);
        body.append(h('div', { class: 'card list' }, rows.map(([k, val]) => h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: k })), h('div', { class: 'end' }, h('span', { text: val, style: 'font-size:15px' }))))));
        body.append(h('p', { class: 'foot', style: 'margin:0', text: 'Counted down from your last full fill-up. It gets more exact with every full tank you log (the T3’s diesel gets checked against the pump). The T3 can show it too: add “To empty” to a screen.' }));
      };
      b.append(body);
      paint();
      clearInterval(S.dteTimer);
      S.dteTimer = setInterval(() => { if (typeof LIVE !== 'undefined' && LIVE.mode && LIVE.mode !== 'demo') paint(); }, 3000);
    },
  });
}

function homeService(v, st) {
  const list = servSorted(S.data, st.odo || 0).filter(x => x.o.state !== 'none');
  if (!list.length) return;
  const { s, o } = list[0];
  v.append(card(cardHead('Next service', 'All', () => go('service')), servBody(s, o, true)));
}

// ======================================================= Fill-ups
function renderFills(v) {
  const st = STATS;
  v.append(titleRow('Fill-ups', st.n ? st.n + (st.n > 1 ? ' fill-ups · ' : ' fill-up · ') + money(st.cost, 0) : 'Every fill-up, newest first'));
  topBanners(v);
  if (!st.n) {
    v.append(card(h('div', { class: 'empty' }, h('div', { class: 'ico' }, icon('pump')), h('h3', { text: 'No fill-ups yet' }),
      h('p', { text: 'Your fill-ups show up here, grouped by month, with the fuel economy of each full tank.' }),
      h('button', { class: 'btn btn-primary', onclick: () => fillSheet() }, icon('plus'), 'Add a fill-up'))));
    return;
  }
  const byMonth = new Map();
  for (const x of st.f.slice().reverse()) {
    const d = new Date(x.t || 0), k = d.getFullYear() * 12 + d.getMonth();
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(x);
  }
  for (const [k, xs] of [...byMonth.entries()].sort((a, b) => b[0] - a[0])) {
    const y = Math.floor(k / 12), m = k % 12;
    const cost = xs.reduce((s, x) => s + x.cost, 0), lit = xs.reduce((s, x) => s + x.lit, 0);
    v.append(h('div', { class: 'month' }, h('b', { text: MONTHS[m] + (y !== new Date().getFullYear() ? ' ' + y : '') }), h('span', { text: money(cost, 0) + ' · ' + fmt0(lit) + ' L' })));
    v.append(h('div', { class: 'card list' }, xs.map(x => fillRow(x))));
  }
}
function fillRow(x) {
  const e = x._.econ;
  return h('button', { class: 'row', onclick: () => fillSheet(S.data.fill.find(y => y.id === x.id)) },
    h('div', { class: 'main' },
      h('b', null, fmtDay(x.t) + (x.t ? ', ' + fmtTime(x.t) : ''), x.full ? null : h('span', { class: 'tag', text: 'Top-up', style: 'display:inline-block' })),
      h('span', { text: fmt0(x.odo) + ' km' + (x._.since ? ' · +' + fmt0(x._.since) : '') + (x.station ? ' · ' + x.station : '') })),
    h('div', { class: 'end' },
      h('b', { text: e != null ? fmt1(e) : '—' }),
      h('span', { text: x.unknown ? (x._.est ? '≈' + fmt0(x._.est) + ' L, estimated' : 'litres not known') : fmt1(x.lit) + ' L · ' + (x.cost ? money(x.cost) : 'no price') })),
    icon('chev', 'chev'));
}

// ======================================================= Service
function servBody(s, o, compact) {
  const facts = h('div', { class: 'facts' });
  if (o.nextKm != null) facts.append(h('span', { text: 'Next at ' + fmt0(o.nextKm) + ' km · ' + (o.kmLeft >= 0 ? 'in ' + fmt0(o.kmLeft) + ' km' : fmt0(-o.kmLeft) + ' km overdue') }));
  if (o.nextT != null) facts.append(h('span', { text: 'By ' + fmtDate(o.nextT) + ' · ' + (o.daysLeft >= 0 ? 'in ' + inDays(o.daysLeft) : inDays(o.daysLeft) + ' overdue') }));
  if (!compact && (s.lastKm != null || s.lastT)) facts.append(h('span', { text: 'Last done' + (s.lastKm != null ? ' at ' + fmt0(s.lastKm) + ' km' : '') + (s.lastT ? ' on ' + fmtDate(s.lastT) : '') }));
  const every = [s.km > 0 ? fmt0(s.km) + ' km' : null, s.mo > 0 ? s.mo + (s.mo > 1 ? ' months' : ' month') : null].filter(Boolean).join(' or ');
  return h('div', { class: 'serv' },
    h('div', { class: 'top' }, h('b', { text: s.name || 'Service' }), h('span', { class: 'pill ' + o.state }, h('i'), STATE_WORD[o.state])),
    h('div', { class: 'bar ' + o.state }, h('i', { style: 'width:' + Math.round(o.frac * 100) + '%' })),
    facts,
    h('div', { class: 'serv-actions' },
      h('button', { class: 'btn btn-small btn-primary', onclick: () => doneSheet(s) }, icon('check'), 'Done'),
      h('button', { class: 'btn btn-small btn-glass glass', onclick: () => servSheet(s) }, 'Edit'),
      every ? h('span', { class: 'foot', style: 'margin-left:auto;align-self:center', text: 'every ' + every }) : null));
}
function renderService(v) {
  const st = STATS;
  v.append(titleRow('Service', st.odo ? 'Odometer ' + fmt0(st.odo) + ' km' : 'Reminders by distance or time'));
  topBanners(v);
  const list = servSorted(S.data, st.odo || 0);
  if (!list.length) {
    v.append(card(h('div', { class: 'empty' }, h('div', { class: 'ico' }, icon('wrench')), h('h3', { text: 'No reminders yet' }),
      h('p', { text: 'Add oil changes, filters and the rest. Each one can be due by distance, by time, or whichever comes first.' }))));
  }
  for (const { s, o } of list) v.append(card(servBody(s, o)));
  v.append(h('button', { class: 'btn btn-glass glass btn-wide', onclick: () => servSheet() }, icon('plus'), 'Add a reminder'));
  if (S.data.log.length) {
    const logs = S.data.log.slice().sort((a, b) => (num(b.t) || 0) - (num(a.t) || 0));
    v.append(h('div', { class: 'month' }, h('b', { text: 'History' }), h('span', { text: money(logs.reduce((s, l) => s + (num(l.cost) || 0), 0), 0) + ' spent' })));
    v.append(h('div', { class: 'card list' }, logs.map(l => h('button', { class: 'row', onclick: () => logSheet(l) },
      h('div', { class: 'main' }, h('b', { text: l.name || 'Service' }), h('span', { text: (l.t ? fmtDate(l.t) : '') + (l.odo ? ' · ' + fmt0(l.odo) + ' km' : '') + (l.note ? ' · ' + l.note : '') })),
      h('div', { class: 'end' }, h('span', { text: num(l.cost) ? money(num(l.cost)) : '' })), icon('chev', 'chev')))));
  }
}

// ======================================================= sheets
function stationList() {
  const count = new Map();
  for (const x of S.data.fill) if (x.station) count.set(x.station, (count.get(x.station) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

// the main thing: a fill-up, typed at the pump or at the personal tank.
// Litres, total and price per litre: type any two and the third works itself out.
function personalPrice() {
  const xs = (STATS ? STATS.f : []).filter(x => x.station === PERSONAL && x.cost > 0 && x.lit > 0);
  return xs.length ? xs[xs.length - 1].cost / xs[xs.length - 1].lit : null;
}
function fillSheet(x) {
  const editing = !!x;
  const st = STATS;
  const m = { t: x ? num(x.t) || Date.now() : Date.now(), odo: x ? num(x.odo) : null, full: x ? x.full !== false : true, station: x ? x.station || '' : '', note: x ? x.note || '' : '' };
  let source = m.station === PERSONAL ? 'personal' : 'station';
  let armed = false, autoPpl = false;
  const lastOdo = st.lastFill ? st.lastFill.odo : 0;
  openSheet({
    title: editing ? 'Fill-up' : 'New fill-up', saveLabel: 'Save fill-up', onSave: () => save(),
    build(b, sheet) {
      const odo = bigField({ id: 'f-odo', label: 'Odometer', unit: 'km', mode: 'numeric', value: m.odo ? String(m.odo) : '', placeholder: lastOdo ? fmt0(lastOdo + Math.round(st.dist / Math.max(1, st.n - 1) || 600)) : '0' });
      const KEYS = ['lit', 'cost', 'ppl'];
      const LABEL = { lit: 'Litres', cost: 'Total', ppl: 'Price per litre' };
      const PH = { lit: '0.00', cost: '0.00', ppl: '0.000' };
      const F = {
        lit: bigField({ id: 'f-lit', label: LABEL.lit, unit: 'L', placeholder: PH.lit }),
        cost: bigField({ id: 'f-cost', label: LABEL.cost, pre: '$', placeholder: PH.cost }),
        ppl: bigField({ id: 'f-ppl', label: LABEL.ppl, pre: '$', placeholder: PH.ppl, last: true }),
      };
      let order = []; // the fields typed in, oldest first; with two typed, the third is worked out
      if (x && num(x.lit) > 0) { F.lit.input.value = String(num(x.lit)); order.push('lit'); }
      if (x && num(x.cost) > 0) { F.cost.input.value = fmt2(num(x.cost)); order.push('cost'); }
      const full = switchEl(m.full, v2 => { m.full = v2; update(); });
      const when = h('input', { type: 'datetime-local', value: toLocalInput(m.t), max: toLocalInput(Date.now() + 864e5) });
      const station = textRow('Station', { placeholder: 'Optional', value: source === 'personal' ? '' : m.station, list: 'stations', enterkeyhint: 'next' });
      const note = textRow('Note', { placeholder: 'Optional', value: m.note, enterkeyhint: 'done' });
      const chips = h('div', { class: 'station-chips' }, stationList().filter(n => n !== PERSONAL).slice(0, 5).map(name => h('button', { type: 'button', text: name, onclick: () => { station.input.value = name; } })));
      const srcSeg = seg([['station', 'Gas station'], ['personal', PERSONAL]], source, v2 => { source = v2; onSource(); update(); });
      const result = h('div', { class: 'result' });
      const err = h('div', { class: 'err' });
      const amounts = h('div', { class: 'pair' }, F.lit.wrap, F.cost.wrap);
      const priceRow = h('div', { class: 'pair' }, F.ppl.wrap, h('div', { class: 'foot', style: 'align-self:center;padding:0 4px', text: 'Type any two of litres, total and price. The third works itself out.' }));
      const fullRow = h('label', { class: 'gr' }, h('span', { text: 'Full tank' }), h('span', { style: 'flex:1' }), full);
      const personalNote = h('div', { class: 'foot', style: 'padding:0 4px', text: 'At your personal tank only the odometer is needed. The tank counts as full, and fuel economy starts again from here.' });
      put(b, srcSeg, odo.wrap,
        amounts, priceRow, personalNote,
        h('div', { class: 'group' },
          fullRow,
          h('label', { class: 'gr' }, h('span', { text: 'When' }), when),
          station.row, note.row),
        chips.children.length ? chips : null,
        result, err,
        h('button', { class: 'btn btn-primary btn-wide', type: 'button', onclick: () => save() }, icon('check'), editing ? 'Save changes' : 'Save fill-up'),
        editing ? confirmButton('Delete this fill-up', 'Tap again to delete it', () => { commit({ op: 'del', tab: 'fill', id: x.id }); sheet.close(); toast('Fill-up deleted', fmt0(m.odo || 0) + ' km', 'info'); }) : null);
      odo.input.addEventListener('blur', () => { const n = odo.get(); if (n) odo.input.value = fmt0(n); });
      odo.input.addEventListener('focus', () => { const n = odo.get(); if (n) odo.input.value = String(n); });
      odo.input.addEventListener('input', () => { armed = false; update(); });
      for (const k of KEYS) F[k].input.addEventListener('input', () => {
        order = order.filter(o => o !== k);
        if (F[k].input.value.trim() !== '') order.push(k);
        if (k === 'ppl') autoPpl = false;
        armed = false;
        update();
      });

      // at the personal tank it's just the odometer: always filled to full, litres and price unknown
      function onSource() {
        const personal = source === 'personal';
        for (const el of [station.row, chips, amounts, priceRow, fullRow]) el.hidden = personal;
        personalNote.hidden = !personal;
        if (personal) { m.full = true; full.checked = true; }
      }
      function derived() {
        if (order.length < 2) return null;
        const two = order.slice(-2);
        return KEYS.find(k => !two.includes(k));
      }
      function values() {
        const v = { lit: F.lit.get(), cost: F.cost.get(), ppl: F.ppl.get() }, d = derived();
        if (d === 'lit') v.lit = v.ppl > 0 && v.cost != null ? v.cost / v.ppl : null;
        if (d === 'cost') v.cost = v.lit != null && v.ppl != null ? v.lit * v.ppl : null;
        if (d === 'ppl') v.ppl = v.lit > 0 && v.cost != null ? v.cost / v.lit : null;
        if (!d && v.lit > 0 && v.cost != null && v.ppl == null) v.ppl = v.cost / v.lit;
        return { v, d };
      }
      function read() {
        const { v } = values();
        m.odo = odo.get();
        m.lit = v.lit != null && isFinite(v.lit) ? v.lit : null;
        m.cost = v.cost != null && isFinite(v.cost) ? Math.round(v.cost * 100) / 100 : null;
        m.ppl = v.ppl != null && isFinite(v.ppl) ? v.ppl : null;
        m.t = fromLocalInput(when.value) || m.t;
        m.station = source === 'personal' ? PERSONAL : station.input.value.trim();
        m.unknown = source === 'personal';
        if (m.unknown) { m.lit = null; m.cost = null; m.ppl = null; m.full = true; }
        m.note = note.input.value.trim();
      }
      function update() {
        read();
        const { v, d } = values();
        for (const k of KEYS) {
          const f = F[k], isD = k === d;
          f.wrap.classList.toggle('calc', isD);
          f.label.textContent = LABEL[k] + (isD ? ' · worked out' : '');
          if (isD) {
            f.input.value = '';
            f.input.placeholder = v[k] != null && isFinite(v[k]) ? (k === 'ppl' ? v[k].toFixed(3) : fmt2(v[k])) : PH[k];
          } else f.input.placeholder = PH[k];
        }
        const p = previewFill(m, x && x.id);
        if (m.odo && p.prev) {
          if (m.odo <= p.prev.odo) odo.setHint('Lower than your last fill-up at ' + fmt0(p.prev.odo) + ' km', true);
          else odo.setHint('+' + fmt0(m.odo - p.prev.odo) + ' km since the fill-up at ' + fmt0(p.prev.odo), m.odo - p.prev.odo > 1500);
        } else odo.setHint(lastOdo && !m.odo ? 'Last fill-up ' + fmt0(lastOdo) + ' km' : '');
        F.lit.setHint(m.lit > st.tank * 1.03 ? 'More than the ' + fmt1(st.tank) + ' L tank' : '', true);
        F.ppl.setHint('');
        result.textContent = '';
        if (p.econ != null) {
          put(result, h('div', { class: 'v' }, fmt1(p.econ), h('small', { text: 'L/100 km' })),
            h('div', { class: 's', text: fmt0(p.dist) + ' km on this tank' + (st.avg ? ' · ' + econWord(p.econ, st.avg) : '') }),
            p.perKm ? h('div', { class: 's', text: '$' + p.perKm.toFixed(3) + ' per km' }) : null);
          result.hidden = false;
        } else if (p.personal) {
          put(result, h('div', { class: 's', text: 'Tank full at this odometer. Fuel economy starts again from here.' }));
          result.hidden = false;
        } else if (m.odo && m.lit) {
          put(result, h('div', { class: 's', text: p.top ? 'Top-up: it counts toward your next full tank.' : p.first ? 'Your first full tank in the log. Fuel economy shows from the next one.' : '' }));
          result.hidden = !result.textContent;
        } else result.hidden = true;
        err.textContent = '';
      }
      function save() {
        read();
        if (!(m.odo > 0)) { odo.bad(true); err.textContent = 'Type what the odometer says.'; odo.input.focus(); return; }
        odo.bad(false);
        if (!m.unknown && !(m.lit > 0)) { F.lit.bad(true); err.textContent = 'Type the litres, or the total and the price per litre.'; F.lit.input.focus(); return; }
        F.lit.bad(false);
        const p = previewFill(m, x && x.id);
        if (p.prev && m.odo <= p.prev.odo && !armed) { armed = true; err.textContent = 'That\'s lower than your last fill-up. Check it, or save again to keep it.'; return; }
        const row = { id: x ? x.id : newId('f'), t: m.t, odo: Math.round(m.odo), lit: m.unknown ? '' : Math.round(m.lit * 1000) / 1000, cost: m.unknown || m.cost == null ? '' : m.cost, full: m.full, station: m.station, note: m.note };
        commit({ op: 'put', tab: 'fill', row });
        sheet.close();
        toast(editing ? 'Fill-up changed' : 'Fill-up saved',
          m.unknown ? 'Personal tank: full at ' + fmt0(m.odo) + ' km' : p.econ != null ? fmt1(p.econ) + ' L/100 km' + (st.avg ? ', ' + econWord(p.econ, st.avg) : '') : (m.full ? 'Fuel economy shows after your next full tank' : 'Top-up: counts toward the next full tank'));
      }
      onSource();
      update();
      if (!editing) setTimeout(() => odo.input.focus(), 60);
    },
  });
}

function odoSheet() {
  const st = STATS;
  openSheet({
    title: 'Odometer', onSave: () => save(),
    build(b, sheet) {
      const f = bigField({ id: 'o-odo', label: 'What it says now', unit: 'km', mode: 'numeric', value: st.odo ? String(st.odo) : '', last: true });
      const err = h('div', { class: 'err' });
      put(b, f.wrap, h('div', { class: 'foot', text: 'Keeps the range estimate and service reminders current between fill-ups. The dashboard sees it too.' }), err,
        h('button', { class: 'btn btn-primary btn-wide', onclick: () => save() }, icon('check'), 'Save'));
      f.input.addEventListener('input', () => {
        const n = f.get();
        f.setHint(n && st.lastFill && n < st.lastFill.odo ? 'Lower than your last fill-up at ' + fmt0(st.lastFill.odo) + ' km' : (st.odo ? 'Was ' + fmt0(st.odo) + ' km, ' + ago(st.odoT) : ''), n && st.lastFill && n < st.lastFill.odo);
      });
      f.input.dispatchEvent(new Event('input'));
      setTimeout(() => { f.input.focus(); f.input.select(); }, 60);
      function save() {
        const n = f.get();
        if (!(n > 0)) { err.textContent = 'Type what the odometer says.'; return; }
        commit({ op: 'info', set: { odo: Math.round(n), odoT: Date.now() } });
        sheet.close();
        toast('Odometer updated', fmt0(n) + ' km');
      }
    },
  });
}

const SERV_NAMES = ['Oil change', 'Fuel filter', 'Air filter', 'Tire rotation', 'Coolant', 'Brake fluid', 'Transmission fluid', 'Differential oil'];
function servSheet(s) {
  const editing = !!s, st = STATS;
  const m = s ? Object.assign({}, s) : { name: '', km: null, mo: null, lastKm: st.odo || null, lastT: Date.now(), note: '' };
  openSheet({
    title: editing ? s.name : 'New reminder', onSave: () => save(),
    build(b, sheet) {
      const name = textRow('Name', { placeholder: 'Oil change', value: m.name || '' });
      const chips = h('div', { class: 'station-chips' }, SERV_NAMES.map(n => h('button', { type: 'button', text: n, onclick: () => { name.input.value = n; update(); } })));
      const km = bigField({ id: 's-km', label: 'Every', unit: 'km', mode: 'numeric', value: m.km ? String(m.km) : '', placeholder: '8000' });
      const mo = bigField({ id: 's-mo', label: 'Or every', unit: 'months', mode: 'numeric', value: m.mo ? String(m.mo) : '', placeholder: '6' });
      const lastKm = bigField({ id: 's-lkm', label: 'Last done at', unit: 'km', mode: 'numeric', value: m.lastKm != null ? String(m.lastKm) : '' });
      const lastT = h('input', { type: 'date', value: m.lastT ? toLocalInput(m.lastT, true) : '' });
      const note = textRow('Note', { placeholder: 'Optional', value: m.note || '' });
      const info = h('div', { class: 'result' });
      const err = h('div', { class: 'err' });
      put(b, h('div', { class: 'group' }, name.row), editing ? null : chips, h('div', { class: 'pair' }, km.wrap, mo.wrap), lastKm.wrap,
        h('div', { class: 'group' }, h('label', { class: 'gr' }, h('span', { text: 'Last done on' }), lastT), note.row),
        info, err, h('button', { class: 'btn btn-primary btn-wide', onclick: () => save() }, icon('check'), 'Save'),
        editing ? confirmButton('Delete this reminder', 'Tap again to delete it', () => { commit({ op: 'del', tab: 'serv', id: s.id }); sheet.close(); toast('Reminder deleted', s.name, 'info'); }) : null);
      for (const i of [km.input, mo.input, lastKm.input, lastT]) i.addEventListener('input', update);
      function read() {
        m.name = name.input.value.trim(); m.km = km.get(); m.mo = mo.get(); m.lastKm = lastKm.get();
        m.lastT = fromLocalInput(lastT.value); m.note = note.input.value.trim();
      }
      function update() {
        read();
        const o = servState(m, st.odo || 0);
        info.textContent = '';
        if (o.state === 'none') { info.hidden = true; return; }
        info.hidden = false;
        if (o.nextKm != null) info.append(h('div', { class: 's', text: 'Next at ' + fmt0(o.nextKm) + ' km · ' + (o.kmLeft >= 0 ? 'in ' + fmt0(o.kmLeft) + ' km' : 'overdue') }));
        if (o.nextT != null) info.append(h('div', { class: 's', text: 'By ' + fmtDate(o.nextT) + ' · ' + (o.daysLeft >= 0 ? 'in ' + inDays(o.daysLeft) : 'overdue') }));
      }
      function save() {
        read();
        if (!m.name) { err.textContent = 'Give it a name, like Oil change.'; return; }
        if (!(m.km > 0) && !(m.mo > 0)) { err.textContent = 'Say how often: in km, in months, or both.'; return; }
        commit({ op: 'put', tab: 'serv', row: { id: s ? s.id : newId('s'), name: m.name, km: m.km || '', mo: m.mo || '', lastKm: m.lastKm == null ? '' : Math.round(m.lastKm), lastT: m.lastT || '', note: m.note } });
        sheet.close();
        toast(editing ? 'Reminder saved' : 'Reminder added', m.name);
      }
      update();
    },
  });
}

function doneSheet(s) {
  const st = STATS;
  openSheet({
    title: s.name + ' done', saveLabel: 'Save', onSave: () => save(),
    build(b, sheet) {
      const odo = bigField({ id: 'd-odo', label: 'Odometer', unit: 'km', mode: 'numeric', value: st.odo ? String(st.odo) : '' });
      const cost = bigField({ id: 'd-cost', label: 'Cost', pre: '$', placeholder: 'optional', last: true });
      const when = h('input', { type: 'date', value: toLocalInput(Date.now(), true) });
      const note = textRow('Note', { placeholder: 'Oil type, shop, parts', value: '' });
      const err = h('div', { class: 'err' });
      put(b, odo.wrap, cost.wrap, h('div', { class: 'group' }, h('label', { class: 'gr' }, h('span', { text: 'Date' }), when), note.row), err,
        h('button', { class: 'btn btn-primary btn-wide', onclick: () => save() }, icon('check'), 'Mark done'));
      function save() {
        const n = odo.get(), t = fromLocalInput(when.value) || Date.now();
        if (!(n > 0)) { err.textContent = 'Type the odometer when it was done.'; return; }
        const ops = [
          { op: 'put', tab: 'serv', row: { id: s.id, lastKm: Math.round(n), lastT: t } },
          { op: 'put', tab: 'log', row: { id: newId('l'), sid: s.id, name: s.name, t, odo: Math.round(n), cost: cost.get() == null ? '' : cost.get(), note: note.input.value.trim() } },
        ];
        if (n > (st.odo || 0)) ops.push({ op: 'info', set: { odo: Math.round(n), odoT: Date.now() } });
        commit(...ops);
        sheet.close();
        const o = servState(Object.assign({}, s, { lastKm: n, lastT: t }), n);
        toast(s.name + ' done', o.nextKm != null ? 'Next at ' + fmt0(o.nextKm) + ' km' : (o.nextT ? 'Next by ' + fmtDate(o.nextT) : ''));
      }
    },
  });
}

function logSheet(l) {
  openSheet({
    title: l.name || 'Service', onSave: () => save(),
    build(b, sheet) {
      const odo = bigField({ id: 'l-odo', label: 'Odometer', unit: 'km', mode: 'numeric', value: num(l.odo) ? String(num(l.odo)) : '' });
      const cost = bigField({ id: 'l-cost', label: 'Cost', pre: '$', value: num(l.cost) ? fmt2(num(l.cost)) : '', placeholder: 'optional', last: true });
      const when = h('input', { type: 'date', value: l.t ? toLocalInput(num(l.t), true) : '' });
      const note = textRow('Note', { placeholder: 'Optional', value: l.note || '' });
      put(b, odo.wrap, cost.wrap, h('div', { class: 'group' }, h('label', { class: 'gr' }, h('span', { text: 'Date' }), when), note.row),
        h('button', { class: 'btn btn-primary btn-wide', onclick: () => save() }, icon('check'), 'Save'),
        confirmButton('Delete from history', 'Tap again to delete it', () => { commit({ op: 'del', tab: 'log', id: l.id }); sheet.close(); }));
      function save() {
        commit({ op: 'put', tab: 'log', row: { id: l.id, odo: odo.get() == null ? '' : Math.round(odo.get()), cost: cost.get() == null ? '' : cost.get(), t: fromLocalInput(when.value) || num(l.t) || '', note: note.input.value.trim() } });
        sheet.close();
      }
    },
  });
}

function settingsSheet() {
  openSheet({
    title: 'Settings',
    build(b, sheet) {
      const st = STATS;
      // the Jeep log connection
      const status = h('div', { class: 'row' },
        h('div', { class: 'main' }, h('b', { text: S.sample ? 'Not connected' : syncWords() }),
          h('span', { text: S.sample ? 'Showing sample data' : (S.sync.msg || (S.syncedAt ? 'Last synced ' + ago(S.syncedAt) : '')) })));
      const rows = [status];
      if (!S.sample) {
        rows.push(h('button', { class: 'row', onclick: () => { sync('tap'); sheet.close(); } }, h('div', { class: 'main' }, h('b', { text: 'Sync now', style: 'color:var(--fuel)' })), icon('sync', 'chev')));
        if (S.conn && S.conn.s) rows.push(h('a', { class: 'row', href: 'https://docs.google.com/spreadsheets/d/' + S.conn.s + '/edit', target: '_blank', rel: 'noopener', style: 'color:inherit;text-decoration:none' },
          h('div', { class: 'main' }, h('b', { text: 'Open the sheet' }), h('span', { text: 'Fill-ups, service and trips in Google Sheets' })), icon('sheet', 'chev')));
      }
      rows.push(h('button', { class: 'row', onclick: () => connectSheet() }, h('div', { class: 'main' }, h('b', { text: S.sample ? 'Connect your Jeep log' : 'Connection' }), h('span', { text: S.sample ? 'Paste your setup link' : 'Change the link to your Jeep log' })), icon('chev', 'chev')));
      // the Jeep
      const veh = h('input', { value: S.prefs.vehicle, placeholder: 'Name', autocomplete: 'off', enterkeyhint: 'done' });
      veh.addEventListener('change', () => { S.prefs.vehicle = veh.value.trim() || '2006 Liberty CRD'; savePrefs(); render(); });
      const tank = h('input', { inputmode: 'decimal', value: fmt1(st.tank), autocomplete: 'off', enterkeyhint: 'done' });
      tank.addEventListener('change', () => { const n = num(tank.value); if (n > 20 && n < 400) commit({ op: 'info', set: { tank: n } }); });
      put(b, h('div', { class: 'label', text: 'Jeep log' }), h('div', { class: 'card list' }, rows),
        h('div', { class: 'label', text: 'Vehicle' }),
        h('div', { class: 'group' }, h('label', { class: 'gr' }, h('span', { text: 'Name' }), veh), h('label', { class: 'gr' }, h('span', { text: 'Tank (L)' }), tank)),
        h('div', { class: 'label', text: 'Appearance' }),
        seg([['system', 'Automatic'], ['dark', 'Dark'], ['light', 'Light']], S.prefs.theme, v2 => { S.prefs.theme = v2; savePrefs(); applyTheme(); }),
        h('div', { class: 'label', text: 'iPhone' }),
        h('div', { class: 'card list' }, h('button', { class: 'row', onclick: () => widgetSheet() }, h('div', { class: 'main' }, h('b', { text: 'iPhone widget' }),
          h('span', { text: 'To empty, economy and more on your Home Screen, Today View and Lock Screen' })), icon('chev', 'chev'))),
        h('div', { class: 'label', text: 'Live' }),
        h('div', { class: 'card list' },
          h('button', { class: 'row', onclick: () => { sheet.close(); go('live'); demoStart(); } }, h('div', { class: 'main' }, h('b', { text: 'Try the live demo' }), h('span', { text: 'Made-up numbers, to see the Live screen' })), icon('play', 'chev')),
          h('a', { class: 'row', href: 'https://github.com/Bennydedado/jeep/blob/main/T3.md', target: '_blank', rel: 'noopener', style: 'color:inherit;text-decoration:none' }, h('div', { class: 'main' }, h('b', { text: 'How the T3 talks to this app' }), h('span', { text: 'The Bluetooth messages, for the T3 code' })), icon('link', 'chev'))),
        h('div', { class: 'foot', style: 'text-align:center', text: 'Jeep ' + VERSION + ' · your data lives in your Jeep log sheet' }),
        S.sample ? null : confirmButton('Disconnect this phone', 'Tap again: this phone forgets the link (the sheet keeps everything)', () => { forgetPhone(); sheet.close(); render(); toast('Disconnected', 'The sheet still has everything', 'info'); }));
    },
  });
}

function connectSheet() {
  openSheet({
    title: 'Connect',
    build(b, sheet) {
      const link = h('textarea', { rows: 3, placeholder: 'Paste the setup link here', autocomplete: 'off', style: 'font:15px/1.35 var(--font)' });
      const err = h('div', { class: 'err' });
      const go2 = h('button', { class: 'btn btn-primary btn-wide', onclick: () => tryIt() }, icon('link'), 'Connect');
      const paste = navigator.clipboard && navigator.clipboard.readText
        ? h('button', { class: 'btn btn-glass glass btn-wide', onclick: async () => { try { link.value = await navigator.clipboard.readText(); tryIt(); } catch (e) { link.focus(); } } }, icon('copy'), 'Paste the link')
        : null;
      put(b, h('div', { class: 'foot', text: 'Open the setup link Claude sent you on this phone, or copy it and paste it here. It connects this app to your Jeep log sheet.' }),
        h('div', { class: 'field small-in' }, h('span', { class: 'fl', text: 'Setup link' }), link), err, paste, go2);
      async function tryIt() {
        const c = decodeSetup(link.value);
        if (!c) { err.textContent = 'That isn\'t a setup link. It starts with https:// and has #setup= in it.'; return; }
        err.textContent = '';
        go2.disabled = true; go2.lastChild.textContent = 'Connecting…';
        connect(c);
        await sync('connect');
        go2.disabled = false; go2.lastChild.textContent = 'Connect';
        if (S.sync.state === 'ok' || S.sync.state === 'pending') { sheet.close(); toast('Connected', 'Your Jeep log is on this phone'); }
        else err.textContent = S.sync.state === 'key' ? 'The sheet didn\'t accept the key in that link.' : 'Couldn\'t reach the sheet. ' + (S.sync.msg || 'Check your signal and try again.');
      }
    },
  });
}
