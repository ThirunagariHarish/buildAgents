// Pocket Box service worker: wake-up and Studio notifications, and an offline
// copy of the Runtime so agents still run on a plane.
const CACHE = 'pocket-v2';
const SHELL = ['/', '/runtime', '/app.js', '/app.css', '/runtime.js', '/agent-worker.js', '/agent-core.js', '/icon.svg', '/icon-180.png', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first; the cache only answers when the network can't.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (res.ok) { const c = await caches.open(CACHE); c.put(url.pathname, res.clone()).catch(() => {}); }
      return res;
    } catch {
      return (await caches.match(url.pathname)) || Response.error();
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Pocket Box', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Pocket Box', {
    body: data.body || '', tag: data.tag || 'pocketbox', renotify: true,
    icon: '/icon.svg', badge: '/icon.svg', data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const samePage = wins.find((w) => new URL(w.url).pathname === new URL(target).pathname);
    if (samePage) { await samePage.focus(); return samePage.navigate(target).catch(() => {}); }
    return self.clients.openWindow(target);
  })());
});
