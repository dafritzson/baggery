// Mirrors postseason games and box scores from the MLB Stats API into mlb_games and
// player_game_stats, which the standings are scored from.
//
// POST {}                    from pg_cron (x-poller-secret header): polls the latest season's
//                            games. The cron job calls every 10 seconds while there's something to
//                            fetch (private.poll_due): live games every call, the schedule every
//                            minute while games are on (10 otherwise), finished games every 10.
//                            Then queues the cut alerts of games just finished and sends the
//                            alerts that are due (bag, sub and cut alerts: alerts.ts).
// POST { setup: true }       from the deploy: records this function's URL for the cron job.
// POST { seasonId }          commissioner: reloads every game of that season's postseason.
// POST { seasonId, videos: true, after? }
//                            commissioner: reads the plays and highlight clips of a few of that
//                            season's games at a time (after the given gamePk), for the Games
//                            tab's videos; the app calls it until `next` is null.

import { requireCommissioner, requireUser } from '../_shared/auth.ts';
import { autoCloseRounds } from '../_shared/close-round.ts';
import { logCommissioner } from '../_shared/commissioner-log.ts';
import { sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';
import { queueCutAlerts, queueSubAlerts, sendBagAlerts, sendQueuedAlerts } from './alerts.ts';
import {
  type ProbableRow,
  boxscoreBatting,
  boxscoreSubs,
  clipsForHits,
  highlightClips,
  linescoreLive,
  linescoreRuns,
  playHits,
  playLines,
  savantHasVideo,
  scheduleGames,
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
 * Saves a game's box score (everyone's batting line) and its live state (inning, bases, due up).
 * With `alerts` (the regular polls, not a reload), queues sub alerts for its lineup changes.
 */
async function saveGame(gamePk: number, alerts: boolean): Promise<number> {
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
      )}
      on conflict (game_pk, mlb_player_id) do update set
        mlb_team_id = excluded.mlb_team_id, pa = excluded.pa, ab = excluded.ab, h = excluded.h, doubles = excluded.doubles,
        triples = excluded.triples, hr = excluded.hr, bb = excluded.bb, hbp = excluded.hbp, sf = excluded.sf,
        tb = excluded.tb, r = excluded.r, rbi = excluded.rbi, updated_at = now()
      where (player_game_stats.pa, player_game_stats.ab, player_game_stats.h, player_game_stats.doubles, player_game_stats.triples,
             player_game_stats.hr, player_game_stats.bb, player_game_stats.hbp, player_game_stats.sf,
             player_game_stats.tb, player_game_stats.r, player_game_stats.rbi)
        is distinct from (excluded.pa, excluded.ab, excluded.h, excluded.doubles, excluded.triples, excluded.hr, excluded.bb,
                          excluded.hbp, excluded.sf, excluded.tb, excluded.r, excluded.rbi)`;
  });
  return rows.length;
}

/**
 * A game's hits and their videos (mlb_hits), and every play's batting lines (mlb_play_lines). Its
 * play-by-play when the box score has hits not yet matched to a play (at most every 20 seconds),
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
           and (r.plays_read_at is null or r.plays_read_at < now() - interval '20 seconds'))
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
  return { year, games, boxscores: due.length, battingLines: batted };
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
      pitcher_id = excluded.pitcher_id, pitcher_name = excluded.pitcher_name, hand = excluded.hand
    where (mlb_probables.pitcher_id, mlb_probables.pitcher_name, mlb_probables.hand)
      is distinct from (excluded.pitcher_id, excluded.pitcher_name, excluded.hand)`;
}

/**
 * Reads the postseason schedule into mlb_games. Rows are only rewritten when something changed,
 * so open apps don't refetch for nothing. A live game keeps the score its linescore gave (read
 * every few seconds) over the schedule's, which can lag behind.
 */
async function syncSchedule(year: number, all: boolean): Promise<number> {
  const teams = await knownTeamIds(year);
  // The person part brings each probable pitcher's hand, for the draft table's platoons.
  const schedule = await mlb(`/schedule?sportId=1&season=${year}&gameType=F,D,L,W&hydrate=probablePitcher,person`);
  const games = scheduleGames(schedule, year, teams);
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
  await syncProbables(scheduleProbables(schedule, games), games.map((g) => g.game_pk));
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
        // and the lineup changes and cut line crossings.
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
