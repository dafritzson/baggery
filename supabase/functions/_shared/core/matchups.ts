// A team's next postseason games and who likely starts them against it, for the draft table's
// platoon-aware xBags and the player popup's Round matchups: the series it's in (or waits for),
// each game's chance of being played, and the opposing starter, announced or from the rotation.
// Pure, so the unit tests can run it without Supabase.

import { type OddsTeam, seriesGameChances, seriesOdds, strength } from './odds.ts';
import { DAYS_PER_POSTSEASON_GAME, type ExpectedGame, LEAGUE_LHP_SHARE, type RotationPitcher, seriesStarters } from './platoon.ts';
import type { ScheduleGame, Series } from './schedule.ts';
import type { GameType } from './types.ts';

export interface NamedPitcher extends RotationPitcher {
  name: string;
}

export interface MatchupGame {
  /** Game number in the series, from 1. */
  number: number;
  /** Chance it gets played with this team in it: 1 once played. */
  chance: number;
  played: boolean;
  /** Scheduled first pitch (ISO), or null until MLB schedules it. */
  start: string | null;
  /** The opposing starter: announced, or the rotation's turn; null with nothing to go on. */
  starter: (NamedPitcher & { announced: boolean }) | null;
}

export interface MatchupSeries {
  gameType: GameType;
  opponentId: number;
  /** The opponent isn't settled: this is the likelier one (a bye team waiting on the Wild Card). */
  likely: boolean;
  games: MatchupGame[];
}

const BEST_OF: Record<GameType, number> = { F: 3, D: 5, L: 7, W: 7 };

/** Which Wild Card pair a bye team's Division Series opponent comes from, by seed: 1 plays the 4/5 winner. */
const BYE_PAIRS: Record<number, [number, number]> = { 1: [4, 5], 2: [3, 6] };
/** The bye seed a Wild Card seed plays next. */
const NEXT_BYE: Record<number, number> = { 3: 2, 6: 2, 4: 1, 5: 1 };

export interface MatchupInput {
  field: OddsTeam[];
  /** Every series so far (core/schedule.ts postseasonSeries). */
  series: Series<ScheduleGame>[];
  rotations: Map<number, NamedPitcher[]>;
  /** Announced starters, by "gamePk:teamId". */
  probables: Map<string, NamedPitcher>;
}

/**
 * A team's games this fantasy round from here: the series it's in, and for a Wild Card team the
 * Division Series it would play next (games weighted by its chance to get there). A bye team
 * before its opponent is known gets the likelier one. Empty when there's nothing to go on.
 */
export function roundMatchups(teamId: number, input: MatchupInput): MatchupSeries[] {
  const { field, series, rotations, probables } = input;
  const team = field.find((t) => t.teamId === teamId);
  if (!team) return [];
  const bySeed = (seed: number) => field.find((t) => t.league === team.league && t.seed === seed);
  const winsOf = (id: number) => field.find((t) => t.teamId === id)?.wins ?? 81;

  const build = (
    gameType: GameType,
    high: number,
    low: number,
    wins: [number, number],
    slots: (ScheduleGame | undefined)[],
    weight: number,
    likely: boolean,
  ): MatchupSeries => {
    const opponentId = high === teamId ? low : high;
    const bestOf = Math.max(slots.length, BEST_OF[gameType]);
    const chances = seriesGameChances(strength(winsOf(high)), strength(winsOf(low)), bestOf, wins);
    const starters = seriesStarters(
      rotations.get(opponentId) ?? [],
      Array.from({ length: bestOf }, (_, i) => {
        const g = slots[i];
        return (g && probables.get(`${g.gamePk}:${opponentId}`)) || null;
      }),
      bestOf,
    ) as MatchupGame['starter'][];
    return {
      gameType,
      opponentId,
      likely,
      games: chances.map((c, i) => ({
        number: i + 1,
        chance: c * weight,
        played: slots[i]?.status === 'Final',
        start: slots[i]?.start ?? null,
        starter: starters[i],
      })),
    };
  };

  const open = series.find((s) => s.teams.includes(teamId) && s.winner === null);
  if (open) {
    const [high, low] = open.teams;
    const result = [build(open.gameType, high, low, open.wins, open.games, 1, false)];
    const nextBye = open.gameType === 'F' ? bySeed(NEXT_BYE[team.seed]) : undefined;
    if (nextBye) {
      const odds = seriesOdds(strength(winsOf(high)), strength(winsOf(low)), 3, open.wins);
      const advance = high === teamId ? odds.win : 1 - odds.win;
      result.push(build('D', nextBye.teamId, teamId, [0, 0], [], advance, false));
    }
    return result;
  }

  // Before the Wild Card is on the schedule: a Wild Card team's series comes from the seeds.
  const decided = (id: number, type: GameType) => series.some((s) => s.gameType === type && s.teams.includes(id));
  const wildCardOpponent = { 3: 6, 6: 3, 4: 5, 5: 4 }[team.seed];
  if (wildCardOpponent && !decided(teamId, 'F')) {
    const opponent = bySeed(wildCardOpponent);
    if (!opponent) return [];
    const [high, low] = team.seed < opponent.seed ? [teamId, opponent.teamId] : [opponent.teamId, teamId];
    const result = [build('F', high, low, [0, 0], [], 1, false)];
    const nextBye = bySeed(NEXT_BYE[team.seed]);
    if (nextBye) {
      const odds = seriesOdds(strength(winsOf(high)), strength(winsOf(low)), 3);
      result.push(build('D', nextBye.teamId, teamId, [0, 0], [], high === teamId ? odds.win : 1 - odds.win, false));
    }
    return result;
  }

  // A bye team waiting on its Wild Card pair: the likelier winner.
  const pair = BYE_PAIRS[team.seed];
  if (pair && !decided(teamId, 'D')) {
    const [a, b] = pair.map(bySeed);
    if (!a || !b) return [];
    const wc = series.find((s) => s.gameType === 'F' && s.teams.includes(a.teamId) && s.teams.includes(b.teamId));
    let opponentId: number;
    let likely = false;
    if (wc?.winner != null) opponentId = wc.winner;
    else {
      const [high, low] = wc ? wc.teams : [a.teamId, b.teamId];
      const odds = seriesOdds(strength(winsOf(high)), strength(winsOf(low)), 3, wc?.wins ?? [0, 0]);
      opponentId = odds.win >= 0.5 ? high : low;
      likely = true;
    }
    return [build('D', teamId, opponentId, [0, 0], [], 1, likely)];
  }
  return [];
}

const DAY_MS = 86_400_000;

/**
 * The games still to play, for core/platoon.ts expectedPaOver: a left-hander's chance from the
 * starter, and when it starts. A game MLB hasn't scheduled yet comes a day and a half after the
 * one before it (or after `now`).
 */
export function expectedGames(matchups: MatchupSeries[], now = Date.now()): ExpectedGame[] {
  let last = now;
  return matchups.flatMap((s) =>
    s.games.flatMap((g) => {
      const start = g.start ? Date.parse(g.start) : last + DAYS_PER_POSTSEASON_GAME * DAY_MS;
      last = Math.max(last, start);
      if (g.played || g.chance <= 0) return [];
      return [{ chance: g.chance, lhpChance: g.starter ? (g.starter.hand === 'L' ? 1 : 0) : LEAGUE_LHP_SHARE, start }];
    }),
  );
}
