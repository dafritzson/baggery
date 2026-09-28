import { describe, expect, it } from 'vitest';

import { expectedGames, roundMatchups } from '../supabase/functions/_shared/core/matchups.ts';
import { seriesGameChances, seriesOdds } from '../supabase/functions/_shared/core/odds.ts';
import {
  BENCH_PA,
  type Hand,
  LEAGUE_LHP_SHARE,
  type LineupGame,
  PA_BY_SPOT,
  expectedPaOver,
  expectedPaPerGame,
  expectedStartsOver,
  likelyRotation,
  lineupSplits,
  paPerStart,
  platoonSide,
  seriesStarters,
  startChance,
  usualSpot,
} from '../supabase/functions/_shared/core/platoon.ts';
import { postseasonSeries } from '../supabase/functions/_shared/core/schedule.ts';

/** `n` games on consecutive days from `start`, each with the given starter's hand and his spot. */
function games(n: number, hand: Hand, spot: number | null, start = '2026-07-01'): LineupGame[] {
  const t = Date.parse(start);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(t + i * 86_400_000).toISOString().slice(0, 10),
    starterHand: hand,
    spot,
  }));
}

/** A season interleaved day by day: every 4th game against a lefty, like a real schedule. */
function season(spotVsL: number | null, spotVsR: number | null, days = 120): LineupGame[] {
  const t = Date.parse('2026-05-01');
  return Array.from({ length: days }, (_, i) => {
    const lefty = i % 4 === 0;
    return {
      date: new Date(t + i * 86_400_000).toISOString().slice(0, 10),
      starterHand: lefty ? 'L' : 'R',
      spot: lefty ? spotVsL : spotVsR,
    } satisfies LineupGame;
  });
}

describe('lineupSplits', () => {
  it('counts recent games for more', () => {
    const splits = lineupSplits([...games(1, 'R', 5, '2026-06-01'), ...games(1, 'R', 2, '2026-07-01')]);
    // The June game is 30 days older: half the weight. Still 2 games' worth in all.
    expect(splits.R.games).toBeCloseTo(2);
    expect(splits.R.spots[1]).toBeCloseTo(2 * splits.R.spots[4]);
    expect(usualSpot(splits.R)).toBe(2);
  });
});

describe('platoonSide', () => {
  it('finds a hitter who only starts against lefties', () => {
    const splits = lineupSplits(season(2, null));
    expect(platoonSide(splits)).toBe('L');
    expect(startChance(splits, 'L')).toBeGreaterThan(0.8);
    expect(startChance(splits, 'R')).toBeLessThan(0.1);
  });

  it('leaves everyday players and bench players alone', () => {
    expect(platoonSide(lineupSplits(season(3, 3)))).toBeNull();
    expect(platoonSide(lineupSplits(season(null, null)))).toBeNull();
  });

  it("doesn't call a platoon from a handful of games against one hand", () => {
    // An everyday player who sat the last 2 of 3 games against lefties.
    const splits = lineupSplits([...season(4, 4, 60), ...games(2, 'L', null, '2026-07-01')]);
    expect(platoonSide(splits)).toBeNull();
  });
});

describe('paPerStart', () => {
  it('follows his spot against each hand', () => {
    const splits = lineupSplits(season(2, 7));
    expect(paPerStart(splits, 'L')).toBeCloseTo(PA_BY_SPOT[1]);
    expect(paPerStart(splits, 'R')).toBeCloseTo(PA_BY_SPOT[6]);
    expect(usualSpot(splits.L)).toBe(2);
    expect(usualSpot(splits.R)).toBe(7);
  });

  it('gives a leadoff hitter most of a time up more a game than a 9th hitter', () => {
    const leadoff = expectedPaPerGame(lineupSplits(season(1, 1)), LEAGUE_LHP_SHARE);
    const ninth = expectedPaPerGame(lineupSplits(season(9, 9)), LEAGUE_LHP_SHARE);
    expect(leadoff - ninth).toBeGreaterThan(0.8);
  });
});

