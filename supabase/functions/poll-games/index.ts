// Mirrors postseason games and box scores from the MLB Stats API into mlb_games and
// player_game_stats, which the standings are scored from.
//
// POST {}                    from pg_cron (x-poller-secret header): polls the latest season's
//                            games. The cron job only calls while games are on (private.poll_due).
// POST { setup: true }       from the deploy: records this function's URL for the cron job.
// POST { seasonId }          commissioner: reloads every game of that season's postseason.

import { requireCommissioner, requireUser } from '../_shared/auth.ts';
import { sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';
import { boxscoreBatting, linescoreLive, scheduleGames } from './feed.ts';

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
  const live = linescoreLive(linescore);
  if (live) {
    await sql`
      update mlb_games set live = ${sql.json(JSON.parse(JSON.stringify(live)))}
      where game_pk = ${gamePk} and live is distinct from ${sql.json(JSON.parse(JSON.stringify(live)))}`;
  }
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
 * Reads the season's postseason schedule, then the box score of every game that's on or just
 * finished. A reload (`all`) reads every game that has started, and treats finished games as
 * settled so the cron job leaves them alone.
 */
async function poll(year: number, all: boolean) {
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
        away_team_id = excluded.away_team_id, home_score = excluded.home_score, away_score = excluded.away_score,
        series_game_number = excluded.series_game_number, games_in_series = excluded.games_in_series,
        final_seen_at = case when excluded.status = 'Final'
          then coalesce(mlb_games.final_seen_at, excluded.final_seen_at) end,
        updated_at = now()`;
  }
  await sql`update private.poller set schedule_synced_at = now()`;

  const due = all
    ? await sql`select game_pk from mlb_games where season_year = ${year} and status in ('Live', 'Final')`
    : await sql`
        select game_pk from mlb_games
        where season_year = ${year}
          and (status = 'Live' or (status = 'Final' and final_seen_at > now() - interval '3 hours'))`;

  let batted = 0;
  // A few at a time, to be gentle with the MLB API.
  const pending = due.map((r) => r.game_pk as number);
  while (pending.length) {
    const counts = await Promise.all(pending.splice(0, 4).map(saveGame));
    batted += counts.reduce((a, b) => a + b, 0);
  }
  return { year, games: games.length, boxscores: due.length, battingLines: batted };
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
