// Push notifications. Bag alerts are queued by the collect_bag trigger when a batting line's total
// bases go up (private.bag_alerts); sub alerts by saveGame from each box score it reads, and cut
// alerts after each game of the round ends, lineup alerts from each schedule read, and stat
// correction alerts from the scoring changes the collect_correction trigger records (all
// private.push_queue). poll-games sends the ones that are due after each poll.

import { bagAlert } from '../_shared/core/bag-alerts.ts';
import { bagParam } from '../_shared/core/bag-celebration.ts';
import { type LineupHitter, correctionAlert, cutAlert, cutFlips, cutSpots, lineupAlert, lineupNews, scratchAlert, subAlert } from '../_shared/core/game-alerts.ts';
import { facesCut } from '../_shared/core/scoring.ts';
import type { FantasyRound } from '../_shared/core/types.ts';
import { type Tx, sql } from '../_shared/db.ts';
import { type Subscription, sendPush } from '../_shared/push.ts';
import { roundGameTypes, roundRanking } from '../_shared/round-ranking.ts';
import type { LineupChange, LineupRow } from './feed.ts';

/** A queued alert, due after its subscription's spoiler delay. */
interface Queued {
  endpoint: string;
  send_at: Date;
  title: string;
  body: string;
  url: string;
}

/** Sends alerts a few at a time, to keep the poll short, and forgets devices that have gone. */
async function sendAll(items: { sub: Subscription; alert: { title: string; body: string; url: string } }[]): Promise<number> {
  let sent = 0;
  const gone = new Set<string>();
  const pending = [...items];
  while (pending.length) {
    const results = await Promise.all(
      pending.splice(0, 10).map(async ({ sub, alert }) => {
        const result = await sendPush(sub, alert);
        if (result === 'gone') gone.add(sub.endpoint);
        return result;
      }),
    );
    sent += results.filter((r) => r === 'sent').length;
  }
  if (gone.size) await sql`delete from public.push_subscriptions where endpoint in ${sql([...gone])}`;
  return sent;
}

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

  const sent = await sendAll(
    due.map((row) => {
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
      return { sub: row as unknown as Subscription, alert: { ...alert, url: `/games?bag=${bag}` } };
    }),
  );
  // Bags are kept a couple of days, so a stat correction and re-read doesn't alert again.
  await sql`delete from private.bag_events where created_at < now() - interval '2 days'`;
  return sent;
}

/** Sends the sub and cut alerts that are due (private.push_queue). */
export async function sendQueuedAlerts(): Promise<number> {
  const due = await sql`
    with taken as (
      delete from private.push_queue where send_at <= now()
      returning endpoint, send_at, title, body, url
    )
    select s.endpoint, s.p256dh, s.auth, d.title, d.body, d.url
    from taken d
    join public.push_subscriptions s using (endpoint)
    where d.send_at > now() - interval '30 minutes'
    order by d.send_at`;
  const sent = await sendAll(
    due.map((row) => ({ sub: row as unknown as Subscription, alert: { title: row.title, body: row.body, url: row.url } })),
  );
  await sql`delete from private.lineup_events where created_at < now() - interval '2 days'`;
  return sent;
}

/**
 * Queues sub alerts for a box score's lineup changes (feed.ts boxscoreSubs): each drafted hitter's
 * change once, while the game is on or just finished, like bag alerts. Returns how many it queued.
 */
