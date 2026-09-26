import { describe, expect, it } from 'vitest';

import { type AlmanacInput, type AlmanacStat, type ScoutingInput, almanac, badges, headToHead, scouting } from '../supabase/functions/_shared/core/almanac.ts';
import type { GameType } from '../supabase/functions/_shared/core/types.ts';

const START: Record<GameType, string> = {
  F: '2021-10-05T00:00:00Z',
  D: '2021-10-07T00:00:00Z',
  L: '2021-10-15T00:00:00Z',
  W: '2021-10-26T00:00:00Z',
};

let pk = 0;
function stat(playerId: number, gameType: GameType, tb: number): AlmanacStat {
  return {
    gamePk: ++pk, seasonId: 's', seriesGameNumber: 1, playerId, gameType, gameStart: START[gameType],
    ab: 4, h: 1, bb: 0, hbp: 0, sf: 0, tb, hr: 0, r: 0, rbi: 0,
  };
}

/**
 * One season, three teams: A (manager a) wins; B (b) goes out after round 2; C (c) after round 1.
 * In Draft 2, A drops player 1 for player 4. Player 2 has a big World Series game after B is out,
 * which must not count.
 */
function input(): AlmanacInput {
  return {
    seasons: [{ id: 's', year: 2021, complete: true }, { id: 'live', year: 2026, complete: false }],
    teams: [
      { id: 'A', seasonId: 's', managerKey: 'a', eliminatedAfterRound: null },
      { id: 'B', seasonId: 's', managerKey: 'b', eliminatedAfterRound: 2 },
      { id: 'C', seasonId: 's', managerKey: 'c', eliminatedAfterRound: 1 },
    ],
    managers: [{ key: 'a', name: 'Alex' }, { key: 'b', name: 'Bill' }, { key: 'c', name: 'Curtis' }],
    spells: [
      { seasonId: 's', teamId: 'A', playerId: 1, from: START.F, to: START.D },
      { seasonId: 's', teamId: 'A', playerId: 4, from: START.D, to: null },
      { seasonId: 's', teamId: 'B', playerId: 2, from: START.F, to: null },
      { seasonId: 's', teamId: 'C', playerId: 3, from: START.F, to: null },
    ],
    stats: [
      stat(1, 'F', 5), stat(1, 'D', 3),
      stat(4, 'D', 2), stat(4, 'L', 6), stat(4, 'W', 7),
      stat(2, 'F', 4), stat(2, 'D', 4), stat(2, 'L', 3), stat(2, 'W', 9),
      stat(3, 'F', 1),
    ],
    redrafts: [{ seasonId: 's', teamId: 'A', draftNumber: 2, add: 4, drop: 1, at: START.D }],
  };
}

describe('almanac', () => {
  const a = almanac(input());

  it('places teams by when they went out, then by that round’s ranking', () => {
    const place = (m: string) => a.teamSeasons.find((t) => t.managerKey === m)!.place;
    expect([place('a'), place('b'), place('c')]).toEqual([1, 2, 3]);
    expect(a.teamSeasons).toHaveLength(3); // the unfinished 2026 season doesn't count
    expect(a.champions).toEqual([expect.objectContaining({ year: 2021 })]);
    expect(a.champions[0].champion.managerKey).toBe('a');
    expect(a.champions[0].runnerUp?.managerKey).toBe('b');
  });

  it('scores each round like the standings, with the round average', () => {
    const alex = a.teamSeasons.find((t) => t.managerKey === 'a')!;
    expect(alex.rounds.map((r) => [r.round, r.tb, r.rank])).toEqual([[1, 7, 2], [2, 6, 1], [3, 7, 1]]);
    expect(alex.rounds[0].average).toBeCloseTo((7 + 8 + 1) / 3);
    expect(alex.bags).toBe(20);
  });

  it('sums careers', () => {
    expect(a.careers.map((c) => [c.name, c.titles, c.roundsSurvived, c.roundsPlayed, c.bags])).toEqual([
      ['Alex', 1, 3, 3, 20],
      ['Bill', 0, 1, 2, 11],
      ['Curtis', 0, 0, 1, 1],
    ]);
  });

  it('only counts games a player played for a team still alive', () => {
    expect(a.bestPlayerGames[0]).toMatchObject({ managerKey: 'a', playerId: 4, tb: 7, gameType: 'W' });
    expect(a.bestPlayerGames.some((g) => g.tb === 9)).toBe(false);
    expect(a.bestPlayerSeasons.slice(0, 2).map((p) => [p.playerId, p.tb])).toEqual([[4, 15], [2, 11]]);
    expect(a.playersByManager.get('a')!.map((p) => [p.playerId, p.tb])).toEqual([[4, 15], [1, 5]]);
  });

  it('finds the closest cuts', () => {
    expect(a.closestCuts.map((c) => [c.round, c.through.managerKey, c.out.managerKey, c.margin])).toEqual([
      [2, 'a', 'b', 3],
      [1, 'a', 'c', 6],
    ]);
  });

  it('weighs redrafts: bags the added player scored against the dropped one’s after the drop', () => {
    expect(a.redrafts).toEqual([
      { managerKey: 'a', year: 2021, draftNumber: 2, add: 4, drop: 1, addedTb: 15, droppedTb: 3 },
    ]);
  });
});

