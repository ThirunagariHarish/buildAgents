// Box service worker: shows push notifications and keeps the home-screen badge.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Box', body: event.data && event.data.text() }; }
  const title = data.title || 'Box';
  const options = {
    body: data.body || '',
    tag: data.tag || 'box',
    renotify: true,
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