export async function queueSubAlerts(gamePk: number, changes: LineupChange[]): Promise<number> {
  if (!changes.length) return 0;
  // The changes of hitters on a roster (in a season played in the app) when the game started,
  // not alerted yet, and every subscription that wants them.
  const rows = await sql`
    with game as (
      select start_time from public.mlb_games
      where game_pk = ${gamePk}
        and (status = 'Live' or (status = 'Final' and final_seen_at > now() - interval '20 minutes'))
    ),
    changes as (
      select * from unnest(${changes.map((c) => c.mlb_player_id)}::int[], ${changes.map((c) => c.kind)}::text[])
        as c (mlb_player_id, kind)
    ),
    fresh as (
      insert into private.lineup_events (game_pk, mlb_player_id, kind)
      select ${gamePk}, c.mlb_player_id, c.kind from changes c, game g
      where exists (
        select 1 from public.roster_spells r
        join public.seasons se on se.id = r.season_id and se.imported_at is null
        where r.mlb_player_id = c.mlb_player_id
          and r.from_at <= g.start_time and (r.to_at is null or g.start_time < r.to_at))
      on conflict do nothing
      returning mlb_player_id, kind
    )
    select f.mlb_player_id, f.kind, s.endpoint, s.user_id, s.delay_seconds,
           coalesce(t.name, 'Team ' || t.slot) as team, t.user_id as team_user_id,
           nullif(split_part(pr.display_name, ' ', 1), '') as manager
    from fresh f
    cross join game g
    join public.roster_spells r
      on r.mlb_player_id = f.mlb_player_id and r.from_at <= g.start_time and (r.to_at is null or g.start_time < r.to_at)
    join public.seasons se on se.id = r.season_id and se.imported_at is null
    join public.fantasy_teams t on t.id = r.fantasy_team_id and t.eliminated_after_round is null
    join public.push_subscriptions s
      on s.sub_alerts
     and ((s.scope = 'mine' and s.user_id = t.user_id)
          or (s.scope = 'league' and exists (
            select 1 from public.league_members m where m.league_id = se.league_id and m.user_id = s.user_id)))
    left join public.profiles pr on pr.id = t.user_id`;
  const byChange = new Map(changes.map((c) => [`${c.mlb_player_id}:${c.kind}`, c]));
  // Tapping one opens the Games tab.
  return queue(
    rows.map((row) => {
      const c = byChange.get(`${row.mlb_player_id}:${row.kind}`)!;
      const alert = subAlert({
        player: c.full_name,
        kind: c.kind,
        position: c.position,
        replacement: c.replacement,
        team: row.team,
        manager: row.manager,
        yours: row.team_user_id === row.user_id,
      });
      return { ...alert, endpoint: row.endpoint, send_at: dueAt(row.delay_seconds), url: '/games' };
    }),
  );
}

/**
 * Queues cut alerts: once each game of the round being played has its final box score (read again
 * ~10 minutes after it ends), the teams that crossed the cut line since the last such check. The
 * round's first check only records where everyone stands. Returns how many it queued.
 */
export async function queueCutAlerts(): Promise<number> {
  return await sql.begin(async (tx) => {
    const [season] = await tx<{ id: string; year: number; league_id: string; survivors_after_round: number[] }[]>`
      select id, year, league_id, survivors_after_round from public.seasons
      where imported_at is null and status <> 'complete'
      order by year desc limit 1`;
    if (!season) return 0;
    const teams = await tx`select id, eliminated_after_round, is_ghost from public.fantasy_teams where season_id = ${season.id}`;
    const round = ([1, 2, 3] as FantasyRound[]).find((r) => !teams.some((t) => t.eliminated_after_round === r));
    if (!round) return 0;
    const ended = await tx`
      select g.game_pk from public.mlb_games g
      join private.box_reads b using (game_pk)
      where g.season_year = ${season.year} and g.game_type in ${tx(roundGameTypes(round))} and g.status = 'Final'
        and g.final_seen_at > now() - interval '6 hours' and b.read_at > g.final_seen_at + interval '5 minutes'
        and not exists (select 1 from private.cut_checks c where c.game_pk = g.game_pk)`;
    if (!ended.length) return 0;
    await tx`insert into private.cut_checks ${tx(ended.map((g) => ({ game_pk: g.game_pk })), 'game_pk')} on conflict do nothing`;

    // The ghost team only faces a cut in round 3.
    const alive = teams.filter((t) => t.eliminated_after_round === null && facesCut({ isGhost: t.is_ghost }, round)).map((t) => t.id as string);
    if (!alive.length) return 0;
    const survivors = season.survivors_after_round[round - 1] ?? 1;
    const spots = cutSpots(await roundRanking(tx, season, round, alive), survivors);
    const before = await tx`select fantasy_team_id, danger from private.cut_standings where round = ${round}`;
    const flips = cutFlips(new Map(before.map((r) => [r.fantasy_team_id as string, r.danger as boolean])), spots);
    await tx`
      insert into private.cut_standings ${tx(spots.map((s) => ({ fantasy_team_id: s.teamId, round, danger: s.danger })), 'fantasy_team_id', 'round', 'danger')}
      on conflict (fantasy_team_id, round) do update set danger = excluded.danger, updated_at = now()
      where private.cut_standings.danger <> excluded.danger`;
    if (!flips.length) return 0;

    const rows = await tx`
      select t.id as team_id, coalesce(t.name, 'Team ' || t.slot) as team, t.user_id as team_user_id,
             nullif(split_part(pr.display_name, ' ', 1), '') as manager,
             s.endpoint, s.user_id, s.delay_seconds
      from public.fantasy_teams t
      join public.push_subscriptions s
        on s.cut_alerts
       and ((s.scope = 'mine' and s.user_id = t.user_id)
            or (s.scope = 'league' and exists (
              select 1 from public.league_members m where m.league_id = ${season.league_id} and m.user_id = s.user_id)))
      left join public.profiles pr on pr.id = t.user_id
      where t.id in ${tx(flips.map((f) => f.teamId))}`;
    const byTeam = new Map(flips.map((f) => [f.teamId, f]));
    // Tapping one opens the Standings.
    return queue(
      rows.map((row) => {
        const alert = cutAlert({
          ...byTeam.get(row.team_id)!,
          survivors: Math.min(survivors, alive.length),
          team: row.team,
          manager: row.manager,
          yours: row.team_user_id === row.user_id,
        });
        return { ...alert, endpoint: row.endpoint, send_at: dueAt(row.delay_seconds), url: '/standings' };
      }),
      tx,
    );
  });
}

