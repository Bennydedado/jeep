'use strict';
// ui.js - building blocks: elements, icons, glass sheets, toasts, fields and charts.

const SVGNS = 'http://www.w3.org/2000/svg';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
function put(el, ...kids) { for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c); return el; }
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

// line icons drawn on a 24 grid, in the spirit of SF Symbols
const IC = {
  gauge: '<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 15.5l3.8-4.6"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none"/>',
  pump: '<path d="M5 20.5V5.5A2.5 2.5 0 0 1 7.5 3h5A2.5 2.5 0 0 1 15 5.5v15"/><path d="M3.5 20.5h13"/><path d="M7.5 7h5v4h-5z"/><path d="M15 9.5h1.5a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
  wrench: '<path d="M15.6 3.6a4.5 4.5 0 0 0-5.7 5.8L3.7 15.6a1.9 1.9 0 0 0 2.7 2.7l6.2-6.2a4.5 4.5 0 0 0 5.8-5.7l-2.6 2.6-2.4-.4-.4-2.4z"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chev: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
  cloudOk: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.5 1.6A3.5 3.5 0 0 0 7 18.5z"/><path d="M9.5 14l2 2 3.5-3.5"/>',
  cloudOff: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.5 1.6A3.5 3.5 0 0 0 7 18.5z"/><path d="M4 4l16 16"/>',
  cloudUp: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.5 1.6A3.5 3.5 0 0 0 7 18.5z"/><path d="M12 16.5v-5M9.8 13.5l2.2-2.2 2.2 2.2"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.6M4 13a8 8 0 0 0 14.3 4.6"/><path d="M5.5 3v3.6h3.6M18.5 21v-3.6h-3.6"/>',
  warn: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4.2M12 17v.2"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 13h9l1-13M9 7V4.5h6V7"/>',
  drop: '<path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/>',
  bt: '<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"/>',
  road: '<path d="M8 3.5L5 20.5M16 3.5l3 17M12 4.5v3M12 11v3M12 17.5v3"/>',
  temp: '<path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 16v-5"/>',
  bolt: '<path d="M13 3L5.5 13.5h6L10.5 21 18.5 10h-6z"/>',
  speed: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  dollar: '<path d="M16 7.5c-.8-1.3-2.3-2-4-2-2.2 0-3.8 1.2-3.8 3s1.6 2.5 3.8 3c2.3.5 4 1.3 4 3.2 0 1.9-1.8 3.2-4 3.2-1.9 0-3.4-.8-4.2-2.2M12 3.5v17"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.5h16M4 15h16M10 4v16"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.2"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  odo: '<rect x="3.5" y="7" width="17" height="10" rx="2.5"/><path d="M8 7v10M12 7v10M16 7v10"/>',
  turbo: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12c0-3 1.5-5 4-6M12 12c-3 0-5 1.5-6 4M12 12c0 3-1.5 5-4 6M12 12c3 0 5-1.5 6-4"/>',
  engine: '<path d="M4 10h2V8h4V6h4v2h3l2 2h1.5v6H19l-2 2H9l-2-2H4z"/>',
  battery: '<rect x="3.5" y="7.5" width="17" height="11" rx="2"/><path d="M7 5.5v2M17 5.5v2M7 13h3M15.5 11.5v3M14 13h3"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  map: '<path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  back: '<path d="M15 5.5L8.5 12l6.5 6.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  wifi: '<path d="M2.5 9.2a13.5 13.5 0 0 1 19 0"/><path d="M5.6 12.6a9 9 0 0 1 12.8 0"/><path d="M8.7 15.9a4.5 4.5 0 0 1 6.6 0"/><circle cx="12" cy="19.3" r="1.2" fill="currentColor" stroke="none"/>',
};
function icon(name, cls) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.9');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = IC[name] || '';
  return s;
}

