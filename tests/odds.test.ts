import { describe, expect, it } from 'vitest';

import { type OddsTeam, type SeriesState, gameWinChance, postseasonOdds, seriesOdds, strength } from '../supabase/functions/_shared/core/odds.ts';
import { type StandingsTeam, expectedBags, playoffSeeds } from '../supabase/functions/_shared/core/stats.ts';

describe('seriesOdds', () => {
  it('gives the coin-flip lengths for even teams, with a small edge to the host', () => {
    const bo3 = seriesOdds(0.5, 0.5, 3);
    const bo5 = seriesOdds(0.5, 0.5, 5);
    const bo7 = seriesOdds(0.5, 0.5, 7);
    expect(bo3.games).toBeCloseTo(2.5, 1);
    expect(bo5.games).toBeCloseTo(4.125, 1);
    expect(bo7.games).toBeCloseTo(5.8125, 1);
    // The Wild Card's higher seed hosts every game.
    expect(bo3.win).toBeGreaterThan(0.52);
    expect(bo7.win).toBeGreaterThan(0.5);
    expect(bo7.win).toBeLessThan(0.53);
  });

  it('starts a series from its score', () => {
    const upTwo = seriesOdds(0.5, 0.5, 5, [2, 0]);
    expect(upTwo.win).toBeGreaterThan(0.85);
    expect(upTwo.games).toBeLessThan(2);
    expect(seriesOdds(0.5, 0.5, 5, [3, 1])).toEqual({ win: 1, games: 0 });
  });

  it('favors the stronger team', () => {
    expect(gameWinChance(strength(100), strength(81), false)).toBeGreaterThan(0.5);
    expect(seriesOdds(strength(100), strength(81), 7).win).toBeGreaterThan(seriesOdds(strength(90), strength(81), 7).win);
  });
});

/** Daniel's 2026 projections, a few days before the season ended. */
const TEAMS: Record<string, { league: 'AL' | 'NL'; wins: number; ws: number }> = {
  Rays: { league: 'AL', wins: 98, ws: 10.9 },
  Guardians: { league: 'AL', wins: 85, ws: 7.3 },
  Astros: { league: 'AL', wins: 79, ws: 1.3 },
  Rangers: { league: 'AL', wins: 80, ws: 0.9 },
  Yankees: { league: 'AL', wins: 93, ws: 8.4 },
  'Red Sox': { league: 'AL', wins: 87, ws: 6.2 },
  'White Sox': { league: 'AL', wins: 83, ws: 4.6 },
  Brewers: { league: 'NL', wins: 102, ws: 23.4 },
  Dodgers: { league: 'NL', wins: 99, ws: 18.5 },
  Braves: { league: 'NL', wins: 94, ws: 5.6 },
  Padres: { league: 'NL', wins: 89, ws: 3.2 },
  Cubs: { league: 'NL', wins: 88, ws: 6.8 },
  Phillies: { league: 'NL', wins: 87, ws: 1.9 },
  Diamondbacks: { league: 'NL', wins: 86, ws: 0.9 },
};
const ids = new Map(Object.keys(TEAMS).map((name, i) => [name, i + 1]));
const id = (name: string) => ids.get(name)!;

function field(al: string[], nl: string[]): OddsTeam[] {
  return [
    ...al.map((name, i) => ({ teamId: id(name), league: 'AL' as const, seed: i + 1, wins: TEAMS[name].wins })),
    ...nl.map((name, i) => ({ teamId: id(name), league: 'NL' as const, seed: i + 1, wins: TEAMS[name].wins })),
  ];
}
const bracket = (al3: string, nl6: string) =>
  field(['Rays', 'Guardians', al3, 'Yankees', 'Red Sox', 'White Sox'], ['Brewers', 'Dodgers', 'Braves', 'Padres', 'Cubs', nl6]);

