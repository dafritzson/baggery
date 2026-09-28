// Draft alerts: "⏰ You're on the clock" to every device of the manager whose team just came up,
// that has draft alerts on (Settings). Sent right after the action that put them there commits.

import type { Turn } from '../_shared/core/draft.ts';
import { onTheClockAlert } from '../_shared/core/draft-alerts.ts';
import { sql } from '../_shared/db.ts';
import { type Subscription, sendPush } from '../_shared/push.ts';

export interface OnTheClock {
  userId: string;
  draftNumber: number;
  kind: 'initial' | 'redraft';
  turn: Turn;
}

export async function alertOnTheClock({ userId, draftNumber, kind, turn }: OnTheClock): Promise<void> {
  const subs = await sql<Subscription[]>`
    select endpoint, p256dh, auth from public.push_subscriptions where user_id = ${userId} and draft_alerts`;
  if (!subs.length) return;
  const [ghost] = turn.ghost
    ? await sql`select coalesce(name, 'Team ' || slot) as name from public.fantasy_teams where id = ${turn.teamId}`
    : [];
  const alert = onTheClockAlert({
    draftNumber,
    kind,
    round: turn.round,
    ghost: turn.ghost && { team: ghost?.name ?? 'the ghost', kind: turn.ghost.kind },
  });
  // Tapping it opens the draft room.
  const results = await Promise.all(subs.map((sub) => sendPush(sub, { ...alert, url: '/draft' })));
  const gone = subs.filter((_, i) => results[i] === 'gone').map((s) => s.endpoint);
  if (gone.length) await sql`delete from public.push_subscriptions where endpoint in ${sql(gone)}`;
}