// ---------- sync status in the title row
function syncIcon() {
  const s = S.sync.state;
  if (S.sample) return 'cloudOff';
  if (s === 'busy') return 'sync';
  if (s === 'key' || s === 'error') return 'warn';
  if (S.queue.length || s === 'offline' || s === 'unreachable') return 'cloudUp';
  return 'cloudOk';
}
function syncWords() {
  if (S.sample) return 'Not connected to your Jeep log';
  const s = S.sync.state, q = S.queue.length;
  const waiting = q ? q + (q > 1 ? ' changes' : ' change') + ' saved on this phone, waiting to sync' : '';
  if (s === 'busy') return 'Syncing with your Jeep log';
  if (s === 'key') return 'The key doesn\'t match your Jeep log';
  if (s === 'error') return 'Your Jeep log answered with a problem';
  if (s === 'unreachable' || s === 'offline') return waiting || 'Can\'t reach your Jeep log right now';
  if (q) return waiting;
  return S.syncedAt ? 'Synced ' + ago(S.syncedAt) : 'Not synced yet';
}
function paintSync(b) {
  b.textContent = '';
  const name = syncIcon();
  b.append(icon(name, name === 'sync' ? 'spin' : null));
  if (S.queue.length && !S.sample) b.append(h('span', { class: 'badge', text: String(S.queue.length) }));
  b.setAttribute('aria-label', syncWords());
  b.title = syncWords();
}
function updateSyncButtons() { document.querySelectorAll('.sync-btn').forEach(paintSync); }
function syncButton() {
  const b = h('button', {
    class: 'sync-btn', onclick: () => {
      if (S.sample) return connectSheet();
      if (['key', 'error'].includes(S.sync.state)) return settingsSheet();
      toast(S.queue.length ? 'Syncing ' + S.queue.length + (S.queue.length > 1 ? ' changes' : ' change') : 'Syncing', syncWords(), 'info');
      sync('tap');
    },
  });
  paintSync(b);
  return b;
}
function titleRow(title, sub) {
  const tt = document.getElementById('topTitle');
  if (tt) tt.textContent = title;
  return h('div', { class: 'title-row' },
    h('div', { class: 't' }, h('h1', { text: title }), sub ? h('div', { class: 'sub', text: sub }) : null),
    h('div', { class: 'capsule glass' }, syncButton(), h('button', { 'aria-label': 'Settings', onclick: () => settingsSheet() }, icon('sliders'))));
}

// ---------- sheets
const sheets = [];
function openSheet(o) {
  const back = h('div', { class: 'backdrop' });
  const body = h('div', { class: 'sheet-body' });
  const okBtn = o.onSave
    ? h('button', { class: 'circle ok', 'aria-label': o.saveLabel || 'Save', onclick: () => o.onSave() }, icon('check'))
    : h('span', { class: 'circle', style: 'visibility:hidden' });
  const head = h('div', { class: 'sheet-head' },
    h('button', { class: 'circle', 'aria-label': 'Close', onclick: () => api.close() }, icon('x')),
    h('h2', { text: o.title }), okBtn);
  const grab = h('div', { class: 'grabber' });
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, grab, head, body);
  let closed = false;
  const api = {
    el, body, head,
    setTitle(t) { head.querySelector('h2').textContent = t; },
    close() {
      if (closed) return;
      closed = true;
      el.classList.remove('drag');
      el.style.transform = '';
      el.classList.remove('on');
      back.classList.remove('on');
      setTimeout(() => { el.remove(); back.remove(); }, 450);
      const i = sheets.indexOf(api);
      if (i >= 0) sheets.splice(i, 1);
      if (o.onClose) o.onClose();
    },
  };
  sheets.push(api);
  back.addEventListener('click', () => api.close());
  document.body.append(back, el);
  o.build(body, api);
  // Return moves to the next field, like the iOS keyboard's Next
  body.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const ins = [...body.querySelectorAll('input:not([type=checkbox]):not([type=hidden]), textarea')];
    const next = ins[ins.indexOf(e.target) + 1];
    if (next) next.focus(); else e.target.blur();
  });
  body.addEventListener('focusin', e => {
    if (e.target.matches('input, textarea, select')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  });
  dragToClose(el, [grab, head], () => api.close());
  requestAnimationFrame(() => requestAnimationFrame(() => { back.classList.add('on'); el.classList.add('on'); }));
  return api;
}
function dragToClose(el, handles, close) {
  let y0 = null, dy = 0;
  const down = e => {
    if (e.target.closest('button')) return;
    y0 = e.clientY; dy = 0;
    el.classList.add('drag');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  const move = e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); el.style.transform = 'translateY(' + dy + 'px)'; };
  const up = () => {
    if (y0 == null) return;
    y0 = null;
    el.classList.remove('drag');
    if (dy > 110) close(); else el.style.transform = '';
  };
  for (const hd of handles) {
    hd.addEventListener('pointerdown', down);
    hd.addEventListener('pointermove', move);
    hd.addEventListener('pointerup', up);
    hd.addEventListener('pointercancel', up);
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheets.length) sheets[sheets.length - 1].close(); });
// keeps the bottom of a sheet reachable above the iOS keyboard
if (window.visualViewport) {
  const vv = window.visualViewport;
  const upd = () => document.documentElement.style.setProperty('--kb', Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) + 'px');
  vv.addEventListener('resize', upd);
  vv.addEventListener('scroll', upd);
}