/**
 * Queues lineup alerts from the schedule's posted lineups (feed.ts scheduleLineups), for games not
 * started yet that start within a day. A lineup seen for the first time names every drafted hitter
 * of that MLB team: his spot, or the bench. A later change names the drafted hitters it dropped.
 * Returns how many it queued.
 */
export async function queueLineupAlerts(lineups: LineupRow[]): Promise<number> {
  if (!lineups.length) return 0;
  return await sql.begin(async (tx) => {
    const upcoming = await tx`
      select game_pk from public.mlb_games
      where game_pk in ${tx([...new Set(lineups.map((l) => l.game_pk))])}
        and status = 'Preview' and not start_time_tbd and start_time < now() + interval '1 day'`;
    const open = new Set(upcoming.map((g) => g.game_pk as number));
    const key = (l: { game_pk: number; mlb_team_id: number }) => `${l.game_pk}:${l.mlb_team_id}`;
    const before = open.size
      ? await tx`select game_pk, mlb_team_id, player_ids from private.lineups where game_pk in ${tx([...open])}`
      : [];
    const seen = new Map(before.map((r) => [key(r as unknown as LineupRow), r.player_ids as number[]]));
    const changed = lineups.filter((l) => open.has(l.game_pk) && seen.get(key(l))?.join() !== l.player_ids.join());
    if (!changed.length) return 0;
    await tx`
      insert into private.lineups ${tx(changed, 'game_pk', 'mlb_team_id', 'player_ids')}
      on conflict (game_pk, mlb_team_id) do update set player_ids = excluded.player_ids, updated_at = now()`;

    // Every drafted hitter (on a team still alive, in a season played in the app) of the MLB teams
    // whose lineups changed, and every subscription that wants his team's alerts.
    const rows = await tx`
      select c.game_pk, c.mlb_team_id, mt.name as mlb_team, p.mlb_player_id, pl.full_name as player,
             p.injured_list is not null as injured,
             coalesce(t.name, 'Team ' || t.slot) as team, t.user_id as team_user_id,
             nullif(split_part(pr.display_name, ' ', 1), '') as manager,
             s.endpoint, s.user_id, s.delay_seconds
      from unnest(${changed.map((l) => l.game_pk)}::int[], ${changed.map((l) => l.mlb_team_id)}::int[]) as c (game_pk, mlb_team_id)
      join public.mlb_games g on g.game_pk = c.game_pk
      join public.mlb_teams mt on mt.id = c.mlb_team_id
      join public.seasons se on se.year = g.season_year and se.imported_at is null
      join public.season_player_pool p on p.season_id = se.id and p.mlb_team_id = c.mlb_team_id
      join public.roster_spells r
        on r.season_id = se.id and r.mlb_player_id = p.mlb_player_id
       and r.from_at <= g.start_time and (r.to_at is null or g.start_time < r.to_at)
      join public.fantasy_teams t on t.id = r.fantasy_team_id and t.eliminated_after_round is null
      join public.mlb_players pl on pl.id = p.mlb_player_id
      join public.push_subscriptions s
        on s.lineup_alerts
       and ((s.scope = 'mine' and s.user_id = t.user_id)
            or (s.scope = 'league' and exists (
              select 1 from public.league_members m where m.league_id = se.league_id and m.user_id = s.user_id)))
      left join public.profiles pr on pr.id = t.user_id`;

    const byKey = new Map(changed.map((l) => [key(l), { lineup: l.player_ids, ...lineupNews(seen.get(key(l)), l.player_ids) }]));
    const alerts: Queued[] = [];
    // A posted lineup: one alert per device and lineup, naming all its drafted hitters.
    const posted = new Map<string, { endpoint: string; delay: number; mlbTeam: string; hitters: LineupHitter[] }>();
    for (const row of rows) {
      const news = byKey.get(key(row as unknown as LineupRow))!;
      const yours = row.team_user_id === row.user_id;
      if (news.posted) {
        const k = `${row.endpoint}|${key(row as unknown as LineupRow)}`;
        const entry = posted.get(k) ?? { endpoint: row.endpoint, delay: row.delay_seconds, mlbTeam: row.mlb_team, hitters: [] as LineupHitter[] };
        const i = news.lineup.indexOf(row.mlb_player_id);
        entry.hitters.push({
          player: row.player,
          spot: i < 0 ? null : i + 1,
          injured: row.injured,
          owner: yours ? null : (row.manager ?? row.team),
        });
        posted.set(k, entry);
      } else if (news.scratched.includes(row.mlb_player_id)) {
        const alert = scratchAlert(row.player, row.mlb_team, { team: row.team, manager: row.manager, yours });
        alerts.push({ ...alert, endpoint: row.endpoint, send_at: dueAt(row.delay_seconds), url: '/games' });
      }
    }
    for (const p of posted.values()) {
      alerts.push({ ...lineupAlert(p.mlbTeam, p.hitters), endpoint: p.endpoint, send_at: dueAt(p.delay), url: '/games' });
    }
    // Tapping one opens the Games tab.
    return queue(alerts, tx);
  });
}

