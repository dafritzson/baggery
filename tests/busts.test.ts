import { describe, expect, it } from 'vitest';

import { type BustSeason, type BustTeam, bustsAndSteals, draftBets, draftXBags } from '../supabase/functions/_shared/core/busts.ts';
import { postseasonOdds } from '../supabase/functions/_shared/core/odds.ts';
import type { PlatoonRecord } from '../supabase/functions/_shared/core/platoon.ts';
import { expectedBags } from '../supabase/functions/_shared/core/stats.ts';

/** A full 12-team field: AL teams 1–6 and NL teams 7–12, seeded in order, better seeds winning more. */
function field(eliminated: number[] = []): BustTeam[] {
  return Array.from({ length: 12 }, (_, i) => ({
    teamId: i + 1,
    league: i < 6 ? 'AL' : 'NL',
    seed: (i % 6) + 1,
    wins: 100 - (i % 6) * 3,
    eliminated: eliminated.includes(i + 1),
    rotation: null,
  }));
}

const player = (playerId: number, mlbTeamId: number, tb: number) => ({ playerId, mlbTeamId, tb, ab: 550, pa: 620, games: 150, platoon: null });

/**
 * Pick 1 is a 1-seed slugger who went 0-for; pick 2 a 6-seed hitter who went off; pick 3 is on a
 * team still playing.
 */
function season(over: Partial<BustSeason> = {}): BustSeason {
  return {
    seasonId: 's',
    year: 2026,
    complete: true,
    lockedAt: '2026-09-29T17:00:00Z',
    teams: field(),
    players: [player(1, 1, 350), player(2, 6, 220), player(3, 2, 300)],
    picks: [{ managerKey: 'k', playerId: 1 }, { managerKey: 'd', playerId: 2 }, { managerKey: 'a', playerId: 3 }],
    teamGamesPlayed: new Map(),
    bags: new Map([[1, 0], [2, 25], [3, 10]]),
    ...over,
  };
}

describe('draftBets', () => {
  it("compares each Draft 1 pick's bags with his xBags at the lock", () => {
    const odds = postseasonOdds(field().map((t) => ({ teamId: t.teamId, league: t.league!, seed: t.seed!, wins: t.wins! })), [])!;
    const bets = draftBets([season()]);
    const first = bets.find((b) => b.playerId === 1)!;
    expect(first).toMatchObject({ managerKey: 'k', pick: 1, bags: 0, live: false });
    expect(first.xBags).toBeCloseTo(expectedBags(350, 550, 150, odds.get(1)!.games)!);
    expect(first.diff).toBeCloseTo(-first.xBags);
  });

  it('counts a pick from the season being played once his MLB team is out', () => {
    const bets = draftBets([season({ complete: false, teams: field([1]) })]);
    expect(bets.map((b) => [b.playerId, b.live])).toEqual([[1, true]]);
  });

  it("gives every team the postseason's average games when the seeds can't (2020's format)", () => {
    const teams = field().map((t) => ({ ...t, seed: null }));
    const played = new Map(teams.map((t) => [t.teamId, t.teamId <= 6 ? 4 : 2]));
    const bets = draftBets([season({ teams, teamGamesPlayed: played })]);
    expect(bets.find((b) => b.playerId === 1)!.xBags).toBeCloseTo(expectedBags(350, 550, 150, 3)!);
    // ...which needs the postseason to be over.
    expect(draftBets([season({ teams, teamGamesPlayed: played, complete: false })])).toEqual([]);
  });

  it('ranks busts and steals', () => {
    const { busts, steals } = bustsAndSteals(draftBets([season()]));
    expect(busts[0].playerId).toBe(1);
    expect(steals[0].playerId).toBe(2);
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
    const everyDay = draftXBags({ ...player(1, 3, 300), platoon: record(40, 1) }, 6, odds, rotations, at)!;
    const bench = draftXBags({ ...player(1, 3, 300), platoon: record(5, 9) }, 6, odds, rotations, at)!;
    expect(everyDay).toBeGreaterThan(2 * bench);
  });
});
