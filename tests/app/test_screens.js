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
ok(JSON.stringify(A.parseBtnMap('next,end;;prev')) === JSON.stringify([['next', 'end'], ['mark', 'menu'], ['prev', 'end']]), 'button map with blanks keeps defaults');
const t3h = fs.readFileSync(path.join(__dirname, '../../firmware/T3/settings.ino'), 'utf8');
ok(t3h.includes('p.getString("bm", "prev,home;mark,menu;next,end")'), 'same default T3 button map as the T3');
// right wheel buttons: Heep's tokens and default are the Nano's (WheelMap.h) and the T3's
const wm = fs.readFileSync(path.join(__dirname, '../../nano/NanoT3Example/WheelMap.h'), 'utf8');
const nanoTokens = [...wm.matchAll(/\{ "([A-Z0-9+\-]{2})", WA_/g)].map(m => m[1]).sort();
const heepTokens = ['V+', 'V-', 'MU', 'PP', 'NX', 'PV', 'SR', 'SI', 'AN', 'HU', 'HB', 'T1', 'T2', 'T3', '--'].filter(t => A.writeWheelMap(A.parseWheelMap(t + ',--;AN,HU;V-,V-')).startsWith(t + ',')).sort();
ok(nanoTokens.length === 15 && JSON.stringify(nanoTokens) === JSON.stringify(heepTokens), 'same right-button tokens as the Nano: ' + nanoTokens.join(' '));
ok(wm.includes('#define WCFG_DEFAULT "' + A.WHEEL_DEFAULT + '"'), 'same default Nano settings as the Nano');
const st = fs.readFileSync(path.join(__dirname, '../../firmware/T3/settings.ino'), 'utf8');
ok(st.includes('p.getString("wb", "' + A.WHEEL_DEFAULT + '")'), 'same default map as the T3');
ok(A.writeWheelMap(A.parseWheelMap('K89,--;T2,HB;NX,PV')) === 'K89,--;T2,HB;NX,PV', 'custom Kenwood code kept');
const RDEF = A.WHEEL_DEFAULT.split('|')[0];
ok(A.writeWheelMap(A.parseWheelMap('K8G,--;T2,HB;NX,PV')) === RDEF && A.writeWheelMap(A.parseWheelMap('V+,V+;AN')) === RDEF, 'bad maps fall back to the default');
ok(A.writeNanoCfg(A.parseNanoCfg('V+,V+;AN,HU;V-,V-')) === A.WHEEL_DEFAULT, '1.1.13 settings (right buttons only) grow the defaults');
const full = 'PP,--;AN,HU;K5E,V-|MU,NX,PV,HB|01|8992';
ok(A.writeNanoCfg(A.parseNanoCfg(full)) === full, 'full Nano settings round trip');
for (const o of ['0101', '0111', '011']) { const t = 'V+,V+;AN,HU;V-,V-|PP,NX,PV,SI|' + o + '|FFFF'; ok(A.writeNanoCfg(A.parseNanoCfg(t)) === t, 'options ' + o + ' round trip'); }
ok(A.parseNanoCfg('V+,V+;AN,HU;V-,V-|PP,NX,PV,SI|1101|FFFF').quickMode, 'tap, hold option read');
const c2 = A.parseNanoCfg(full); ok(!c2.lmidBeams && c2.lmidMode && c2.answer === '89' && c2.hangup === '92' && c2.pedal[3] === 'HB', 'Nano settings read right');
ok(A.writeNanoCfg(A.parseNanoCfg('V+,V+;AN,HU;V-,V-|PP,NX|11|FFFF')) === A.WHEEL_DEFAULT, 'a broken pedal part keeps the default pedal');
ok(A.WHEEL_DEFAULT.length <= 64 && 'K8A,K8B;K8C,K8D;K8E,K8F|K90,K91,K92,K93|11|FFFF'.length <= 64, 'fits the Nano and T3 (64)');
ok(A.KENWOOD_NAMES['14'] === 'Volume +' && A.KENWOOD_NAMES['8B'] === 'Siri', 'known Kenwood codes named');
// the preview cuts labels exactly like the T3 (see test_screens.cpp)
ok(A.fitLabel('Peak boost', 40) === 'Peak' && A.fitLabel('Peak boost', 52) === 'Peak' && A.fitLabel('Peak boost', 80) === 'Peak boost', 'peak boost label fits');
ok(A.fitLabel('Satellites', 30) === 'Sate' && A.fitLabel('RPM', 38) === 'RPM' && A.fitLabel('Coolant', 10) === '', 'labels cut like the T3');
ok(JSON.stringify(A.parseBv('5,100,200')) === '[5,100,200]' && JSON.stringify(A.parseBv('5,900,1')) === '[1,70,255]', 'brightness levels read, bad ones fall back');
const sti = fs.readFileSync(path.join(__dirname, '../../firmware/T3/settings.ino'), 'utf8');
ok(sti.includes('p.getString("bv", "1,70,255")'), 'same default levels as the T3');
console.log('test_screens.js: ' + n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