describe('expectedPaPerGame', () => {
  const platoon = lineupSplits(season(2, null));
  it('is a full game of plate appearances against a lefty, and bench scraps against a righty', () => {
    expect(expectedPaPerGame(platoon, 1)).toBeGreaterThan(3.8);
    expect(expectedPaPerGame(platoon, 0)).toBeLessThan(0.7);
    expect(expectedPaPerGame(platoon, 0)).toBeGreaterThan(BENCH_PA);
  });

  it('counts the known games and league-average starters for the rest', () => {
    const vsLefties = expectedPaOver(platoon, [{ chance: 1, lhpChance: 1 }, { chance: 1, lhpChance: 1 }], 2);
    const vsRighties = expectedPaOver(platoon, [{ chance: 1, lhpChance: 0 }, { chance: 1, lhpChance: 0 }], 2);
    expect(vsLefties).toBeGreaterThan(4 * vsRighties);
    expect(expectedPaOver(platoon, [], 3)).toBeCloseTo(3 * expectedPaPerGame(platoon, LEAGUE_LHP_SHARE));
  });
});

describe('likelyRotation and seriesStarters', () => {
  // Five starters through September, the 5th (id 5) skipped once rosters tighten... and a spot
  // starter (id 9) in July.
  const starts = [
    { date: '2026-07-10', pitcherId: 9, hand: 'L' as Hand },
    ...Array.from({ length: 25 }, (_, i) => ({
      date: new Date(Date.parse('2026-09-01') + i * 86_400_000).toISOString().slice(0, 10),
      pitcherId: (i % 5) + 1,
      hand: (i % 5) + 1 === 3 ? ('L' as Hand) : ('R' as Hand),
    })),
  ];
  const rotation = likelyRotation(starts);

  it('keeps the 4 pitchers with the most recent starts, in turn order', () => {
    expect(rotation).toHaveLength(4);
    expect(rotation.map((p) => p.pitcherId)).not.toContain(9);
    // Everyone had 5 starts: the ties go to who pitched last, and they're listed oldest turn first.
    expect(rotation.map((p) => p.pitcherId)).toEqual([2, 3, 4, 5]);
  });

  it('uses announced starters, then picks up the rotation after them', () => {
    const starters = seriesStarters(rotation, [{ pitcherId: 3, hand: 'L' }], 5);
    expect(starters.map((s) => s?.pitcherId)).toEqual([3, 4, 5, 2, 3]);
    expect(starters.map((s) => s?.announced)).toEqual([true, false, false, false, false]);
    expect(starters.map((s) => s?.hand)).toEqual(['L', 'R', 'R', 'R', 'L']);
    expect(seriesStarters([], [], 3)).toEqual([null, null, null]);
  });
});

