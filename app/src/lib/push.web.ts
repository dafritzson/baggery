// Alerts on this device (bag, sub, cut, lineup and draft alerts), by web push: the service worker (public/sw.js) shows what
// poll-games and the draft function send. Works in Chrome and Firefox (Android and desktop) and, on iPhone, once Baggery is opened
// from the Home Screen (iOS 16.4+). The notifications Edge Function keeps each device's choices.

import { supabase, callFunction, invokeFunction } from '@/lib/supabase';

import type { Prefs, PushState } from './push';

export type { Prefs, PushState, Scope } from './push';

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhone or iPad Safari not opened from the Home Screen, where web push isn't available. */
function needsHomeScreen(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

let registration: Promise<ServiceWorkerRegistration> | null = null;
function worker(): Promise<ServiceWorkerRegistration> {
  registration ??= navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
  return registration;
}

let serverKey: Promise<string | null> | null = null;
/** The key to subscribe with, fetched ahead so the tap that turns alerts on goes straight to it. */
function publicKey(): Promise<string | null> {
  serverKey ??= invokeFunction<{ publicKey: string }>('notifications', { action: 'key' }).then(({ data }) => {
    if (!data) serverKey = null;
    return data?.publicKey ?? null;
  });
  return serverKey;
}

function base64UrlBytes(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export async function loadPushState(): Promise<PushState> {
  if (!supported()) return needsHomeScreen() ? { kind: 'install' } : { kind: 'unsupported' };
  if (Notification.permission === 'denied') return { kind: 'blocked' };
  void publicKey();
  const sub = await (await worker()).pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return { kind: 'off' };
  // Only the signed-in user's own row is readable: someone else's alerts on this browser show as off.
  const { data } = await supabase
    .from('push_subscriptions')
    .select('scope, delay_seconds, bag_alerts, sub_alerts, cut_alerts, lineup_alerts, draft_alerts')
    .eq('endpoint', sub.endpoint)
    .maybeSingle();
  return data
    ? {
        kind: 'on',
        scope: data.scope,
        delaySeconds: data.delay_seconds,
        bags: data.bag_alerts,
        subs: data.sub_alerts,
        cut: data.cut_alerts,
        lineups: data.lineup_alerts,
        draft: data.draft_alerts,
      }
    : { kind: 'off' };
}

/** This device's spoiler delay in seconds, or 0 with alerts off. Reads only the table, no function call. */
export async function pushDelaySeconds(): Promise<number> {
  if (!supported() || Notification.permission !== 'granted') return 0;
  const sub = await (await worker()).pushManager.getSubscription();
  if (!sub) return 0;
  const { data } = await supabase.from('push_subscriptions').select('delay_seconds').eq('endpoint', sub.endpoint).maybeSingle();
  return data?.delay_seconds ?? 0;
}

export async function savePush(prefs: Prefs): Promise<string | null> {
  if (!supported()) return "This browser can't show notifications.";
  // Asked first, straight from the tap: iPhone only shows the prompt in response to one.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return permission === 'denied'
      ? 'Notifications are blocked for Baggery. Allow them in your settings, then try again.'
      : 'Notifications weren’t allowed.';
  }
  const key = await publicKey();
  if (!key) return 'Couldn’t reach Baggery. Try again in a minute.';
  const keyBytes = base64UrlBytes(key);
  const push = (await worker()).pushManager;
  let sub = await push.getSubscription();
  // A subscription made with another key (a different Baggery, say) can't receive ours.
  if (sub && !sameKey(sub.options.applicationServerKey, keyBytes)) {
    await sub.unsubscribe();
    sub = null;
  }
  try {
    sub ??= await push.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
  } catch {
    return 'This browser wouldn’t turn on notifications.';
  }
  return callFunction('notifications', { action: 'subscribe', subscription: sub.toJSON(), ...prefs });
}

export async function turnOffPush(): Promise<string | null> {
  if (!supported()) return null;
  const sub = await (await worker()).pushManager.getSubscription();
  if (!sub) return null;
  const error = await callFunction('notifications', { action: 'unsubscribe', endpoint: sub.endpoint });
  if (error) return error;
  await sub.unsubscribe();
  return null;
}

export async function sendTestPush(): Promise<string | null> {
  const sub = supported() ? await (await worker()).pushManager.getSubscription() : null;
  if (!sub) return 'Alerts are off on this device.';
  return callFunction('notifications', { action: 'test', endpoint: sub.endpoint });
}
