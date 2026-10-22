'use strict';
// Listening - your listening stats from the Hub, on the phone. The Hub sums up your Spotify history and sends a
// summary to your Jeep log sheet's Apps Script every half hour; this app reads it from there.

const VERSION = '1.0.0';
const store = {
  get(k, d) { try { const v = localStorage.getItem('listen.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('listen.' + k, JSON.stringify(v)); } catch (e) { /* private mode or full */ } },
  del(k) { try { localStorage.removeItem('listen.' + k); } catch (e) { /* ignore */ } },
};
const S = {
  conn: store.get('conn', null),
  data: store.get('data', null),
  at: store.get('at', 0),
  syncedAt: store.get('syncedAt', 0),
  prefs: Object.assign({ theme: 'system', range: '28', kind: 'artists' }, store.get('prefs', {})),
  tab: store.get('tab', 'home'),
  sync: { busy: false, state: 'idle', msg: '' },
  queue: [],
  sample: false,
};
const RANGES = [['28', '4 weeks'], ['182', '6 months'], ['365', 'Year'], ['all', 'All time']];
const RANGE_WORD = { '28': 'the last 4 weeks', '182': 'the last 6 months', '365': 'the last year', all: 'all time' };
function rangeSub(r) {
  if (S.prefs.range !== 'all') return 'In ' + RANGE_WORD[S.prefs.range];
  const t = r && (r.first || r.histFirst);
  return t ? 'Since ' + MONTHS[new Date(t * 1000).getMonth()] + ' ' + new Date(t * 1000).getFullYear() : 'All time';
}
const PREV_WORD = { '28': 'the 4 weeks before', '182': 'the 6 months before', '365': 'the year before' };
function persist() {
  if (S.sample) return;
  store.set('conn', S.conn); store.set('data', S.data); store.set('at', S.at); store.set('syncedAt', S.syncedAt);
}
function savePrefs() { store.set('prefs', S.prefs); }

// ---------- small helpers the shared ui.js expects
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt0 = n => nf0.format(Math.round(n || 0));
function num(s) { const n = Number(s); return isFinite(n) ? n : null; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayStart(t) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function fmtDay(t, long) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  const diff = Math.round((dayStart(now) - dayStart(t)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7 && !long) return DAYS[d.getDay()];
  return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== now.getFullYear() || long ? ', ' + d.getFullYear() : '');
}
function fmtTime(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function ago(t) {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : d + ' days ago';
}
function ymd(s) { s = String(s || ''); return s.length >= 8 ? new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)).getTime() : null; }
function hrs(mins) { return mins >= 600 ? fmt0(mins / 60) + ' h' : mins >= 60 ? (Math.round(mins / 6) / 10) + ' h' : fmt0(mins) + ' min'; }
function img(id) { return id ? 'https://i.scdn.co/image/' + id : ''; }

function setSync(state, msg) { S.sync.state = state; S.sync.msg = msg || ''; if (typeof updateSyncButtons === 'function') updateSyncButtons(); }
async function sync(why) {
  if (!S.conn || S.sample || S.sync.busy) return;
  S.sync.busy = true;
  setSync('busy');
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), 35000);
  try {
    const res = await fetch(S.conn.u, { method: 'POST', body: JSON.stringify({ k: S.conn.k, get: 'listen' }), signal: ctl ? ctl.signal : undefined, cache: 'no-store', redirect: 'follow' });
    let j;
    try { j = JSON.parse(await res.text()); } catch (e) { const err = new Error('not-json'); err.notJson = true; throw err; }
    if (!j.ok) setSync(j.error === 'key' ? 'key' : 'error', j.error === 'key' ? '' : String(j.error || ''));
    else if (!('listen' in j)) setSync('old');
    else {
      if (j.listen) { S.data = j.listen; S.at = j.at || 0; }
      S.syncedAt = Date.now();
      persist();
      setSync(j.listen ? 'ok' : 'waiting');
    }
  } catch (e) {
    setSync(e && e.notJson ? 'error' : (navigator.onLine === false ? 'offline' : 'unreachable'), e && e.notJson ? 'The sheet answered with something that isn\'t your stats. Check the script is deployed as a web app with access for Anyone.' : '');
  } finally {
    clearTimeout(timer);
    S.sync.busy = false;
    render();
  }
}