// ---------- toast
let toastEl = null, toastTimer = 0;
function toast(title, sub, kind) {
  if (toastEl) toastEl.remove();
  const name = kind === 'bad' ? 'warn' : kind === 'info' ? 'sync' : 'check';
  const el = toastEl = h('div', { class: 'toast glass', role: 'status' },
    h('div', { class: 'ico ' + (kind || '') }, icon(name)),
    h('div', null, h('b', { text: title }), sub ? h('span', { text: sub }) : null));
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 500); }, kind === 'bad' ? 5000 : 3400);
}

// ---------- form pieces
function bigField(o) {
  const input = h('input', { id: o.id, inputmode: o.mode || 'decimal', autocomplete: 'off', placeholder: o.placeholder || '', enterkeyhint: o.last ? 'done' : 'next', value: o.value == null ? '' : o.value });
  if (o.mode === 'numeric') input.setAttribute('pattern', '[0-9]*');
  const hint = h('div', { class: 'hint', text: o.hint || '' });
  const label = h('label', { for: o.id, text: o.label });
  const unit = o.unit ? h('span', { class: 'u', text: o.unit }) : null;
  const wrap = h('div', { class: 'field' }, label, h('div', { class: 'in' }, o.pre ? h('span', { class: 'pre', text: o.pre }) : null, input, unit), hint);
  return {
    wrap, input, label, unit,
    get() { return num(input.value); },
    setHint(t, warn) { hint.textContent = t || ''; hint.classList.toggle('warn', !!(warn && t)); },
    bad(on) { wrap.classList.toggle('bad', !!on); },
  };
}
function textRow(label, o) {
  const input = h('input', Object.assign({ autocomplete: 'off', enterkeyhint: 'next' }, o));
  return { row: h('label', { class: 'gr' }, h('span', { text: label }), input), input };
}
function seg(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'group' });
  for (const [v, label] of options) {
    const b = h('button', {
      type: 'button', 'aria-pressed': String(v === value), text: label,
      onclick: () => { for (const x of el.children) x.setAttribute('aria-pressed', String(x === b)); onChange(v); },
    });
    el.append(b);
  }
  return el;
}
function switchEl(checked, onChange) {
  const i = h('input', { type: 'checkbox', role: 'switch', checked });
  // Safari's own iOS switch (with its haptic tick) where it exists, a drawn one elsewhere
  if ('switch' in HTMLInputElement.prototype) { i.setAttribute('switch', ''); i.style.accentColor = 'var(--good)'; }
  else i.className = 'sw';
  i.addEventListener('change', () => onChange(i.checked));
  return i;
}
// a destructive button that asks for a second tap instead of a dialog
function confirmButton(label, armed, act) {
  let on = false, t = 0;
  const b = h('button', { type: 'button', class: 'danger-link', text: label });
  b.addEventListener('click', () => {
    if (!on) { on = true; b.textContent = armed; clearTimeout(t); t = setTimeout(() => { on = false; b.textContent = label; }, 4000); return; }
    act();
  });
  return b;
}

// ---------- charts (drawn to scale, values on tap)
function chartW() { return Math.max(260, Math.min(document.documentElement.clientWidth, 600) - 32 - 36); }
function niceCeil(v) {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v - 1e-9) return m * e;
  return 10 * e;
}
function niceStep(v) {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v - 1e-9) return m * e;
  return 10 * e;
}
function placeTip(root, tip, cx, cy, W) {
  tip.classList.add('on');
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.max(0, Math.min(W - tw, cx - tw / 2)) + 'px';
  tip.style.top = Math.max(-th - 4, cy - th - 12) + 'px';
}
function scrub(svg, onAt, onEnd) {
  let hideT = 0;
  const at = e => {
    const r = svg.getBoundingClientRect();
    const k = svg.viewBox.baseVal.width / r.width;
    onAt((e.clientX - r.left) * k);
    clearTimeout(hideT);
  };
  svg.addEventListener('pointerdown', at);
  svg.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) at(e); });
  const end = () => { clearTimeout(hideT); hideT = setTimeout(onEnd, 1800); };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointerleave', end);
  svg.addEventListener('pointercancel', end);
}

