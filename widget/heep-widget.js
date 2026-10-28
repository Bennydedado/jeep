// HEEP_WIDGET - the Jeep on your iPhone's widget pages and Lock Screen, through the free Scriptable app.
//
// The little script you paste into Scriptable (widget/Heep.js) downloads this file and runs it, so changes made here
// reach your phone by themselves. It reads your Jeep log (the same Google Sheet Heep uses, through the setup link
// you give it once; kept in Scriptable's Keychain, never in this file) and works the numbers out with Heep's own
// code (core.js, econ.js, trips.js, downloaded and kept for when there's no signal).
//
// Sizes: small, medium, large (home screen and the Today View), and the Lock Screen's circle, rectangle and line.
// What each shows: run the script in Scriptable (Customize), or per widget: Edit Widget > Parameter, e.g.
// "dte,econ,week" (the blocks below, first one big).
//
// Plain JavaScript for Scriptable; tests/app/test_widget.js runs it in Node with a pretend Scriptable.

const BASE = 'https://bennydedado.github.io/jeep/';
const LIBS = ['core.js', 'econ.js', 'trips.js'];
const KEY = 'heep.setup';                         // Keychain: {"u": web app link, "k": key}
const BLOCKS = {
  dte: 'Distance to empty', econ: 'Fuel economy', cost: 'Cost per km', week: 'This week', month: 'This month',
  trip: 'Last trip', odo: 'Odometer', service: 'Next service', fill: 'Last fill-up', chart: 'Driving by week (chart)',
};
const DEFAULTS = {
  small: ['dte', 'econ'], medium: ['dte', 'econ', 'cost', 'week'], large: ['dte', 'econ', 'cost', 'week', 'month', 'trip', 'service', 'chart'],
  accessoryCircular: ['dte'], accessoryRectangular: ['dte', 'econ', 'week'], accessoryInline: ['dte', 'econ'],
};
const FAMILY_NAMES = { small: 'Small', medium: 'Medium', large: 'Large', accessoryCircular: 'Lock Screen circle',
  accessoryRectangular: 'Lock Screen rectangle', accessoryInline: 'Lock Screen line' };
const MAX = { small: 2, medium: 4, large: 8, extraLarge: 8, accessoryCircular: 1, accessoryRectangular: 3, accessoryInline: 2 };