// ---------- the setup link (the same kind as Heep's): https://.../listen/#setup=<base64url of {"u":...,"k":...}>
function decodeSetup(text) {
  const m = String(text || '').match(/setup=([A-Za-z0-9_\-]+)/);
  if (!m) return null;
  try {
    let b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const j = JSON.parse(decodeURIComponent(escape(atob(b))));
    if (j && /^https:\/\/script\.google(usercontent)?\.com\//.test(j.u) && j.k) return { u: j.u, k: String(j.k), s: j.s || '' };
  } catch (e) { /* not a setup link */ }
  return null;
}
function connect(c) {
  const same = S.conn && S.conn.u === c.u && S.conn.k === c.k;
  S.conn = c; S.sample = false;
  if (!same) { S.data = null; S.at = 0; S.syncedAt = 0; }
  persist();
  return !same;
}

// ---------- extra icons for this app
Object.assign(IC, {
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  note: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  skip: '<path d="M5 5l9 7-9 7z"/><path d="M18 5v14"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  flame: '<path d="M12 21c-3.9 0-7-2.9-7-6.6 0-3.4 2.4-5.6 4.2-8.4.5 1.7 1.6 3 3 3.4C12 6.5 13 4.4 15 3c.4 3.4 4 5.9 4 11 0 3.7-3.1 7-7 7z"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>',
});

// Spotify's picture IDs carry their size: ask for a sharper copy, then the one the Hub had, then show a letter
function sharper(id) {
  if (/^ab67616d00004851/.test(id)) return 'ab67616d00001e02' + id.slice(16);
  if (/^ab6761610000f178/.test(id)) return 'ab67616100005174' + id.slice(16);
  return id;
}
function artEl(id, name, round, big) {
  const cls = 'art' + (round ? ' round' : '') + (big ? ' big' : '');
  const fallback = () => h('div', { class: cls, text: (String(name || '?').trim()[0] || '?').toUpperCase() });
  if (!id) return fallback();
  const ids = [...new Set([sharper(id), id])];
  let k = 0;
  const el = h('img', { class: cls, src: img(ids[0]), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  el.addEventListener('error', () => { if (++k < ids.length) el.src = img(ids[k]); else el.replaceWith(fallback()); });
  return el;
}
function card(...kids) { return h('div', { class: 'card' }, ...kids); }
function cardHead(title, right, onRight) {
  return h('div', { class: 'card-head' }, h('h2', { text: title }),
    onRight ? h('button', { class: 'link', text: right, onclick: onRight }) : (right ? h('span', { class: 'muted', text: right }) : null));
}
function tile(k, ic, v, unit, s) {
  return h('div', { class: 'tile card' }, h('div', { class: 'k' }, icon(ic), k), h('div', { class: 'v num' }, v, unit ? h('small', { text: unit }) : null), s ? h('div', { class: 's', text: s }) : null);
}
function banner(ic, title, sub, onclick) {
  return h('button', { class: 'banner glass', onclick }, h('div', { class: 'ico' }, icon(ic)), h('div', null, h('b', { text: title }), h('span', { text: sub })), icon('chev', 'go'));
}
function topBanners(v) {
  if (S.sample) v.append(banner('info', 'Sample data', 'Connect to see your own listening', connectSheet));
  else if (S.sync.state === 'key') v.append(banner('warn', 'The key doesn\'t match', 'Open Settings to fix the connection', settingsSheet));
  else if (S.sync.state === 'old') v.append(banner('warn', 'The sheet\'s script needs its update', 'Paste the new Code.gs and deploy a new version', settingsSheet));
  else if (S.sync.state === 'error') v.append(banner('warn', 'Your stats had a problem', S.sync.msg || 'Open Settings for details', settingsSheet));
  else if (!S.data && S.sync.state === 'waiting') v.append(banner('info', 'Waiting for your PC', 'The Hub sends your stats every half hour', () => sync('tap')));
}
// only the ranges the Hub has summed up (it normally sends all four)
function ranges() { const rs = (S.data && S.data.ranges) || {}; const a = RANGES.filter(x => rs[x[0]]); return a.length ? a : RANGES; }
function rangeSeg() {
  return h('div', { class: 'range-row' }, seg(ranges(), S.prefs.range, v => { S.prefs.range = v; savePrefs(); render(); }));
}
function R() {
  const rs = S.data && S.data.ranges;
  if (!rs) return null;
  if (!rs[S.prefs.range]) { const k = RANGES.map(x => x[0]).find(x => rs[x]); if (!k) return null; S.prefs.range = k; }
  return rs[S.prefs.range];
}
const axisH = g => !g ? '0' : g >= 600 ? Math.round(g / 60) + 'h' : g >= 60 ? Math.round(g / 6) / 10 + 'h' : Math.round(g) + 'm';
// at most `max` labels under a chart, counted back from the newest bar
function thin(items, max) {
  const n = items.length, k = Math.max(1, Math.ceil(n / max));
  items.forEach((it, i) => { if ((n - 1 - i) % k) it.x = ''; });
  return items;
}
const dkey = t => { const d = new Date(t); return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };
const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
// the day the Hub last summed things up: the ranges end there
function lastDay(r) { return dayStart(r && r.gen ? r.gen * 1000 : Date.now()); }
// every day of the range, the ones with no music too (the Hub only lists days you listened)
function rangeDays(r) {
  const by = new Map((r.days || []).map(d => [String(d[0]), d[1]]));
  const last = lastDay(r), n = +S.prefs.range || 0, out = [];
  for (let i = n - 1; i >= 0; i--) { const t = addDays(last, -i); out.push({ t, m: by.get(dkey(t)) || 0 }); }
  return out;
}
// listening over time: days for 4 weeks, weeks for 6 months, months for a year and for all time
function timeline(r) {
  const days = rangeDays(r);
  const md = t => MON[new Date(t).getMonth()] + ' ' + new Date(t).getDate();
  if (S.prefs.range === '28') return { items: thin(days.map(d => ({ v: d.m, x: md(d.t), tip: fmtDay(d.t, true) + ' · ' + hrs(d.m) })), 4), unit: 'a day' };
  if (S.prefs.range === '182') {
    // whole weeks counted back from the last day, so the last bar is the latest week
    const weeks = [];
    for (let end = days.length; end > 0; end -= 7) { const part = days.slice(Math.max(0, end - 7), end); weeks.unshift({ t: part[0].t, m: part.reduce((s, d) => s + d.m, 0) }); }
    return { items: thin(weeks.map(w => ({ v: w.m, x: md(w.t), tip: 'Week of ' + fmtDay(w.t, true) + ' · ' + hrs(w.m) })), 5), unit: 'a week' };
  }
  const map = new Map();
  if (S.prefs.range === 'all') for (const m of r.months || []) { const y = +String(m[0]).slice(0, 4), mo = +String(m[0]).slice(4, 6) - 1; if (y) map.set(y * 12 + mo, m[1]); }
  else for (const d of days) { const dt = new Date(d.t), k = dt.getFullYear() * 12 + dt.getMonth(); map.set(k, (map.get(k) || 0) + d.m); }
  if (!map.size) return { items: [], unit: '' };
  // months with no music still get their (empty) place, so the bars are to scale in time
  const keys = [...map.keys()];
  let k0 = Math.min(...keys);
  const k1 = Math.max(...keys);
  k0 = Math.max(k0, k1 - 23);
  const items = [];
  for (let k = k0; k <= k1; k++) {
    const y = Math.floor(k / 12), mo = k % 12, m = map.get(k) || 0;
    items.push({ v: m, x: MON[mo] + (S.prefs.range === 'all' ? ' ’' + String(y).slice(2) : ''), tip: MONTHS[mo] + ' ' + y + ' · ' + hrs(m) });
  }
  return { items: thin(items, S.prefs.range === 'all' ? 5 : 6), unit: 'a month' };
}
// days in a row with music, up to the Hub's last day (or the day before, if that day had none yet)
function streakNow(r) {
  const set = new Set((r.days || []).filter(d => d[1] > 0).map(d => String(d[0])));
  let n = 0, t = lastDay(r);
  if (!set.has(dkey(t))) t = addDays(t, -1);
  while (set.has(dkey(t))) { n++; t = addDays(t, -1); }
  return n;
}

// ======================================================= Summary
function renderHome(v) {
  const r = R();
  v.append(titleRow('Listening', r ? rangeSub(r) : 'Your listening, from the Hub'));
  topBanners(v);
  v.append(rangeSeg());
  if (!r) {
    v.append(card(h('div', { class: 'empty' }, h('div', { class: 'ico' }, icon('note')), h('h3', { text: 'No stats yet' }),
      h('p', { text: S.conn ? 'Your PC sends your listening stats here every half hour while the Hub is running.' : 'Connect with your setup link to see your listening.' }))));
    return;
  }
  // the headline: time listened, against the same stretch before it
  const hero = h('div', { class: 'hero' });
  hero.append(h('div', null, h('div', { class: 'big', text: r.mins >= 600 ? fmt0(r.mins / 60) : fmt0(r.mins) }),
    h('div', { class: 'unit', text: (r.mins >= 600 ? 'hours' : 'minutes') + ' of music · ' + fmt0(r.plays) + ' plays' })));
  const chips = h('div', { class: 'chips' });
  if (r.prevMins > 0 && PREV_WORD[S.prefs.range]) {
    const d = (r.mins - r.prevMins) / r.prevMins;
    chips.append(h('span', { class: 'chip' }, h('i', { class: 'dot', style: 'background:' + (d >= 0 ? 'var(--good)' : 'var(--ink-3)') }), (d >= 0 ? '+' : '') + Math.round(d * 100) + '% vs ' + PREV_WORD[S.prefs.range]));
  }
  if (S.prefs.range !== 'all' && r.days && r.days.length) chips.append(h('span', { class: 'chip', text: 'about ' + hrs(r.mins / Math.max(1, +S.prefs.range)) + ' a day' }));
  hero.append(chips);
  v.append(card(hero));
  // number one
  const a = (r.artists || [])[0];
  if (a) v.append(h('button', { class: 'card', style: 'text-align:left;width:100%', onclick: () => go('top') },
    h('div', { class: 'label', style: 'margin-bottom:12px', text: 'Your top artist' }),
    h('div', { class: 'top-artist' }, artEl(a[3], a[0], true, true),
      h('div', { class: 'who' }, h('b', { text: a[0] }), h('span', { text: fmt0(a[1]) + ' plays · ' + hrs(a[2]) + (a[4] ? ' · most played: ' + a[4] : '') })))));
  // the numbers
  const total = S.prefs.range === 'all' ? null : +S.prefs.range;
  v.append(h('div', { class: 'tiles' },
    tile('Songs', 'note', fmt0(r.nSongs), null, fmt0(r.nArtists) + ' artists · ' + fmt0(r.nAlbums) + ' albums'),
    tile('Days listening', 'calendar', fmt0(r.daysWith), total ? '/ ' + total : null, total ? Math.round(r.daysWith / total * 100) + '% of days' : 'since ' + (r.first ? fmtDay(r.first * 1000, true) : 'you started')),
    tile('Longest streak', 'flame', fmt0(r.longest), r.longest === 1 ? 'day' : 'days', !r.longestEnd ? '' : ymd(r.longestEnd) >= addDays(lastDay(r), -1) ? 'still going' : 'ended ' + fmtDay(ymd(r.longestEnd), true)),
    tile('Skipped', 'skip', fmt0(r.skips), null, r.plays ? Math.round(r.skips / Math.max(1, r.plays) * 100) + '% of plays' : '')));
  // over time
  const tl = timeline(r);
  if (tl.items.length > 1) {
    v.append(card(cardHead('Over time', 'time ' + tl.unit),
      barChart({ items: tl.items, fmt: hrs, fmtAxis: axisH, labelAll: true, label: 'Listening over time' })));
  }
  if (S.prefs.range === 'all' && (r.years || []).length > 1) {
    const ym = new Map(r.years.map(y => [+y[0], y]));
    const y0 = Math.min(...ym.keys()), y1 = Math.max(...ym.keys()), ys = [];
    for (let y = y0; y <= y1; y++) { const e = ym.get(y) || [y, 0, 0]; ys.push({ v: e[1], x: String(y), tip: y + ' · ' + fmt0(e[2]) + ' plays' }); }
    v.append(card(cardHead('By year', y1 === new Date().getFullYear() ? y1 + ' so far' : null),
      barChart({ items: ys, fmt: hrs, fmtAxis: axisH, labelAll: ys.length <= 8, height: 150, label: 'Listening by year' })));
  }
  // when
  if ((r.hours || []).some(x => x > 0)) {
    const peak = r.hours.indexOf(Math.max(...r.hours));
    const hl = x => (x % 12 || 12) + (x < 12 ? ' AM' : ' PM');
    v.append(card(cardHead('Time of day', 'most at ' + hl(peak)),
      barChart({ items: r.hours.map((m, i) => ({ v: m, x: i % 6 === 0 ? hl(i).replace(' ', '') : '', tip: hl(i) + ' · ' + hrs(m) })), hl: peak, fmt: hrs, fmtAxis: axisH, labelAll: true, height: 150, label: 'Listening by hour' })));
  }
  if ((r.wdays || []).some(x => x > 0)) {
    // the Hub's week starts on Monday
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const best = r.wdays.indexOf(Math.max(...r.wdays));
    const full = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
    v.append(card(cardHead('Day of the week', full[best] + ' are the biggest'),
      barChart({ items: r.wdays.map((m, i) => ({ v: m, x: names[i], tip: names[i] + ' · ' + hrs(m) })), hl: best, fmt: hrs, fmtAxis: axisH, labelAll: true, height: 150, label: 'Listening by weekday' })));
  }
  // the top five
  if ((r.artists || []).length > 1) {
    v.append(card(cardHead('Top artists', 'All', () => { S.prefs.kind = 'artists'; savePrefs(); go('top'); }),
      h('div', { class: 'list', style: 'margin:0 -18px -18px' }, r.artists.slice(0, 5).map((x, i) => h('div', { class: 'row' },
        h('div', { class: 'rank', text: String(i + 1) }), artEl(x[3], x[0], true),
        h('div', { class: 'main' }, h('b', { text: x[0] }), h('span', { text: x[4] ? 'most played: ' + x[4] : '' })),
        h('div', { class: 'end' }, h('b', { text: hrs(x[2]) }), h('span', { text: fmt0(x[1]) + ' plays' })))))));
  }
  // a few fun ones
  const facts = [];
  if (r.best && r.best[1] > 0) facts.push(['star', 'Biggest day: ' + fmtDay(ymd(r.best[0]), true), hrs(r.best[1]) + ' of music']);
  if (S.prefs.range === '28' || S.prefs.range === '182') { const n = streakNow(r); if (n > 1 && n !== r.longest) facts.push(['flame', n + ' days in a row', 'music every day, up to ' + fmtDay(lastDay(r), true)]); }
  if (r.skipped && r.skipped[0]) facts.push(['skip', 'Skipped the most: ' + r.skipped[0], r.skipped[1] + ' · ' + fmt0(r.skipped[2]) + ' skips']);
  if (r.firstPlay && r.firstPlay[1]) facts.push(['clock', 'First song on record: ' + r.firstPlay[1], r.firstPlay[2] + ' · ' + fmtDay(r.firstPlay[0] * 1000, true)]);
  if ((r.devices || []).length > 1) {
    const tot = r.devices.reduce((s, d) => s + d[1], 0) || 1;
    facts.push(['phone', 'Where you listen', r.devices.slice(0, 3).map(d => d[0] + ' ' + Math.round(d[1] / tot * 100) + '%').join(' · ')]);
  }
  if (facts.length) v.append(card(cardHead('Highlights', null), h('div', { class: 'facts' }, facts.map(([ic, b, s]) => h('div', { class: 'fact' }, h('div', { class: 'ico' }, icon(ic)), h('div', null, h('b', { text: b }), h('span', { text: s })))))));
  v.append(h('div', { class: 'foot', style: 'text-align:center', text: S.sample ? 'Sample data' : 'From your Hub · sent ' + ago(S.at) + (S.syncedAt ? ' · checked ' + ago(S.syncedAt) : '') }));
}

// ======================================================= Top
function renderTop(v) {
  const r = R();
  const kinds = [['artists', 'Artists'], ['songs', 'Songs'], ['albums', 'Albums']];
  v.append(titleRow('Top', r ? rangeSub(r) : ''));
  topBanners(v);
  v.append(rangeSeg(), seg(kinds, S.prefs.kind, k => { S.prefs.kind = k; savePrefs(); render(); }));
  if (!r) return;
  const list = r[S.prefs.kind] || [];
  if (!list.length) { v.append(card(h('div', { class: 'empty' }, h('p', { text: 'Nothing here yet.' })))); return; }
  v.append(h('div', { class: 'card list' }, list.map((x, i) => {
    let title, sub, mins, plays, pic, round = false;
    if (S.prefs.kind === 'artists') { [title, plays, mins, pic] = x; sub = x[4] ? 'most played: ' + x[4] : ''; round = true; }
    else if (S.prefs.kind === 'songs') { [title, sub, plays, mins, pic] = x; if (x[5]) sub += ' · ' + x[5]; }
    else { [title, sub, plays, mins, pic] = x; }
    return h('div', { class: 'row' }, h('div', { class: 'rank', text: String(i + 1) }), artEl(pic, title, round),
      h('div', { class: 'main' }, h('b', { text: title }), h('span', { text: sub })),
      h('div', { class: 'end' }, h('b', { text: hrs(mins) }), h('span', { text: fmt0(plays) + (plays === 1 ? ' play' : ' plays') })));
  })));
}

// ======================================================= Recent
function renderRecent(v) {
  const rec = (S.data && S.data.recent) || [];
  v.append(titleRow('Recent', rec.length ? 'Your last ' + rec.length + ' songs' : ''));
  topBanners(v);
  if (!rec.length) { v.append(card(h('div', { class: 'empty' }, h('div', { class: 'ico' }, icon('recent')), h('h3', { text: 'Nothing yet' }), h('p', { text: 'Songs show up here after your PC sends your stats.' })))); return; }
  let lastDay = '';
  const rows = [];
  for (const x of rec) {
    const t = x[0] * 1000, day = fmtDay(t, true);
    if (day !== lastDay) {
      if (rows.length) v.append(h('div', { class: 'card list' }, rows.splice(0)));
      v.append(h('div', { class: 'month' }, h('b', { text: day })));
      lastDay = day;
    }
    rows.push(h('div', { class: 'row' }, artEl(x[5], x[1]),
      h('div', { class: 'main' }, h('b', { text: x[1] }), h('span', { text: x[2] + (x[3] ? ' · ' + x[3] : '') })),
      h('div', { class: 'end' }, h('span', { text: fmtTime(t) }))));
  }
  if (rows.length) v.append(h('div', { class: 'card list' }, rows));
}

// ======================================================= sheets
function settingsSheet() {
  openSheet({
    title: 'Settings',
    build(b, sheet) {
      const rows = [h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: S.sample ? 'Not connected' : syncWords() }), h('span', { text: S.sample ? 'Showing sample data' : (S.sync.msg || (S.at ? 'Your PC last sent stats ' + ago(S.at) : 'Nothing sent from your PC yet')) })))];
      if (!S.sample) rows.push(h('button', { class: 'row', onclick: () => { sync('tap'); sheet.close(); } }, h('div', { class: 'main' }, h('b', { text: 'Check now', style: 'color:var(--fuel)' })), icon('sync', 'chev')));
      rows.push(h('button', { class: 'row', onclick: () => connectSheet() }, h('div', { class: 'main' }, h('b', { text: S.sample ? 'Connect' : 'Connection' }), h('span', { text: 'Paste your setup link' })), icon('chev', 'chev')));
      put(b, h('div', { class: 'label', text: 'Your stats' }), h('div', { class: 'card list' }, rows),
        h('div', { class: 'label', text: 'Appearance' }),
        seg([['system', 'Automatic'], ['dark', 'Dark'], ['light', 'Light']], S.prefs.theme, v2 => { S.prefs.theme = v2; savePrefs(); applyTheme(); }),
        h('div', { class: 'foot', text: 'Your PC sums up your Spotify history in the Hub and sends a summary to your Jeep log sheet every half hour. Pictures come from Spotify.' }),
        h('div', { class: 'foot', style: 'text-align:center', text: 'Listening ' + VERSION }),
        S.sample ? null : confirmButton('Disconnect this phone', 'Tap again: this phone forgets the link', () => {
          for (const k of ['conn', 'data', 'at', 'syncedAt']) store.del(k);
          S.conn = null; S.data = sampleData(); S.sample = true; setSync('idle'); sheet.close(); render();
        }));
    },
  });
}
function connectSheet() {
  openSheet({
    title: 'Connect',
    build(b, sheet) {
      const link = h('textarea', { rows: 3, placeholder: 'Paste the setup link here', autocomplete: 'off', style: 'font:15px/1.35 var(--font)' });
      const err = h('div', { class: 'err' });
      const btn = h('button', { class: 'btn btn-primary btn-wide', onclick: () => tryIt() }, icon('link'), 'Connect');
      put(b, h('div', { class: 'foot', text: 'Open the Listening setup link Claude sent you on this phone, or paste it here.' }),
        h('div', { class: 'field small-in' }, h('span', { class: 'fl', text: 'Setup link' }), link), err,
        navigator.clipboard && navigator.clipboard.readText ? h('button', { class: 'btn btn-glass glass btn-wide', onclick: async () => { try { link.value = await navigator.clipboard.readText(); tryIt(); } catch (e) { link.focus(); } } }, icon('copy'), 'Paste the link') : null,
        btn);
      async function tryIt() {
        const c = decodeSetup(link.value);
        if (!c) { err.textContent = 'That isn\'t a setup link. It has #setup= in it.'; return; }
        connect(c);
        await sync('connect');
        if (['ok', 'waiting', 'old'].includes(S.sync.state)) { sheet.close(); toast('Connected', S.sync.state === 'ok' ? 'Your listening is here' : 'Waiting for your PC'); }
        else err.textContent = S.sync.state === 'key' ? 'The sheet didn\'t accept the key in that link.' : 'Couldn\'t reach the sheet. Check your signal and try again.';
      }
    },
  });
}

