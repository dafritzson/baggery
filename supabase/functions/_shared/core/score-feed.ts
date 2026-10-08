// Live scores as the app keeps them: the rows poll-games writes (mlb_games, player_game_stats),
// turned into the app's shape, and each poll's broadcast of changed rows folded in. Pure, so the
// unit tests can run it without Supabase.

import type { LiveState } from './live.ts';
import type { ScoreGame, ScoreStat } from './scoreboard.ts';

/** A game with what the Games tab shows beyond scoring. */
export interface GameInfo extends ScoreGame {
  homeScore: number | null;
  awayScore: number | null;
  /** MLB detailedState: "Scheduled", "In Progress", "Final", "Postponed", ... */
  detailedState: string | null;
  /** No start time set yet (`start` is MLB's 3:33 AM ET placeholder). */
  startTimeTbd: boolean;
  /** The game's date as MLB lists it, e.g. "2026-09-29". */
  officialDate: string | null;
  /** Inning, count, runners and who's up, while live (and the final state after). */
  live: LiveState | null;
  /** Most games the series can go, as MLB lists it. */
  gamesInSeries: number | null;
  /** When the poller first saw it Final (bags stay news for a few minutes after that). */
  finalSeenAt: string | null;
}

/** A batter's line in one game, for the at bat / due up lists of live games. */
export interface BattingLine {
  gamePk: number;
  playerId: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  bb: number;
  /** His spot in the batting order (1–9), or null before the box score has him. */
  spot: number | null;
}

/** One hit by a player who has been on a fantasy roster, from mlb_hits: the bags come in these. */
export interface ScoreHit {
  playId: string;
  gamePk: number;
  playerId: number;
  event: '1B' | '2B' | '3B' | 'HR';
  /** When the play ended, which orders a player's hits in a game. */
  endedAt: string | null;
  /** MLB's clip or Savant's video of it is up. */
  hasVideo: boolean;
  /** MLB's clip, once posted (its slug). */
  clip: string | null;
  /** Savant's video is up (the day after the game). */
  savant: boolean;
}

export interface Scores {
  games: GameInfo[];
  /** Box-score TB of players who have been on a fantasy roster this season. */
  stats: ScoreStat[];
  /** Every batter's line in the games being played now. */
  lines: BattingLine[];
  /** Their hits, one by one (a few seconds behind the box score while poll-games matches them). */
  hits?: ScoreHit[];
}

/** A table row as realtime and the API send it. */
// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

export function toGame(g: Row): GameInfo {
  return {
    gamePk: g.game_pk,
    gameType: g.game_type,
    seriesGameNumber: g.series_game_number,
    start: g.start_time,
    startTimeTbd: g.start_time_tbd,
    officialDate: g.official_date,
    status: g.status,
    homeTeamId: g.home_team_id,
    awayTeamId: g.away_team_id,
    homeScore: g.home_score,
    awayScore: g.away_score,
    detailedState: g.detailed_state,
    live: g.live,
    gamesInSeries: g.games_in_series ?? null,
    finalSeenAt: g.final_seen_at ?? null,
  };
}

export function toHit(h: Row): ScoreHit {
  return {
    playId: h.play_id,
    gamePk: h.game_pk,
    playerId: h.mlb_player_id,
    event: h.event,
    endedAt: h.ended_at ?? null,
    hasVideo: h.has_video ?? false,
    clip: h.clip_slug ?? null,
    savant: h.savant_ready ?? false,
  };
}

export function toLine(l: Row): BattingLine {
  return { gamePk: l.game_pk, playerId: l.mlb_player_id, ab: l.ab, h: l.h, doubles: l.doubles, triples: l.triples, hr: l.hr, bb: l.bb, spot: battingSpot(l.batting_order) };
}

/** MLB's batting order is 100 × the spot, plus 1, 2, ... for each sub in it: 701 bats 7th. */
export function battingSpot(order: unknown): number | null {
  const n = Number(order);
  return Number.isInteger(n) && n >= 100 && n < 1000 ? Math.floor(n / 100) : null;
}

