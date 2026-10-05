// Mirrors postseason games and box scores from the MLB Stats API into mlb_games and
// player_game_stats, which the standings are scored from.
//
// POST {}                    from pg_cron (x-poller-secret header): polls the latest season's
//                            games. The cron job runs every 15 seconds while games are on (once a
//                            minute on staging) and once a minute otherwise (private.poller), and
//                            calls when there's something to fetch (private.poll_due): live games
//                            every call, the schedule every minute while games are on (10
//                            otherwise), finished games every 10.
//                            Then queues the cut alerts of games just finished and the stat
//                            correction alerts, and sends the alerts that are due (bag, sub, cut,
//                            lineup and stat correction alerts: alerts.ts).
// POST { setup: true }       from the deploy: records this function's URL for the cron job.
// POST { seasonId }          commissioner: reloads every game of that season's postseason.
// POST { seasonId, videos: true, after? }
//                            commissioner: reads the plays and highlight clips of a few of that
//                            season's games at a time (after the given gamePk), for the Games
//                            tab's videos; the app calls it until `next` is null.

import { requireCommissioner, requireUser } from '../_shared/auth.ts';
import { autoCloseRounds } from '../_shared/close-round.ts';
import type { LiveState } from '../_shared/core/live.ts';
import { type ScheduledGame, eliminatedTeams, redraftLock } from '../_shared/core/scoreboard.ts';
import { sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';
import { logCommissioner } from '../_shared/league-log.ts';
import { queueCorrectionAlerts, queueCutAlerts, queueLineupAlerts, queueSubAlerts, sendBagAlerts, sendQueuedAlerts } from './alerts.ts';
import {
  type ProbableRow,
  boxscoreBatting,
  boxscoreSubs,
  clipsForHits,
  highlightClips,
  type LineupRow,
  LAST_PLAY_FIELDS,
  linescoreLive,
  linescoreRuns,
  linescoreTable,
  nextLastPlay,
  pitcherStats,
  playHits,
  playLines,
  playsKey,
  savantHasVideo,
  scheduleGames,
  scheduleLineups,
  scheduleProbables,
} from './feed.ts';

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

/**
 * Carries the game's last play over from what's stored, reading the play-by-play (filtered to
 * what the play needs) only while the game is live and the line score has moved on to another
 * at-bat. Finished games don't show it, so a season's reload reads none. A failure keeps the
 * stored play, and the next poll tries again.
 */
async function addLastPlay(gamePk: number, live: LiveState): Promise<void> {
  const [row] = await sql`select live, status from mlb_games where game_pk = ${gamePk}`;
  const before = (row?.live ?? null) as LiveState | null;
  Object.assign(live, { lastPlay: before?.lastPlay ?? null, playsAsOf: before?.playsAsOf });
  if (row?.status !== 'Live' || before?.playsAsOf === playsKey(live)) return;
  try {
    Object.assign(live, nextLastPlay(live, before, await mlb(`/game/${gamePk}/playByPlay?fields=${LAST_PLAY_FIELDS}`)));
  } catch (e) {
    console.error('last play', gamePk, e);
  }
}

/**
 * Saves a game's box score (everyone's batting line) and its live state (inning, bases, due up).
 * With `alerts` (the regular polls, not a reload), queues sub alerts for its lineup changes.
 */
async function saveGame(gamePk: number, alerts: boolean): Promise<number> {
  const [boxscore, linescore] = await Promise.all([mlb(`/game/${gamePk}/boxscore`), mlb(`/game/${gamePk}/linescore`)]);
  // The live state and the score (the schedule, which also has it, is only read once a minute
  // during games), in one update.
  const live = linescoreLive(linescore, boxscore?.teams?.home?.team?.id);
  const runs = linescoreRuns(linescore);
  const table = linescoreTable(linescore);
  if (live) await addLastPlay(gamePk, live);
  if (live || runs || table) {
    const liveJson = live ? sql.json(JSON.parse(JSON.stringify(live))) : null;
    const tableJson = table ? sql.json(JSON.parse(JSON.stringify(table))) : null;
    await sql`
      update mlb_games set
        live = coalesce(${liveJson}::jsonb, live),
        linescore = coalesce(${tableJson}::jsonb, linescore),
        home_score = coalesce(${runs?.home ?? null}::smallint, home_score),
        away_score = coalesce(${runs?.away ?? null}::smallint, away_score)
      where game_pk = ${gamePk}
        and (live, linescore, home_score, away_score) is distinct from
            (coalesce(${liveJson}::jsonb, live),
             coalesce(${tableJson}::jsonb, linescore),
             coalesce(${runs?.home ?? null}::smallint, home_score),
             coalesce(${runs?.away ?? null}::smallint, away_score))`;
  }
  await sql`
    insert into private.box_reads (game_pk, read_at) values (${gamePk}, now())
    on conflict (game_pk) do update set read_at = excluded.read_at`;
  if (alerts) {
    // A failure here mustn't stop the scores.
    await queueSubAlerts(gamePk, boxscoreSubs(boxscore)).catch((e) => console.error('sub alerts', gamePk, e));
  }
  const { rows, players } = boxscoreBatting(gamePk, boxscore);
  if (!rows.length) return 0;
  await sql.begin(async (tx) => {
    await tx`insert into mlb_players ${tx(players, 'id', 'full_name')} on conflict (id) do nothing`;
    await tx`
      insert into player_game_stats ${tx(
        rows,
        'game_pk', 'mlb_player_id', 'mlb_team_id', 'pa', 'ab', 'h', 'doubles', 'triples', 'hr', 'bb', 'hbp', 'sf', 'tb', 'r', 'rbi',
        'so', 'batting_order', 'position',
      )}
      on conflict (game_pk, mlb_player_id) do update set
        mlb_team_id = excluded.mlb_team_id, pa = excluded.pa, ab = excluded.ab, h = excluded.h, doubles = excluded.doubles,
        triples = excluded.triples, hr = excluded.hr, bb = excluded.bb, hbp = excluded.hbp, sf = excluded.sf,
        tb = excluded.tb, r = excluded.r, rbi = excluded.rbi, so = excluded.so, batting_order = excluded.batting_order,
        position = excluded.position, updated_at = now()
      where (player_game_stats.pa, player_game_stats.ab, player_game_stats.h, player_game_stats.doubles, player_game_stats.triples,
             player_game_stats.hr, player_game_stats.bb, player_game_stats.hbp, player_game_stats.sf,
             player_game_stats.tb, player_game_stats.r, player_game_stats.rbi, player_game_stats.so,
             player_game_stats.batting_order, player_game_stats.position)
        is distinct from (excluded.pa, excluded.ab, excluded.h, excluded.doubles, excluded.triples, excluded.hr, excluded.bb,
                          excluded.hbp, excluded.sf, excluded.tb, excluded.r, excluded.rbi, excluded.so,
                          excluded.batting_order, excluded.position)`;
  });
  return rows.length;
}

/**
 * A game's hits and their videos (mlb_hits), and every play's batting lines (mlb_play_lines). Its
 * play-by-play when the box score has hits not yet matched to a play (at most every 10 seconds),
 * and once more 10 minutes after it ends so the lines have the whole game; then its highlights
 * while hits are still without an official clip (every 2 minutes while live, every 10 after;
 * finished games stop being polled after 6 hours). `force` reads both regardless (reloading a
 * season). Returns the hits it saved.
 */
async function saveVideos(gamePk: number, force: boolean): Promise<number> {
  const due = async () => {
    const [row] = await sql`
      select
        ((select coalesce(sum(h), 0) from player_game_stats where game_pk = g.game_pk)
           > (select count(*) from mlb_hits where game_pk = g.game_pk)
           and (r.plays_read_at is null or r.plays_read_at < now() - interval '10 seconds'))
        or (g.status = 'Final' and g.final_seen_at < now() - interval '10 minutes'
            and (r.plays_read_at is null or r.plays_read_at < g.final_seen_at + interval '10 minutes')) as plays,
        exists (select 1 from mlb_hits where game_pk = g.game_pk and clip_slug is null)
          and (r.clips_read_at is null or r.clips_read_at < now()
               - case when g.status = 'Live' then interval '2 minutes' else interval '10 minutes' end) as clips
      from mlb_games g
      left join private.video_reads r using (game_pk)
      where g.game_pk = ${gamePk}`;
    return { plays: !!row?.plays, clips: !!row?.clips };
  };

  let saved = 0;
  if (force || (await due()).plays) {
    const plays = await mlb(`/game/${gamePk}/playByPlay`);
    const hits = playHits(gamePk, plays);
    const lines = playLines(gamePk, plays);
    await sql.begin(async (tx) => {
      if (lines.length) {
        await tx`
          insert into mlb_play_lines ${tx(lines, 'game_pk', 'at_bat', 'mlb_player_id', 'ended_at', 'pa', 'ab', 'h', 'tb', 'hr', 'bb', 'hbp', 'sf', 'r', 'rbi')}
          on conflict (game_pk, at_bat, mlb_player_id) do update set
            ended_at = excluded.ended_at, pa = excluded.pa, ab = excluded.ab, h = excluded.h, tb = excluded.tb, hr = excluded.hr,
            bb = excluded.bb, hbp = excluded.hbp, sf = excluded.sf, r = excluded.r, rbi = excluded.rbi
          where (mlb_play_lines.ended_at, mlb_play_lines.pa, mlb_play_lines.ab, mlb_play_lines.h, mlb_play_lines.tb, mlb_play_lines.hr,
                 mlb_play_lines.bb, mlb_play_lines.hbp, mlb_play_lines.sf, mlb_play_lines.r, mlb_play_lines.rbi)
            is distinct from (excluded.ended_at, excluded.pa, excluded.ab, excluded.h, excluded.tb, excluded.hr,
                              excluded.bb, excluded.hbp, excluded.sf, excluded.r, excluded.rbi)`;
        // A scoring change can move or take away a line.
        await tx`
          delete from mlb_play_lines where game_pk = ${gamePk}
            and (at_bat, mlb_player_id) not in (
              select * from unnest(${lines.map((x) => x.at_bat)}::int[], ${lines.map((x) => x.mlb_player_id)}::int[]))`;
      }
      if (hits.length) {
        await tx`
          insert into mlb_hits ${tx(hits, 'play_id', 'game_pk', 'mlb_player_id', 'event', 'inning', 'top_inning', 'ended_at')}
          on conflict (play_id) do update set
            mlb_player_id = excluded.mlb_player_id, event = excluded.event, inning = excluded.inning,
            top_inning = excluded.top_inning, ended_at = excluded.ended_at`;
        // A scoring change can take a hit away.
        await tx`delete from mlb_hits where game_pk = ${gamePk} and not (play_id = any(${hits.map((h) => h.play_id)}::uuid[]))`;
      }
      await tx`
        insert into private.video_reads (game_pk, plays_read_at) values (${gamePk}, now())
        on conflict (game_pk) do update set plays_read_at = now()`;
    });
    saved = hits.length;
  }
  if (force || (await due()).clips) {
    const missing = await sql`select play_id, mlb_player_id from mlb_hits where game_pk = ${gamePk} and clip_slug is null`;
    const clips = clipsForHits(
      missing.map((h) => ({ play_id: h.play_id as string, mlb_player_id: h.mlb_player_id as number })),
      highlightClips(await mlb(`/game/${gamePk}/content`)),
    );
    await sql.begin(async (tx) => {
      for (const [playId, clip] of clips) {
        await tx`update mlb_hits set clip_slug = ${clip.slug}, clip_headline = ${clip.headline} where play_id = ${playId}`;
      }
      await tx`
        insert into private.video_reads (game_pk, clips_read_at) values (${gamePk}, now())
        on conflict (game_pk) do update set clips_read_at = now()`;
    });
  }
  return saved;
}

/**
 * Whether Savant has a finished game's play videos yet. Savant publishes them in a batch 13–25
 * hours after the game, all of a game's at once, so this loads one not-yet-ready hit's page and,
 * once it has the video, marks every hit of the game ready (the ▶ sheet only links ready ones).
 * Unless `force` (reloading a season), only from 12 hours after first pitch, at most hourly and 48
 * times per game.
 */
async function checkSavant(gamePk: number, force: boolean): Promise<boolean> {
  const [hit] = await sql`
    select h.play_id from mlb_hits h
    join mlb_games g using (game_pk)
    left join private.video_reads r using (game_pk)
    where h.game_pk = ${gamePk} and not h.savant_ready
      and (${force} or (g.status = 'Final' and g.start_time < now() - interval '12 hours'
           and coalesce(r.savant_checks, 0) < 48
           and (r.savant_checked_at is null or r.savant_checked_at < now() - interval '1 hour')))
    order by h.ended_at
    limit 1`;
  if (!hit) return false;
  const res = await fetch(`https://baseballsavant.mlb.com/sporty-videos?playId=${hit.play_id}`);
  const ready = res.ok && savantHasVideo(await res.text());
  await sql.begin(async (tx) => {
    if (ready) await tx`update mlb_hits set savant_ready = true where game_pk = ${gamePk} and not savant_ready`;
    await tx`
      insert into private.video_reads (game_pk, savant_checked_at, savant_checks) values (${gamePk}, now(), 1)
      on conflict (game_pk) do update set savant_checked_at = now(), savant_checks = private.video_reads.savant_checks + 1`;
  });
  return ready;
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
      const counts = await Promise.all(pending.splice(0, 4).map((pk) => saveGame(pk, !all)));
      batted += counts.reduce((a, b) => a + b, 0);
    }
    // Videos only on the regular polls; a reload reads them in batches of their own (CPU limits).
    // A failure here mustn't stop the scores.
    if (!all) {
      for (const r of due) {
        try {
          await saveVideos(r.game_pk as number, false);
        } catch (e) {
          console.error('videos', r.game_pk, e);
        }
      }
      // Yesterday's games whose Savant videos may be up by now (a few at a time).
      const savantDue = await sql`
        select distinct h.game_pk from mlb_hits h
        join mlb_games g using (game_pk)
        left join private.video_reads r using (game_pk)
        where g.season_year = ${year} and not h.savant_ready and g.status = 'Final'
          and g.start_time < now() - interval '12 hours'
          and coalesce(r.savant_checks, 0) < 48
          and (r.savant_checked_at is null or r.savant_checked_at < now() - interval '1 hour')
        limit 4`;
      for (const r of savantDue) {
        try {
          await checkSavant(r.game_pk as number, false);
        } catch (e) {
          console.error('savant', r.game_pk, e);
        }
      }
    }
  } finally {
    // Everything this poll changed, to open apps in one realtime message.
    await sql`select private.flush_score_changes()`;
  }
  // Only when it read a game or the schedule, which is when a series can have ended or been scheduled.
  let bracket: Bracket = { eliminated: [], locked: [] };
  if (due.length || games) {
    try {
      bracket = await updateBracket(year);
    } catch (e) {
      console.error('bracket', e);
    }
  }
  return { year, games, boxscores: due.length, battingLines: batted, ...bracket };
}