// ---------------------------------------------------------------- numbers
const f0 = n => Math.round(n).toLocaleString('en-US');
const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
function agoShort(t, now) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min';
  if (s < 86400) return Math.round(s / 3600) + ' h';
  return Math.round(s / 86400) + ' d';
}
function dur(sec) {
  const m = Math.round(sec / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
}
function when(t, now) {
  const d = new Date(t), today = new Date(now);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return time;
  if (d.toDateString() === new Date(now - 864e5).toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// the setup link Heep makes: https://.../jeep/#setup=<base64url of {"u","k","s"}>
function parseSetup(text, b64) {
  const m = String(text || '').match(/setup=([A-Za-z0-9_\-]+)/);
  if (!m) return null;
  try {
    let b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const j = JSON.parse(b64(b));
    if (j && /^https:\/\/script\.google(usercontent)?\.com\//.test(j.u) && j.k) return { u: j.u, k: String(j.k) };
  } catch (e) { /* not a setup link */ }
  return null;
}

// Heep's own code, evaluated here: calc() (core.js), blendEcon() (econ.js), tripTotals() (trips.js)
function loadLib(sources) {
  const src = sources.join('\n;\n') + '\nreturn { calc, blendEcon, tripTotals, servSorted, normalize, sampleData, num, STATE_WORD };';
  return new Function('module', 'localStorage', src)(undefined, undefined);
}

// ---------------------------------------------------------------- what the widget shows: the numbers, from the log
function model(j, L, now) {
  const d = L.normalize(j);
  const st = L.calc(d);
  const e = st.econ || L.blendEcon(st, d.trip);
  const wk = L.tripTotals(d.trip, 'w', 8, now), month = L.tripTotals(d.trip, 'm', 1, now)[0];
  const trips = d.trip.slice().filter(t => L.num(t.t1) || L.num(t.t0)).sort((a, b) => (L.num(b.t1) || L.num(b.t0)) - (L.num(a.t1) || L.num(a.t0)));
  const serv = L.servSorted(d, st.odo || 0).filter(x => x.o.state !== 'none')[0] || null;
  return { d, st, e, wk, week: wk[wk.length - 1], month, last: trips[0] || null, serv, now, L };
}
// each block: label, SF Symbol, value + unit, a line under it; pct for the gauge
function block(id, m) {
  const { st, e, now, L } = m;
  const per = (p, word) => ({ value: f0(p.km), unit: 'km', sub: p.n ? p.n + (p.n > 1 ? ' trips' : ' trip') + (p.lit > 0 ? ' · ' + f1(p.lit) + ' L' : '') : 'no trips ' + word });
  switch (id) {
    case 'dte': return e.left != null
      ? { label: 'To empty', sym: 'fuelpump.fill', value: '≈' + f0(e.left), unit: 'km', sub: f0(e.fuelL) + ' L · ' + Math.round(e.fuelPct * 100) + '%', pct: e.fuelPct, low: e.fuelPct < 0.15 }
      : { label: 'To empty', sym: 'fuelpump.fill', value: '—', unit: '', sub: st.lastFull ? 'needs some driving' : 'after a full fill-up', pct: null };
    case 'econ': return { label: 'Economy', sym: 'leaf.fill', value: e.v ? f1(e.v) : '—', unit: 'L/100',
      sub: ({ tank: 'full tanks', mix: 'tanks + T3 since', t3: 'T3 estimate' })[e.src] || 'after some driving' };
    case 'cost': return { label: 'Cost per km', sym: 'dollarsign.circle.fill', value: e.perKm ? '$' + e.perKm.toFixed(3) : '—', unit: '',
      sub: e.perKm ? (e.perKmEst ? 'estimate' : 'diesel, full tanks') : 'after a priced fill-up' };
    case 'week': return Object.assign({ label: 'This week', sym: 'calendar' }, per(m.week, 'yet'));
    case 'month': return Object.assign({ label: 'This month', sym: 'calendar.circle.fill' }, per(m.month, 'yet'));
    case 'trip': {
      const t = m.last;
      if (!t) return { label: 'Last trip', sym: 'car.fill', value: '—', unit: '', sub: 'no trips yet' };
      const km = L.num(t.km) || 0, lit = L.num(t.lit) || 0, s = ((L.num(t.t1) || 0) - (L.num(t.t0) || 0)) / 1000;
      return { label: 'Last trip', sym: 'car.fill', value: f1(km), unit: 'km',
        sub: when(L.num(t.t1) || L.num(t.t0), now) + (s > 0 ? ' · ' + dur(s) : '') + (km > 1 && lit > 0 ? ' · ' + f1(lit / km * 100) + ' L/100' : '') };
    }
    case 'odo': return { label: 'Odometer', sym: 'gauge.with.dots.needle.67percent', value: st.odo ? f0(st.odo) : '—', unit: 'km', sub: st.odoT ? 'as of ' + when(st.odoT, now) : '' };
    case 'service': {
      const x = m.serv;
      if (!x) return { label: 'Service', sym: 'wrench.and.screwdriver.fill', value: 'All good', unit: '', sub: 'no reminders due' };
      const o = x.o, byKm = o.kmLeft != null, byDay = o.daysLeft != null;
      const v = byKm && (!byDay || o.kmLeft / 50 < o.daysLeft) ? (o.kmLeft < 0 ? f0(-o.kmLeft) + ' km over' : f0(o.kmLeft) + ' km')
        : byDay ? (o.daysLeft < 0 ? Math.round(-o.daysLeft) + ' d over' : Math.round(o.daysLeft) + ' d') : '';
      return { label: x.s.name || 'Service', sym: 'wrench.and.screwdriver.fill', value: v, unit: '', sub: L.STATE_WORD[o.state] || '', warn: o.state === 'over' || o.state === 'soon' };
    }
    case 'fill': {
      const x = st.lastFill;
      if (!x) return { label: 'Last fill-up', sym: 'drop.fill', value: '—', unit: '', sub: 'none yet' };
      return { label: 'Last fill-up', sym: 'drop.fill', value: x.t ? agoShort(x.t, now) : '—', unit: x.t ? 'ago' : '',
        sub: (x.lit ? f1(x.lit) + ' L' : 'litres not known') + (x._ && x._.ppl ? ' · $' + x._.ppl.toFixed(3) + '/L' : '') };
    }
    case 'chart': {
      const total = m.wk.reduce((a, p) => a + p.km, 0);
      return { label: 'Driving by week', sym: 'chart.bar.fill', value: f0(total), unit: 'km', sub: 'last ' + m.wk.length + ' weeks', chart: m.wk.map(p => p.km) };
    }
  }
  return { label: id, sym: 'questionmark.circle', value: '?', unit: '', sub: 'unknown block' };
}
// which blocks this widget shows: its Parameter, else your choice for this size, else the defaults
function pick(family, param, cfg) {
  const fromParam = String(param || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(s => BLOCKS[s]);
  const list = fromParam.length ? fromParam : (cfg && cfg[family] && cfg[family].length ? cfg[family] : DEFAULTS[family] || DEFAULTS.medium);
  return list.slice(0, MAX[family] || 4);
}

// ---------------------------------------------------------------- drawing (Scriptable)
const C = () => ({
  bg1: Color.dynamic(new Color('#ffffff'), new Color('#1c1c1e')), bg2: Color.dynamic(new Color('#f2f2f7'), new Color('#0b0b0d')),
  ink: Color.dynamic(new Color('#000000'), new Color('#ffffff')), ink2: Color.dynamic(new Color('#6e6e73'), new Color('#a1a1a6')),
  tile: Color.dynamic(new Color('#000000', 0.05), new Color('#ffffff', 0.08)),
  fuel: new Color('#ff9f0a'), good: new Color('#30d158'), bad: new Color('#ff453a'), warn: new Color('#ffd60a'),
});
function arcImage(pct, size, line, color, track, label, labelColor, sub) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size); ctx.opaque = false; ctx.respectScreenScale = true;
  const cx = size / 2, cy = size / 2, r = size / 2 - line / 2 - 1;
  const arc = (from, to, col) => {
    const p = new Path(), steps = Math.max(2, Math.round((to - from) / 4));
    for (let i = 0; i <= steps; i++) {
      const a = (from + (to - from) * i / steps - 90) * Math.PI / 180, pt = new Point(cx + r * Math.cos(a), cy + r * Math.sin(a));
      if (i) p.addLine(pt); else p.move(pt);
    }
    ctx.addPath(p); ctx.setStrokeColor(col); ctx.setLineWidth(line); ctx.strokePath();
  };
  arc(-135, 135, track);
  if (pct != null && pct > 0.005) arc(-135, -135 + 270 * Math.min(1, pct), color);
  if (label) {
    ctx.setTextAlignedCenter();
    ctx.setFont(Font.boldRoundedSystemFont(size * 0.24)); ctx.setTextColor(labelColor);
    ctx.drawTextInRect(label, new Rect(0, cy - size * 0.2, size, size * 0.3));
    if (sub) { ctx.setFont(Font.mediumRoundedSystemFont(size * 0.12)); ctx.drawTextInRect(sub, new Rect(0, cy + size * 0.1, size, size * 0.2)); }
  }
  return ctx.getImage();
}
function barsImage(values, w, h, color, faint) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true;
  const max = Math.max(1, ...values), n = Math.max(1, values.length), slot = w / n, bw = Math.min(22, slot * 0.62);
  values.forEach((v, i) => {
    const bh = v > 0 ? Math.max(4, (h - 2) * v / max) : 2;
    ctx.setFillColor(i === n - 1 ? color : faint);
    const p = new Path(); p.addRoundedRect(new Rect(i * slot + (slot - bw) / 2, h - bh, bw, bh), 4, 4); ctx.addPath(p); ctx.fillPath();
  });
  return ctx.getImage();
}
function txt(stack, s, font, color, opts = {}) {
  const t = stack.addText(String(s));
  t.font = font; t.textColor = color;
  t.lineLimit = opts.lines || 1;
  if (opts.scale) t.minimumScaleFactor = opts.scale;
  if (opts.right) t.rightAlignText();
  if (opts.center) t.centerAlignText();
  return t;
}
function symbol(stack, name, size, color) {
  const s = SFSymbol.named(name) || SFSymbol.named('circle.fill');
  const img = stack.addImage(s.image);
  img.imageSize = new Size(size, size); img.tintColor = color;
  return img;
}
function hero(stack, b, c, size) {
  const head = stack.addStack(); head.layoutHorizontally(); head.centerAlignContent(); head.spacing = 4;
  symbol(head, b.sym, size === 'small' ? 11 : 13, c.fuel);
  txt(head, b.label.toUpperCase(), Font.semiboldSystemFont(size === 'small' ? 10 : 11), c.ink2);
  stack.addSpacer(2);
  const row = stack.addStack(); row.layoutHorizontally(); row.bottomAlignContent(); row.spacing = 3;
  txt(row, b.value, Font.boldRoundedSystemFont(size === 'large' ? 40 : size === 'medium' ? 34 : 30), b.low ? c.bad : c.ink, { scale: 0.5 });
  if (b.unit) { const u = txt(row, b.unit, Font.semiboldRoundedSystemFont(13), c.ink2); u.lineLimit = 1; }
  if (b.sub) txt(stack, b.sub, Font.mediumSystemFont(11), c.ink2, { scale: 0.7 });
}
function rowLine(stack, b, c) {
  const r = stack.addStack(); r.layoutHorizontally(); r.centerAlignContent(); r.spacing = 6;
  symbol(r, b.sym, 13, b.warn ? c.warn : c.fuel);
  const left = r.addStack(); left.layoutVertically();
  txt(left, b.label, Font.semiboldSystemFont(12), c.ink, { scale: 0.7 });
  if (b.sub) txt(left, b.sub, Font.systemFont(10), c.ink2, { scale: 0.7 });
  r.addSpacer();
  txt(r, b.value + (b.unit ? ' ' + b.unit : ''), Font.boldRoundedSystemFont(15), c.ink, { scale: 0.6, right: true });
}
function tileBox(stack, b, c) {
  const t = stack.addStack(); t.layoutVertically(); t.backgroundColor = c.tile; t.cornerRadius = 12; t.setPadding(8, 10, 8, 10);
  t.size = new Size(146, 64);   // two to a row on any iPhone's large widget
  const head = t.addStack(); head.layoutHorizontally(); head.centerAlignContent(); head.spacing = 4;
  symbol(head, b.sym, 10, b.warn ? c.warn : c.fuel);
  txt(head, b.label, Font.semiboldSystemFont(10), c.ink2, { scale: 0.7 });
  t.addSpacer(2);
  const v = t.addStack(); v.layoutHorizontally(); v.bottomAlignContent(); v.spacing = 2;
  txt(v, b.value, Font.boldRoundedSystemFont(19), c.ink, { scale: 0.5 });
  if (b.unit) txt(v, b.unit, Font.semiboldRoundedSystemFont(10), c.ink2);
  if (b.sub) txt(t, b.sub, Font.systemFont(9), c.ink2, { scale: 0.7 });
  return t;
}
function footer(w, m, c, stale) {
  const f = w.addStack(); f.layoutHorizontally();
  txt(f, stale ? 'offline · ' + stale : '2006 Liberty CRD', Font.mediumSystemFont(9), stale ? c.warn : c.ink2, { scale: 0.7 });
  f.addSpacer();
  const t = new Date(m.now);
  txt(f, t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), Font.mediumSystemFont(9), c.ink2);
}

// a widget for this family from the numbers (m) and the blocks to show
function render(family, ids, m, stale) {
  const c = C();
  const w = new ListWidget();
  w.url = BASE;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
  const bs = ids.map(id => Object.assign({ id }, block(id, m)));
  // ---- Lock Screen
  if (family === 'accessoryInline') {
    w.addText(bs.map(b => (b.id === 'dte' ? '⛽ ' : '') + b.value + (b.unit ? ' ' + b.unit : '')).join(' · '));
    return w;
  }
  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const b = bs[0];
    const img = w.addImage(arcImage(b.pct != null ? b.pct : null, 120, 10, Color.white(), new Color('#ffffff', 0.3),
      b.value.replace('≈', ''), Color.white(), b.unit || b.label));
    img.centerAlignImage && img.centerAlignImage();
    return w;
  }
  if (family === 'accessoryRectangular') {
    w.addAccessoryWidgetBackground = false;
    bs.forEach((b, i) => {
      const r = w.addStack(); r.layoutHorizontally(); r.centerAlignContent(); r.spacing = 4;
      symbol(r, b.sym, i ? 11 : 13, Color.white());
      txt(r, i ? b.label + ' ' + b.value + (b.unit ? ' ' + b.unit : '') : b.value + (b.unit ? ' ' + b.unit : '') + (b.id === 'dte' ? ' to empty' : ' ' + b.label.toLowerCase()),
        i ? Font.mediumSystemFont(12) : Font.boldRoundedSystemFont(15), Color.white(), { scale: 0.6 });
    });
    return w;
  }
  // ---- home screen / Today View
  const g = new LinearGradient(); g.colors = [c.bg1, c.bg2]; g.locations = [0, 1];
  w.backgroundGradient = g;
  const first = bs[0], rest = bs.slice(1);
  if (family === 'small') {
    w.setPadding(14, 14, 12, 14);
    hero(w, first, c, 'small');
    w.addSpacer();
    if (first.pct != null) {
      const bar = w.addImage(barLine(first.pct, 130, first.low ? c.bad : c.fuel)); bar.imageSize = new Size(130, 6);
      w.addSpacer(6);
    }
    for (const b of rest) {
      const r = w.addStack(); r.layoutHorizontally(); r.bottomAlignContent(); r.spacing = 3;
      txt(r, b.value, Font.boldRoundedSystemFont(16), c.ink, { scale: 0.6 });
      txt(r, b.unit || b.label, Font.semiboldSystemFont(10), c.ink2, { scale: 0.7 });
    }
    return w;
  }
  if (family === 'medium') {
    w.setPadding(14, 16, 10, 16);
    const main = w.addStack(); main.layoutHorizontally(); main.spacing = 12;
    const left = main.addStack(); left.layoutVertically(); left.size = new Size(130, 0);
    if (first.pct != null) {
      const img = left.addImage(arcImage(first.pct, 74, 9, first.low ? c.bad : c.fuel, new Color('#8e8e93', 0.3), Math.round(first.pct * 100) + '%', c.fuel));
      img.imageSize = new Size(52, 52);
      left.addSpacer(4);
    }
    hero(left, first, c, 'medium');
    const right = main.addStack(); right.layoutVertically(); right.spacing = 7;
    right.addSpacer();
    for (const b of rest) (b.id === 'chart' ? chartLine(right, b, c, 150, 34) : rowLine(right, b, c));
    right.addSpacer();
    w.addSpacer(4);
    footer(w, m, c, stale);
    return w;
  }
  // large (and extra large)
  w.setPadding(16, 16, 12, 16);
  const top = w.addStack(); top.layoutHorizontally(); top.centerAlignContent(); top.spacing = 14;
  if (first.pct != null) {
    const img = top.addImage(arcImage(first.pct, 96, 11, first.low ? c.bad : c.fuel, new Color('#8e8e93', 0.3), Math.round(first.pct * 100) + '%', c.fuel));
    img.imageSize = new Size(72, 72);
  }
  const col = top.addStack(); col.layoutVertically(); hero(col, first, c, 'large');
  top.addSpacer();
  w.addSpacer(10);
  const tiles = rest.filter(b => b.id !== 'chart'), chart = rest.find(b => b.id === 'chart');
  for (let i = 0; i < tiles.length; i += 2) {
    const r = w.addStack(); r.layoutHorizontally(); r.spacing = 8;
    tileBox(r, tiles[i], c);
    if (tiles[i + 1]) tileBox(r, tiles[i + 1], c); else r.addSpacer();
    w.addSpacer(8);
  }
  if (chart) chartLine(w, chart, c, 300, 44);
  w.addSpacer();
  footer(w, m, c, stale);
  return w;
}
function barLine(pct, w, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, 6); ctx.opaque = false; ctx.respectScreenScale = true;
  const p0 = new Path(); p0.addRoundedRect(new Rect(0, 0, w, 6), 3, 3); ctx.addPath(p0); ctx.setFillColor(new Color('#8e8e93', 0.3)); ctx.fillPath();
  if (pct > 0.01) { const p = new Path(); p.addRoundedRect(new Rect(0, 0, Math.max(6, w * Math.min(1, pct)), 6), 3, 3); ctx.addPath(p); ctx.setFillColor(color); ctx.fillPath(); }
  return ctx.getImage();
}
function chartLine(stack, b, c, w, h) {
  const head = stack.addStack(); head.layoutHorizontally(); head.centerAlignContent(); head.spacing = 4;
  symbol(head, b.sym, 10, c.fuel);
  txt(head, b.label, Font.semiboldSystemFont(10), c.ink2);
  head.addSpacer();
  txt(head, b.value + ' km · ' + b.sub, Font.mediumSystemFont(10), c.ink2, { scale: 0.7 });
  stack.addSpacer(3);
  const img = stack.addImage(barsImage(b.chart, w, h, c.fuel, new Color('#ff9f0a', 0.35)));
  img.imageSize = new Size(w, h);
}
function messageWidget(title, text) {
  const c = C(), w = new ListWidget();
  const g = new LinearGradient(); g.colors = [c.bg1, c.bg2]; g.locations = [0, 1]; w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);
  const h = w.addStack(); h.layoutHorizontally(); h.centerAlignContent(); h.spacing = 4;
  symbol(h, 'fuelpump.fill', 12, c.fuel);
  txt(h, 'HEEP', Font.semiboldSystemFont(11), c.ink2);
  w.addSpacer(6);
  txt(w, title, Font.boldSystemFont(14), c.ink, { lines: 2, scale: 0.7 });
  w.addSpacer(4);
  txt(w, text, Font.systemFont(11), c.ink2, { lines: 4, scale: 0.7 });
  w.url = 'scriptable:///run/' + encodeURIComponent(Script.name());
  return w;
}

