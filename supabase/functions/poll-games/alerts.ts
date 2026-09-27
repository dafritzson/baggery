// Sends the bag alerts that are due (private.bag_alerts, queued by the collect_bag trigger when a
// batting line's total bases go up). poll-games calls it after each poll.

import { bagAlert } from '../_shared/core/bag-alerts.ts';
import { bagParam } from '../_shared/core/bag-celebration.ts';
import { sql } from '../_shared/db.ts';
import { sendPush } from '../_shared/push.ts';

export async function sendBagAlerts(): Promise<number> {
  // Taken off the queue before sending, so a slow send can't go out twice. One that's long
  // overdue (the poller was down) is dropped instead: the moment has passed.
  const due = await sql`
    with taken as (
      delete from private.bag_alerts where send_at <= now()
      returning event_id, endpoint, fantasy_team_id, send_at
    )
    select s.endpoint, s.p256dh, s.auth, s.user_id,
           p.full_name as player, e.game_pk, e.mlb_player_id, e.tb, e.bags, e.singles, e.doubles, e.triples, e.hr,
           coalesce(t.name, 'Team ' || t.slot) as team, t.user_id as team_user_id,
           nullif(split_part(pr.display_name, ' ', 1), '') as manager
    from taken d
    join private.bag_events e on e.id = d.event_id
    join public.push_subscriptions s on s.endpoint = d.endpoint
    join public.mlb_players p on p.id = e.mlb_player_id
    join public.fantasy_teams t on t.id = d.fantasy_team_id
    left join public.profiles pr on pr.id = t.user_id
    where d.send_at > now() - interval '30 minutes'
    order by d.send_at`;

  let sent = 0;
  const gone = new Set<string>();
  const pending = [...due];
  // A few at a time, to keep the poll short.
  while (pending.length) {
    const results = await Promise.all(
      pending.splice(0, 10).map(async (row) => {
        const alert = bagAlert({
          player: row.player,
          bags: row.bags,
          singles: row.singles,
          doubles: row.doubles,
          triples: row.triples,
          hr: row.hr,
          team: row.team,
          manager: row.manager,
          yours: row.team_user_id === row.user_id,
        });
        // Tapping it opens the Games tab, which shows the bag's popup.
        const bag = bagParam({
          gamePk: row.game_pk,
          playerId: row.mlb_player_id,
          tb: row.tb,
          bags: row.bags,
          singles: row.singles,
          doubles: row.doubles,
          triples: row.triples,
          hr: row.hr,
        });
        const url = `/games?bag=${bag}`;
        const result = await sendPush(row as { endpoint: string; p256dh: string; auth: string }, { ...alert, url });
        if (result === 'gone') gone.add(row.endpoint);
        return result;
      }),
    );
    sent += results.filter((r) => r === 'sent').length;
  }
  if (gone.size) await sql`delete from public.push_subscriptions where endpoint in ${sql([...gone])}`;
  // Bags are kept a couple of days, so a stat correction and re-read doesn't alert again.
  await sql`delete from private.bag_events where created_at < now() - interval '2 days'`;
  return sent;
}
