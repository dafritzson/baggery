// Baggery's service worker: shows bag alerts (web push from poll-games) and opens the app when
// one is tapped. It doesn't cache anything, so the app always loads fresh from the network.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let alert = {};
  try {
    alert = event.data ? event.data.json() : {};
  } catch {
    alert = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(alert.title || 'Baggery', {
      body: alert.body || '',
      icon: '/icon-192.png',
      // Android's status bar icon: only its shape shows.
      badge: '/badge-96.png',
      data: { url: alert.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ('navigate' in open) await open.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
