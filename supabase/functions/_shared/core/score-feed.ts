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
}

export interface Scores {
  games: GameInfo[];
  /** Box-score TB of players who have been on a fantasy roster this season. */
  stats: ScoreStat[];
  /** Every batter's line in the games being played now. */
  lines: BattingLine[];
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
  };
}

export function toLine(l: Row): BattingLine {
  return { gamePk: l.game_pk, playerId: l.mlb_player_id, ab: l.ab, h: l.h, doubles: l.doubles, triples: l.triples, hr: l.hr, bb: l.bb };
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
  /** Too much changed (or a row was deleted) to send; reload everything. */
  reload?: boolean;
}

/** Folds one poll's changed rows into the scores, so a live game costs no refetch. */
export function applyChanges(scores: Scores, changes: ScoreChanges, year: number, rostered: Set<number>): Scores {
  let { games, stats, lines } = scores;
  for (const row of changes.games ?? []) {
    if (row.season_year !== year || row.series_game_number === null) continue;
    games = upsert(games, toGame(row), (g) => g.gamePk === row.game_pk);
  }
  const live = new Set(games.filter((g) => g.status === 'Live').map((g) => g.gamePk));
  for (const row of changes.stats ?? []) {
    if (rostered.has(row.mlb_player_id)) {
      const stat = { gamePk: row.game_pk, playerId: row.mlb_player_id, tb: row.tb };
      stats = upsert(stats, stat, (s) => s.gamePk === stat.gamePk && s.playerId === stat.playerId);
    }
    if (live.has(row.game_pk)) {
      const line = toLine(row);
      lines = upsert(lines, line, (l) => l.gamePk === line.gamePk && l.playerId === line.playerId);
    }
  }
  return { games, stats, lines };
}
