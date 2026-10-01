// A season replayed in time, for the Standings' scrubber: its game days in order and, on each day,
// the bags as they happened (every hit that counted for a fantasy team still in that round).
//
// A stop is a moment in the season: a day's first `bag` bags. Games before that day count in
// full, from their box scores. That day's games count only up to that bag: from their play-by-play
// lines when the app has them (every plate appearance and run, so tiebreakers are exact), else
// from the hits (TB, H and HR only). At a day's last bag the day's box scores count in full, so
// its end matches the standings the day really ended with.

import { ownerAt, type ScoreGame, type ScoreStat } from './scoreboard.ts';
import type { RosterSpell } from './scoring.ts';
import { type FantasyRound, type PlayerId, ROUND_FOR_GAME_TYPE, type TeamId } from './types.ts';

export interface TimelineGame extends ScoreGame {
  /** The game's date as MLB lists it (YYYY-MM-DD). */
  officialDate?: string | null;
}

export interface TimelineHit {
  playId: string;
  gamePk: number;
  playerId: PlayerId;
  event: '1B' | '2B' | '3B' | 'HR';
  /** When the play ended; hits without it count only at the end of their day. */
  endedAt: string | null;
}

/** What one play added to a player's batting line (mlb_play_lines). */
export interface PlayLine {
  gamePk: number;
  playerId: PlayerId;
  endedAt: string | null;
  ab: number;
  h: number;
  tb: number;
  hr: number;
  bb: number;
  hbp: number;
  sf: number;
  r: number;
  rbi: number;
}

export const HIT_BAGS: Record<TimelineHit['event'], number> = { '1B': 1, '2B': 2, '3B': 3, HR: 4 };

/** A hit that counted for a fantasy team. */
export interface Bag {
  playId: string;
  gamePk: number;
  playerId: PlayerId;
  teamId: TeamId;
  round: FantasyRound;
  event: TimelineHit['event'];
  bags: number;
  endedAt: string;
}

export interface TimelineDay {
  /** YYYY-MM-DD, as MLB dates its games. */
  date: string;
  /** The latest fantasy round among the day's games. */
  round: FantasyRound;
  gamePks: number[];
  /** The day's bags in the order they happened. */
  bags: Bag[];
}

export interface Timeline {
  days: TimelineDay[];
}

/** A moment: a day's first `bag` bags. A day's `bags.length` (0 for a day without bags) is its end. */
export interface Stop {
  day: number;
  bag: number;
}

export type Zoom = 'season' | 'round' | 'day';

const started = (g: ScoreGame) => g.status === 'Live' || g.status === 'Final';

