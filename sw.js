// Keeps the app opening with no signal (gas stations up north). Your data never goes through here:
// calls to the sheet go straight to Google, and map pictures (OpenStreetMap tiles) are left to the browser.
const CACHE = 'jeep-1.1.8';
const SHELL = ['./', 'index.html', 'app.css?v=1.1.8', 'core.js?v=1.1.8', 'ui.js?v=1.1.8', 'views.js?v=1.1.8', 'live.js?v=1.1.8', 'trips.js?v=1.1.8', 't3.js?v=1.1.8', 't3screens.js?v=1.1.8', 't3net.js?v=1.1.8', 'codes.js?v=1.1.8', 'map.js?v=1.1.8', 'app.js?v=1.1.8',
  'vendor/leaflet/leaflet.js?v=1.9.4', 'vendor/leaflet/leaflet.css?v=1.9.4',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  // only Heep's own old caches: the Listening app keeps its copy in the same place
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf('jeep-') === 0 && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.indexOf('/listen/') !== -1 || url.pathname.indexOf('/firmware/') !== -1) return; // the Listening app and the T3 install page have their own
  const key = e.request.mode === 'navigate' ? 'index.html' : e.request;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(key);
    const net = fetch(e.request).then(r => { if (r.ok && e.request.mode !== 'navigate') c.put(e.request, r.clone()); return r; });
    if (hit) { e.waitUntil(net.catch(() => null)); return hit; }
    return net.catch(() => c.match('index.html'));
  }));
});
