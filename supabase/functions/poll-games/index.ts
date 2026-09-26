// Mirrors postseason games and box scores from the MLB Stats API into mlb_games and
// player_game_stats, which the standings are scored from.
//
// POST {}                    from pg_cron (x-poller-secret header): polls the latest season's
//                            games. The cron job calls every 10 seconds while there's something to
//                            fetch (private.poll_due): live games every call, the schedule every
//                            minute while games are on (10 otherwise), finished games every 10.
// POST { setup: true }       from the deploy: records this function's URL for the cron job.
// POST { seasonId }          commissioner: reloads every game of that season's postseason.

import { requireCommissioner, requireUser } from '../_shared/auth.ts';
import { sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';
import { boxscoreBatting, linescoreLive, linescoreRuns, scheduleGames } from './feed.ts';

const MLB = 'https://statsapi.mlb.com/api/v1';
const LEAGUES: Record<number, 'AL' | 'NL'> = { 103: 'AL', 104: 'NL' };

// deno-lint-ignore no-explicit-any
async function mlb(path: string): Promise<any> {
  const res = await fetch(`${MLB}${path}`);
  if (!res.ok) throw new Error(`MLB API ${res.status} for ${path}`);
  return res.json();
}

/** MLB team ids we have rows for, loading all teams first if the table isn't filled in yet. */
async function knownTeamIds(year: number): Promise<Set<number>> {
  let rows = await sql`select id from mlb_teams`;
  if (rows.length < 30) {
    const data = await mlb(`/teams?sportId=1&season=${year}`);
    // deno-lint-ignore no-explicit-any
    const teams = data.teams.map((t: any) => ({
      id: t.id,
      name: t.name,
      abbreviation: t.abbreviation,
      league: LEAGUES[t.league?.id] ?? null,
    }));
    await sql`
      insert into mlb_teams ${sql(teams, 'id', 'name', 'abbreviation', 'league')}
      on conflict (id) do nothing`;
    rows = await sql`select id from mlb_teams`;
  }
  return new Set(rows.map((r) => r.id as number));
}

/** Saves a game's box score (everyone's batting line) and its live state (inning, bases, due up). */
async function saveGame(gamePk: number): Promise<number> {
  const [boxscore, linescore] = await Promise.all([mlb(`/game/${gamePk}/boxscore`), mlb(`/game/${gamePk}/linescore`)]);
  // The live state and the score (the schedule, which also has it, is only read once a minute
  // during games), in one update.
  const live = linescoreLive(linescore);
  const runs = linescoreRuns(linescore);
  if (live || runs) {
    const liveJson = live ? sql.json(JSON.parse(JSON.stringify(live))) : null;
    await sql`
      update mlb_games set
        live = coalesce(${liveJson}::jsonb, live),
        home_score = coalesce(${runs?.home ?? null}::smallint, home_score),
        away_score = coalesce(${runs?.away ?? null}::smallint, away_score)
      where game_pk = ${gamePk}
        and (live, home_score, away_score) is distinct from
            (coalesce(${liveJson}::jsonb, live),
             coalesce(${runs?.home ?? null}::smallint, home_score),
             coalesce(${runs?.away ?? null}::smallint, away_score))`;
  }
  await sql`
    insert into private.box_reads (game_pk, read_at) values (${gamePk}, now())
    on conflict (game_pk) do update set read_at = excluded.read_at`;
  const { rows, players } = boxscoreBatting(gamePk, boxscore);
  if (!rows.length) return 0;
  await sql.begin(async (tx) => {
    await tx`insert into mlb_players ${tx(players, 'id', 'full_name')} on conflict (id) do nothing`;
    await tx`
      insert into player_game_stats ${tx(
        rows,
        'game_pk', 'mlb_player_id', 'mlb_team_id', 'ab', 'h', 'doubles', 'triples', 'hr', 'bb', 'hbp', 'sf', 'tb', 'r', 'rbi',
      )}
      on conflict (game_pk, mlb_player_id) do update set
        mlb_team_id = excluded.mlb_team_id, ab = excluded.ab, h = excluded.h, doubles = excluded.doubles,
        triples = excluded.triples, hr = excluded.hr, bb = excluded.bb, hbp = excluded.hbp, sf = excluded.sf,
        tb = excluded.tb, r = excluded.r, rbi = excluded.rbi, updated_at = now()
      where (player_game_stats.ab, player_game_stats.h, player_game_stats.doubles, player_game_stats.triples,
             player_game_stats.hr, player_game_stats.bb, player_game_stats.hbp, player_game_stats.sf,
             player_game_stats.tb, player_game_stats.r, player_game_stats.rbi)
        is distinct from (excluded.ab, excluded.h, excluded.doubles, excluded.triples, excluded.hr, excluded.bb,
                          excluded.hbp, excluded.sf, excluded.tb, excluded.r, excluded.rbi)`;
  });
  return rows.length;
}

/**
 * Reads the schedule if it's due (private.schedule_due), then the box score of every live game
 * and of finished games due a re-check. A reload (`all`) reads the schedule and every game that
 * has started, and treats finished games as settled so the cron job leaves them alone.
 */
async function poll(year: number, all: boolean) {
  const [{ due: scheduleDue }] = await sql`select private.schedule_due() as due`;
  // Postseason games on the schedule, when it was read this time.
  const games = all || scheduleDue ? await syncSchedule(year, all) : null;

  const due = all
    ? await sql`select game_pk from mlb_games where season_year = ${year} and status in ('Live', 'Final')`
    : await sql`
        select g.game_pk from mlb_games g
        left join private.box_reads b using (game_pk)
        where g.season_year = ${year}
          and (g.status = 'Live'
               or (g.status = 'Final' and g.final_seen_at > now() - interval '6 hours'
                   and (b.read_at is null or b.read_at < now() - interval '10 minutes')))`;

  let batted = 0;
  try {
    // A few at a time, to be gentle with the MLB API.
    const pending = due.map((r) => r.game_pk as number);
    while (pending.length) {
      const counts = await Promise.all(pending.splice(0, 4).map(saveGame));
      batted += counts.reduce((a, b) => a + b, 0);
    }
  } finally {
    // Everything this poll changed, to open apps in one realtime message.
    await sql`select private.flush_score_changes()`;
  }
  return { year, games, boxscores: due.length, battingLines: batted };
}

/**
 * Reads the postseason schedule into mlb_games. Rows are only rewritten when something changed,
 * so open apps don't refetch for nothing. A live game keeps the score its linescore gave (read
 * every few seconds) over the schedule's, which can lag behind.
 */
async function syncSchedule(year: number, all: boolean): Promise<number> {
  const teams = await knownTeamIds(year);
  const games = scheduleGames(await mlb(`/schedule?sportId=1&season=${year}&gameType=F,D,L,W`), year, teams);
  if (games.length) {
    const settled = all ? new Date(Date.now() - 24 * 3600 * 1000).toISOString() : new Date().toISOString();
    const rows = games.map((g) => ({ ...g, final_seen_at: g.status === 'Final' ? settled : null }));
    await sql`
      insert into mlb_games ${sql(
        rows,
        'game_pk', 'season_year', 'game_type', 'start_time', 'start_time_tbd', 'official_date', 'status', 'detailed_state', 'home_team_id', 'away_team_id',
        'home_score', 'away_score', 'series_game_number', 'games_in_series', 'final_seen_at',
      )}
      on conflict (game_pk) do update set
        game_type = excluded.game_type, start_time = excluded.start_time, start_time_tbd = excluded.start_time_tbd,
        official_date = excluded.official_date, status = excluded.status,
        detailed_state = excluded.detailed_state, home_team_id = excluded.home_team_id,
        away_team_id = excluded.away_team_id,
        home_score = case when excluded.status = 'Live' and mlb_games.status = 'Live'
          then mlb_games.home_score else excluded.home_score end,
        away_score = case when excluded.status = 'Live' and mlb_games.status = 'Live'
          then mlb_games.away_score else excluded.away_score end,
        series_game_number = excluded.series_game_number, games_in_series = excluded.games_in_series,
        final_seen_at = case when excluded.status = 'Final'
          then coalesce(mlb_games.final_seen_at, excluded.final_seen_at) end,
        updated_at = now()
      where (mlb_games.game_type, mlb_games.start_time, mlb_games.start_time_tbd, mlb_games.official_date,
             mlb_games.status, mlb_games.detailed_state, mlb_games.home_team_id, mlb_games.away_team_id,
             mlb_games.series_game_number, mlb_games.games_in_series)
          is distinct from
            (excluded.game_type, excluded.start_time, excluded.start_time_tbd, excluded.official_date,
             excluded.status, excluded.detailed_state, excluded.home_team_id, excluded.away_team_id,
             excluded.series_game_number, excluded.games_in_series)
         or (excluded.status <> 'Live'
             and (mlb_games.home_score, mlb_games.away_score) is distinct from (excluded.home_score, excluded.away_score))`;
  }
  // Only the latest season's read counts for the cron job's schedule; reloading a past season
  // mustn't delay the next read of the one being played.
  await sql`update private.poller set schedule_synced_at = now() where ${year} = (select max(year) from seasons)`;
  return games.length;
}

/** Holds a short lease so overlapping cron calls don't poll at the same time. */
async function withLease<T>(run: () => Promise<T>): Promise<T | { skipped: true }> {
  const [lease] = await sql`
    update private.poller set running_until = now() + interval '55 seconds'
    where running_until is null or running_until < now()
    returning 1`;
  if (!lease) return { skipped: true };
  try {
    return await run();
  } finally {
    await sql`update private.poller set running_until = null`;
  }
}

serve(async (req) => {
  const body = (await req.json().catch(() => ({}))) as { setup?: boolean; seasonId?: string };

  if (body.setup) {
    // Only ever points the cron job at this function, so it needs no auth.
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/poll-games`;
    await sql`update private.poller set function_url = ${url}`;
    return json({ ok: true });
  }

  const secret = req.headers.get('x-poller-secret');
  if (secret) {
    const [cfg] = await sql`select secret from private.poller`;
    if (secret !== cfg?.secret) throw new UserError('Not allowed.', 403);
    const [latest] = await sql`select max(year) as year from seasons`;
    if (!latest?.year) return json({ skipped: true });
    return json(await withLease(() => poll(latest.year, false)));
  }

  const userId = await requireUser(req);
  if (!body.seasonId) throw new UserError('seasonId is required.');
  await requireCommissioner(body.seasonId, userId);
  const [season] = await sql`select year from seasons where id = ${body.seasonId}`;
  if (!season) throw new UserError('Season not found.', 404);
  return json(await poll(season.year, true));
});