/** Replaces the item with the same key, or adds it. */
function upsert<T>(list: T[], item: T, same: (a: T) => boolean): T[] {
  const i = list.findIndex(same);
  return i === -1 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
}

/** What poll-games broadcasts after each poll (private.flush_score_changes). */
export interface ScoreChanges {
  games?: Row[];
  stats?: Row[];
  hits?: Row[];
  /** Too much changed (or a row was deleted) to send; reload everything. */
  reload?: boolean;
  /** The broadcast's number, one more than the last (see checkBroadcast). */
  seq?: number;
}

/**
 * Whether to apply broadcast number `seq`, given `last`: the number of the last broadcast the
 * scores include (scores_load returns it, and each broadcast applied moves it on), null when not
 * known. A number past last + 1 means one was missed, as happens while Realtime starts up: apply
 * this one and reload. One the scores already include is skipped. Without a number to compare
 * (from a server before the numbers), it's applied as before.
 */
export function checkBroadcast(last: number | null, seq: number | undefined): { apply: boolean; missed: boolean; last: number | null } {
  if (seq === undefined) return { apply: true, missed: false, last };
  if (last === null) return { apply: true, missed: false, last: seq };
  // Far behind isn't one the load already had (those are at most a broadcast or two still on their
  // way): the numbers started over, after a database reset or restore. Take it and reload.
  if (seq < last - 10) return { apply: true, missed: true, last: seq };
  if (seq <= last) return { apply: false, missed: false, last };
  return { apply: true, missed: seq > last + 1, last: seq };
}

/**
 * After a load that includes broadcasts up to `loaded`, which replaces the scores: `missed` when a
 * broadcast heard while it loaded (`last`) is newer, so its changes were just overwritten and the
 * scores should load again.
 */
export function checkLoad(last: number | null, loaded: number | null): { missed: boolean; last: number | null } {
  return { missed: last !== null && loaded !== null && last > loaded, last: loaded };
}

/** A player_game_stats row as the standings keep it: TB plus the line for the tiebreakers. */
// deno-lint-ignore no-explicit-any
export function toStat(row: any): ScoreStat {
  return {
    gamePk: row.game_pk,
    playerId: row.mlb_player_id,
    tb: row.tb,
    ab: row.ab,
    h: row.h,
    bb: row.bb,
    hbp: row.hbp,
    sf: row.sf,
    hr: row.hr,
    r: row.r,
    rbi: row.rbi,
  };
}

/** Folds one poll's changed rows into the scores, so a live game costs no refetch. */
export function applyChanges(scores: Scores, changes: ScoreChanges, year: number, rostered: Set<number>): Scores {
  let { games, stats, lines, hits } = scores;
  for (const row of changes.games ?? []) {
    if (row.season_year !== year || row.series_game_number === null) continue;
    games = upsert(games, toGame(row), (g) => g.gamePk === row.game_pk);
  }
  const live = new Set(games.filter((g) => g.status === 'Live').map((g) => g.gamePk));
  for (const row of changes.stats ?? []) {
    if (rostered.has(row.mlb_player_id)) {
      const stat = toStat(row);
      stats = upsert(stats, stat, (s) => s.gamePk === stat.gamePk && s.playerId === stat.playerId);
    }
    if (live.has(row.game_pk)) {
      const line = toLine(row);
      lines = upsert(lines, line, (l) => l.gamePk === line.gamePk && l.playerId === line.playerId);
    }
  }
  const inSeason = new Set(games.map((g) => g.gamePk));
  for (const row of changes.hits ?? []) {
    if (!rostered.has(row.mlb_player_id) || !inSeason.has(row.game_pk)) continue;
    const hit = toHit(row);
    hits = upsert(hits ?? [], hit, (h) => h.playId === hit.playId);
  }
  return { games, stats, lines, hits };
}
