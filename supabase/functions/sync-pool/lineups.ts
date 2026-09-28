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

/**
 * A stretch a hitter couldn't play for his team: on the injured list, in the minors, or not on the
 * team yet. From `from` up to `to` (YYYY-MM-DD, `to` excluded: he can play that day's game), or
 * still out when `to` is null.
 */
export interface Absence {
  from: string;
  to: string | null;
}

/** Earlier than any game: for a hitter whose first move of the year brings him back. */
const SEASON_START = '0000-00-00';

/**
 * When a hitter was off his team's active roster this year, from its `/transactions?teamId=…`:
 * placed on the injured list (from the day it's backdated to) until activated, optioned or
 * designated for assignment until recalled or selected, and before a trade brought him over. A
 * hitter whose first move of the year brings him back (activated off a list he started the year on,
 * or called up) was out from the start.
 */
// deno-lint-ignore no-explicit-any
export function absences(transactions: any[], playerId: number, teamId: number): Absence[] {
  const moves = transactions
    .filter((t) => t?.person?.id === playerId)
    .flatMap((t): { day: string; out: boolean }[] => {
      const day: string | undefined = t.effectiveDate ?? t.date;
      const text = String(t.description ?? '');
      if (!day) return [];
      if (t.typeCode === 'SC' && /\binjured list\b/i.test(text)) {
        if (/\bplaced\b/i.test(text)) return [{ day, out: true }];
        if (/\b(activated|reinstated)\b/i.test(text)) return [{ day, out: false }];
        return [];
      }
      if (t.typeCode === 'OPT' || t.typeCode === 'DES') return [{ day, out: true }];
      if (t.typeCode === 'CU' || t.typeCode === 'SE') return [{ day, out: false }];
      if (t.typeCode === 'TR') {
        if (t.toTeam?.id === teamId) return [{ day, out: false }];
        if (t.fromTeam?.id === teamId) return [{ day, out: true }];
      }
      return [];
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  const result: Absence[] = [];
  let outSince: string | null = moves[0] && !moves[0].out ? SEASON_START : null;
  for (const m of moves) {
    if (m.out && outSince === null) outSince = m.day;
    else if (!m.out && outSince !== null) {
      result.push({ from: outSince, to: m.day });
      outSince = null;
    }
  }
  if (outSince !== null) result.push({ from: outSince, to: null });
  return result;
}

/**
 * A hitter's games in his team's lineups, by the opposing starter's hand (games with no known hand
 * left out). Games he couldn't play (`away`: injured, in the minors) are left out too, so they
 * don't count as games he sat: his start rate is from the games he was there for.
 */
export function hitterLineupGames(games: TeamGame[], playerId: number, hands: Map<number, Person>, away: Absence[] = []): LineupGame[] {
  return games.flatMap((g) => {
    const starterHand = g.oppStarterId === null ? null : hands.get(g.oppStarterId)?.pitchHand;
    if (!starterHand) return [];
    const i = g.lineup.indexOf(playerId);
    // In the lineup, he was there, whatever the transactions say.
    if (i < 0 && away.some((a) => g.date >= a.from && (a.to === null || g.date < a.to))) return [];
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