/** A game's day: MLB's date for it, else its start in US Eastern time (4 hours behind UTC in October). */
export function gameDay(g: TimelineGame): string {
  return g.officialDate ?? new Date(Date.parse(g.start) - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

/** When a game day ends: 3 AM Eastern, so games that run past midnight still count as the day before. */
export const GAME_DAY_ROLLOVER_HOURS = 3;

const easternDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's game day (as MLB dates them, Eastern), e.g. "2026-09-30": until 3 AM Eastern, still yesterday's. */
export function currentGameDay(now: number): string {
  // en-CA formats as YYYY-MM-DD.
  return easternDate.format(new Date(now - GAME_DAY_ROLLOVER_HOURS * 3600 * 1000));
}

/**
 * The season's game days so far (days with a game that has started) and each day's bags. A hit
 * counts for the team whose roster had the batter at first pitch, if that team is still in the
 * game's round (`inRound`).
 */
export function buildTimeline(
  games: TimelineGame[],
  hits: TimelineHit[],
  spells: RosterSpell[],
  inRound: (teamId: TeamId, round: FantasyRound) => boolean,
): Timeline {
  const byDate = new Map<string, TimelineDay>();
  const gameByPk = new Map<number, TimelineGame>();
  for (const g of games) {
    if (!started(g)) continue;
    gameByPk.set(g.gamePk, g);
    const date = gameDay(g);
    const round = ROUND_FOR_GAME_TYPE[g.gameType];
    const day = byDate.get(date) ?? { date, round, gamePks: [], bags: [] };
    day.gamePks.push(g.gamePk);
    if (round > day.round) day.round = round;
    byDate.set(date, day);
  }
  for (const hit of hits) {
    const game = gameByPk.get(hit.gamePk);
    if (!game || !hit.endedAt) continue;
    const round = ROUND_FOR_GAME_TYPE[game.gameType];
    const teamId = ownerAt(spells, hit.playerId, game.start);
    if (!teamId || !inRound(teamId, round)) continue;
    byDate.get(gameDay(game))!.bags.push({
      playId: hit.playId,
      gamePk: hit.gamePk,
      playerId: hit.playerId,
      teamId,
      round,
      event: hit.event,
      bags: HIT_BAGS[hit.event],
      endedAt: hit.endedAt,
    });
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) d.bags.sort((a, b) => a.endedAt.localeCompare(b.endedAt) || a.playId.localeCompare(b.playId));
  return { days };
}

export const dayEnd = (tl: Timeline, day: number): Stop => ({ day, bag: tl.days[day].bags.length });
export const isDayEnd = (tl: Timeline, s: Stop) => s.bag >= tl.days[s.day].bags.length;
export const sameStop = (a: Stop, b: Stop) => a.day === b.day && a.bag === b.bag;

/** Where a stop sits on the chart's x axis: one unit per day, the day's bags spread evenly across it. */
export function stopPosition(tl: Timeline, s: Stop): number {
  const n = tl.days[s.day].bags.length;
  return s.day + (n ? s.bag / n : 1);
}

/** The days a round was played on (a day with a game of that round). */
export function roundDays(tl: Timeline, games: TimelineGame[], round: FantasyRound): number[] {
  const inRound = new Set(games.filter((g) => ROUND_FOR_GAME_TYPE[g.gameType] === round).map((g) => g.gamePk));
  return tl.days.flatMap((d, i) => (d.gamePks.some((pk) => inRound.has(pk)) ? [i] : []));
}

/**
 * The zoom the scrubber steps by: while only one round has been played, the season is that round,
 * so it goes bag by bag like the round instead of day by day.
 */
export function stepZoom(tl: Timeline, zoom: Zoom): Zoom {
  return zoom === 'season' && new Set(tl.days.map((d) => d.round)).size <= 1 ? 'round' : zoom;
}

/**
 * The scrubber's stops at a zoom: the end of each day for the season; every bag of the round
 * (`at`'s) when zoomed in on it; and one day's first pitch and every bag when zoomed in on that day.
 * A day's last bag is its end; a day without bags is only its end.
 */
export function stopsFor(tl: Timeline, zoom: Zoom, at: Stop): Stop[] {
  if (!tl.days.length) return [];
  if (zoom === 'season') return tl.days.map((_, i) => dayEnd(tl, i));
  if (zoom === 'day') return bagsOf(tl, at.day, 0);
  const round = tl.days[at.day].round;
  return tl.days.flatMap((d, i) => (d.round === round ? bagsOf(tl, i, 1) : []));
}

/** A day's stops from its `from`th bag on; a day without bags is only its end. */
function bagsOf(tl: Timeline, day: number, from: number): Stop[] {
  const n = tl.days[day].bags.length;
  return n ? Array.from({ length: n - from + 1 }, (_, k) => ({ day, bag: from + k })) : [{ day, bag: 0 }];
}

/** What playback steps through: always bag by bag, over the whole season when zoomed out. */
export function playStops(tl: Timeline, zoom: Zoom, at: Stop): Stop[] {
  return zoom === 'season' ? tl.days.flatMap((_, i) => bagsOf(tl, i, 1)) : stopsFor(tl, zoom, at);
}

/** Where playback goes after `at`; null at the end. */
export function nextPlayStop(tl: Timeline, zoom: Zoom, at: Stop): Stop | null {
  const from = stopPosition(tl, at);
  return playStops(tl, zoom, at).find((s) => stopPosition(tl, s) > from) ?? null;
}

/** Where playback in reverse goes after `at`; null at the start. */
export function prevPlayStop(tl: Timeline, zoom: Zoom, at: Stop): Stop | null {
  const from = stopPosition(tl, at);
  return playStops(tl, zoom, at).filter((s) => stopPosition(tl, s) < from).pop() ?? null;
}

/**
 * The stop before `at`, to show who moved since: the day before at a day's end on the season,
 * else the bag before. Null at the start.
 */
export function previousStop(tl: Timeline, zoom: Zoom, at: Stop): Stop | null {
  const list = zoom === 'season' && isDayEnd(tl, at) ? stopsFor(tl, zoom, at) : playStops(tl, zoom, at);
  const from = stopPosition(tl, at);
  return list.filter((s) => stopPosition(tl, s) < from).pop() ?? null;
}

/** The stop in `list` nearest to a position on the x axis. */
export function nearestStop(tl: Timeline, list: Stop[], position: number): Stop {
  let best = list[0];
  for (const s of list) if (Math.abs(stopPosition(tl, s) - position) < Math.abs(stopPosition(tl, best) - position)) best = s;
  return best;
}

/**
 * The games and stat lines as they stood at a stop, to score like the live ones: games after it
 * haven't started, and the stop's day counts its games up to the stop's bag (a game is live once
 * its first pitch was before that bag). A game with `plays` gets its whole line up to that moment
 * from them; one without, just its hits.
 */
export function scoresAt<G extends TimelineGame>(
  tl: Timeline,
  games: G[],
  stats: ScoreStat[],
  stop: Stop,
  plays: PlayLine[] = [],
): { games: G[]; stats: ScoreStat[] } {
  const day = tl.days[stop.day];
  const end = isDayEnd(tl, stop);
  // At the day's end its box scores count, not its hits.
  const bags = end ? [] : day.bags.slice(0, stop.bag);
  const cutoff = bags.length ? Date.parse(bags[bags.length - 1].endedAt) : -Infinity;
  const partial = new Set<number>();
  const shown = games.map((g) => {
    if (!started(g)) return g;
    const date = gameDay(g);
    if (date < day.date || (date === day.date && end)) return g;
    if (date > day.date) return { ...g, status: 'Preview' };
    partial.add(g.gamePk);
    return { ...g, status: Date.parse(g.start) <= cutoff ? 'Live' : 'Preview' };
  });
  const lines = new Map<string, ScoreStat>();
  const lineOf = (gamePk: number, playerId: PlayerId) => {
    const key = `${gamePk}:${playerId}`;
    const line = lines.get(key) ?? { gamePk, playerId, tb: 0, ab: 0, h: 0, bb: 0, hbp: 0, sf: 0, hr: 0, r: 0, rbi: 0 };
    lines.set(key, line);
    return line;
  };
  const withPlays = new Set(plays.filter((p) => partial.has(p.gamePk)).map((p) => p.gamePk));
  for (const p of plays) {
    if (!withPlays.has(p.gamePk) || !p.endedAt || Date.parse(p.endedAt) > cutoff) continue;
    const line = lineOf(p.gamePk, p.playerId);
    for (const k of ['tb', 'ab', 'h', 'bb', 'hbp', 'sf', 'hr', 'r', 'rbi'] as const) line[k] = (line[k] ?? 0) + p[k];
  }
  for (const b of bags) {
    if (withPlays.has(b.gamePk)) continue;
    const line = lineOf(b.gamePk, b.playerId);
    line.tb += b.bags;
    line.h = (line.h ?? 0) + 1;
    if (b.event === 'HR') line.hr = (line.hr ?? 0) + 1;
  }
  const later = new Set(shown.filter((g) => g.status === 'Preview').map((g) => g.gamePk));
  return {
    games: shown,
    stats: [...stats.filter((s) => !partial.has(s.gamePk) && !later.has(s.gamePk)), ...lines.values()],
  };
}

/** A step line: [x, bags] vertices, x in days (see stopPosition). */
export type Vertices = [number, number][];

export interface RoundLines {
  /** Where the round starts and ends on the x axis. */
  from: number;
  to: number;
  /** Each team's running round total. */
  teams: Map<TeamId, Vertices>;
  /** The running total of the last team through (the `survivors`th best). */
  cut: Vertices;
}

/**
 * A round's race, for the chart: each team's running total stepping up bag by bag, and the cut
 * line. At the end of each day a team's total is set to its box scores', so the lines end each day
 * where the standings did even if a hit is missing from the play-by-play.
 */
export function roundLines(
  tl: Timeline,
  games: TimelineGame[],
  stats: ScoreStat[],
  spells: RosterSpell[],
  round: FantasyRound,
  teamIds: TeamId[],
  survivors: number,
  /** The teams the cut is drawn from (the ghost team in round 2 faces no cut); all of `teamIds` by default. */
  cutTeamIds: TeamId[] = teamIds,
): RoundLines | null {
  const days = roundDays(tl, games, round);
  if (!days.length) return null;
  const gameByPk = new Map(games.filter((g) => ROUND_FOR_GAME_TYPE[g.gameType] === round).map((g) => [g.gamePk, g]));
  const totals = new Map(teamIds.map((id) => [id, 0]));
  const teams = new Map<TeamId, Vertices>(teamIds.map((id) => [id, [[days[0], 0]]]));
  const cut: Vertices = [[days[0], 0]];
  const counted = new Set(cutTeamIds);
  const cutNow = () => {
    const values = [...totals].filter(([id]) => counted.has(id)).map(([, v]) => v).sort((a, b) => b - a);
    return values[Math.min(survivors, values.length) - 1] ?? 0;
  };
  const step = (line: Vertices, x: number, v: number) => {
    const last = line[line.length - 1][1];
    if (v !== last) line.push([x, last], [x, v]);
  };

  for (const d of days) {
    const day = tl.days[d];
    const n = day.bags.length;
    day.bags.forEach((b, k) => {
      if (b.round !== round || !totals.has(b.teamId)) return;
      const x = d + (k + 1) / n;
      const v = totals.get(b.teamId)! + b.bags;
      totals.set(b.teamId, v);
      step(teams.get(b.teamId)!, x, v);
      step(cut, x, cutNow());
    });
    // The day's end, from the box scores.
    const box = new Map<TeamId, number>();
    for (const s of stats) {
      const g = gameByPk.get(s.gamePk);
      if (!g || !day.gamePks.includes(g.gamePk)) continue;
      const teamId = ownerAt(spells, s.playerId, g.start);
      if (teamId && totals.has(teamId)) box.set(teamId, (box.get(teamId) ?? 0) + s.tb);
    }
    for (const id of teamIds) {
      const dayBags = day.bags.filter((b) => b.round === round && b.teamId === id).reduce((a, b) => a + b.bags, 0);
      totals.set(id, totals.get(id)! - dayBags + (box.get(id) ?? 0));
      step(teams.get(id)!, d + 1, totals.get(id)!);
    }
    step(cut, d + 1, cutNow());
  }
  const to = days[days.length - 1] + 1;
  for (const line of [...teams.values(), cut]) line.push([to, line[line.length - 1][1]]);
  return { from: days[0], to, teams, cut };
}

/** A step line's value at x: the last vertex at or before it (0 before it starts). */
export function valueAt(line: Vertices, x: number): number {
  let v = 0;
  for (const [vx, vy] of line) {
    if (vx > x) break;
    v = vy;
  }
  return v;
}