type Bracket = { eliminated: number[]; locked: number[] };

/**
 * What the season's games settle outside the scores. Marks the MLB teams that lost a series
 * eliminated, as soon as it's clinched: their hitters can't be drafted and must be replaced, as the
 * draft room's odds (0% to advance) already show. And gives each redraft without a lock time its
 * series' first pitch, once that's certain (core/scoreboard.ts redraftLock). Returns the teams it
 * just marked and the drafts it just gave a lock time.
 */
async function updateBracket(year: number): Promise<Bracket> {
  const rows = await sql`
    select game_type, home_team_id, away_team_id, status, home_score, away_score, games_in_series, start_time, start_time_tbd
    from mlb_games where season_year = ${year}`;
  const games: ScheduledGame[] = rows.map((g) => ({
    gameType: g.game_type,
    homeTeamId: g.home_team_id,
    awayTeamId: g.away_team_id,
    status: g.status,
    homeScore: g.home_score,
    awayScore: g.away_score,
    gamesInSeries: g.games_in_series,
    start: new Date(g.start_time).toISOString(),
    startTimeTbd: !!g.start_time_tbd,
  }));

  const out = eliminatedTeams(games);
  const marked = out.length
    ? await sql`
        update season_mlb_teams t set eliminated = true
        from seasons s
        where s.id = t.season_id and s.year = ${year} and t.mlb_team_id = any(${out}::int[]) and not t.eliminated
        returning t.mlb_team_id`
    : [];

  // Only ever fills in a missing lock: once picks are made, their roster spots start at it.
  const unlocked = await sql`
    select d.id, d.before_game_type from drafts d join seasons s on s.id = d.season_id
    where s.year = ${year} and d.kind = 'redraft' and d.locks_at is null and d.status <> 'complete'`;
  const locked: number[] = [];
  for (const d of unlocked) {
    const lock = redraftLock(d.before_game_type, games);
    if (!lock) continue;
    const [row] = await sql`update drafts set locks_at = ${lock} where id = ${d.id} and locks_at is null returning number`;
    if (row) locked.push(row.number as number);
  }
  return { eliminated: marked.map((r) => r.mlb_team_id as number), locked };
}