// ---------------------------------------------------------------- data and files (Scriptable)
const fm = () => FileManager.local();
// kept in Scriptable's Library folder: in its Documents folder, .js files show up in your Scripts list
const file = name => fm().joinPath(fm().libraryDirectory(), 'heep-' + name);
// the first version kept them in Documents (and its pasted script fetched this file into there): tidy up once,
// and bring that script up to date so it stops making "heep-widget-module" too
async function tidyUp() {
  const f = fm(), docs = f.documentsDirectory(), at = n => f.joinPath(docs, n);
  try {
    if (f.fileExists(at('heep-config.json')) && !f.fileExists(file('config.json'))) f.writeString(file('config.json'), f.readString(at('heep-config.json')));
    for (const n of ['heep-lib-core.js', 'heep-lib-econ.js', 'heep-lib-trips.js', 'heep-log.json', 'heep-config.json']) if (f.fileExists(at(n))) f.remove(at(n));
    const me = at(Script.name() + '.js');
    if (f.fileExists(me) && /documentsDirectory\(\), 'heep-widget-module\.js'/.test(f.readString(me))) {
      const r = new Request(BASE + 'widget/Heep.js?t=' + Date.now()); r.timeoutInterval = 8;
      const loader = await r.loadString();
      if (r.response && r.response.statusCode === 200 && /libraryDirectory/.test(loader)) {
        f.writeString(me, loader);
        if (!f.fileExists(f.joinPath(f.libraryDirectory(), 'heep-widget-module.js'))) f.writeString(f.joinPath(f.libraryDirectory(), 'heep-widget-module.js'), f.readString(at('heep-widget-module.js')));
        f.remove(at('heep-widget-module.js'));
      }
    }
  } catch (e) { /* next time */ }
}
function readJSON(name, d) { try { return fm().fileExists(file(name)) ? JSON.parse(fm().readString(file(name))) : d; } catch (e) { return d; } }
function writeJSON(name, v) { try { fm().writeString(file(name), JSON.stringify(v)); } catch (e) { /* full? */ } }
const b64 = s => Data.fromBase64String(s).toRawString();
function getConn() { try { return Keychain.contains(KEY) ? JSON.parse(Keychain.get(KEY)) : null; } catch (e) { return null; } }
function setConn(c) { if (c) Keychain.set(KEY, JSON.stringify(c)); else if (Keychain.contains(KEY)) Keychain.remove(KEY); }
async function libs() {
  const out = [];
  for (const n of LIBS) {
    let src = null;
    try {
      const r = new Request(BASE + n + '?t=' + Math.floor(Date.now() / 3600e3)); r.timeoutInterval = 8;
      const s = await r.loadString();
      if (r.response && r.response.statusCode === 200 && s.length > 500) { src = s; fm().writeString(file('lib-' + n), s); }
    } catch (e) { /* no signal: the copy from last time */ }
    if (!src && fm().fileExists(file('lib-' + n))) src = fm().readString(file('lib-' + n));
    if (!src) throw new Error('Needs signal once to get Heep’s code (' + n + ')');
    out.push(src);
  }
  return loadLib(out);
}
async function fetchLog(conn) {
  const r = new Request(conn.u);
  r.method = 'POST'; r.body = JSON.stringify({ k: conn.k, ops: [] }); r.timeoutInterval = 20;
  const j = await r.loadJSON();
  if (!j || !j.ok) throw new Error(j && j.error === 'key' ? 'The key doesn’t match: copy the setup link from Heep again' : 'The Jeep log said: ' + ((j && j.error) || 'nothing'));
  return j;
}
// the log: fresh if it can, else the last copy (and how old it is)
async function getLog(conn) {
  try { const j = await fetchLog(conn); writeJSON('log.json', { at: Date.now(), j }); return { j, stale: null }; }
  catch (e) {
    const c = readJSON('log.json', null);
    if (c && c.j) return { j: c.j, stale: agoShort(c.at, Date.now()) + ' old' };
    throw e;
  }
}