// columns: one value each, the highlighted one in full colour, the rest a step lighter
function barChart(o) {
  const items = o.items, n = items.length;
  const W = chartW(), H = o.height || 180, padT = 22, padB = 24, padR = 38, padL = 2;
  const base = H - padB;
  const top = niceCeil(Math.max(...items.map(i => i.v || 0), o.avg || 0) * 1.08);
  const y = v => base - (base - padT) * (v / top);
  const slot = (W - padL - padR) / Math.max(n, 1);
  const bw = Math.max(6, Math.min(24, slot * .58));
  const hl = o.hl == null ? n - 1 : o.hl;
  const root = h('div', { class: 'chart' });
  const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': o.label || '' });
  for (const g of [0, top / 2, top]) {
    svg.append(sv('line', { class: 'grid', x1: padL, x2: W - padR + 8, y1: y(g), y2: y(g) }));
    svg.append(sv('text', { class: 'axis', x: W, y: y(g) + 4, 'text-anchor': 'end' }, o.fmtAxis ? o.fmtAxis(g) : String(g)));
  }
  const bars = [];
  items.forEach((it, i) => {
    const x = padL + slot * i + (slot - bw) / 2, v = Math.max(0, it.v || 0);
    const yt = Math.min(base - (v > 0 ? 3 : 0), y(v)), r = Math.min(4, (base - yt) / 2, bw / 2);
    const d = v > 0
      ? 'M' + x + ',' + base + 'V' + (yt + r) + 'Q' + x + ',' + yt + ' ' + (x + r) + ',' + yt + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + yt + ' ' + (x + bw) + ',' + (yt + r) + 'V' + base + 'Z'
      : '';
    const p = sv('path', { d, class: 'b' + (i === hl ? ' on' : '') });
    bars.push({ p, x: x + bw / 2, y: yt, it });
    svg.append(p);
    const step = n > 9 ? 3 : n > 5 ? 2 : 1;
    if ((n - 1 - i) % step === 0 && it.x) svg.append(sv('text', { class: 'axis', x: x + bw / 2, y: H - 6, 'text-anchor': 'middle' }, it.x));
  });
  if (o.avg) {
    const ya = y(o.avg);
    svg.append(sv('line', { class: 'avg', x1: padL, x2: W - padR + 8, y1: ya, y2: ya }));
    svg.append(sv('text', { class: 'avgt', x: padL + 2, y: ya - 5 }, o.avgLabel || ''));
  }
  const lab = bars[hl];
  if (lab && lab.it.v > 0) svg.append(sv('text', { class: 'val', x: lab.x, y: lab.y - 7, 'text-anchor': 'middle' }, o.fmt(lab.it.v)));
  const tip = h('div', { class: 'tip glass' });
  root.append(svg, tip);
  scrub(svg, px => {
    const i = Math.max(0, Math.min(n - 1, Math.floor((px - padL) / slot)));
    bars.forEach((b, j) => b.p.classList.toggle('on', j === i));
    const b = bars[i];
    tip.textContent = '';
    tip.append(h('b', { text: o.fmt(b.it.v || 0) }), h('span', { text: b.it.tip || '' }));
    const k = svg.getBoundingClientRect().width / W;
    placeTip(root, tip, b.x * k, b.y * k, svg.getBoundingClientRect().width);
  }, () => { tip.classList.remove('on'); bars.forEach((b, j) => b.p.classList.toggle('on', j === hl)); });
  return root;
}

