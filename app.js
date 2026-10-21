'use strict';
// app.js - start-up, the tab bar, theme and the scroll title.

const TAB_DEFS = [
  ['home', 'Overview', 'gauge', renderHome],
  ['fills', 'Fill-ups', 'pump', renderFills],
  ['service', 'Service', 'wrench', renderService],
  ['live', 'Live', 'live', renderLive],
];

function render() {
  STATS = calc(S.data);
  const v = document.getElementById('view');
  if (!v) return;
  const def = TAB_DEFS.find(t => t[0] === S.tab) || TAB_DEFS[0];
  v.textContent = '';
  def[3](v);
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-current', b.dataset.tab === def[0] ? 'page' : 'false');
  const dl = document.getElementById('stations');
  if (dl) { dl.textContent = ''; for (const s of stationList()) dl.append(h('option', { value: s })); }
  onScroll();
}
function go(tab) {
  if (S.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  S.tab = tab;
  store.set('tab', tab);
  window.scrollTo(0, 0);
  render();
  const v = document.getElementById('view');
  v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
}
function onScroll() {
  const bar = document.getElementById('topbar');
  if (bar) bar.classList.toggle('on', window.scrollY > 46);
}
function applyTheme() {
  const t = S.prefs.theme;
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#050506' : '#f2f2f7');
}

function boot() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  const fromLink = decodeSetup(location.hash);
  const fresh = fromLink ? connect(fromLink) : false;
  if (!S.conn) { S.sample = true; S.data = sampleData(); }
  const bar = document.getElementById('tabbar');
  for (const [id, label, ic] of TAB_DEFS) bar.append(h('button', { class: 'tab', 'data-tab': id, 'aria-label': label, onclick: () => go(id) }, icon(ic), h('span', { text: label })));
  const fab = document.getElementById('fab');
  fab.append(icon('plus'));
  fab.addEventListener('click', () => fillSheet());
  addEventListener('scroll', onScroll, { passive: true });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 250); });
  render();
  if (fresh) toast('Connected to your Jeep log', 'Getting your fill-ups…', 'info');
  sync('start');
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync('back'); });
  addEventListener('online', () => sync('online'));
  setInterval(() => { if (!document.hidden) sync('poll'); }, 5 * 60 * 1000);
  setInterval(() => { if (!document.hidden && !sheets.length && S.tab !== 'live') updateSyncButtons(); }, 30000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { /* works without it, just not offline */ });
}
boot();
