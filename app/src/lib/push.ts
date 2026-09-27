// Alerts on this device (bag, sub and cut alerts): web push, so web only (push.web.ts). An iOS app
// would use expo-notifications; until then Settings doesn't offer them there.

export type Scope = 'mine' | 'league';

export interface Prefs {
  scope: Scope;
  delaySeconds: number;
  /** Sub alerts: 👀 a hitter came off the bench, 😠 one was replaced. */
  subs: boolean;
  /** Cut alerts: 🥵 on the hot seat, 😮‍💨 off the chopping block. */
  cut: boolean;
}

/**
 * What this device can do: `unsupported` (no web push), `install` (iPhone Safari: alerts need
 * Baggery opened from the Home Screen first), `blocked` (notifications denied in the browser or
 * phone settings), `off`, or `on` with its choices.
 */
export type PushState =
  | { kind: 'unsupported' }
  | { kind: 'install' }
  | { kind: 'blocked' }
  | { kind: 'off' }
  | ({ kind: 'on' } & Prefs);

export async function loadPushState(): Promise<PushState> {
  return { kind: 'unsupported' };
}

export async function pushDelaySeconds(): Promise<number> {
  return 0;
}

/** Turns alerts on (asking for permission) or changes their choices. Returns an error to show. */
export async function savePush(_prefs: Prefs): Promise<string | null> {
  return 'Alerts need the web app for now.';
}

export async function turnOffPush(): Promise<string | null> {
  return null;
}

export async function sendTestPush(): Promise<string | null> {
  return 'Alerts need the web app for now.';
}
