'use strict';
// map.js - the Map & Trip History page. Only Heep has a map; the T3 just records.
//
// Where the tracks come from: the T3 logs every trip to its SD card, then (on home Wi-Fi or your hotspot)
// uploads each finished trip to YOUR track store, a small Apps Script in your own Google Drive
// (tracks/TrackStore.gs). This page lists the trips from there and downloads a trip's track only when
// you open it, keeping it on the phone afterwards (IndexedDB), so long histories stay quick.
//
// The map draws the RECORDED GPS track: never snapped to roads, never filled in across gaps. Map pictures
// come from OpenStreetMap and need signal; with no signal the track still draws on a plain background.
// Your tracks are only ever sent to your own track store, never to the map service.

const MAP = { el: null, map: null, L: null, layer: null, live: null, sel: null, rows: null, stats: null, play: null, playMk: null, color: 'speed', infoEl: null };
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// ---------------------------------------------------------------- the track store (your own Apps Script)
const trkConf = () => store.get('trk', null);
async function trkCall(body) {
  const c = trkConf();
  if (!c || !c.u) throw new Error('no store');
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), 45000);
  try {
    const res = await fetch(c.u, { method: 'POST', body: JSON.stringify(Object.assign({ k: c.k }, body)), redirect: 'follow', cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    const j = JSON.parse(await res.text());
    if (!j.ok) throw new Error(j.error === 'key' ? 'The track store didn’t accept the key' : (j.error || 'track store error'));
    return j;
  } finally { clearTimeout(timer); }
}
// tracks are kept on the phone after the first download (they never change once uploaded)
function idb() {
  return new Promise((ok, bad) => {
    if (!window.indexedDB) { bad(new Error('no IndexedDB')); return; }
    const r = indexedDB.open('jeep-tracks', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('csv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
async function idbGet(id) { try { const db = await idb(); return await new Promise(ok => { const q = db.transaction('csv').objectStore('csv').get(id); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); } catch (e) { return null; } }
async function idbPut(id, v) { try { const db = await idb(); db.transaction('csv', 'readwrite').objectStore('csv').put(v, id); } catch (e) { /* private mode: just download again next time */ } }
async function idbDel(id) { try { const db = await idb(); db.transaction('csv', 'readwrite').objectStore('csv').delete(id); } catch (e) { /* nothing kept */ } }

const SAMPLE_TRIPS = [1, 2, 3].map(i => ({ id: 'sample-' + i, sample: true }));
function sampleCsv(id) { const i = Number(id.split('-')[1]); return sampleTrack(i, dayStart(Date.now()) - (i * 1.4) * 864e5 + 15.5 * 3600e3); }

// the list: cached copy right away, refreshed from the store at most every 2 minutes (or on pull)
let trkBusy = false;
async function trkRefresh(force) {
  const c = trkConf(), cur = store.get('trkIndex', null);
  if (!c || !c.u || trkBusy) return;
  if (!force && cur && Date.now() - cur.at < 120000) return;
  trkBusy = true;
  try { const j = await trkCall({ op: 'list' }); store.set('trkIndex', { at: Date.now(), trips: j.trips || [], err: '' }); }
  catch (e) { store.set('trkIndex', Object.assign({}, cur || { trips: [] }, { err: e.message || 'unreachable', errAt: Date.now() })); }
  finally { trkBusy = false; if (S.tab === 'map') render(); }
}
function tripList() {
  if (!trkConf()) return SAMPLE_TRIPS.map(t => Object.assign({}, t, summarise(t.id, sampleCsv(t.id))));
  return ((store.get('trkIndex', null) || {}).trips || []).slice();
}
function summarise(id, csv) {
  const { rows } = parseTrack(csv);
  const s = tripStats(rows);
  return { id, t0: s.t0, t1: s.t1, km: s.km, vmax: s.vmax, tmin: s.tmin, tmax: s.tmax, a0: s.a0, a1: s.a1, secs: s.durS, est: s.est };
}
async function trackCsv(id) {
  if (id.startsWith('sample-')) return sampleCsv(id);
  const hit = await idbGet(id);
  if (hit) return hit;
  const j = await trkCall({ op: 'get', id });
  await idbPut(id, j.csv);
  return j.csv;
}

// ---------------------------------------------------------------- named places (Home, the shop...) instead of coordinates
const places = () => store.get('places', []);
function placeName(p) {
  if (!p) return null;
  for (const pl of places()) if (distM(pl.lat, pl.lon, p[0], p[1]) <= (pl.r || 250)) return pl.name;
  return null;
}
const where = p => (p ? placeName(p) || p[0].toFixed(4) + ', ' + p[1].toFixed(4) : 'no GPS fix');

// ---------------------------------------------------------------- Leaflet, loaded the first time the page opens (kept for offline)
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((ok, bad) => {
    document.head.append(h('link', { rel: 'stylesheet', href: 'vendor/leaflet/leaflet.css?v=1.9.4' }));
    const s = h('script', { src: 'vendor/leaflet/leaflet.js?v=1.9.4' });
    s.onload = () => ok(window.L);
    s.onerror = () => { leafletP = null; bad(new Error('map code didn’t load')); };
    document.head.append(s);
  });
  return leafletP;
}
function mapBox() {
  if (MAP.el) return MAP.el;
  MAP.el = h('div', { class: 'mapbox' }, h('div', { class: 'map-wait', text: 'Loading the map…' }));
  loadLeaflet().then(L => {
    MAP.L = L;
    MAP.el.textContent = '';
    MAP.map = L.map(MAP.el, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([56.2, -120.7], 9);
    L.control.zoom({ position: 'topright' }).addTo(MAP.map);
    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR, crossOrigin: true });
    tiles.on('tileerror', () => MAP.el.classList.add('offline'));
    tiles.on('tileload', () => MAP.el.classList.remove('offline'));
    tiles.addTo(MAP.map);
    MAP.map.on('click', e => { if (MAP.rows) pickPoint(nearestRow(MAP.rows, e.latlng.lat, e.latlng.lng), true); });
    drawSelection();
    drawLive();
  }).catch(() => { MAP.el.textContent = ''; MAP.el.append(h('div', { class: 'map-wait', text: 'The map code couldn’t load (no signal the first time?). Trips and numbers still work below.' })); });
  return MAP.el;
}

// ---------------------------------------------------------------- the page
function renderMap(v) {
  const conf = trkConf(), idx = store.get('trkIndex', null);
  const list = tripList();
  v.append(titleRow(MAP.sel ? 'Trip' : 'Trips', MAP.sel ? 'Trip on the map' : conf ? list.length + ' trips recorded' : 'Sample trips until track storage is set up'));
  topBanners(v);
  if (!conf) v.append(banner('map', 'Set up track storage', 'So the T3’s trips show here. These are made-up sample trips.', trackStoreSheet));
  else if (idx && idx.err) v.append(banner('warn', 'Couldn’t reach your track store', idx.err + ' · showing what this phone has', () => trkRefresh(true)));
  const box = mapBox();
  const tools = h('div', { class: 'map-tools' },
    h('button', { class: 'circle glass', 'aria-label': 'Fit the trip', onclick: fitSelection }, icon('fit')),
    h('button', { class: 'circle glass', 'aria-label': 'Where the Jeep is', onclick: () => showLive(true) }, icon('pin')));
  v.append(h('div', { class: 'map-wrap card' }, box, tools, h('div', { class: 'map-legend' }, MAP.sel ? colorLegend() : liveLegend())));
  if (MAP.map) setTimeout(() => { MAP.map.invalidateSize(); }, 0);
  if (MAP.sel) renderTrip(v);
  else renderTripList(v, list);
  drawLive();
  if (conf) trkRefresh(false);
}

function liveLegend() {
  const lp = store.get('lastPos', null);
  const fresh = LIVE.v && LIVE.v.lat != null && Date.now() - LIVE.at < 5000;
  if (fresh) return h('span', null, h('i', { class: 'lg live' }), 'Jeep now (live)');
  if (lp) return h('span', null, h('i', { class: 'lg last' }), 'Last known position, ' + fmtDay(lp.at) + ' ' + fmtTime(lp.at));
  return h('span', { class: 'muted', text: 'Pick a trip to see its route' });
}

// the Jeep's own position: live while the T3 is sending, otherwise the last one this phone saw
function drawLive() {
  if (!MAP.map) return;
  const L = MAP.L;
  const fresh = LIVE.v && LIVE.v.lat != null && Date.now() - LIVE.at < 5000;
  const p = fresh ? { lat: LIVE.v.lat, lon: LIVE.v.lon, hdg: LIVE.v.hdg } : store.get('lastPos', null);
  if (!p) { if (MAP.live) { MAP.live.remove(); MAP.live = null; } return; }
  const html = '<div class="jeep-dot' + (fresh ? ' live' : '') + '">' + (p.hdg != null && fresh ? '<b style="transform:rotate(' + Math.round(p.hdg) + 'deg)"></b>' : '') + '</div>';
  const ic = L.divIcon({ className: 'jeep-ic', html, iconSize: [22, 22], iconAnchor: [11, 11] });
  if (!MAP.live) MAP.live = L.marker([p.lat, p.lon], { icon: ic, zIndexOffset: 1000, interactive: false }).addTo(MAP.map);
  else { MAP.live.setLatLng([p.lat, p.lon]); MAP.live.setIcon(ic); }
}
function showLive(pan) {
  const fresh = LIVE.v && LIVE.v.lat != null && Date.now() - LIVE.at < 5000;
  const p = fresh ? LIVE.v : store.get('lastPos', null);
  if (!p) { toast('No position yet', 'The T3 sends it once its GPS has a fix', 'info'); return; }
  if (pan && MAP.map) MAP.map.setView([p.lat, p.lon], Math.max(MAP.map.getZoom(), 14));
}
setInterval(() => { if (S.tab === 'map' && !document.hidden) drawLive(); }, 2000);

// ---------------------------------------------------------------- trip list
// a trip's distance: the GPS track's, or the T3's trip meter when there was no GPS
const tripKm = t => (t.km > 0.05 ? t.km : t.t3km || t.km || 0);
function renderTripList(v, list) {
  const f = store.get('mapFilter', { month: 'all', sort: 'new' });
  const months = [...new Set(list.filter(t => t.t0).map(t => { const d = new Date(t.t0); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }))].sort().reverse();
  const mSel = h('select', { class: 'pick' }, h('option', { value: 'all', text: 'All months' }), months.map(m => h('option', { value: m, text: MONTHS[+m.slice(5) - 1] + ' ' + m.slice(0, 4) })), h('option', { value: 'none', text: 'No date' }));
  mSel.value = months.includes(f.month) || f.month === 'none' ? f.month : 'all';
  const sSel = h('select', { class: 'pick' }, [['new', 'Newest first'], ['old', 'Oldest first'], ['far', 'Longest distance'], ['long', 'Longest time'], ['cold', 'Coldest']].map(([a, b]) => h('option', { value: a, text: b })));
  sSel.value = f.sort;
  const save = () => { store.set('mapFilter', { month: mSel.value, sort: sSel.value }); render(); };
  mSel.addEventListener('change', save); sSel.addEventListener('change', save);
  let shown = list.filter(t => mSel.value === 'all' ? true : mSel.value === 'none' ? !t.t0 : t.t0 && (new Date(t.t0).getFullYear() + '-' + String(new Date(t.t0).getMonth() + 1).padStart(2, '0')) === mSel.value);
  const by = { new: (a, b) => (b.t0 || 0) - (a.t0 || 0), old: (a, b) => (a.t0 || 0) - (b.t0 || 0), far: (a, b) => tripKm(b) - tripKm(a), long: (a, b) => (b.secs || 0) - (a.secs || 0), cold: (a, b) => (a.tmin == null ? 99 : a.tmin) - (b.tmin == null ? 99 : b.tmin) };
  shown.sort(by[sSel.value] || by.new);
  v.append(h('div', { class: 'month' }, h('b', { text: 'Trips' }), h('span', { text: fmt1(shown.reduce((s, t) => s + tripKm(t), 0)) + ' km' })));
  v.append(h('div', { class: 'map-filters' }, mSel, sSel, trkConf() ? h('button', { class: 'circle glass', 'aria-label': 'Refresh', onclick: () => trkRefresh(true) }, icon('sync', trkBusy ? 'spin' : null)) : null));
  if (shown.length) v.append(h('div', { class: 'foot', text: 'Tap a trip to open its map, replay and drive details.' }));
  if (!shown.length) {
    v.append(card(h('div', { class: 'empty', style: 'padding:14px 6px' }, h('div', { class: 'ico' }, icon('map')), h('h3', { text: list.length ? 'No trips here' : 'No trips yet' }),
      h('p', { text: list.length ? 'Try another month.' : 'Finished trips appear here after the T3 uploads them (home Wi-Fi or your hotspot).' }))));
    return;
  }
  v.append(h('div', { class: 'card list' }, shown.slice(0, 300).map(t => {
    const title = t.t0 ? fmtDay(t.t0) + ', ' + fmtTime(t.t0) + (t.est ? ' (approx.)' : '') : 'Time unknown';
    const tr = t.tmin != null ? ' · ' + fmt1(t.tmin) + (t.tmax !== t.tmin ? ' to ' + fmt1(t.tmax) : '') + ' °C' : '';
    return h('button', { class: 'row', onclick: () => openTrip(t.id) },
      h('div', { class: 'main' }, h('b', { text: title + (t.sample ? ' · Sample' : '') }),
        h('span', { text: t.a0 || t.a1 ? where(t.a0) + ' → ' + where(t.a1) : 'No GPS on this trip: tap for the engine’s numbers' }),
        h('span', { text: (t.secs ? dur(t.secs) : '') + (t.vmax ? ' · top ' + Math.round(t.vmax) + ' km/h' : '') + tr })),
      h('div', { class: 'end' }, h('b', { text: fmt1(tripKm(t)) + ' km' })), icon('chev', 'chev'));
  })));
  if (shown.length > 300) v.append(h('div', { class: 'foot', text: 'Showing 300 of ' + shown.length + '. Pick a month to see the rest.' }));
}

// ---------------------------------------------------------------- one trip
async function openTrip(id) {
  MAP.sel = id; MAP.rows = null; MAP.stats = null; MAP.pick = -1; MAP.err = ''; stopPlay();
  window.scrollTo(0, 0);
  render();
  if (!trkConf() && !id.startsWith('sample-')) { MAP.err = 'Connect track storage in Heep on this browser to open this trip map.'; render(); return; }
  try {
    const csv = await trackCsv(id);
    if (MAP.sel !== id) return;
    const { rows } = parseTrack(csv);
    MAP.rows = rows; MAP.stats = tripStats(rows);
  } catch (e) { MAP.err = e.message || 'couldn’t download'; }
  render();
  drawSelection(); fitSelection();
}
function closeTrip() { MAP.sel = null; MAP.rows = null; MAP.stats = null; MAP.err = ''; stopPlay(); if (MAP.layer) { MAP.layer.remove(); MAP.layer = null; } render(); }

const SPEED_COLORS = [[0, '#64d2ff'], [30, '#30d158'], [60, '#ffd60a'], [90, '#ff9f0a'], [110, '#ff453a']];
const TEMP_COLORS = [[-40, '#bf5af2'], [-20, '#0a84ff'], [-5, '#64d2ff'], [5, '#30d158'], [20, '#ffd60a'], [30, '#ff453a']];
function colorFor(v, scale) { let c = scale[0][1]; for (const [x, col] of scale) if (v != null && v >= x) c = col; return c; }
function colorLegend() {
  const opt = seg([['speed', 'Speed'], ['temp', 'Temp'], ['plain', 'Plain']], MAP.color, c => { MAP.color = c; drawSelection(); });
  return h('div', { class: 'legend-row' }, opt, h('span', { class: 'small muted', text: 'Recorded GPS track · not snapped to roads' }));
}

// draw the selected trip: each unbroken piece as its own line, coloured in runs, gaps left empty
function drawSelection() {
  if (!MAP.map) return;
  const L = MAP.L;
  if (MAP.layer) { MAP.layer.remove(); MAP.layer = null; }
  const rows = MAP.rows, s = MAP.stats;
  if (!rows || !s) return;
  const g = L.layerGroup();
  const scale = MAP.color === 'temp' ? TEMP_COLORS : SPEED_COLORS;
  const val = r => (MAP.color === 'temp' ? r.ot : r.kmh);
  for (const seg0 of s.segs) {
    const segIdx = simplify(rows, seg0, seg0.length > 4000 ? 6 : 2.5);   // fewer points to draw; every point still counts in the numbers
    if (MAP.color === 'plain') { L.polyline(segIdx.map(i => [rows[i].lat, rows[i].lon]), { color: '#ff9f0a', weight: 5, opacity: .9 }).addTo(g); continue; }
    let run = [segIdx[0]], col = colorFor(val(rows[segIdx[0]]), scale);
    for (let k = 1; k < segIdx.length; k++) {
      const c = colorFor(val(rows[segIdx[k]]), scale);
      run.push(segIdx[k]);
      if (c !== col || k === segIdx.length - 1) { L.polyline(run.map(i => [rows[i].lat, rows[i].lon]), { color: col, weight: 5, opacity: .95 }).addTo(g); run = [segIdx[k]]; col = c; }
    }
    if (segIdx.length === 1) L.circleMarker([rows[segIdx[0]].lat, rows[segIdx[0]].lon], { radius: 3, color: col }).addTo(g);
  }
  // where the signal was lost and found again: hollow dots, no line between
  for (const gp of s.gaps) for (const i of [gp.a, gp.b]) L.circleMarker([rows[i].lat, rows[i].lon], { radius: 5, color: '#8e8e93', weight: 2, fillOpacity: 0, dashArray: '2 2' }).bindTooltip(gp.why + (gp.sec ? ', ' + Math.round(gp.sec) + ' s' : '')).addTo(g);
  for (const st of s.stops) L.circleMarker([st.lat, st.lon], { radius: 7, color: '#0a84ff', weight: 2, fillColor: '#0a84ff', fillOpacity: .35 }).bindTooltip('Stopped about ' + dur(st.sec)).addTo(g);
  for (const i of s.marks) if (rows[i].lat != null) L.circleMarker([rows[i].lat, rows[i].lon], { radius: 6, color: '#bf5af2', weight: 2, fillOpacity: .6 }).bindTooltip(rows[i].ev).addTo(g);
  const dot = (p, c, t) => L.circleMarker(p, { radius: 8, color: '#fff', weight: 3, fillColor: c, fillOpacity: 1 }).bindTooltip(t).addTo(g);
  if (s.a0) dot(s.a0, '#30d158', 'Start');
  if (s.a1) dot(s.a1, '#ff453a', 'End');
  // the replay / picked-point marker (hidden until a point is picked)
  MAP.playMk = L.circleMarker([s.a0 ? s.a0[0] : 0, s.a0 ? s.a0[1] : 0], { radius: 9, color: '#fff', weight: 3, fillColor: '#ff9f0a', opacity: 0, fillOpacity: 0, interactive: false }).addTo(g);
  g.addTo(MAP.map);
  MAP.layer = g;
  if (MAP.pick >= 0) pickPoint(MAP.pick, false);
}
function fitSelection() {
  if (!MAP.map) return;
  const s = MAP.stats;
  if (s && s.fixes) {
    const pts = MAP.rows.filter(r => r.lat != null).map(r => [r.lat, r.lon]);
    MAP.map.fitBounds(MAP.L.latLngBounds(pts), { padding: [28, 28], maxZoom: 16 });
  } else showLive(true);
}

// a point on the track: its numbers, and the marker on the map
function pickPoint(i, fromMap) {
  if (i < 0 || !MAP.rows) return;
  MAP.pick = i;
  const r = MAP.rows[i];
  if (MAP.playMk && r.lat != null) { MAP.playMk.setLatLng([r.lat, r.lon]); MAP.playMk.setStyle({ opacity: 1, fillOpacity: 1 }); }
  if (MAP.slider && document.activeElement !== MAP.slider) MAP.slider.value = String(i);
  if (MAP.infoEl) {
    MAP.infoEl.textContent = '';
    const t = r.t ? fmtTime(r.t) + (r.est ? ' (approx.)' : '') : 'T3 clock +' + Math.round((r.up - MAP.rows[0].up) / 1000) + ' s';
    const kv = (k, val) => h('div', null, h('div', { class: 'small muted', text: k }), h('b', { class: 'num', text: val }));
    put(MAP.infoEl,
      kv('Time', t), kv('Speed', r.kmh != null ? Math.round(r.kmh) + ' km/h' : r.okmh != null ? Math.round(r.okmh) + ' km/h (iCar)' : '—'),
      kv('Outside', r.ot != null ? fmt1(r.ot) + ' °C' : '—'), kv('Heading', r.crs != null && r.kmh >= 5 ? compass(r.crs) + ' ' + Math.round(r.crs) + '°' : '—'),
      kv('GPS', r.lat != null ? (r.sats != null ? r.sats + ' sats' : 'fix') + (r.hdop != null ? ' · HDOP ' + r.hdop : '') : 'no fix'),
      kv('Boost', r.boost != null ? fmt1(r.boost) + ' psi' : '—'), kv('RPM', r.rpm != null ? fmt0(r.rpm) : '—'),
      kv('Coolant', r.ect != null ? (t3EngF() ? Math.round(r.ect * 9 / 5 + 32) + ' °F' : Math.round(r.ect) + ' °C') : '—'), r.ev ? kv('Note', r.ev) : null);
  }
}

function stopPlay() { if (MAP.play) { clearInterval(MAP.play.timer); MAP.play = null; } if (MAP.playBtn) { MAP.playBtn.lastChild.textContent = 'Play'; } }
function togglePlay() {
  if (MAP.play) { stopPlay(); return; }
  const rows = MAP.rows;
  if (!rows) return;
  let i = MAP.pick >= 0 && MAP.pick < rows.length - 1 ? MAP.pick : 0;
  const speed = Number(store.get('playSpeed', 30));
  MAP.play = { timer: setInterval(() => {
    // move on by `speed` seconds of T3 time per tick (10 ticks a second)
    const target = rows[i].up + speed * 100;
    while (i < rows.length - 1 && rows[i].up < target) i++;
    if (MAP.stats && MAP.stats.fixes) while (i < rows.length - 1 && rows[i].lat == null) i++;
    pickPoint(i, true);
    if (rows[i].lat != null && MAP.map && !MAP.map.getBounds().contains([rows[i].lat, rows[i].lon])) MAP.map.panTo([rows[i].lat, rows[i].lon]);
    if (i >= rows.length - 1) stopPlay();
  }, 100) };
  if (MAP.playBtn) MAP.playBtn.lastChild.textContent = 'Pause';
}

function renderTrip(v) {
  const s = MAP.stats, rows = MAP.rows, id = MAP.sel;
  const meta = tripList().find(t => t.id === id) || { id };
  put(v, h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-small btn-glass glass', onclick: closeTrip }, icon('back'), 'All trips')));
  if (!s) {
    put(v, card(h('p', { class: 'foot', style: 'margin:0', text: MAP.err ? 'Couldn’t get this trip: ' + MAP.err : 'Getting the track…' })));
    return;
  }
  const title = s.t0 ? fmtDay(s.t0, true) + ', ' + fmtTime(s.t0) + (s.t1 ? ' to ' + fmtTime(s.t1) : '') : 'Date and time unknown (no clock on this trip)';
  const cell = (k, val, sub) => h('div', { class: 'tile card' }, h('div', { class: 'k', text: k }), h('div', { class: 'v num', text: val }), sub ? h('div', { class: 's', text: sub }) : null);
  put(v, card(h('div', { class: 'card-head' }, h('h2', { text: title + (meta.sample ? ' · Sample' : '') })),
    h('div', { class: 'small muted', text: (s.est ? 'Times marked approx. were worked out from the T3’s own clock before the GPS had the time. ' : '') + (s.fixes ? where(s.a0) + ' → ' + where(s.a1) : 'No GPS on this trip, so no map line: the numbers below come from the engine (through the iCar) and the T3.') })));
  const km = s.kmFrom === 'gps' && s.km < 0.05 && meta.t3km ? meta.t3km : s.km;
  const kmFrom = s.kmFrom === 'gps' && s.km < 0.05 && meta.t3km ? 't3' : s.kmFrom;
  const lit = s.lit != null && s.lit > 0.05 ? s.lit : meta.litres || null;
  const engF = typeof t3EngF === 'function' ? t3EngF() : true;
  const eT = c => (engF ? c * 9 / 5 + 32 : c), eU = engF ? '°F' : '°C';
  put(v, h('div', { class: 'tiles' },
    cell(({ gps: 'Distance (GPS track)', t3: 'Distance (T3 trip meter)', obd: 'Distance (engine speed)' })[kmFrom], fmt1(km) + ' km', kmFrom === 'gps' && meta.t3km ? 'T3 trip meter ' + fmt1(meta.t3km) + ' km' : null),
    cell('Time', s.durS ? dur(s.durS) : '—', s.movingS ? 'moving ' + dur(s.movingS) : null),
    cell('Average speed', s.movingS > 60 ? Math.round(km / (s.movingS / 3600)) + ' km/h' : '—', s.durS > 60 ? Math.round(km / (s.durS / 3600)) + ' km/h including stops' : null),
    cell('Top speed', s.vmax != null ? Math.round(s.vmax) + ' km/h' : '—', null),
    cell('Outside', s.tavg != null ? fmt1(s.tavg) + ' °C' : '—', s.tmin != null ? fmt1(s.tmin) + ' to ' + fmt1(s.tmax) + ' °C' : 'no probe readings'),
    lit ? cell('Fuel', fmt1(lit) + ' L', km > 1 ? fmt1(lit / km * 100) + ' L/100 km' : null) : null,
    s.rpmMax != null ? cell('Top RPM', fmt0(s.rpmMax), s.ectMax != null ? 'coolant up to ' + Math.round(eT(s.ectMax)) + ' ' + eU : null) : null,
    cell('GPS', !s.fixes ? 'No GPS' : s.gaps.length ? s.gaps.length + (s.gaps.length > 1 ? ' gaps' : ' gap') : 'No gaps', !s.fixes ? 'the map needs the GPS; the rest works' : s.fixes + ' of ' + s.rows + ' points with a fix')));
  // playback
  MAP.slider = h('input', { type: 'range', min: 0, max: Math.max(0, rows.length - 1), value: MAP.pick >= 0 ? MAP.pick : 0, class: 'scrub' });
  MAP.slider.addEventListener('input', () => { stopPlay(); let i = Number(MAP.slider.value); if (s.fixes) while (i < rows.length - 1 && rows[i].lat == null) i++; pickPoint(i, true); if (rows[i].lat != null && MAP.map) MAP.map.panTo([rows[i].lat, rows[i].lon]); });
  MAP.playBtn = h('button', { class: 'btn btn-small btn-primary', onclick: togglePlay }, icon('play'), 'Play');
  MAP.infoEl = h('div', { class: 'pt-info' });
  const sp = h('select', { class: 'pick' }, [[10, '10×'], [30, '30×'], [60, '60×'], [180, '180×']].map(([a, b]) => h('option', { value: String(a), text: b })));
  sp.value = String(store.get('playSpeed', 30));
  sp.addEventListener('change', () => store.set('playSpeed', Number(sp.value)));
  put(v, card(cardHead('Replay', null), h('div', { class: 'play-row' }, MAP.playBtn, sp), MAP.slider, MAP.infoEl,
    h('div', { class: 'foot', text: 'Tap the map to see the nearest recorded point.' })));
  if (MAP.pick >= 0) pickPoint(MAP.pick, false); else { const first = rows.findIndex(r => r.lat != null); pickPoint(first >= 0 ? first : 0, false); }
  // charts: speed and temperature over the trip (scrubbing moves the marker)
  const chart = (label, key, unit, dp, conv) => {
    const pts = [];
    const step = Math.max(1, Math.floor(rows.length / 300));
    for (let i = 0; i < rows.length; i += step) { const r = rows[i]; if (r[key] != null && r.up != null) pts.push({ t: r.t || r.up, v: conv ? conv(r[key]) : r[key], i, tip: (r.t ? fmtTime(r.t) : '+' + Math.round((r.up - rows[0].up) / 60000) + ' min') }); }
    if (pts.length < 3) return null;
    return card(cardHead(label, null), lineChart({ pts, label, fmt: x => x.toFixed(dp) + ' ' + unit, fmtAxis: x => String(+x.toFixed(1)), fmtX: t => (rows[0].t ? fmtTime(t) : ''), onAt: p => pickPoint(p.i, true) }));
  };
  put(v, chart('Speed', 'v', 'km/h', 0), chart('RPM', 'rpm', 'rpm', 0));
  if (s.bmax != null && s.bmax > 0) put(v, chart('Boost', 'boost', 'psi', 1));
  put(v, chart('Coolant', 'ect', eU, 0, eT), chart('Engine load', 'load', '%', 0), chart('Fuel rate', 'lph', 'L/h', 1),
    chart('Intake air', 'iat', eU, 0, eT), chart('Battery', 'volt', 'V', 1), chart('Outside temperature', 'ot', '°C', 1));
  // stops and gaps
  if (s.stops.length) put(v, h('div', { class: 'label', text: 'Likely stops (stopped ' + Math.round(TRK.stopSec / 60) + '+ min, from GPS speed)' }),
    h('div', { class: 'card list' }, s.stops.map(st => h('button', { class: 'row', onclick: () => { pickPoint(st.i, true); if (MAP.map) MAP.map.setView([st.lat, st.lon], 16); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
      h('div', { class: 'main' }, h('b', { text: 'About ' + dur(st.sec) }), h('span', { text: (st.t ? (st.est ? 'approx. ' : '') + fmtTime(st.t) + ' · ' : '') + where([st.lat, st.lon]) })), icon('chev', 'chev')))));
  if (s.gaps.length) put(v, h('div', { class: 'label', text: 'Where the GPS track has gaps (no line is drawn across them)' }),
    h('div', { class: 'card list' }, s.gaps.map(gp => h('div', { class: 'row' }, h('div', { class: 'main' }, h('b', { text: gp.why + (gp.sec ? ' for ' + (gp.sec < 120 ? Math.round(gp.sec) + ' s' : dur(gp.sec)) : '') }),
      h('span', { text: rows[gp.a].t ? fmtTime(rows[gp.a].t) + ' to ' + fmtTime(rows[gp.b].t) : '' }))))));
  // places, export, delete
  put(v, h('div', { class: 'label', text: 'This trip' }), h('div', { class: 'card list' },
    s.a0 ? h('button', { class: 'row', onclick: () => namePlace(s.a0) }, h('div', { class: 'main' }, h('b', { text: 'Name the start' }), h('span', { text: where(s.a0) })), icon('pin', 'chev')) : null,
    s.a1 ? h('button', { class: 'row', onclick: () => namePlace(s.a1) }, h('div', { class: 'main' }, h('b', { text: 'Name the end' }), h('span', { text: where(s.a1) })), icon('pin', 'chev')) : null,
    h('button', { class: 'row', onclick: async () => { const csv = await trackCsv(id); const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'jeep-' + id + '.csv' }); document.body.append(a); a.click(); a.remove(); } },
      h('div', { class: 'main' }, h('b', { text: 'Download the track (CSV)' }), h('span', { text: 'Every recorded row, as the T3 logged it' })), icon('download', 'chev'))),
  meta.sample ? null : confirmButton('Delete this trip from the track store', 'Tap again: the track is deleted from your Drive (the T3’s SD card still has it)', async () => {
    try { await trkCall({ op: 'del', id }); await idbDel(id); const ix = store.get('trkIndex', { trips: [] }); ix.trips = ix.trips.filter(t => t.id !== id); store.set('trkIndex', ix); closeTrip(); toast('Deleted', 'Gone from the track store'); }
    catch (e) { toast('Couldn’t delete it', e.message, 'bad'); }
  }));
}

function namePlace(p) {
  openSheet({
    title: 'Name this place',
    build(b, sheet) {
      const name = h('input', { placeholder: 'Home, the shop, work…', value: placeName(p) || '' });
      put(b, h('div', { class: 'group' }, h('label', { class: 'gr' }, h('span', { text: 'Name' }), name)),
        h('div', { class: 'foot', text: 'Trips starting or ending within 250 m of ' + p[0].toFixed(5) + ', ' + p[1].toFixed(5) + ' will show this name. Kept on this phone only.' }),
        h('button', { class: 'btn btn-primary btn-wide', onclick: () => { const n = name.value.trim(); const list = places().filter(pl => distM(pl.lat, pl.lon, p[0], p[1]) > 250); if (n) list.push({ name: n, lat: p[0], lon: p[1], r: 250 }); store.set('places', list); sheet.close(); render(); } }, icon('check'), 'Save'));
    },
  });
}

// ---------------------------------------------------------------- setting up the track store (once)
function newKey() { const a = new Uint8Array(24); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function trackStoreSheet() {
  const cur = trkConf();
  const key = (cur && cur.k) || store.get('trkKeyDraft', null) || newKey();
  store.set('trkKeyDraft', key);
  openSheet({
    title: 'Track storage',
    build(b, sheet) {
      const url = h('textarea', { rows: 2, placeholder: 'https://script.google.com/macros/s/…/exec', style: 'font:15px/1.35 var(--font)' }, cur ? cur.u : '');
      const err = h('div', { class: 'err' });
      const copyCode = async btn => {
        try {
          const code = await (await fetch('tracks/TrackStore.gs', { cache: 'no-store' })).text();
          await copyText(code.replace("var KEY = 'PUT-YOUR-KEY-HERE';", "var KEY = '" + key + "';"), btn);
        } catch (e) { err.textContent = 'Couldn’t get the script (no signal?).'; }
      };
      put(b,
        h('div', { class: 'foot', text: 'Your trips’ GPS tracks go to a folder in YOUR Google Drive, through a small script you own, separate from the Jeep log. About 5 minutes, once, on the PC or phone.' }),
        h('ol', { class: 'steps' },
          h('li', null, h('div', null, 'Open ', h('a', { class: 'link', href: 'https://script.google.com/home/projects/create', target: '_blank', rel: 'noopener', text: 'a new Apps Script project' }), ' and name it Jeep tracks.')),
          h('li', null, h('div', null, 'Copy the script (it already has your new key in it) and paste it over everything in Code.gs. Save.',
            h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn btn-small btn-glass glass', onclick: e => copyCode(e.currentTarget) }, icon('copy'), 'Copy the script')))),
          h('li', null, h('div', { text: 'Deploy > New deployment > type Web app. Execute as: Me. Who has access: Anyone. Deploy, and allow it to use your Drive.' })),
          h('li', null, h('div', { text: 'Copy the Web app URL and paste it here, then Connect.' }))),
        h('div', { class: 'field small-in' }, h('span', { class: 'fl', text: 'Web app URL' }), url), err,
        h('button', { class: 'btn btn-primary btn-wide', onclick: async () => {
          const u = url.value.trim();
          if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) { err.textContent = 'That doesn’t look like an Apps Script web app URL.'; return; }
          err.textContent = 'Checking…';
          store.set('trk', { u, k: key });
          try { await trkCall({ op: 'list' }); err.textContent = ''; store.del('trkKeyDraft'); sheet.close(); toast('Track store connected', 'Now send T3 settings over Bluetooth so the T3 knows it'); trkRefresh(true); render(); }
          catch (e) { store.set('trk', cur); err.textContent = 'It answered with a problem: ' + e.message + '. Check "Who has access: Anyone" and that you pasted the script with its key.'; }
        } }, icon('link'), 'Connect'),
        h('div', { class: 'foot', text: 'Then T3 settings > Send settings (over Bluetooth) to give the T3 the address and key. Finished trips upload by themselves whenever the T3 is on home Wi-Fi or your hotspot.' }),
        cur ? confirmButton('Disconnect the track store', 'Tap again: this phone forgets it (your Drive keeps the tracks)', () => { store.del('trk'); store.del('trkIndex'); sheet.close(); render(); }) : null);
    },
  });
}