/**
 * Keeps mlb_probables in step with the schedule's games: rows are only written when a starter
 * changes, and dropped when one is no longer announced.
 */
async function syncProbables(rows: ProbableRow[], gamePks: number[]) {
  if (!gamePks.length) return;
  const keys = rows.map((r) => `${r.game_pk}:${r.mlb_team_id}`);
  await sql`
    delete from mlb_probables
    where game_pk = any(${gamePks}) and not (game_pk::text || ':' || mlb_team_id::text = any(${keys}))`;
  if (!rows.length) return;
  await sql`
    insert into mlb_probables ${sql(rows, 'game_pk', 'mlb_team_id', 'pitcher_id', 'pitcher_name', 'hand')}
    on conflict (game_pk, mlb_team_id) do update set
      pitcher_id = excluded.pitcher_id, pitcher_name = excluded.pitcher_name, hand = excluded.hand,
      -- A different starter's numbers are read again.
      stats = case when mlb_probables.pitcher_id = excluded.pitcher_id then mlb_probables.stats end,
      stats_at = case when mlb_probables.pitcher_id = excluded.pitcher_id then mlb_probables.stats_at end
    where (mlb_probables.pitcher_id, mlb_probables.pitcher_name, mlb_probables.hand)
      is distinct from (excluded.pitcher_id, excluded.pitcher_name, excluded.hand)`;
}

