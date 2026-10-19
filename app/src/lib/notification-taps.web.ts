// Tapped alerts: the service worker (public/sw.js) keeps the last tap in Cache Storage and tells the
// app, which goes to its link and, for a bag alert, hands its bag straight to the celebrations (not
// through the link's `?bag=`, which a navigation within the app can drop). The tap is looked for
// whenever the app comes to the front, and again every half second for a few seconds after: a
// window woken from the background can miss the worker's message, or come to the front before the
// worker has kept the tap, and the worker can't always navigate it.

import { type Href, router } from 'expo-router';
import { useEffect } from 'react';

import { tapBag } from '@/lib/bag-celebrations';

const TAPS = 'baggery-taps';
const TAP = '/last-tap';
/** Older than this, a tap was left behind (the app wasn't opened): it's not acted on. */
const MAX_AGE_MS = 2 * 60 * 1000;
/** How long after coming to the front the app keeps looking for a tap, and how often. */
const WATCH_MS = 6000;
const WATCH_EVERY_MS = 500;

async function pickUpTap() {
  const cache = await caches.open(TAPS);
  const saved = await cache.match(TAP);
  if (!saved) return;
  await cache.delete(TAP);
  const tap: unknown = await saved.json();
  if (!tap || typeof tap !== 'object') return;
  const { url, at } = tap as { url?: unknown; at?: unknown };
  if (typeof url !== 'string' || !url.startsWith('/') || typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) return;
  const link = new URL(url, window.location.origin);
  const bag = link.searchParams.get('bag');
  if (bag) {
    tapBag(bag);
    link.searchParams.delete('bag');
  }
  try {
    router.navigate(`${link.pathname}${link.search}` as Href);
  } catch {
    // Not ready to navigate: the bag still shows wherever the app is.
  }
}

/** Opens tapped alerts' links and shows their bags. Mounted once, in the signed-in app. */
export function useNotificationTaps() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('caches' in window)) return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      await pickUpTap().catch(() => {});
      busy = false;
    };
    let until = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const watch = () => {
      until = Date.now() + WATCH_MS;
      check();
      timer ??= setInterval(() => {
        if (Date.now() < until) return void check();
        clearInterval(timer!);
        timer = null;
      }, WATCH_EVERY_MS);
    };
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'baggery-tap') watch();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.startMessages();
    document.addEventListener('visibilitychange', watch);
    window.addEventListener('focus', watch);
    window.addEventListener('pageshow', watch);
    // Opened by the tap: the bag is in the link as well, and shown once either way.
    watch();
    return () => {
      if (timer) clearInterval(timer);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', watch);
      window.removeEventListener('focus', watch);
      window.removeEventListener('pageshow', watch);
    };
  }, []);
}