// a line over time: 2px line, a light wash under it, the latest point marked
function lineChart(o) {
  const pts = o.pts, n = pts.length;
  const W = chartW(), H = o.height || 150, padT = 12, padB = 22, padR = 48, padL = 4;
  const base = H - padB;
  let t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(...pts.map(p => p.t));
  if (t1 === t0) { t0 -= 864e5; t1 += 864e5; }
  const vs = pts.map(p => p.v);
  const step = niceStep(Math.max((Math.max(...vs) - Math.min(...vs)) / 2, o.minStep || 0.01));
  const lo = Math.floor(Math.min(...vs) / step) * step, hi = Math.max(lo + step * 2, Math.ceil(Math.max(...vs) / step) * step);
  const x = t => padL + (W - padL - padR) * (t - t0) / (t1 - t0);
  const y = v => base - (base - padT) * (v - lo) / (hi - lo);
  const root = h('div', { class: 'chart' });
  const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': o.label || '' });
  for (let v = lo; v <= hi + step / 2; v += step) {
    svg.append(sv('line', { class: 'grid', x1: padL, x2: W - padR + 8, y1: y(v), y2: y(v) }));
    svg.append(sv('text', { class: 'axis', x: W, y: y(v) + 4, 'text-anchor': 'end' }, o.fmtAxis(v)));
  }
  const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1)).join('');
  svg.append(sv('path', { class: 'ar', d: line + 'L' + x(pts[n - 1].t).toFixed(1) + ',' + base + 'L' + x(pts[0].t).toFixed(1) + ',' + base + 'Z' }));
  svg.append(sv('path', { class: 'ln', d: line }));
  const last = pts[n - 1];
  svg.append(sv('circle', { class: 'dot', cx: x(last.t), cy: y(last.v), r: 4.5 }));
  const fx = o.fmtX || (t => MON[new Date(t).getMonth()] + ' ' + new Date(t).getDate());
  svg.append(sv('text', { class: 'axis', x: padL, y: H - 6 }, fx(t0)));
  svg.append(sv('text', { class: 'axis', x: W - padR, y: H - 6, 'text-anchor': 'end' }, fx(t1)));
  const cross = sv('line', { class: 'hl', y1: padT - 4, y2: base, x1: -10, x2: -10 });
  const hot = sv('circle', { class: 'dot', r: 5, cx: -20, cy: -20 });
  svg.append(cross, hot);
  const tip = h('div', { class: 'tip glass' });
  root.append(svg, tip);
  scrub(svg, px => {
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = i; });
    const p = pts[best], cx = x(p.t), cy = y(p.v);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
    hot.setAttribute('cx', cx); hot.setAttribute('cy', cy);
    tip.textContent = '';
    tip.append(h('b', { text: o.fmt(p.v) }), h('span', { text: p.tip || fmtDay(p.t, true) }));
    const k = svg.getBoundingClientRect().width / W;
    placeTip(root, tip, cx * k, cy * k, svg.getBoundingClientRect().width);
    if (o.onAt) o.onAt(p);
  }, () => { tip.classList.remove('on'); cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); hot.setAttribute('cx', -20); });
  return root;
}

// the fuel gauge: a 270° arc like the one on the dash
function arcPath(cx, cy, r, a1, a2) {
  const p = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [x1, y1] = p(a1), [x2, y2] = p(a2);
  return 'M' + x1.toFixed(2) + ',' + y1.toFixed(2) + 'A' + r + ',' + r + ' 0 ' + (a2 - a1 > 180 ? 1 : 0) + ' 1 ' + x2.toFixed(2) + ',' + y2.toFixed(2);
}
function fuelGauge(pct, big, small, stale) {
  const C = 66, R = 54, a0 = 135, sweep = 270;
  const col = pct < .15 ? 'var(--bad)' : pct < .3 ? 'var(--warn)' : 'var(--fuel)';
  const svg = sv('svg', { viewBox: '0 0 132 132', width: 132, height: 132, 'aria-hidden': 'true' },
    sv('path', { d: arcPath(C, C, R, a0, a0 + sweep), stroke: 'var(--track)', 'stroke-width': 11, fill: 'none', 'stroke-linecap': 'round' }),
    pct > 0.005 ? sv('path', { d: arcPath(C, C, R, a0, a0 + sweep * Math.min(1, pct)), stroke: col, 'stroke-width': 11, fill: 'none', 'stroke-linecap': 'round', opacity: stale ? .55 : 1 }) : null,
    sv('text', { x: 30, y: 116, class: 'axis', 'text-anchor': 'middle', style: 'font: 600 11px var(--font); fill: var(--ink-3)' }, 'E'),
    sv('text', { x: 102, y: 116, class: 'axis', 'text-anchor': 'middle', style: 'font: 600 11px var(--font); fill: var(--ink-3)' }, 'F'));
  return h('div', { class: 'gauge', role: 'img', 'aria-label': big + ' ' + small }, svg,
    h('div', { class: 'mid' }, h('div', { class: 'pct', text: big }), h('div', { class: 'km', text: small })));
}

