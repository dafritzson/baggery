// Web push: sends a notification to a browser's push subscription (RFC 8291 encryption, VAPID
// signing), for bag alerts. Works for Chrome and Firefox on Android and for Home Screen web apps
// on iPhone, whose push services all take the same request.

import * as webpush from 'jsr:@negrel/webpush@0.5.0';

import { sql } from './db.ts';
import type { Alert } from './core/bag-alerts.ts';

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The VAPID key pair, made the first time it's needed (private.push_keys). */
async function vapidKeys(): Promise<webpush.ExportedVapidKeys> {
  let [row] = await sql`select public_key, private_key from private.push_keys`;
  if (!row) {
    const keys = await webpush.exportVapidKeys(await webpush.generateVapidKeys({ extractable: true }));
    await sql`
      insert into private.push_keys (public_key, private_key)
      values (${sql.json(JSON.parse(JSON.stringify(keys.publicKey)))}, ${sql.json(JSON.parse(JSON.stringify(keys.privateKey)))})
      on conflict (id) do nothing`;
    // Another call may have made them first.
    [row] = await sql`select public_key, private_key from private.push_keys`;
  }
  return { publicKey: row.public_key, privateKey: row.private_key };
}

let keysPromise: Promise<CryptoKeyPair> | null = null;
function importedKeys(): Promise<CryptoKeyPair> {
  keysPromise ??= vapidKeys().then((k) => webpush.importVapidKeys(k)).catch((e) => {
    keysPromise = null;
    throw e;
  });
  return keysPromise;
}

/** The public key browsers subscribe with (applicationServerKey), base64url. */
export async function applicationServerKey(): Promise<string> {
  return webpush.exportApplicationServerKey(await importedKeys());
}

/** Push services browsers use. Subscriptions to anything else are refused. */
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

/**
 * Sends one notification. 'gone' means the browser dropped the subscription (turned alerts off,
 * cleared site data, removed the Home Screen app): delete it.
 */
export async function sendPush(sub: Subscription, alert: Alert & { url?: string }): Promise<'sent' | 'gone' | 'failed'> {
  // A fresh application server per message: its encryption key pair is only used once.
  const server = await webpush.ApplicationServer.new({
    // Apple's push service wants an https: or mailto: contact.
    contactInformation: Deno.env.get('SUPABASE_URL')!.replace(/^http:/, 'https:'),
    vapidKeys: await importedKeys(),
  });
  try {
    await server
      .subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } })
      // High urgency so Android delivers it now, not at the next battery-saving window; a short TTL
      // because a bag alert an hour late is worse than none.
      .pushTextMessage(JSON.stringify(alert), { urgency: webpush.Urgency.High, ttl: 300 });
    return 'sent';
  } catch (e) {
    if (e instanceof webpush.PushMessageError) {
      if ([404, 410].includes(e.response.status)) return 'gone';
      // The push service says why in the body (Apple: {"reason":"BadJwtToken"}, ...).
      console.error('push failed', new URL(sub.endpoint).host, e.toString(), await e.response.text().catch(() => ''));
    } else {
      console.error('push failed', new URL(sub.endpoint).host, e);
    }
    return 'failed';
  }
}