// ---------- sample data: made up, shown only until the app is connected
function sampleData() {
  const art = ['The Gravel Roads', 'Prairie Lights', 'June Halloway', 'Northbound', 'Tall Pines', 'Ruby Creek', 'Daniel Marsh', 'The Hay Wagons'];
  const songs = ['Long Way Home', 'Dust on the Dash', 'Midnight Grain', 'Back Forty', 'Cold Coffee Morning', 'River Mile', 'Porch Light', 'Gravel & Gold'];
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const mk = (days, scale) => {
    const r = { plays: Math.round(900 * scale), mins: Math.round(3100 * scale), nSongs: Math.round(400 * Math.sqrt(scale)), nArtists: Math.round(120 * Math.sqrt(scale)), nAlbums: Math.round(200 * Math.sqrt(scale)),
      daysWith: Math.round(days * 0.86), longest: Math.min(days, 19), longestEnd: '', skips: Math.round(150 * scale), prevMins: Math.round(2800 * scale), prevPlays: 0,
      hours: Array.from({ length: 24 }, (_, i) => Math.round((i < 6 ? 2 : i < 9 ? 40 : i < 17 ? 150 : 110) * scale * (0.6 + rnd() * 0.8) / 10)),
      wdays: Array.from({ length: 7 }, () => Math.round(400 * scale * (0.6 + rnd() * 0.8))), days: [], months: [], artists: [], songs: [], albums: [], devices: [['iPhone', 2400], ['Windows PC', 700]] };
    const now = dayStart(Date.now());
    for (let i = Math.min(days, 365) - 1; i >= 0; i--) { const d = new Date(now - i * 864e5); r.days.push(['' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'), rnd() < 0.12 ? 0 : Math.round(40 + rnd() * 180)]); }
    r.best = r.days.reduce((b, d) => d[1] > b[1] ? d : b, ['', 0]);
    art.forEach((n, i) => r.artists.push([n, Math.round((80 - i * 8) * scale), Math.round((260 - i * 26) * scale), '', songs[i]]));
    songs.forEach((n, i) => r.songs.push([n, art[i], Math.round((20 - i * 2) * scale), Math.round((60 - i * 6) * scale), '', 'Sample Album']));
    art.slice(0, 6).forEach((n, i) => r.albums.push(['Sample Album ' + (i + 1), n, Math.round((40 - i * 5) * scale), Math.round((130 - i * 15) * scale), '']));
    return r;
  };
  const all = mk(365, 18);
  all.days = [];
  for (let i = 23; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); all.months.push(['' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0'), Math.round(1500 + rnd() * 3000)]); }
  const yr = new Date().getFullYear();
  Object.assign(all, { prevMins: 0, years: [[yr - 2, 9000, 2800], [yr - 1, 52000, 16000], [yr, 41000, 12500]], skipped: ['Back Forty', 'Northbound', 31],
    firstPlay: [Math.round(Date.now() / 1000) - 800 * 86400, 'Long Way Home', 'The Gravel Roads'] });
  const recent = [];
  for (let i = 0; i < 20; i++) recent.push([Math.round(Date.now() / 1000) - i * 210 - Math.floor(i / 8) * 86400, songs[i % 8], art[(i * 3) % 8], 'Sample Album', 200, '']);
  return { v: 1, ranges: { '28': mk(28, 1), '182': mk(182, 6), '365': mk(365, 12), all }, recent };
}

// ---------- start
const TAB_DEFS = [['home', 'Summary', 'chart', renderHome], ['top', 'Top', 'crown', renderTop], ['recent', 'Recent', 'recent', renderRecent]];
function render() {
  const v = document.getElementById('view');
  const def = TAB_DEFS.find(t => t[0] === S.tab) || TAB_DEFS[0];
  v.textContent = '';
  def[3](v);
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-current', b.dataset.tab === def[0] ? 'page' : 'false');
  onScroll();
}
function go(tab) {
  if (S.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  S.tab = tab; store.set('tab', tab); window.scrollTo(0, 0); render();
  const v = document.getElementById('view'); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
}
function onScroll() { const bar = document.getElementById('topbar'); if (bar) bar.classList.toggle('on', window.scrollY > 46); }
function applyTheme() {
  const t = S.prefs.theme;
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#050506' : '#f2f2f7');
}
// Safari may still hold an old Heep that answers for every page under /jeep/, this one included: then Heep's
// page comes up with this script in it. Get the new Heep (which leaves this app alone) and load the real page.
function rightPage() {
  let tries = 0;
  if (document.documentElement.dataset.app === 'listening') { try { sessionStorage.removeItem('listen.fix'); } catch (e) { /* fine */ } return true; }
  try { tries = +(sessionStorage.getItem('listen.fix') || 0); sessionStorage.setItem('listen.fix', String(tries + 1)); } catch (e) { tries = 9; }
  if (tries > 2) return true; // do our best in the page we got rather than reload forever
  document.body.innerHTML = '<p style="padding:80px 24px;text-align:center;opacity:.6">Opening Listening…</p>';
  const active = r => new Promise(res => {
    const w = r && (r.installing || r.waiting);
    if (!w) return res();
    w.addEventListener('statechange', () => { if (w.state === 'activated' || w.state === 'redundant') res(); });
    setTimeout(res, 6000);
  });
  const sw = navigator.serviceWorker;
  (sw ? sw.getRegistrations() : Promise.resolve([]))
    .then(rs => Promise.all(rs.map(r => r.update().then(() => active(r), () => null))))
    .catch(() => null)
    .then(() => location.reload());
  return false;
}
function boot() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  const fromLink = decodeSetup(location.hash);
  const fresh = fromLink ? connect(fromLink) : false;
  if (!S.conn) { S.sample = true; S.data = sampleData(); }
  const bar = document.getElementById('tabbar');
  for (const [id, label, ic] of TAB_DEFS) bar.append(h('button', { class: 'tab', 'data-tab': id, 'aria-label': label, onclick: () => go(id) }, icon(ic), h('span', { text: label })));
  addEventListener('scroll', onScroll, { passive: true });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 250); });
  render();
  if (fresh) toast('Connected', 'Getting your listening…', 'info');
  sync('start');
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync('back'); });
  addEventListener('online', () => sync('online'));
  setInterval(() => { if (!document.hidden) sync('poll'); }, 10 * 60 * 1000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /[?&]sw=1/.test(location.search))) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { /* fine without it */ });
}
if (rightPage()) boot();
