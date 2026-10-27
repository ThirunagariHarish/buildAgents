// Jot service worker: reminder notifications, and the app shell offline.
const CACHE = 'jot-v1';
const SHELL = ['/', '/app.js', '/app.css', '/icons.js', '/install-banner.js', '/icon.svg', '/icon-180.png', '/icon-192.png', '/manifest.webmanifest', '/Geist-Variable.woff2', '/GeistMono-Variable.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })()); });
// Network first; the cache answers only when offline. Notes and pictures always come from the server.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    try { const res = await fetch(req, { cache: 'no-store' }); if (res.ok) { const c = await caches.open(CACHE); c.put(url.pathname, res.clone()).catch(() => {}); } return res; }
    catch { return (await caches.match(url.pathname)) || Response.error(); }
  })());
});
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Jot', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Jot', { body: d.body || '', tag: d.tag || 'jot', renotify: true, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins[0]) { await wins[0].focus(); return wins[0].navigate(target).catch(() => {}); }
    return self.clients.openWindow(target);
  })());
});
