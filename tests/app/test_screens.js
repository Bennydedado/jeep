// test_screens.js - the app's screen format must match the T3's exactly (node tests/app/test_screens.js)
'use strict';
const fs = require('fs'), path = require('path');
const A = require('../../t3screens.js');
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
// the same default screens and field ids on both sides
const h = fs.readFileSync(path.join(__dirname, '../../firmware/T3/screens.h'), 'utf8');
const fw = [...h.slice(h.indexOf('DEFAULT_SCREENS[]')).matchAll(/^\s+"(.*)",$/gm)].map(m => m[1]);
ok(fw.length === A.DEFAULT_SCREENS.length, 'same number of default screens (' + fw.length + ' vs ' + A.DEFAULT_SCREENS.length + ')');
fw.forEach((s, i) => ok(s === A.DEFAULT_SCREENS[i], 'default screen ' + i + ' identical'));
const fh = fs.readFileSync(path.join(__dirname, '../../firmware/T3/fields.h'), 'utf8');
const fwIds = [...fh.matchAll(/\{ "([a-z0-9]+)", "/g)].map(m => m[1]);
ok(JSON.stringify(fwIds) === JSON.stringify(A.FIELDS.map(f => f.id)), 'same field ids in the same order');
// parse -> write round trip is exact for every default
for (const s of A.DEFAULT_SCREENS) { const once = A.writeScreen(A.parseScreen(s)); ok(A.writeScreen(A.parseScreen(once)) === once, 'round trip: ' + s.slice(0, 20)); }
// fingerprint matches the T3's FNV-1a (test_screens.cpp checks "abc" = 1a47e90b too)
ok(A.fnv1a('abc').toString(16) === '1a47e90b', 'fnv1a');
// unsafe text can't break the format
const sc = A.parseScreen('X|1|l,-,0,0,10,10,1,l,,0,0,ok');
sc.w[0].text = 'a|b,c\nd'; sc.name = 'N|a,me';
const out = A.writeScreen(sc);
ok(out.split('|').length === 3 && A.parseScreen(out).w[0].text === 'a b c d', 'separators stripped from text');
ok(JSON.stringify(A.parseBtnMap('next,end;;prev')) === JSON.stringify([['next', 'end'], ['mark', 'pause'], ['prev', 'end']]), 'button map with blanks keeps defaults');
console.log('test_screens.js: ' + n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
