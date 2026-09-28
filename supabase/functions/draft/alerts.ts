// Draft alerts, sent right after the action that caused them commits, to devices with each kind
// on (Settings → Draft alerts): ⏰ on the clock, 📣 a draft started, 🤖 autodraft picked for you
// (off unless turned on) and ✅ a draft is done.

import type { Alert } from '../_shared/core/bag-alerts.ts';
import type { DraftKind, Turn } from '../_shared/core/draft.ts';
import { autopickAlert, draftDoneAlert, draftStartedAlert, onTheClockAlert } from '../_shared/core/draft-alerts.ts';
import { sql } from '../_shared/db.ts';
import { type Subscription, sendPush } from '../_shared/push.ts';

export type DraftNotice =
  | { type: 'on-the-clock'; userId: string; draftNumber: number; kind: DraftKind; turn: Turn }
  | {
      type: 'started';
      seasonId: string;
      draftNumber: number;
      /** Each manager's place in round 1. */
      slots: [string, number][];
      /** Who started it. */
      skip: string;
      /** Who's on the clock first: their on-the-clock alert says it already. */
      onClock: string | null;
    }
  | {
      type: 'autopick';
      userId: string;
      draftNumber: number;
      round: number;
      /** On a ghost turn, the ghost team the pick was for. */
      ghostTeamId: string | null;
      addPlayerId: number | null;
      dropPlayerId: number | null;
    }
  | { type: 'done'; seasonId: string; draftNumber: number; skip: string };

type Flag = 'draft_alerts' | 'draft_started_alerts' | 'autopick_alerts' | 'draft_done_alerts';

interface Device extends Subscription {
  user_id: string;
  draft_alerts: boolean;
}

/** The devices of these managers with this kind of alert on. */
async function devices(flag: Flag, userIds: string[]): Promise<Device[]> {
  if (!userIds.length) return [];
  return await sql<Device[]>`
    select endpoint, p256dh, auth, user_id, draft_alerts from public.push_subscriptions
    where ${sql(flag)} and user_id in ${sql(userIds)}`;
}

async function members(seasonId: string): Promise<string[]> {
  const rows = await sql`
    select m.user_id from public.league_members m join public.seasons s on s.league_id = m.league_id
    where s.id = ${seasonId}`;
  return rows.map((r) => r.user_id as string);
}

async function teamName(teamId: string): Promise<string> {
  const [row] = await sql`select coalesce(name, 'Team ' || slot) as name from public.fantasy_teams where id = ${teamId}`;
  return row?.name ?? 'the ghost';
}

async function playerName(id: number | null): Promise<string | null> {
  if (id === null) return null;
  const [row] = await sql`select full_name from public.mlb_players where id = ${id}`;
  return row?.full_name ?? 'a hitter';
}

/** The pushes a notice makes. */
async function pushes(n: DraftNotice): Promise<{ sub: Subscription; alert: Alert }[]> {
  switch (n.type) {
    case 'on-the-clock': {
      const subs = await devices('draft_alerts', [n.userId]);
      if (!subs.length) return [];
      const ghost = n.turn.ghost && { team: await teamName(n.turn.teamId), kind: n.turn.ghost.kind };
      const alert = onTheClockAlert({ draftNumber: n.draftNumber, kind: n.kind, round: n.turn.round, ghost });
      return subs.map((sub) => ({ sub, alert }));
    }
    case 'started': {
      const users = (await members(n.seasonId)).filter((u) => u !== n.skip);
      const slots = new Map(n.slots);
      return (await devices('draft_started_alerts', users))
        .filter((sub) => !(sub.user_id === n.onClock && sub.draft_alerts))
        .map((sub) => ({ sub, alert: draftStartedAlert(n.draftNumber, slots.get(sub.user_id) ?? null) }));
    }
    case 'autopick': {
      const subs = await devices('autopick_alerts', [n.userId]);
      if (!subs.length) return [];
      const alert = autopickAlert({
        draftNumber: n.draftNumber,
        round: n.round,
        player: await playerName(n.addPlayerId),
        dropped: await playerName(n.dropPlayerId),
        ghost: n.ghostTeamId ? await teamName(n.ghostTeamId) : undefined,
      });
      return subs.map((sub) => ({ sub, alert }));
    }
    case 'done': {
      const users = (await members(n.seasonId)).filter((u) => u !== n.skip);
      const alert = draftDoneAlert(n.draftNumber);
      return (await devices('draft_done_alerts', users)).map((sub) => ({ sub, alert }));
    }
  }
}

export async function sendDraftAlerts(notices: DraftNotice[]): Promise<void> {
  const items = (await Promise.all(notices.map(pushes))).flat();
  const gone = new Set<string>();
  // A few at a time; tapping one opens the draft room.
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    const results = await Promise.all(batch.map(({ sub, alert }) => sendPush(sub, { ...alert, url: '/draft' })));
    results.forEach((r, j) => r === 'gone' && gone.add(batch[j].sub.endpoint));
  }
  if (gone.size) await sql`delete from public.push_subscriptions where endpoint in ${sql([...gone])}`;
}
