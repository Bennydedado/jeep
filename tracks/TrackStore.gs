// TrackStore.gs - your own store for the Jeep's GPS tracks, in your Google Drive. A second small Apps Script,
// separate from the Jeep log sheet's script, so fill-ups and trips are never touched by it.
//
// Heep sets this up for you (Map > Set up track storage): it puts a fresh key into this code. By hand:
//   1. script.google.com > New project, name it "Jeep tracks", paste this file over Code.gs.
//   2. Put a long random key in KEY below (Heep makes one for you).
//   3. Deploy > New deployment > Web app: Execute as Me, Who has access: Anyone. Authorize (it asks for Drive).
//   4. Copy the web app URL into Heep (Map > Track storage) and send T3 setup again.
//
// What it stores: a folder "Jeep tracks" in your Drive with one CSV per trip (exactly the rows the T3 logged
// on its SD card) and index.json with each trip's summary. Nothing goes anywhere else.
//
// Requests are POSTs with a JSON body (text/plain), each carrying the key:
//   {"k","op":"part","id","p","rows","csv"}   the T3: one piece of a track (sending a piece again replaces it)
//   {"k","op":"fin","id","parts","rows","head","idx"}  the T3: all pieces sent; joined into <id>.csv only if every row arrived
//   {"k","op":"list"}                         Heep: every trip's summary
//   {"k","op":"get","id"}                     Heep: one trip's CSV
//   {"k","op":"del","id"}                     Heep: delete one trip's track
var KEY = 'PUT-YOUR-KEY-HERE';
var FOLDER = 'Jeep tracks';

function doPost(e) {
  var out;
  try {
    var b = JSON.parse(e.postData.contents);
    if (!KEY || KEY === 'PUT-YOUR-KEY-HERE' || b.k !== KEY) out = { ok: false, error: 'key' };
    else out = handle(b);
  } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return ContentService.createTextOutput(JSON.stringify({ ok: true, store: 'jeep-tracks', v: 1 })).setMimeType(ContentService.MimeType.JSON); }