// ---------------------------------------------------------------- in the Scriptable app: connect, customize, preview
async function askForLink(reason) {
  const fromClip = parseSetup(Pasteboard.pasteString() || '', b64);
  if (fromClip) {
    const a = new Alert(); a.title = 'Connect to your Jeep log?'; a.message = 'Found your Heep setup link on the clipboard.';
    a.addAction('Connect'); a.addCancelAction('Not now');
    if (await a.presentAlert() === 0) { setConn(fromClip); return fromClip; }
  }
  const a = new Alert();
  a.title = 'Your Jeep log';
  a.message = (reason ? reason + '\n\n' : '') + 'In Heep: Settings > iPhone widget > Copy your setup link, then paste it here. It stays on this phone (Scriptable’s Keychain).';
  a.addTextField('https://bennydedado.github.io/jeep/#setup=…', '');
  a.addAction('Connect'); a.addCancelAction('Cancel');
  if (await a.presentAlert() !== 0) return null;
  const c = parseSetup(a.textFieldValue(0), b64);
  if (!c) { const x = new Alert(); x.title = 'That isn’t a setup link'; x.message = 'It starts with https://bennydedado.github.io/jeep/#setup='; x.addAction('OK'); await x.presentAlert(); return null; }
  setConn(c);
  return c;
}
async function chooseBlocks(family, cfg) {
  const list = (cfg[family] && cfg[family].length ? cfg[family] : DEFAULTS[family]).slice();
  const t = new UITable(); t.showSeparators = true;
  const draw = () => {
    t.removeAllRows();
    const h = new UITableRow(); h.isHeader = true; h.height = 70;
    h.addText(FAMILY_NAMES[family], 'Tap to add or take away. The first is the big one; up to ' + MAX[family] + '. Done: swipe down.');
    t.addRow(h);
    for (const id of Object.keys(BLOCKS)) {
      if (id === 'chart' && !/large|medium/.test(family)) continue;
      const r = new UITableRow(); r.dismissOnSelect = false; r.height = 48;
      const i = list.indexOf(id);
      const n = r.addText(i >= 0 ? String(i + 1) : ''); n.widthWeight = 8; n.titleColor = new Color('#ff9f0a');
      const name = r.addText(BLOCKS[id]); name.widthWeight = 92;
      r.onSelect = () => {
        const k = list.indexOf(id);
        if (k >= 0) list.splice(k, 1); else if (list.length < MAX[family]) list.push(id);
        draw(); t.reload();
      };
      t.addRow(r);
    }
    const reset = new UITableRow(); reset.dismissOnSelect = false; reset.height = 48;
    const rt = reset.addText('Back to the default'); rt.titleColor = new Color('#ff453a');
    reset.onSelect = () => { list.splice(0, list.length, ...DEFAULTS[family]); draw(); t.reload(); };
    t.addRow(reset);
  };
  draw();
  await t.present(false);
  cfg[family] = list.length ? list : DEFAULTS[family].slice();
  writeJSON('config.json', cfg);
}
async function preview(family, m, cfg, stale) {
  const w = render(family, pick(family, '', cfg), m, stale);
  const show = { small: 'presentSmall', medium: 'presentMedium', large: 'presentLarge', accessoryCircular: 'presentAccessoryCircular',
    accessoryRectangular: 'presentAccessoryRectangular', accessoryInline: 'presentAccessoryInline' }[family];
  if (w[show]) await w[show](); else await w.presentMedium();
}
async function appMenu() {
  let conn = getConn() || await askForLink();
  const cfg = readJSON('config.json', {});
  let m = null, stale = null, err = null, loadedFor;
  for (;;) {
    if (loadedFor !== conn) {   // the numbers: once, and again after connecting
      loadedFor = conn; m = null; stale = null; err = null;
      try { const L = await libs(); if (conn) { const r = await getLog(conn); m = model(r.j, L, Date.now()); stale = r.stale; } else m = model(L.sampleData(), L, Date.now()); }
      catch (e) { err = e.message || String(e); }
    }
    const a = new Alert();
    a.title = 'Heep widget';
    a.message = err ? 'Problem: ' + err : !conn ? 'Showing made-up numbers until you connect your Jeep log.' :
      (stale ? 'No signal: numbers from ' + stale + '.' : 'Connected to your Jeep log.') + ' To empty: ' + block('dte', m).value + ' km.';
    const acts = [];
    const add = (title, fn) => { a.addAction(title); acts.push(fn); };
    if (m) for (const f of ['small', 'medium', 'large', 'accessoryRectangular', 'accessoryCircular'])
      add('Preview ' + FAMILY_NAMES[f], () => preview(f, m, cfg, stale));
    for (const f of ['small', 'medium', 'large', 'accessoryRectangular', 'accessoryCircular', 'accessoryInline'])
      add('Customize ' + FAMILY_NAMES[f], () => chooseBlocks(f, cfg));
    add(conn ? 'Change the Jeep log link' : 'Connect your Jeep log', async () => { const c = await askForLink(); if (c) conn = c; });
    add('How to add the widget', async () => {
      const x = new Alert(); x.title = 'Adding it';
      x.message = 'Home Screen or the Today View (swipe right from your first Home Screen page): touch and hold an empty spot > Edit > Add Widget > Scriptable > pick a size > Add. Then tap the new widget > Script: Heep.\n\n' +
        'Lock Screen: touch and hold the Lock Screen > Customize > Lock Screen > tap the widget row > Scriptable.\n\n' +
        'Different blocks on one widget: tap it while editing > Parameter, e.g.  dte,econ,week  (dte = to empty, econ, cost, week, month, trip, odo, service, fill, chart).';
      x.addAction('OK'); await x.presentAlert();
    });
    a.addCancelAction('Done');
    const i = await a.presentSheet();
    if (i < 0 || !acts[i]) return;
    await acts[i]();
  }
}

// ---------------------------------------------------------------- start here
async function run() {
  await tidyUp();
  if (config.runsInApp && !config.runsInWidget && !config.runsInAccessoryWidget) { await appMenu(); Script.complete(); return; }
  const family = config.widgetFamily || 'medium';
  let w;
  try {
    const conn = getConn();
    if (!conn) w = messageWidget('Connect your Jeep log', 'Open Scriptable and run Heep once: it asks for your setup link (Heep: Settings > iPhone widget).');
    else {
      const L = await libs();
      const r = await getLog(conn);
      w = render(family, pick(family, args.widgetParameter, readJSON('config.json', {})), model(r.j, L, Date.now()), r.stale);
    }
  } catch (e) { w = messageWidget('Couldn’t get the numbers', (e && e.message) || String(e)); }
  Script.setWidget(w);
  Script.complete();
}

module.exports = { run, model, block, pick, render, parseSetup, loadLib, BLOCKS, DEFAULTS, MAX };
