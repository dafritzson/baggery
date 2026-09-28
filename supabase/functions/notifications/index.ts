// Alerts on this device (Settings): bag alerts, and sub, cut and lineup alerts with them, and draft
// alerts. poll-games sends the game alerts themselves, and the draft function the draft alerts.
//
// POST { action: 'key' }                          the public key browsers subscribe with.
// POST { action: 'subscribe', subscription, scope, delaySeconds, bags?, subs?, cut?, lineups?, draft? }
//                                                 signed in: saves this browser's subscription and
//                                                 its choices (also to change them). `scope` is
//                                                 whose game alerts: 'mine', 'league', or 'off'
//                                                 for draft alerts only. `bags`, `subs`, `cut`,
//                                                 `lineups` and `draft` turn each kind on or off;
//                                                 left out, they stay as they were (at first all
//                                                 on but lineup alerts).
// POST { action: 'unsubscribe', endpoint }        signed in: this browser's alerts are off.
// POST { action: 'test', endpoint }               signed in: sends this browser a test alert.

import { requireUser } from '../_shared/auth.ts';
import { testAlert } from '../_shared/core/bag-alerts.ts';
import { sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';
import { applicationServerKey, isPushEndpoint, sendPush } from '../_shared/push.ts';

const DELAYS = [0, 30, 60, 120];

interface Body {
  action?: string;
  subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  scope?: string;
  delaySeconds?: number;
  bags?: boolean;
  subs?: boolean;
  cut?: boolean;
  lineups?: boolean;
  draft?: boolean;
  endpoint?: string;
}

serve(async (req) => {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (body.action === 'key') return json({ publicKey: await applicationServerKey() });

  const userId = await requireUser(req);
  switch (body.action) {
    case 'subscribe': {
      const { endpoint, keys } = body.subscription ?? {};
      if (!endpoint || !isPushEndpoint(endpoint) || !keys?.p256dh || !keys?.auth) {
        throw new UserError("This browser's push subscription isn't one Baggery can send to.");
      }
      if (body.scope !== 'off' && body.scope !== 'mine' && body.scope !== 'league') {
        throw new UserError('Choose whose game alerts to get.');
      }
      const delay = body.delaySeconds ?? 0;
      if (!DELAYS.includes(delay)) throw new UserError('Choose a delay from the list.');
      const bags = typeof body.bags === 'boolean' ? body.bags : null;
      const subs = typeof body.subs === 'boolean' ? body.subs : null;
      const cut = typeof body.cut === 'boolean' ? body.cut : null;
      const lineups = typeof body.lineups === 'boolean' ? body.lineups : null;
      const draft = typeof body.draft === 'boolean' ? body.draft : null;
      // An endpoint belongs to one browser; whoever signs in there last gets its alerts.
      await sql`
        insert into push_subscriptions (endpoint, user_id, p256dh, auth, scope, delay_seconds, bag_alerts, sub_alerts, cut_alerts, lineup_alerts, draft_alerts)
        values (${endpoint}, ${userId}, ${keys.p256dh}, ${keys.auth}, ${body.scope}, ${delay},
                coalesce(${bags}::boolean, true), coalesce(${subs}::boolean, true), coalesce(${cut}::boolean, true), coalesce(${lineups}::boolean, false), coalesce(${draft}::boolean, true))
        on conflict (endpoint) do update set
          user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
          scope = excluded.scope, delay_seconds = excluded.delay_seconds,
          bag_alerts = coalesce(${bags}::boolean, push_subscriptions.bag_alerts),
          sub_alerts = coalesce(${subs}::boolean, push_subscriptions.sub_alerts),
          cut_alerts = coalesce(${cut}::boolean, push_subscriptions.cut_alerts),
          lineup_alerts = coalesce(${lineups}::boolean, push_subscriptions.lineup_alerts),
          draft_alerts = coalesce(${draft}::boolean, push_subscriptions.draft_alerts)`;
      return json({ ok: true });
    }

    case 'unsubscribe': {
      await sql`delete from push_subscriptions where endpoint = ${body.endpoint ?? ''} and user_id = ${userId}`;
      return json({ ok: true });
    }

    case 'test': {
      const [sub] = await sql`
        select endpoint, p256dh, auth, scope from push_subscriptions
        where endpoint = ${body.endpoint ?? ''} and user_id = ${userId}`;
      if (!sub) throw new UserError('Alerts are off on this device.');
      const result = await sendPush(sub as { endpoint: string; p256dh: string; auth: string }, {
        ...testAlert(sub.scope),
        url: '/settings',
      });
      if (result === 'gone') {
        await sql`delete from push_subscriptions where endpoint = ${sub.endpoint}`;
        throw new UserError('This device stopped accepting alerts. Turn them off and on again.');
      }
      if (result === 'failed') throw new UserError("The alert couldn't be sent. Try again in a minute.", 502);
      return json({ ok: true });
    }

    default:
      throw new UserError('Unknown action.');
  }
});
