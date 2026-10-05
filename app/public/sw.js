// Baggery's service worker: shows bag alerts (web push from poll-games) and opens the app when
// one is tapped. It doesn't cache the app, so the app always loads fresh from the network.

// The last tapped alert, kept until the app picks it up (lib/notification-taps).
const TAPS = 'baggery-taps';
const TAP = '/last-tap';

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
  const path = event.notification.data?.url || '/';
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      // Kept for the app to pick up as it comes to the front, so the tap opens its link (and a bag
      // alert its celebration) even when the message below is missed or the window can't be navigated.
      const cache = await caches.open(TAPS);
      await cache.put(TAP, new Response(JSON.stringify({ url: path, at: Date.now() })));
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (!open) {
        await self.clients.openWindow(url);
        return;
      }
      await open.focus().catch(() => {});
      open.postMessage({ type: 'baggery-tap' });
      // Still there a few seconds on: an app from before taps were picked up. Load the link instead.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if ((await cache.match(TAP)) && 'navigate' in open) await open.navigate(url).catch(() => {});
    })(),
  );
});