/**
 * Reads the numbers of the starters of games still to come (mlb_probables.stats) that don't have
 * them yet, or last had them over 6 hours ago: a few at a time, two small MLB requests each.
 */
async function syncPitcherStats(year: number) {
  const due = await sql`
    select p.game_pk, p.mlb_team_id, p.pitcher_id from mlb_probables p
    join mlb_games g using (game_pk)
    where g.season_year = ${year} and g.status = 'Preview'
      and (p.stats_at is null or p.stats_at < now() - interval '6 hours')
    order by g.start_time
    limit 6`;
  for (const r of due) {
    const path = (gameType: string) =>
      `/people/${r.pitcher_id}/stats?stats=season&group=pitching&gameType=${gameType}&sportId=1&season=${year}`;
    try {
      const [regular, postseason] = await Promise.all([mlb(path('R')), mlb(path('P'))]);
      await sql`
        update mlb_probables set stats = ${sql.json(JSON.parse(JSON.stringify(pitcherStats(regular, postseason))))}, stats_at = now()
        where game_pk = ${r.game_pk} and mlb_team_id = ${r.mlb_team_id} and pitcher_id = ${r.pitcher_id}`;
    } catch (e) {
      console.error('pitcher stats', r.pitcher_id, e);
    }
  }
}

/**
 * Saves the posted lineups for the box score (mlb_lineups), only those that changed. A lineup
 * that's taken down again is kept: the box score shows the last one posted.
 */
