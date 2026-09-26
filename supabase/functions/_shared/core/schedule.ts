// The postseason schedule as series: which games each has played, who leads, who won and which
// games only happen if needed. For the Games tab's Round and Postseason views.

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

/** Every series in the games, in play order: by round, then by first pitch of game 1. */
export function postseasonSeries<G extends ScheduleGame>(games: G[]): Series<G>[] {
  const groups = new Map<string, G[]>();
  for (const g of games) {
    const pair = [g.homeTeamId, g.awayTeamId].sort((a, b) => a - b).join('-');
    const key = `${g.gameType}:${pair}`;
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