describe('seriesGameChances', () => {
  it('adds up to the expected series length', () => {
    for (const bestOf of [3, 5, 7]) {
      const chances = seriesGameChances(0.55, 0.5, bestOf);
      expect(chances.reduce((a, b) => a + b, 0)).toBeCloseTo(seriesOdds(0.55, 0.5, bestOf).games, 6);
      expect(chances.slice(0, Math.floor(bestOf / 2) + 1)).toEqual(Array(Math.floor(bestOf / 2) + 1).fill(1));
    }
    const bo5 = seriesGameChances(0.5, 0.5, 5);
    expect(bo5[3]).toBeCloseTo(0.75, 1);
    expect(bo5[4]).toBeCloseTo(0.375, 1);
  });

  it('starts from the score', () => {
    const chances = seriesGameChances(0.5, 0.5, 5, [2, 1]);
    expect(chances.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(chances[4]).toBeGreaterThan(0.4);
    expect(chances[4]).toBeLessThan(0.6);
    expect(seriesGameChances(0.5, 0.5, 5, [3, 0])).toEqual([1, 1, 1, 0, 0]);
  });
});

describe('roundMatchups', () => {
  // AL seeds 1–6 (ids 1–6); NL left out.
  const field = [1, 2, 3, 4, 5, 6].map((seed) => ({ teamId: seed, league: 'AL' as const, seed, wins: 100 - seed * 3 }));
  const lefty = (id: number) => ({ pitcherId: id, name: `L${id}`, hand: 'L' as Hand });
  const righty = (id: number) => ({ pitcherId: id, name: `R${id}`, hand: 'R' as Hand });
  const rotations = new Map([
    [6, [righty(61), lefty(62), righty(63), righty(64)]],
    [2, [righty(21), righty(22), lefty(23), righty(24)]],
    [5, [lefty(51), lefty(52), righty(53), righty(54)]],
  ]);
  const input = { field, series: [], rotations, probables: new Map() };

  it("gives a Wild Card team its series and the Division Series it would play, weighted by getting there", () => {
    const [wc, ds] = roundMatchups(3, input);
    expect(wc).toMatchObject({ gameType: 'F', opponentId: 6, likely: false });
    expect(wc.games.map((g) => g.starter?.hand)).toEqual(['R', 'L', 'R']);
    expect(wc.games[0].chance).toBe(1);
    expect(wc.games[2].chance).toBeGreaterThan(0.4);
    expect(ds.opponentId).toBe(2);
    expect(ds.games[0].chance).toBeGreaterThan(0.5);
    expect(ds.games[0].chance).toBeLessThan(1);
    expect(ds.games.map((g) => g.starter?.hand)).toEqual(['R', 'R', 'L', 'R', 'R']);
    const expected = expectedGames([wc, ds]);
    expect(expected).toHaveLength(8);
    expect(expected[1]).toEqual({ chance: 1, lhpChance: 1 });
  });

  it('gives a bye team the likelier Wild Card winner', () => {
    const [ds] = roundMatchups(1, input);
    expect(ds).toMatchObject({ gameType: 'D', opponentId: 4, likely: true });
    // Team 4 has no rotation on file: no starters, so league-average odds of a lefty.
    expect(ds.games[0].starter).toBeNull();
    expect(expectedGames([ds])[0].lhpChance).toBe(LEAGUE_LHP_SHARE);
  });

  it('follows a series under way, with its announced starters', () => {
    const g = (n: number, status: string, homeScore: number | null, awayScore: number | null) => ({
      gamePk: 100 + n,
      gameType: 'F' as const,
      seriesGameNumber: n,
      start: `2026-09-${29 + n}T18:00:00Z`,
      status,
      homeTeamId: 3,
      awayTeamId: 6,
      homeScore,
      awayScore,
      gamesInSeries: 3,
    });
    const series = postseasonSeries([g(1, 'Final', 5, 2), g(2, 'Preview', null, null)]);
    const probables = new Map([['102:6', { pitcherId: 99, name: 'Opener', hand: 'L' as Hand }]]);
    const [wc] = roundMatchups(3, { ...input, series, probables });
    expect(wc.games[0]).toMatchObject({ played: true, chance: 1 });
    expect(wc.games[1].starter).toMatchObject({ pitcherId: 99, announced: true, hand: 'L' });
    // Up 1–0: game 3 is less likely than at 0–0.
    expect(wc.games[2].chance).toBeLessThan(0.5);
    expect(expectedGames([wc])).toHaveLength(2);
  });
});

describe('expectedStartsOver', () => {
  it('counts a platoon hitter as starting the lefties', () => {
    const splits = lineupSplits(season(2, null));
    const starts = expectedStartsOver(splits, [{ chance: 1, lhpChance: 1 }, { chance: 1, lhpChance: 0 }, { chance: 0.5, lhpChance: 0 }], 2.5);
    expect(starts).toBeGreaterThan(0.8);
    expect(starts).toBeLessThan(1.2);
  });
});
