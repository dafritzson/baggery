import { describe, expect, it } from 'vitest';

import { type BustSeason, type BustTeam, bustsAndSteals, draftBets, draftXBags, replacementLevels } from '../supabase/functions/_shared/core/busts.ts';
import type { PlatoonRecord } from '../supabase/functions/_shared/core/platoon.ts';

/** A full 12-team field: AL teams 1–6 and NL teams 7–12, seeded in order, better seeds winning more. */
function field(out: Partial<Record<number, BustTeam['replacedAt']>> = {}): BustTeam[] {
  return Array.from({ length: 12 }, (_, i) => ({
    teamId: i + 1,
    league: i < 6 ? 'AL' : 'NL',
    seed: (i % 6) + 1,
    wins: 100 - (i % 6) * 3,
    rotation: null,
    ...(i + 1 in out ? { replacedAt: out[i + 1] } : {}),
  }));
}

const REPLACEMENT = { 2: 12, 3: 12, 4: 5 } as const;
const hitter = (playerId: number, mlbTeamId: number, tb: number) => ({ playerId, mlbTeamId, tb, ab: 550, pa: 620, games: 150, platoon: null });

/**
 * Six hitters, best TB (and xBags, all on similar teams) first: 1–6 on MLB teams 1–6. Draft 1
 * takes 6, then 1. Hitter 6 went off; 1 went 0-for and his team went out in the Wild Card.
 */
function season(over: Partial<BustSeason> = {}): BustSeason {
  return {
    seasonId: 's',
    year: 2025,
    complete: true,
    lockedAt: '2025-09-29T17:00:00Z',
    teams: field({ 1: 2, 2: 3, 3: 4, 4: null, 5: 2 }),
    players: [hitter(1, 1, 360), hitter(2, 2, 340), hitter(3, 3, 320), hitter(4, 4, 300), hitter(5, 5, 280), hitter(6, 6, 260)],
    picks: [{ managerKey: 'a', playerId: 6 }, { managerKey: 'b', playerId: 1 }],
    teamGamesPlayed: new Map(),
    bags: new Map([[1, 0], [2, 10], [3, 20], [4, 30], [5, 5], [6, 40]]),
    ...over,
  };
}

describe('replacementLevels', () => {
  it("averages what each redraft's adds went on to score", () => {
    expect(replacementLevels([{ draft: 2, bags: 10 }, { draft: 2, bags: 14 }, { draft: 4, bags: 3 }])).toEqual({ 2: 12, 3: 0, 4: 3 });
  });
});

describe('draftBets', () => {
  const bets = draftBets([season()], REPLACEMENT);
  const of = (id: number) => bets.find((b) => b.playerId === id)!;

  it("scores a pick's roster spot: his bags, plus a replacement's after his team went out", () => {
    expect(of(1)).toMatchObject({ pick: 2, bags: 0, spot: 12 }); // out in the Wild Card: Draft 2's 12
    expect(of(6)).toMatchObject({ pick: 1, bags: 40, spot: 40 }); // team 6 still playing at the end
  });

  it('measures each pick against the best 3 undrafted, ranked by xBags and by TB', () => {
    // Pick 1 (hitter 6) faces 1, 2 and 3 on both rankings: spots 12 (0 + Draft 2's 12), 22 (10 +
    // Draft 3's 12) and 25 (20 + Draft 4's 5).
    expect(of(6).alternatives).toEqual([1, 2, 3]);
    expect(of(6).board).toBeCloseTo((12 + 22 + 25) / 3);
    // Pick 2 (hitter 1) faces 2, 3 and 4 (hitter 6 is gone): 22, 25 and 30 (team 4 lost the World Series).
    expect(of(1).board).toBeCloseTo((22 + 25 + 30) / 3);
    expect(of(1).diff).toBeCloseTo(12 - (22 + 25 + 30) / 3);
  });

  it('waits, in the season being played, until the pick and his alternatives are all out', () => {
    const live = { complete: false, year: 2026 };
    // Everyone pick 2 is measured against is out, and so is he.
    const allOut = draftBets([season({ ...live, teams: field({ 1: 2, 2: 3, 3: 4, 4: 2 }) })], REPLACEMENT);
    expect(allOut.map((b) => [b.playerId, b.live])).toEqual([[1, true]]);
    // Hitter 4's team is still playing: nothing yet.
    expect(draftBets([season({ ...live, teams: field({ 1: 2, 2: 3, 3: 4 }) })], REPLACEMENT)).toEqual([]);
  });

  it('ranks busts and steals', () => {
    const { busts, steals } = bustsAndSteals(bets);
    expect(busts.map((b) => b.playerId)).toEqual([1]);
    expect(steals.map((b) => b.playerId)).toEqual([6]);
  });
});

describe('draftXBags', () => {
  const split = (starts: number, spot: number) => ({ games: 40, starts, spots: Array.from({ length: 9 }, (_, i) => (i === spot - 1 ? starts : 0)) });
  const record = (starts: number, spot: number): PlatoonRecord => ({
    L: { games: 40, starts, weighted: split(starts, spot), line: null, opsPlus: null },
    R: { games: 40, starts, weighted: split(starts, spot), line: null, opsPlus: null },
  });

  it('uses his starts and lineup spot when the pool has them', () => {
    const teams = field();
    const odds = teams.map((t) => ({ teamId: t.teamId, league: t.league!, seed: t.seed!, wins: t.wins! }));
    const rotations = new Map(teams.map((t) => [t.teamId, [{ pitcherId: t.teamId * 10, name: 'P', hand: 'R' as const }]]));
    const at = Date.parse('2026-09-29T17:00:00Z');
    const everyDay = draftXBags({ ...hitter(1, 3, 300), platoon: record(40, 1) }, 6, odds, rotations, at)!;
    const bench = draftXBags({ ...hitter(1, 3, 300), platoon: record(5, 9) }, 6, odds, rotations, at)!;
    expect(everyDay).toBeGreaterThan(2 * bench);
  });
});
