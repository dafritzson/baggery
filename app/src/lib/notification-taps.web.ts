// Tapped alerts: the service worker (public/sw.js) keeps the last tap in Cache Storage and tells the
// app, which goes to its link (a bag alert's shows the bag's celebration). Picked up from there when
// the app comes to the front as well as on the message, since a window woken from the background
// can miss the message, and the worker can't always navigate it.

import { type Href, router } from 'expo-router';
import { useEffect } from 'react';

const TAPS = 'baggery-taps';
const TAP = '/last-tap';
/** Older than this, a tap was left behind (the app wasn't opened): it's not acted on. */
const MAX_AGE_MS = 2 * 60 * 1000;

async function pickUpTap() {
  const cache = await caches.open(TAPS);
  const saved = await cache.match(TAP);
  if (!saved) return;
  await cache.delete(TAP);
  const tap: unknown = await saved.json();
  if (!tap || typeof tap !== 'object') return;
  const { url, at } = tap as { url?: unknown; at?: unknown };
  if (typeof url !== 'string' || !url.startsWith('/') || typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) return;
  router.navigate(url as Href);
}

/** Opens tapped alerts' links. Mounted once, in the signed-in app. */
export function useNotificationTaps() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('caches' in window)) return;
    const check = () => {
      if (document.visibilityState === 'visible') pickUpTap().catch(() => {});
    };
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'baggery-tap') check();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.startMessages();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    // Opened by the tap: the link is already the page's, and the bag celebrated once either way.
    check();
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
}
