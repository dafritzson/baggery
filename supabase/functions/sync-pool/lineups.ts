// Reads MLB Stats API responses for platoons and batting order (core/platoon.ts): each postseason
// team's regular-season lineups and starters, and its hitters' splits against each hand. Pure,
// so the unit tests can run it on saved responses.

import {
  type Hand,
  type LineupGame,
  type PitcherStart,
  type PlatoonRecord,
  type RotationPitcher,
  HANDS,
  likelyRotation,
  lineupSplits,
} from '../_shared/core/platoon.ts';
import type { Counts } from '../_shared/core/player-stats.ts';

export type { PlatoonRecord };

/** One regular-season game a team played, from `/schedule?teamId=…&hydrate=lineups,probablePitcher`. */
export interface TeamGame {
  gamePk: number;
  /** YYYY-MM-DD. */
  date: string;
  /** Its starting lineup's player ids, leadoff first. */
  lineup: number[];
  /** The starters (the probable pitcher is kept after the game, and is the one who started). */
  ownStarterId: number | null;
  oppStarterId: number | null;
}

/** A team's finished regular-season games that have a lineup. */
// deno-lint-ignore no-explicit-any
export function teamGames(data: any, teamId: number): TeamGame[] {
  const games = new Map<number, TeamGame>();
  // deno-lint-ignore no-explicit-any
  for (const g of (data?.dates ?? []).flatMap((d: any) => d.games ?? [])) {
    if (g.gameType !== 'R' || g.status?.abstractGameState !== 'Final') continue;
    const side = g.teams?.home?.team?.id === teamId ? 'home' : g.teams?.away?.team?.id === teamId ? 'away' : null;
    if (!side) continue;
    const other = side === 'home' ? 'away' : 'home';
    // deno-lint-ignore no-explicit-any
    const lineup: number[] = (g.lineups?.[`${side}Players`] ?? []).map((p: any) => p?.id).filter(Boolean);
    if (!lineup.length) continue;
    games.set(g.gamePk, {
      gamePk: g.gamePk,
      date: g.officialDate ?? String(g.gameDate).slice(0, 10),
      lineup,
      ownStarterId: g.teams[side].probablePitcher?.id ?? null,
      oppStarterId: g.teams[other].probablePitcher?.id ?? null,
    });
  }
  return [...games.values()];
}

/** Everyone we need a hand for: both sides' starters. */
export function starterIds(games: TeamGame[]): number[] {
  return [...new Set(games.flatMap((g) => [g.ownStarterId, g.oppStarterId]).filter((id): id is number => id !== null))];
}

export interface Person {
  name: string;
  pitchHand: Hand | null;
  batSide: 'L' | 'R' | 'S' | null;
}

/** From `/people?personIds=…`. */
// deno-lint-ignore no-explicit-any
export function people(data: any): Map<number, Person> {
  const hand = (code: unknown) => (code === 'L' || code === 'R' ? code : null);
  return new Map(
    // deno-lint-ignore no-explicit-any
    (data?.people ?? []).map((p: any) => [
      p.id,
      {
        name: p.fullName ?? `Player ${p.id}`,
        pitchHand: hand(p.pitchHand?.code),
        batSide: p.batSide?.code === 'S' ? 'S' : hand(p.batSide?.code),
      },
    ]),
  );
}

/** A hitter's games in his team's lineups, by the opposing starter's hand (games with no known hand left out). */
export function hitterLineupGames(games: TeamGame[], playerId: number, hands: Map<number, Person>): LineupGame[] {
  return games.flatMap((g) => {
    const starterHand = g.oppStarterId === null ? null : hands.get(g.oppStarterId)?.pitchHand;
    if (!starterHand) return [];
    const i = g.lineup.indexOf(playerId);
    return [{ date: g.date, starterHand, spot: i < 0 ? null : i + 1 }];
  });
}

/** A team's likely postseason rotation, with names. */
export function teamRotation(games: TeamGame[], hands: Map<number, Person>): (RotationPitcher & { name: string })[] {
  const starts: PitcherStart[] = games.flatMap((g) => {
    const hand = g.ownStarterId === null ? null : hands.get(g.ownStarterId)?.pitchHand;
    return hand ? [{ date: g.date, pitcherId: g.ownStarterId!, hand }] : [];
  });
  return likelyRotation(starts).map((p) => ({ ...p, name: hands.get(p.pitcherId)?.name ?? `Pitcher ${p.pitcherId}` }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** His `platoon` column: null without any lineup games. */
export function platoonRecord(
  games: LineupGame[],
  lines: Partial<Record<Hand, Counts>>,
  opsPlus: (line: Counts, hand: Hand) => number | null,
): PlatoonRecord | null {
  if (!games.length) return null;
  const splits = lineupSplits(games);
  const record = {} as PlatoonRecord;
  for (const hand of HANDS) {
    const mine = games.filter((g) => g.starterHand === hand);
    const line = lines[hand] ?? null;
    record[hand] = {
      games: mine.length,
      starts: mine.filter((g) => g.spot !== null).length,
      weighted: {
        games: round2(splits[hand].games),
        starts: round2(splits[hand].starts),
        spots: splits[hand].spots.map(round2),
      },
      line,
      opsPlus: line ? opsPlus(line, hand) : null,
    };
  }
  return record;
}

/** MLB's split codes: against left- and right-handed pitchers. */
export const SPLIT_CODES: Record<string, Hand> = { vl: 'L', vr: 'R' };

/**
 * A hitter's splits from a roster hydrated with `stats(type=statSplits,sitCodes=[vl,vr])`, grouped
 * by hand. A traded player gets a row per team and a combined one without a team.
 */
// deno-lint-ignore no-explicit-any
export function handSplitRows(splits: any[] = []): Partial<Record<Hand, any[]>> {
  // deno-lint-ignore no-explicit-any
  const byHand: Partial<Record<Hand, any[]>> = {};
  for (const s of splits) {
    const hand = SPLIT_CODES[s?.split?.code];
    if (hand) (byHand[hand] ??= []).push(s);
  }
  return byHand;
}