function handle(b) {
  var id = String(b.id || '');
  if (b.op !== 'list' && !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return { ok: false, error: 'bad id' };
  var dir = folder();
  if (b.op === 'part') {
    var p = parseInt(b.p, 10), csv = String(b.csv || '');
    if (!(p >= 0 && p < 5000)) return { ok: false, error: 'bad part' };
    var n = csv.split('\n').filter(function (l) { return l.length > 0; }).length;
    if (n !== Number(b.rows)) return { ok: false, error: 'rows ' + n + ' != ' + b.rows };
    put(dir, id + '.p' + ('0000' + p).slice(-4) + '.part', csv);
    return { ok: true, rows: n };
  }
  if (b.op === 'fin') {
    var parts = parseInt(b.parts, 10), want = Number(b.rows), text = '', got = 0, files = [];
    for (var i = 0; i < parts; i++) {
      var f = find(dir, id + '.p' + ('0000' + i).slice(-4) + '.part');
      if (!f) return { ok: false, error: 'missing part ' + i };
      var c = f.getBlob().getDataAsString();
      got += c.split('\n').filter(function (l) { return l.length > 0; }).length;
      text += c; files.push(f);
    }
    if (got !== want) return { ok: false, error: 'rows ' + got + ' != ' + want };
    var csv = String(b.head || '') + '\n' + text;
    put(dir, id + '.csv', csv);
    files.forEach(function (f) { f.setTrashed(true); });
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { var idx = index(dir); idx[id] = summary(id, csv, String(b.idx || '')); saveIndex(dir, idx); } finally { lock.releaseLock(); }
    return { ok: true, rows: got };
  }
  if (b.op === 'list') {
    var all = index(dir), list = [];
    for (var k in all) list.push(all[k]);
    list.sort(function (a, c) { return (c.t0 || 0) - (a.t0 || 0); });
    return { ok: true, trips: list };
  }
  if (b.op === 'get') {
    var g = find(dir, id + '.csv');
    return g ? { ok: true, id: id, csv: g.getBlob().getDataAsString() } : { ok: false, error: 'no such trip' };
  }
  if (b.op === 'del') {
    var d = find(dir, id + '.csv');
    if (d) d.setTrashed(true);
    var lock2 = LockService.getScriptLock(); lock2.waitLock(20000);
    try { var ix = index(dir); delete ix[id]; saveIndex(dir, ix); } finally { lock2.releaseLock(); }
    return { ok: true };
  }
  return { ok: false, error: 'unknown op' };
}

// a trip's summary for the list: from the T3's index line and the track itself
function summary(id, csv, idxLine) {
  var lines = csv.split('\n'), head = lines[0].split(','), col = {};
  head.forEach(function (h, i) { col[h] = i; });
  var s = { id: id, pts: 0, fixes: 0, km: 0, t0: null, t1: null, vmax: 0, tmin: null, tmax: null, a0: null, a1: null, bbox: null };
  var prev = null;
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    var r = lines[i].split(','); s.pts++;
    var ms = Number(r[col.ms]) || null, lat = parseFloat(r[col.lat]), lon = parseFloat(r[col.lon]);
    if (ms) { if (!s.t0) s.t0 = ms; s.t1 = ms; }
    var ot = parseFloat(r[col.otemp]);
    if (!isNaN(ot)) { s.tmin = s.tmin == null ? ot : Math.min(s.tmin, ot); s.tmax = s.tmax == null ? ot : Math.max(s.tmax, ot); }
    var v = parseFloat(r[col.kmh]); if (!isNaN(v) && v > s.vmax) s.vmax = v;
    if (isNaN(lat) || isNaN(lon)) continue;
    s.fixes++;
    if (!s.a0) s.a0 = [lat, lon];
    s.a1 = [lat, lon];
    if (!s.bbox) s.bbox = [lat, lon, lat, lon];
    else { s.bbox[0] = Math.min(s.bbox[0], lat); s.bbox[1] = Math.min(s.bbox[1], lon); s.bbox[2] = Math.max(s.bbox[2], lat); s.bbox[3] = Math.max(s.bbox[3], lon); }
    var up = Number(r[col.up]);
    if (prev && up - prev.up < 30000 && !isNaN(v) && v > 2) { var d = dist(prev.lat, prev.lon, lat, lon); if (d < 1500) s.km += d / 1000; }
    prev = { lat: lat, lon: lon, up: up };
  }
  s.km = Math.round(s.km * 100) / 100;
  // the T3's own totals (odometer-style distance, fuel, seconds) from its index line
  var x = idxLine.split(',');
  if (x.length >= 8) { s.t3km = Number(x[3]) || 0; s.litres = Number(x[5]) || 0; s.secs = Number(x[6]) || 0; if (!s.t0 && Number(x[1])) s.t0 = Number(x[1]); if (!s.t1 && Number(x[2])) s.t1 = Number(x[2]); }
  return s;
}
function dist(a, b, c, d) {
  var r = 6371000, k = Math.PI / 180, x = (c - a) * k, y = (d - b) * k;
  var h = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * k) * Math.cos(c * k) * Math.sin(y / 2) * Math.sin(y / 2);
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function folder() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('folder');
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* gone: make a new one */ } }
  var it = DriveApp.getFoldersByName(FOLDER), dir = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
  props.setProperty('folder', dir.getId());
  return dir;
}
function find(dir, name) { var it = dir.getFilesByName(name); while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; } return null; }
function put(dir, name, text) { var f = find(dir, name); if (f) f.setContent(text); else dir.createFile(name, text, /\.csv$/.test(name) ? MimeType.CSV : MimeType.PLAIN_TEXT); }
function index(dir) { var f = find(dir, 'index.json'); try { return f ? JSON.parse(f.getBlob().getDataAsString()) : {}; } catch (e) { return {}; } }
function saveIndex(dir, idx) { put(dir, 'index.json', JSON.stringify(idx)); }
