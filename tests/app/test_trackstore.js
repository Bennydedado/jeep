// test_trackstore.js - tracks/TrackStore.gs against a pretend Google Drive (node tests/app/test_trackstore.js)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
// --- a tiny in-memory Drive
const files = [];
const mkFile = (name, text) => { const f = { name, text, trashed: false, getBlob: () => ({ getDataAsString: () => f.text }), setContent: t => { f.text = t; }, setTrashed: v => { f.trashed = v; }, isTrashed: () => f.trashed, getName: () => name }; files.push(f); return f; };
const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
const folder = { getId: () => 'F1', isTrashed: () => false, createFile: (name, text) => mkFile(name, text), getFilesByName: name => iter(files.filter(f => f.name === name && !f.trashed)) };
const props = {};
const ctx = {
  DriveApp: { getFolderById: () => folder, getFoldersByName: () => iter([]), createFolder: () => folder },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
  MimeType: { CSV: 'text/csv', PLAIN_TEXT: 'text/plain' },
  JSON, Math, Number, String, parseInt, parseFloat, isNaN,
};
vm.createContext(ctx);
const code = fs.readFileSync(path.join(__dirname, '../../tracks/TrackStore.gs'), 'utf8').replace("var KEY = 'PUT-YOUR-KEY-HERE';", "var KEY = 'k123';");
vm.runInContext(code, ctx);
const call = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }));

const T = require('../../trips.js');
const csv = T.sampleTrack(2, 1.79e12);
const lines = csv.split('\n'), head = lines[0], rows = lines.slice(1);
// the T3 sends 200 rows a part, exactly as net.ino does
ok(call({ k: 'wrong', op: 'list' }).error === 'key', 'wrong key refused');
ok(call({ k: 'k123', op: 'part', id: '../evil', p: 0, rows: 1, csv: 'x\n' }).error === 'bad id', 'odd ids refused');
const parts = [];
for (let i = 0; i < rows.length; i += 200) parts.push(rows.slice(i, i + 200));
ok(call({ k: 'k123', op: 'part', id: 't5-1', p: 0, rows: 199, csv: parts[0].join('\n') + '\n' }).ok === false, 'row count checked');
// finishing before every part arrived fails and keeps nothing
ok(/missing part/.test(call({ k: 'k123', op: 'fin', id: 't5-1', parts: parts.length, rows: rows.length, head, idx: '' }).error), 'missing parts noticed');
parts.forEach((p, i) => ok(call({ k: 'k123', op: 'part', id: 't5-1', p: i, rows: p.length, csv: p.join('\n') + '\n' }).ok, 'part ' + i));
// a resend of a part replaces it (no duplicates)
ok(call({ k: 'k123', op: 'part', id: 't5-1', p: 1, rows: parts[1].length, csv: parts[1].join('\n') + '\n' }).ok, 'resend ok');
const fin = call({ k: 'k123', op: 'fin', id: 't5-1', parts: parts.length, rows: rows.length, head, idx: '"t5-1",1790000000000,1790001300000,20.10,20.05,2.10,1300,91,56.2,-120.6,56.3,-120.4' });
ok(fin.ok && fin.rows === rows.length, 'finished with every row (' + fin.rows + ')');
ok(files.filter(f => /\.part$/.test(f.name) && !f.trashed).length === 0, 'parts tidied away');
const list = call({ k: 'k123', op: 'list' });
ok(list.ok && list.trips.length === 1 && list.trips[0].id === 't5-1', 'listed');
const s = list.trips[0], local = T.tripStats(T.parseTrack(csv).rows);
ok(Math.abs(s.km - local.km) < 0.5, 'store and Heep agree on distance (' + s.km + ' vs ' + local.km.toFixed(2) + ')');
ok(s.t3km === 20.1 && s.litres === 2.1, 'T3 totals kept');
const got = call({ k: 'k123', op: 'get', id: 't5-1' });
ok(got.ok && got.csv.trim() === csv.trim(), 'download is exactly what the T3 logged');
ok(call({ k: 'k123', op: 'del', id: 't5-1' }).ok && call({ k: 'k123', op: 'list' }).trips.length === 0, 'deleted');
console.log('test_trackstore.js: ' + n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