// ---------- the tab bar, iOS 26 style: a glass bubble sits behind the current tab. Tap a tab and it glides over;
// press and slide along the bar and it lifts into a lens that follows your finger, then settles where you let go.
function tabBar(bar, defs, onPick) {
  const bub = h('div', { class: 'bubble', 'aria-hidden': 'true' });
  bar.append(bub);
  const tabs = defs.map(([id, label, ic]) => {
    const b = h('button', { class: 'tab', type: 'button', 'data-tab': id, 'aria-label': label }, icon(ic), h('span', { text: label }));
    // the keyboard and VoiceOver still click; a finger is handled below (and its click skipped)
    b.addEventListener('click', e => { if (e.detail === 0 || Date.now() - api.touched > 700) onPick(id); });
    bar.append(b);
    return b;
  });
  const api = { touched: 0, set };
  let cur = -1, drag = null;
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const geo = i => ({ x: tabs[i].offsetLeft, w: tabs[i].offsetWidth });
  function move(x, w) { bub.style.translate = x + 'px 0'; if (w != null) bub.style.width = w + 'px'; }
  // show tab i as current; `glide` adds the little stretch iOS does when the bubble travels
  function show(i, glide) {
    const g = geo(i);
    if (!g.w) return;
    if (cur < 0) { bub.classList.add('still'); move(g.x, g.w); void bub.offsetWidth; bub.classList.remove('still'); }
    else move(g.x, g.w);
    if (glide && cur >= 0 && i !== cur && bub.animate && !calm()) {
      bub.animate([{ scale: '1 1' }, { scale: '1.22 0.86', offset: 0.32 }, { scale: '1 1' }], { duration: 560, easing: 'ease-out' });
    }
    cur = i;
  }
  function set(id) { const i = defs.findIndex(d => d[0] === id); show(i < 0 ? 0 : i, true); }
  const nearest = cx => { let best = 0, bd = Infinity; tabs.forEach((t, i) => { const d = Math.abs(t.offsetLeft + t.offsetWidth / 2 - cx); if (d < bd) { bd = d; best = i; } }); return best; };
  function lift(clientX) {
    clearTimeout(drag.hold);
    drag.lens = true;
    bar.classList.add('dragging');
    bub.classList.add('lens');
    follow(clientX, performance.now());
  }
  function follow(clientX, t) {
    const w = tabs[0].offsetWidth, pad = 4;
    const x = Math.max(pad, Math.min(bar.clientWidth - pad - w, clientX - drag.left - w / 2));
    // like a drop of liquid: the faster it moves, the more it stretches
    const v = drag.pt ? (x - drag.px) / Math.max(8, t - drag.pt) : 0;
    drag.px = x; drag.pt = t;
    drag.st = drag.st * 0.55 + Math.min(0.3, Math.abs(v) * 0.22) * 0.45;
    if (!calm()) bub.style.scale = (1.2 + drag.st).toFixed(3) + ' ' + (1.2 - drag.st * 0.55).toFixed(3);
    clearTimeout(drag.relax);
    drag.relax = setTimeout(() => { if (drag) { drag.st = 0; bub.style.scale = ''; } }, 90);
    move(x, w);
    const i = nearest(x + w / 2);
    tabs.forEach((tb, j) => tb.classList.toggle('near', j === i));
  }
  bar.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, left: bar.getBoundingClientRect().left, lens: false, st: 0, px: 0, pt: 0, lx: e.clientX };
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    drag.hold = setTimeout(() => { if (drag && !drag.lens) lift(drag.lx); }, 220); // press and hold lifts it too
  });
  bar.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.lx = e.clientX;
    if (!drag.lens && Math.abs(e.clientX - drag.x0) > 6) lift(e.clientX);
    else if (drag.lens) follow(e.clientX, performance.now());
  });
  function end(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    clearTimeout(d.hold); clearTimeout(d.relax);
    bar.classList.remove('dragging');
    bub.classList.remove('lens');
    bub.style.scale = '';
    tabs.forEach(tb => tb.classList.remove('near'));
    api.touched = Date.now();
    if (cancelled) { show(cur, false); return; }
    const w = tabs[0].offsetWidth;
    const i = d.lens ? nearest((parseFloat(bub.style.translate) || 0) + w / 2) : nearest(e.clientX - d.left);
    const same = i === cur;
    show(i, !d.lens);
    if (!(same && d.lens)) onPick(defs[i][0]); // sliding back to where you started changes nothing
  }
  bar.addEventListener('pointerup', e => end(e, false));
  bar.addEventListener('pointercancel', e => end(e, true));
  bar.addEventListener('lostpointercapture', e => { if (drag && e.pointerId === drag.id) end(e, false); });
  addEventListener('resize', () => { if (cur >= 0) { const c = cur; cur = -1; show(c, false); } });
  return api;
}
