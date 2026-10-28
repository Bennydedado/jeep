// test_widget.js - the Scriptable widget (widget/heep-widget.js) in Node, with a pretend Scriptable: every size from
// sample data and from a log like Ben's (one fill-up, a few T3 trips), the Parameter, the setup link, and the whole
// run() the way a widget refresh goes (download Heep's code, ask the Jeep log, draw). node tests/app/test_widget.js
'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } };

// ---------------------------------------------------------------- a pretend Scriptable (enough for drawing)
const texts = [];
let images = 0, problems = [];
class Color { constructor(hex, a = 1) { if (!/^#[0-9a-f]{6}$/i.test(hex)) problems.push('bad colour ' + hex); this.hex = hex; this.a = a; }
  static dynamic(l, d) { return { l, d }; } static white() { return new Color('#ffffff'); } static clear() { return new Color('#000000', 0); } }
const fontNames = ['boldRoundedSystemFont', 'semiboldRoundedSystemFont', 'mediumRoundedSystemFont', 'regularRoundedSystemFont', 'boldSystemFont',
  'semiboldSystemFont', 'mediumSystemFont', 'systemFont', 'heavyRoundedSystemFont'];
const Font = {}; for (const f of fontNames) Font[f] = size => { if (!(size > 0)) problems.push(f + ' size ' + size); return { f, size }; };
class Size { constructor(w, h) { if (!(w >= 0 && h >= 0)) problems.push('bad size ' + w + 'x' + h); this.width = w; this.height = h; } }
class Point { constructor(x, y) { if (!isFinite(x) || !isFinite(y)) problems.push('bad point'); this.x = x; this.y = y; } }
class Rect { constructor(x, y, w, h) { if (![x, y, w, h].every(isFinite)) problems.push('bad rect'); Object.assign(this, { x, y, w, h }); } }
class Path { move() {} addLine() {} addRoundedRect() {} addRect() {} addEllipse() {} closeSubpath() {} }
class DrawContext { setFillColor() {} setStrokeColor() {} setLineWidth(w) { if (!(w > 0)) problems.push('line width'); } addPath() {} strokePath() {} fillPath() {}
  fillRect() {} fillEllipse() {} setFont() {} setTextColor() {} setTextAlignedCenter() {} drawTextInRect(t) { texts.push(String(t)); } getImage() { images++; return { img: true }; } }
class LinearGradient {}
const SFSymbol = { named: name => ({ name, image: { sym: name } }) };
class WText { constructor(s) { texts.push(s); } rightAlignText() {} centerAlignText() {} leftAlignText() {} }
class WImage { centerAlignImage() {} }
class Stack {
  constructor() { this.kids = []; }
  addText(s) { if (typeof s !== 'string') problems.push('addText got ' + typeof s); const t = new WText(s); this.kids.push(t); return t; }
  addStack() { const s = new Stack(); this.kids.push(s); return s; }
  addSpacer() {} addImage(i) { if (!i) problems.push('addImage without an image'); return new WImage(); }
  layoutHorizontally() {} layoutVertically() {} centerAlignContent() {} topAlignContent() {} bottomAlignContent() {} setPadding() {}
}
class ListWidget extends Stack { async presentMedium() {} }
const STORE = {}, KC = {};
const FileManager = { local: () => ({ documentsDirectory: () => '/docs', joinPath: (a, b) => a + '/' + b, fileExists: p => p in STORE,
  readString: p => STORE[p], writeString: (p, s) => { STORE[p] = s; } }) };
const Keychain = { contains: k => k in KC, get: k => KC[k], set: (k, v) => { KC[k] = v; }, remove: k => { delete KC[k]; } };
const Data = { fromBase64String: s => ({ toRawString: () => Buffer.from(s, 'base64').toString('utf8') }) };
let LOG = null, set = null;
class Request {
  constructor(url) { this.url = url; this.response = null; }
  async loadString() { const f = this.url.replace(/^https:\/\/bennydedado\.github\.io\/jeep\//, '').replace(/\?.*$/, ''); this.response = { statusCode: 200 }; return fs.readFileSync(path.join(root, f), 'utf8'); }
  async loadJSON() { this.response = { statusCode: 200 }; if (JSON.parse(this.body).k !== 'key-1') return { ok: false, error: 'key' }; return LOG; }
}
Object.assign(global, { Color, Font, Size, Point, Rect, Path, DrawContext, LinearGradient, SFSymbol, ListWidget, FileManager, Keychain, Data, Request,
  Script: { name: () => 'Heep', setWidget: w => { set = w; }, complete: () => {} }, config: {}, args: {} });

// ---------------------------------------------------------------- the widget
const W = require('../../widget/heep-widget.js');
const src = ['core.js', 'econ.js', 'trips.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8'));
const L = W.loadLib(src);
ok(typeof L.calc === 'function' && typeof L.blendEcon === 'function' && typeof L.tripTotals === 'function', 'Heep\'s code loads outside the browser');
const now = Date.now(), day = 864e5;
const sample = W.model(L.sampleData(), L, now);
const ben = (() => {
  const t = now - 5 * day;
  return { ok: true, fill: [{ id: 'f1', t, odo: 159557, lit: 70.2, cost: 120.4, full: true, station: 'Esso' }],
    trip: [{ id: 't1', t0: t + day, t1: t + day + 1800e3, km: 31.4, lit: 3.4, vmax: 104, idle: 2 }, { id: 't2', t0: now - 3600e3, t1: now - 1800e3, km: 28.6, lit: 2.9, vmax: 96, idle: 1 }],
    serv: [{ id: 's1', name: 'Oil change', km: 10000, mo: 12, lastKm: 156000, lastT: now - 300 * day }], log: [], info: { odo: 159557, odoT: t, tank: 77.6 } };
})();
const mb = W.model(ben, L, now);

// the blocks
const dte = W.block('dte', mb);
ok(/^≈\d/.test(dte.value) && dte.unit === 'km' && dte.pct > 0.8 && dte.pct < 1, 'distance to empty from one full fill-up and the T3: ' + dte.value + ' km, ' + Math.round(dte.pct * 100) + '%');
ok(W.block('econ', mb).value === (6.3 / 60 * 100).toFixed(1) && /T3 estimate/.test(W.block('econ', mb).sub), 'economy from the T3 before two full tanks: ' + W.block('econ', mb).value);
ok(/^\$0\.1\d\d$/.test(W.block('cost', mb).value) && W.block('cost', mb).sub === 'estimate', 'cost per km estimated: ' + W.block('cost', mb).value);
ok(W.block('week', mb).value === '29' || W.block('week', mb).value === '60', 'this week\'s km: ' + W.block('week', mb).value);
ok(W.block('trip', mb).value === '28.6' && /min/.test(W.block('trip', mb).sub), 'last trip: ' + W.block('trip', mb).value + ' km, ' + W.block('trip', mb).sub);
ok(/km| d$/.test(W.block('service', mb).value) && W.block('service', mb).label === 'Oil change', 'next service: ' + W.block('service', mb).label + ' ' + W.block('service', mb).value);
ok(W.block('fill', mb).value === '5 d', 'last fill-up 5 days ago');
ok(W.block('chart', mb).chart.length === 8, 'chart: 8 weeks');
for (const id of Object.keys(W.BLOCKS)) { const b = W.block(id, sample); ok(b.label && typeof b.value === 'string', 'sample data: block ' + id + ' = ' + b.value); }
ok(W.block('dte', W.model({ ok: true, fill: [], trip: [], serv: [], log: [], info: {} }, L, now)).value === '—', 'an empty log: dashes, no crash');

// which blocks
ok(JSON.stringify(W.pick('small', '', {})) === '["dte","econ"]', 'small default');
ok(JSON.stringify(W.pick('medium', 'trip, week ,nope,econ', {})) === '["trip","week","econ"]', 'Parameter picks the blocks, unknown ones dropped');
ok(W.pick('small', 'dte,econ,cost,week', {}).length === 2, 'no more than a size holds');
ok(JSON.stringify(W.pick('large', '', { large: ['odo', 'fill'] })) === '["odo","fill"]', 'your choice for a size');

// drawing every size
for (const fam of ['small', 'medium', 'large', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline']) {
  for (const [name, m] of [['Ben', mb], ['sample', sample]]) {
    texts.length = 0; problems = [];
    let w;
    try { w = W.render(fam, W.pick(fam, '', {}), m, null); } catch (e) { ok(false, fam + ' (' + name + ') threw: ' + e.stack); continue; }
    ok(w instanceof ListWidget && w.url, fam + ' (' + name + '): a widget that opens Heep');
    ok(!problems.length, fam + ' (' + name + '): nothing odd drawn ' + problems.join(', '));
    const all = texts.join(' | ');
    ok(all.length > 3 && !/undefined|NaN|null/.test(all), fam + ' (' + name + '): ' + all.slice(0, 140));
    if (fam === 'accessoryInline') ok(/^⛽ ≈\d[\d,]* km · [\d.]+ L\/100$/.test(texts[0]), 'Lock Screen line: ' + texts[0]);
    if (fam === 'large' && name === 'Ben') ok(/Driving by week/.test(all) && /Oil change/.test(all), 'large: the chart and the service');
  }
}
texts.length = 0; W.render('medium', W.pick('medium', 'trip,odo', {}), mb, '3 h old');
ok(/offline · 3 h old/.test(texts.join(' ')), 'no signal: says how old the numbers are');

// the setup link
const link = 'https://bennydedado.github.io/jeep/#setup=' + Buffer.from(JSON.stringify({ u: 'https://script.google.com/macros/s/ABC/exec', k: 'key-1', s: 'x' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = s => Buffer.from(s, 'base64').toString('utf8');
ok(JSON.stringify(W.parseSetup(link, b64)) === '{"u":"https://script.google.com/macros/s/ABC/exec","k":"key-1"}', 'setup link read');
ok(W.parseSetup('https://example.com/#setup=abc', b64) === null && W.parseSetup('hello', b64) === null, 'anything else isn\'t');

// a widget refresh, start to finish
(async () => {
  global.config = { runsInWidget: true, widgetFamily: 'medium' }; global.args = { widgetParameter: null };
  set = null; texts.length = 0;
  await W.run();
  ok(set && /Connect your Jeep log/.test(texts.join(' ')), 'not connected yet: the widget says how');
  KC['heep.setup'] = JSON.stringify({ u: 'https://script.google.com/macros/s/ABC/exec', k: 'key-1' });
  LOG = ben; set = null; texts.length = 0;
  await W.run();
  ok(set && texts.some(t => /^≈\d/.test(t)), 'connected: downloads Heep\'s code, asks the log, draws the numbers');
  ok(STORE['/docs/heep-lib-core.js'] && STORE['/docs/heep-log.json'], 'keeps Heep\'s code and the log for no signal');
  global.args = { widgetParameter: 'service' }; global.config = { runsInWidget: true, widgetFamily: 'small' }; texts.length = 0;
  await W.run();
  ok(texts.includes('OIL CHANGE'), 'a widget\'s Parameter changes what it shows');
  KC['heep.setup'] = JSON.stringify({ u: 'https://script.google.com/macros/s/ABC/exec', k: 'wrong' });
  texts.length = 0; global.args = {}; global.config = { runsInWidget: true, widgetFamily: 'medium' };
  await W.run();
  ok(texts.some(t => /^≈\d/.test(t)) && texts.some(t => /^offline · /.test(t)), 'a refused key falls back to the last numbers: ' + texts.filter(t => /offline/.test(t)).join(''));
  console.log('test_widget.js: ' + n + ' checks, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