describe('postseasonOdds', () => {
  it("lands within a few points of Daniel's projections", () => {
    // Two spots were still open: weight each bracket by his chances.
    const title = new Map<string, number>();
    for (const [al3, pAl] of [['Astros', 0.634], ['Rangers', 0.366]] as const) {
      for (const [nl6, pNl] of [['Phillies', 0.7], ['Diamondbacks', 0.3]] as const) {
        const odds = postseasonOdds(bracket(al3, nl6), [])!;
        for (const name of Object.keys(TEAMS)) title.set(name, (title.get(name) ?? 0) + pAl * pNl * (odds.get(id(name))?.title ?? 0));
      }
    }
    const diffs = Object.entries(TEAMS).map(([name, t]) => Math.abs(100 * title.get(name)! - t.ws));
    expect(diffs.reduce((a, b) => a + b, 0) / diffs.length).toBeLessThan(3);
    expect(Math.max(...diffs)).toBeLessThan(9);
    const total = [...title.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('gives bye teams their Division Series odds and more games for better teams', () => {
    const odds = postseasonOdds(bracket('Astros', 'Phillies'), [])!;
    expect(odds.get(id('Brewers'))!.advance).toBeGreaterThan(0.55);
    expect(odds.get(id('Yankees'))!.advance).toBeGreaterThan(0.5); // hosts the Red Sox
    expect(odds.get(id('Brewers'))!.games).toBeGreaterThan(odds.get(id('Phillies'))!.games);
    // Every team plays its first series: at least 2 Wild Card or 3 Division Series games.
    for (const [, o] of odds) expect(o.games).toBeGreaterThan(2);
  });

  it('follows the series as they go', () => {
    const teams = bracket('Astros', 'Phillies');
    const series: SeriesState[] = [
      { gameType: 'F', teams: [id('Yankees'), id('Red Sox')], wins: [0, 2], winner: id('Red Sox') },
      { gameType: 'F', teams: [id('Astros'), id('White Sox')], wins: [1, 0], winner: null },
    ];
    const odds = postseasonOdds(teams, series)!;
    expect(odds.get(id('Yankees'))).toEqual({ advance: 0, games: 0, title: 0 });
    // The Red Sox won their Wild Card: now it's the Division Series against the Rays.
    expect(odds.get(id('Red Sox'))!.advance).toBeLessThan(0.5);
    expect(odds.get(id('Red Sox'))!.games).toBeGreaterThan(3);
    // Up 1-0, hosting game 2.
    expect(odds.get(id('Astros'))!.advance).toBeGreaterThan(0.7);
  });

  it('needs a full 6 seeds per league', () => {
    expect(postseasonOdds(bracket('Astros', 'Phillies').filter((t) => t.seed !== 6), [])).toBeNull();
  });
});

describe('playoffSeeds', () => {
  const team = (teamId: number, league: 'AL' | 'NL', divisionRank: number, leagueRank: number): StandingsTeam => ({ teamId, league, divisionRank, leagueRank });

  it('seeds division winners 1–3 and wild cards 4–6 by league rank', () => {
    const standings = [
      team(1, 'AL', 1, 1), team(2, 'AL', 2, 2), team(3, 'AL', 1, 3), team(4, 'AL', 2, 4),
      team(5, 'AL', 1, 6), team(6, 'AL', 3, 5), team(7, 'AL', 2, 7), team(8, 'AL', 4, 8),
    ];
    const seeds = playoffSeeds(standings, [1, 2, 3, 4, 5, 6]);
    expect([1, 3, 5, 2, 4, 6, 7].map((t) => seeds.get(t))).toEqual([1, 2, 3, 4, 5, 6, undefined]);
    expect(seeds.has(8)).toBe(false);
  });

  it('leaves out a league that is not 3 division winners and 3 wild cards', () => {
    expect(playoffSeeds([team(1, 'AL', 1, 1), team(2, 'AL', 2, 2)], [1, 2]).size).toBe(0);
  });
});

describe('expectedBags', () => {
  it('is RDSLG times his at-bats per game times the games left', () => {
    // 300 TB in 600 AB over 150 games: RDSLG (300 + 87) / 800, 4 AB a game, 8 games left.
    expect(expectedBags(300, 600, 150, 8)).toBeCloseTo(((300 + 87) / 800) * 4 * 8, 6);
    expect(expectedBags(0, 0, 0, 8)).toBeNull();
  });
});