async function syncLineups(lineups: LineupRow[]) {
  if (!lineups.length) return;
  const rows = lineups.map((l) => ({ game_pk: l.game_pk, mlb_team_id: l.mlb_team_id, players: sql.json(JSON.parse(JSON.stringify(l.players))) }));
  await sql`
    insert into mlb_lineups ${sql(rows, 'game_pk', 'mlb_team_id', 'players')}
    on conflict (game_pk, mlb_team_id) do update set players = excluded.players, updated_at = now()
    where mlb_lineups.players is distinct from excluded.players`;
}

/**
 * Reads the postseason schedule into mlb_games. Rows are only rewritten when something changed,
 * so open apps don't refetch for nothing. A live game keeps the score its linescore gave (read
 * every few seconds) over the schedule's, which can lag behind.
 */
async function syncSchedule(year: number, all: boolean): Promise<number> {
  const teams = await knownTeamIds(year);
  // The person part brings each probable pitcher's hand, for the draft table's platoons; the
  // lineups are for lineup alerts; the venue's location brings its city.
  const schedule = await mlb(`/schedule?sportId=1&season=${year}&gameType=F,D,L,W&hydrate=probablePitcher,person,lineups,venue(location)`);
  const games = scheduleGames(schedule, year, teams);
  if (games.length) {
    const settled = all ? new Date(Date.now() - 24 * 3600 * 1000).toISOString() : new Date().toISOString();
    const rows = games.map((g) => ({ ...g, final_seen_at: g.status === 'Final' ? settled : null }));
    await sql`
      insert into mlb_games ${sql(
        rows,
        'game_pk', 'season_year', 'game_type', 'start_time', 'start_time_tbd', 'official_date', 'status', 'detailed_state', 'home_team_id', 'away_team_id',
        'home_score', 'away_score', 'series_game_number', 'games_in_series', 'venue', 'final_seen_at',
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
        venue = coalesce(excluded.venue, mlb_games.venue),
        final_seen_at = case when excluded.status = 'Final'
          then coalesce(mlb_games.final_seen_at, excluded.final_seen_at) end,
        updated_at = now()
      where (mlb_games.game_type, mlb_games.start_time, mlb_games.start_time_tbd, mlb_games.official_date,
             mlb_games.status, mlb_games.detailed_state, mlb_games.home_team_id, mlb_games.away_team_id,
             mlb_games.series_game_number, mlb_games.games_in_series, mlb_games.venue)
          is distinct from
            (excluded.game_type, excluded.start_time, excluded.start_time_tbd, excluded.official_date,
             excluded.status, excluded.detailed_state, excluded.home_team_id, excluded.away_team_id,
             excluded.series_game_number, excluded.games_in_series, coalesce(excluded.venue, mlb_games.venue))
         or (excluded.status <> 'Live'
             and (mlb_games.home_score, mlb_games.away_score) is distinct from (excluded.home_score, excluded.away_score))`;
  }
  await syncProbables(scheduleProbables(schedule, games), games.map((g) => g.game_pk));
  // A failure here mustn't stop the scores.
  await syncPitcherStats(year).catch((e) => console.error('pitcher stats', e));
  const lineups = scheduleLineups(schedule, games);
  await syncLineups(lineups);
  if (!all) {
    // A failure here mustn't stop the scores.
    await queueLineupAlerts(lineups).catch((e) => console.error('lineup alerts', e));
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
  const body = (await req.json().catch(() => ({}))) as { setup?: boolean; seasonId?: string; videos?: boolean; after?: number };

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
    return json(
      await withLease(async () => {
        const result = await poll(latest.year, false);
        // Rounds whose series are all decided (and settled for stat corrections) close themselves.
        // A failure here mustn't stop the scores.
        let closedRounds: number[] = [];
        try {
          closedRounds = await sql.begin((tx) => autoCloseRounds(tx));
        } catch (e) {
          console.error('auto-close', e);
        }
        // Push notifications for the bags this poll (or an earlier one, after a spoiler delay) found,
        // and the lineup changes, cut line crossings and stat corrections.
        let bagAlerts = 0;
        try {
          bagAlerts = await sendBagAlerts();
        } catch (e) {
          console.error('bag alerts', e);
        }
        try {
          await queueCutAlerts();
        } catch (e) {
          console.error('cut alerts', e);
        }
        try {
          await queueCorrectionAlerts();
        } catch (e) {
          console.error('correction alerts', e);
        }
        let otherAlerts = 0;
        try {
          otherAlerts = await sendQueuedAlerts();
        } catch (e) {
          console.error('alerts', e);
        }
        return { ...result, closedRounds, bagAlerts, otherAlerts };
      }),
    );
  }

  const userId = await requireUser(req);
  if (!body.seasonId) throw new UserError('seasonId is required.');
  await requireCommissioner(body.seasonId, userId);
  const [season] = await sql`select year from seasons where id = ${body.seasonId}`;
  if (!season) throw new UserError('Season not found.', 404);
  if (body.videos) {
    const games = await sql`
      select game_pk from mlb_games
      where season_year = ${season.year} and status in ('Live', 'Final') and game_pk > ${body.after ?? 0}
      order by game_pk limit 4`;
    let hits = 0;
    for (const g of games) {
      hits += await saveVideos(g.game_pk as number, true);
      await checkSavant(g.game_pk as number, true).catch((e) => console.error('savant', g.game_pk, e));
    }
    return json({ hits, next: games.length === 4 ? games[3].game_pk : null });
  }
  const result = await poll(season.year, true);
  // The videos batches that follow are part of the same reload, so only this call is logged.
  await logCommissioner(sql, {
    seasonId: body.seasonId,
    userId,
    action: 'reload-games',
    summary: `Reloaded ${season.year}'s games from MLB`,
  });
  return json(result);
});
