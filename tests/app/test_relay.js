// test_relay.js - the relay formats both ends must agree on (node tests/app/test_relay.js):
//  T3 -> Heep: {"e": base64(12-byte nonce + AES-256-GCM ciphertext + 16-byte tag)}, key = SHA-256("heep-enc:" + sheet key)
//  Heep -> T3: {"n": ms, "m": command JSON, "h": hex HMAC-SHA256(sheet key, n + "|" + m)}
// The T3 side (net.ino) is mbedtls; here Node's crypto plays the T3, WebCrypto plays Heep (same calls as live.js / t3.js).
'use strict';
const nodeCrypto = require('crypto');
const { subtle } = globalThis.crypto;
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
(async () => {
  const sheetKey = '_4G6hVE6B8l0lbAJiQOyBiv6-test';
  // the T3 encrypts like relaySend()
  const key = nodeCrypto.createHash('sha256').update('heep-enc:' + sheetKey).digest();
  const iv = nodeCrypto.randomBytes(12);
  const line = '{"t":"live","kmh":87,"lat":56.246500,"lon":-120.847600,"ot":-12.5}';
  const c = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(line, 'utf8'), c.final()]);
  const wire = JSON.stringify({ e: Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64') });
  ok(!wire.includes('56.2') && !wire.includes('kmh'), 'nothing readable on the broker');
  // Heep opens it like relayOpen() in live.js
  const k = await subtle.importKey('raw', await subtle.digest('SHA-256', new TextEncoder().encode('heep-enc:' + sheetKey)), 'AES-GCM', false, ['decrypt']);
  const raw = Uint8Array.from(atob(JSON.parse(wire).e), ch => ch.charCodeAt(0));
  const plain = new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, k, raw.slice(12)));
  ok(plain === line, 'Heep reads exactly what the T3 sent');
  // a different key (someone else's T3, or a forged message) fails instead of showing junk
  const k2 = await subtle.importKey('raw', await subtle.digest('SHA-256', new TextEncoder().encode('heep-enc:other')), 'AES-GCM', false, ['decrypt']);
  let threw = false; try { await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, k2, raw.slice(12)); } catch (e) { threw = true; }
  ok(threw, 'wrong key rejected');
  // Heep signs a command like t3Send(); the T3 checks it like onRelay()
  const m = JSON.stringify({ c: 'page', i: 2 }), nonce = 1793125815000;
  const hk = await subtle.importKey('raw', new TextEncoder().encode(sheetKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = Buffer.from(await subtle.sign('HMAC', hk, new TextEncoder().encode(nonce + '|' + m))).toString('hex');
  const t3mac = nodeCrypto.createHmac('sha256', sheetKey).update(String(nonce) + '|' + m).digest('hex');
  ok(mac === t3mac && mac.length === 64, 'signature matches what the T3 computes');
  // the T3 pulls "m" back out of the wrapper with jStr(): quotes come back unescaped
  const wrapper = JSON.stringify({ n: nonce, m, h: mac });
  const i = wrapper.indexOf('"m":"') + 5; let out = '';
  for (let j = i; j < wrapper.length && wrapper[j] !== '"'; j++) { if (wrapper[j] === '\\') { j++; out += wrapper[j] === 'n' ? '\n' : wrapper[j]; } else out += wrapper[j]; }
  ok(out === m, 'T3 recovers the exact signed text');
  console.log('test_relay.js: ' + n + ' checks, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
