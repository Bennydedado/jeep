// Keeps the app opening with no signal (gas stations up north). Your data never goes through here:
// calls to the sheet go straight to Google.
const CACHE = 'jeep-1.0.9';
const SHELL = ['./', 'index.html', 'app.css?v=1.0.9', 'core.js?v=1.0.9', 'ui.js?v=1.0.9', 'views.js?v=1.0.9', 'live.js?v=1.0.9', 'app.js?v=1.0.9',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  // only Heep's own old caches: the Listening app keeps its copy in the same place
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf('jeep-') === 0 && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.indexOf('/listen/') !== -1) return; // the Listening app has its own
  const key = e.request.mode === 'navigate' ? 'index.html' : e.request;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(key);
    const net = fetch(e.request).then(r => { if (r.ok && e.request.mode !== 'navigate') c.put(e.request, r.clone()); return r; });
    if (hit) { e.waitUntil(net.catch(() => null)); return hit; }
    return net.catch(() => c.match('index.html'));
  }));
});