describe('headToHead', () => {
  const a = almanac(input());

  it('compares the seasons and rounds both managers played', () => {
    const h = headToHead(a, 'a', 'b')!;
    expect(h.seasons.map((s) => [s.year, s.winner])).toEqual([[2021, 'a']]);
    // Round 1: Bill 8 beat Alex 7; round 2: Alex 6 beat Bill 3. Bill wasn't in round 3.
    expect(h.rounds.map((r) => [r.round, r.a, r.b, r.winner])).toEqual([[1, 7, 8, 'b'], [2, 6, 3, 'a']]);
    expect(h.record).toEqual({ seasons: { a: 1, b: 0 }, rounds: { a: 1, b: 1, ties: 0 } });
  });

  it('needs two different managers who have played', () => {
    expect(headToHead(a, 'a', 'a')).toBeNull();
    expect(headToHead(a, 'a', 'nobody')).toBeNull();
  });
});

describe('scouting', () => {
  // Draft 1: A takes 1, B takes 2, C takes 3 (one round each). Draft 2: A swaps 1 for 4.
  // Only player 1's MLB team (100) reached the Championship Series.
  const scout: ScoutingInput = {
    picks: [
      { seasonId: 's', teamId: 'A', draftNumber: 1, actionNumber: 0, type: 'pick', add: 1, drop: null },
      { seasonId: 's', teamId: 'B', draftNumber: 1, actionNumber: 1, type: 'pick', add: 2, drop: null },
      { seasonId: 's', teamId: 'C', draftNumber: 1, actionNumber: 2, type: 'pick', add: 3, drop: null },
      { seasonId: 's', teamId: 'A', draftNumber: 2, actionNumber: 0, type: 'pick', add: 4, drop: 1 },
    ],
    players: [
      { seasonId: 's', playerId: 1, mlbTeamId: 100 },
      { seasonId: 's', playerId: 2, mlbTeamId: 200 },
      { seasonId: 's', playerId: 3, mlbTeamId: 300 },
    ],
    seriesTeams: [{ seasonId: 's', gameType: 'L', mlbTeamIds: [100, 400] }],
  };
  const inp = input();
  const s = scouting(inp, scout, almanac(inp));
  const of = (k: string) => s.find((x) => x.key === k)!;

  it('scores round-1 picks and how deep their MLB teams went', () => {
    expect([of('a').firstRoundBags, of('b').firstRoundBags, of('c').firstRoundBags]).toEqual([5, 11, 1]);
    expect([of('a').crystalBall, of('b').crystalBall]).toEqual([1, 0]);
  });

  it('counts swaps and whether they paid off', () => {
    expect(of('a')).toMatchObject({ swapsPerSeason: 1, swapWinRate: 1 });
    expect(of('b')).toMatchObject({ swapsPerSeason: 0, swapWinRate: null });
  });

  it('finds close cuts: Alex cleared round 2 by 3, Bill missed it by 3', () => {
    expect([of('a').closeEscapes, of('b').heartbreaks, of('c').heartbreaks]).toEqual([1, 1, 0]);
  });

  it('gives badges to the league leaders who qualify', () => {
    const b = badges(s, 1);
    expect(b.get('b')!.map((x) => x.name)).toContain('First-round ace');
    expect(b.get('a')!.map((x) => x.name)).toContain('Crystal ball');
    expect(b.get('a')!.map((x) => x.name)).toContain('Tinkerer');
    expect(badges(s, 2).get('a')).toEqual([]); // nobody has 2 seasons
  });
});
