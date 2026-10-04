// Box service worker: push notifications, the home-screen badge, and an
// offline copy of the app shell plus the last ideas you opened.
const CACHE = 'box-v1';
const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
    self.clients.claim(),
  ]));
});

// Network first, cache as the fallback: the shell, and GET reads of ideas,
// agents and uploads, so briefs and documents open on a plane.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api/events') return;
  const cacheable = SHELL.includes(url.pathname) || /^\/api\/(ideas|agents|crew|templates)(\/|$)/.test(url.pathname) || /^\/api\/uploads\//.test(url.pathname);
  if (!cacheable) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()).catch(() => {}); }
      return res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') return (await caches.match('/')) || Response.error();
      return new Response(JSON.stringify({ error: 'Offline: this was not saved on this device yet.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Box', body: event.data && event.data.text() }; }
  const title = data.title || 'Box';
  const options = {
    body: data.body || '',
    tag: data.tag || 'box',
    renotify: !data.silent,   // progress updates replace quietly; alerts re-buzz
    silent: !!data.silent,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: data.url || '/' },
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    setBadge(data.badge),
  ]));
});

async function setBadge(n) {
  try {
    if (!('setAppBadge' in self.navigator)) return;
    if (n > 0) await self.navigator.setAppBadge(n);
    else await self.navigator.clearAppBadge();
  } catch {}
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        if ('navigate' in c && c.url !== url) { try { await c.navigate(url); } catch {} }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'badge') setBadge(event.data.count);
});