/**
 * Queues stat correction alerts for the scoring changes the collect_correction trigger recorded
 * (private.stat_corrections): a drafted hitter's total bases moved in a game on now or finished
 * within 6 hours. Goes to the team whose roster had him when the game started, while it's alive
 * or was knocked out in that game's round (a change can come in after the round closes). Returns
 * how many it queued.
 */
export async function queueCorrectionAlerts(): Promise<number> {
  return await sql.begin(async (tx) => {
    const rows = await tx`
      with taken as (
        delete from private.stat_corrections
        returning id, game_pk, mlb_player_id, old_h, old_doubles, old_triples, old_hr, h, doubles, triples, hr
      )
      select c.*, p.full_name as player,
             coalesce(t.name, 'Team ' || t.slot) as team, t.user_id as team_user_id,
             nullif(split_part(pr.display_name, ' ', 1), '') as manager,
             s.endpoint, s.user_id, s.delay_seconds
      from taken c
      join public.mlb_games g on g.game_pk = c.game_pk
      join public.mlb_players p on p.id = c.mlb_player_id
      join public.roster_spells r
        on r.mlb_player_id = c.mlb_player_id and r.from_at <= g.start_time and (r.to_at is null or g.start_time < r.to_at)
      join public.seasons se on se.id = r.season_id and se.imported_at is null
      join public.fantasy_teams t
        on t.id = r.fantasy_team_id
       and (t.eliminated_after_round is null
            or t.eliminated_after_round >= case g.game_type when 'L' then 2 when 'W' then 3 else 1 end)
      join public.push_subscriptions s
        on s.correction_alerts
       and ((s.scope = 'mine' and s.user_id = t.user_id)
            or (s.scope = 'league' and exists (
              select 1 from public.league_members m where m.league_id = se.league_id and m.user_id = s.user_id)))
      left join public.profiles pr on pr.id = t.user_id
      order by c.id`;
    const hits = (h: number, doubles: number, triples: number, hr: number) => ({ singles: h - doubles - triples - hr, doubles, triples, hr });
    // Tapping one opens the Games tab.
    return queue(
      rows.map((row) => {
        const alert = correctionAlert({
          player: row.player,
          before: hits(row.old_h, row.old_doubles, row.old_triples, row.old_hr),
          after: hits(row.h, row.doubles, row.triples, row.hr),
          team: row.team,
          manager: row.manager,
          yours: row.team_user_id === row.user_id,
        });
        return { ...alert, endpoint: row.endpoint, send_at: dueAt(row.delay_seconds), url: '/games' };
      }),
      tx,
    );
  });
}

function dueAt(delaySeconds: number): Date {
  return new Date(Date.now() + delaySeconds * 1000);
}

async function queue(alerts: Queued[], db: Tx | typeof sql = sql): Promise<number> {
  if (!alerts.length) return 0;
  await db`insert into private.push_queue ${db(alerts, 'endpoint', 'send_at', 'title', 'body', 'url')}`;
  return alerts.length;
}
