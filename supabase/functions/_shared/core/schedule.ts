// The postseason schedule as series: which games each has played, who leads, who won and which
// games only happen if needed. For the Games tab.

import { SERIES, type ScoreGame } from './scoreboard.ts';
import type { GameType } from './types.ts';

export interface ScheduleGame extends ScoreGame {
  homeScore: number | null;
  awayScore: number | null;
  /** Most games the series can go, as MLB lists it (1 for 2021's Wild Card games). */
  gamesInSeries: number | null;
}

export interface Series<G extends ScheduleGame = ScheduleGame> {
  /** Game type and both teams, e.g. "D:119-135". */
  key: string;
  gameType: GameType;
  /** Game 1's home team first: the higher seed, with home field. */
  teams: [number, number];
  bestOf: number;
  /** Wins needed to take the series. */
  needed: number;
  /** Slot i is game i + 1; undefined until MLB schedules it. */
  games: (G | undefined)[];
  /** Wins of `teams[0]` and `teams[1]`. */
  wins: [number, number];
  /** The team that won the series, once one has. */
  winner: number | null;
  /** Scheduled first pitch of the series' first game. */
  start: string;
}

/** A game's series: its game type and both teams, e.g. "D:119-135". */
function seriesKey(g: ScoreGame): string {
  return `${g.gameType}:${[g.homeTeamId, g.awayTeamId].sort((a, b) => a - b).join('-')}`;
}

/** The winning team of a finished game, if it has one. */
export function gameWinner(game: ScheduleGame): number | null {
  if (game.status !== 'Final' || game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore) return null;
  return game.homeScore > game.awayScore ? game.homeTeamId : game.awayTeamId;
}

/** Game n is only played if neither team has clinched before it (games 5–7 of a best-of-7). */
export function ifNecessary(series: Series, number: number): boolean {
  return number > series.needed;
}

/** A game the series no longer needs: it was decided before this game started. */
export function notNeeded(series: Series, number: number): boolean {
  const game = series.games[number - 1];
  return series.winner !== null && (!game || game.status === 'Preview');
}

/**
 * The games still worth showing: drops the ones scheduled after their series was decided, which
 * MLB keeps listing (for the Games tab's Day view).
 */
export function neededGames<G extends ScheduleGame>(games: G[]): G[] {
  const decided = new Set(postseasonSeries(games).filter((s) => s.winner !== null).map((s) => s.key));
  return games.filter((g) => !(g.status === 'Preview' && decided.has(seriesKey(g))));
}

/** Every series in the games, in play order: by round, then by first pitch of game 1. */
export function postseasonSeries<G extends ScheduleGame>(games: G[]): Series<G>[] {
  const groups = new Map<string, G[]>();
  for (const g of games) {
    const key = seriesKey(g);
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  const round = (t: GameType) => SERIES.findIndex((s) => s.gameType === t);
  return [...groups.entries()]
    .map(([key, list]) => {
      const byStart = [...list].sort((a, b) => a.start.localeCompare(b.start));
      const first = byStart.find((g) => g.seriesGameNumber === 1) ?? byStart[0];
      const gameType = first.gameType;
      const listed = byStart.find((g) => g.gamesInSeries)?.gamesInSeries;
      const bestOf = Math.max(listed ?? SERIES.find((s) => s.gameType === gameType)?.games ?? 1, ...list.map((g) => g.seriesGameNumber));
      const needed = Math.floor(bestOf / 2) + 1;
      const slots: (G | undefined)[] = Array.from({ length: bestOf }, () => undefined);
      // A later listing of the same game number (a resumed or rescheduled game) wins.
      for (const g of byStart) slots[g.seriesGameNumber - 1] = g;
      const teams: [number, number] = [first.homeTeamId, first.awayTeamId];
      const wins: [number, number] = [0, 0];
      for (const g of slots) {
        const w = g && gameWinner(g);
        if (w === teams[0]) wins[0]++;
        else if (w === teams[1]) wins[1]++;
      }
      const winner = wins[0] >= needed ? teams[0] : wins[1] >= needed ? teams[1] : null;
      return { key, gameType, teams, bestOf, needed, games: slots, wins, winner, start: first.start };
    })
    .sort((a, b) => round(a.gameType) - round(b.gameType) || a.start.localeCompare(b.start));
}

/**
 * Where a team stands in its series, from its side: "won 3–1", "lost 1–3", "leads 2–1",
 * "trails 1–2", "tied 1–1", or "0–0" before a first game is played.
 */
export function seriesLine(series: Series, teamId: number): string {
  const [mine, theirs] = series.teams[0] === teamId ? series.wins : [series.wins[1], series.wins[0]];
  const score = `${mine}–${theirs}`;
  if (series.winner !== null) return `${series.winner === teamId ? 'won' : 'lost'} ${score}`;
  if (mine === 0 && theirs === 0) return score;
  return `${mine > theirs ? 'leads' : mine < theirs ? 'trails' : 'tied'} ${score}`;
}

/**
 * Each team's series record going into a game, from its earlier games: [wins, losses], by team
 * id. Game 1's is 0–0.
 */
export function recordBefore(games: ScheduleGame[], game: ScheduleGame): Map<number, [number, number]> {
  const series = postseasonSeries(games).find((s) => s.key === seriesKey(game));
  let [home, away] = [0, 0];
  for (const g of series?.games.slice(0, game.seriesGameNumber - 1) ?? []) {
    const w = g ? gameWinner(g) : null;
    if (w === game.homeTeamId) home++;
    else if (w === game.awayTeamId) away++;
  }
  return new Map<number, [number, number]>([
    [game.homeTeamId, [home, away]],
    [game.awayTeamId, [away, home]],
  ]);
}
