import { describe, expect, it } from 'vitest';

import {
  type AlmanacInput,
  type AlmanacStat,
  type ScoutingInput,
  almanac,
  almanacFromJson,
  almanacToJson,
  badges,
  headToHead,
  scouting,
} from '../supabase/functions/_shared/core/almanac.ts';
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

  it("adds up a player's seasons for a manager, and keeps each one", () => {
    const inp = input();
    inp.seasons.push({ id: 's2', year: 2022, complete: true });
    inp.teams.push({ id: 'A2', seasonId: 's2', managerKey: 'a', eliminatedAfterRound: null });
    inp.spells.push({ seasonId: 's2', teamId: 'A2', playerId: 4, from: '2022-10-01T00:00:00Z', to: null });
    inp.stats.push({ ...stat(4, 'F', 3), seasonId: 's2', gameStart: '2022-10-05T00:00:00Z' });
    expect(almanac(inp).playersByManager.get('a')![0]).toEqual({
      playerId: 4,
      tb: 18,
      years: [2021, 2022],
      seasons: [{ year: 2021, tb: 15 }, { year: 2022, tb: 3 }],
    });
  });

  it('finds the closest cuts', () => {
    expect(a.closestCuts.map((c) => [c.round, c.through.managerKeys, c.out.managerKeys, c.margin, c.decidedBy])).toEqual([
      [2, ['a'], ['b'], 3, 'TB'],
      [1, ['a'], ['c'], 6, 'TB'],
    ]);
  });

  it('shows every team tied at the cut, in ranking order, and the tiebreaker that settled it', () => {
    // All three score 4 bags in round 1 and two go through. Slugging decides it: P needed the
    // fewest at-bats, then Q, so R is out.
    const line = (playerId: number, ab: number, tb: number): AlmanacStat => ({
      gamePk: ++pk, seasonId: 't', seriesGameNumber: 1, playerId, gameType: 'F', gameStart: START.F,
      ab, h: 1, bb: 0, hbp: 0, sf: 0, tb, hr: 0, r: 0, rbi: 0,
    });
    const tie = almanac({
      seasons: [{ id: 't', year: 2025, complete: true }],
      // Loaded in an order that isn't the ranking, which must not matter.
      teams: [
        { id: 'R', seasonId: 't', managerKey: 'r', eliminatedAfterRound: 1 },
        { id: 'Q', seasonId: 't', managerKey: 'q', eliminatedAfterRound: 2 },
        { id: 'P', seasonId: 't', managerKey: 'p', eliminatedAfterRound: null },
      ],
      managers: [{ key: 'p', name: 'P' }, { key: 'q', name: 'Q' }, { key: 'r', name: 'R' }],
      spells: [
        { seasonId: 't', teamId: 'P', playerId: 1, from: START.F, to: null },
        { seasonId: 't', teamId: 'Q', playerId: 2, from: START.F, to: null },
        { seasonId: 't', teamId: 'R', playerId: 3, from: START.F, to: null },
      ],
      stats: [line(1, 4, 4), line(2, 5, 4), line(3, 8, 4)],
      redrafts: [],
    });
    const cut = tie.closestCuts.find((c) => c.round === 1)!;
    expect(cut).toMatchObject({ through: { managerKeys: ['p', 'q'], tb: 4 }, out: { managerKeys: ['r'], tb: 4 }, margin: 0, decidedBy: 'SLG' });
  });

  it('weighs redrafts: bags the added player scored against the dropped one’s after the drop', () => {
    expect(a.redrafts).toEqual([
      { managerKey: 'a', year: 2021, draftNumber: 2, add: 4, drop: 1, addedTb: 15, droppedTb: 3 },
    ]);
  });
});

/**
 * input() plus the 2026 season being played: round 1 is closed (Curtis out), round 2 is under way.
 * Alex's player 10 scored 12 in round 1 and 5 in round 2 so far; Bill's 11 scored 6, then
 * Curtis's 12 scored 2 and is done.
 */
function liveInput(): AlmanacInput {
  const inp = input();
  const at = (t: GameType) => START[t].replace('2021', '2026');
  const line = (playerId: number, gameType: GameType, tb: number): AlmanacStat => ({ ...stat(playerId, gameType, tb), seasonId: 'live', gameStart: at(gameType) });
  inp.teams.push(
    { id: 'LA', seasonId: 'live', managerKey: 'a', eliminatedAfterRound: null },
    { id: 'LB', seasonId: 'live', managerKey: 'b', eliminatedAfterRound: null },
    { id: 'LC', seasonId: 'live', managerKey: 'c', eliminatedAfterRound: 1 },
  );
  inp.spells.push(
    { seasonId: 'live', teamId: 'LA', playerId: 10, from: at('F'), to: null },
    { seasonId: 'live', teamId: 'LB', playerId: 11, from: at('F'), to: null },
    { seasonId: 'live', teamId: 'LC', playerId: 12, from: at('F'), to: null },
  );
  inp.stats.push(line(10, 'F', 12), line(10, 'L', 5), line(11, 'D', 6), line(12, 'F', 2));
  return inp;
}

describe('the season being played', () => {
  const a = almanac(liveInput());

  it('counts its closed rounds, not the open one', () => {
    expect(a.liveYear).toBe(2026);
    expect(a.bestRounds[1].filter((r) => r.year === 2026).map((r) => [r.managerKey, r.tb])).toEqual([['a', 12], ['b', 6], ['c', 2]]);
    expect(a.bestRounds[2].some((r) => r.year === 2026)).toBe(false);
    expect(a.closestCuts.find((c) => c.year === 2026)).toMatchObject({ round: 1, through: { managerKeys: ['b'] }, out: { managerKeys: ['c'] }, margin: 4 });
  });

  it('has no champion or finishes yet, and keeps careers to finished seasons plus live bags', () => {
    expect(a.champions.map((c) => c.year)).toEqual([2021]);
    expect(a.careers.map((c) => [c.name, c.seasons, c.bags, c.liveBags])).toEqual([
      ['Alex', 1, 20, 17],
      ['Bill', 1, 11, 6],
      ['Curtis', 1, 1, 2],
    ]);
    const live = (m: string) => a.teamSeasons.find((t) => t.year === 2026 && t.managerKey === m)!;
    expect([live('a').alive, live('c').alive, live('c').live]).toEqual([true, false, true]);
    expect(live('a').rounds.map((r) => r.round)).toEqual([1]);
  });

  it('takes finished games for single-game records, and a bagger’s total once it is final', () => {
    expect(a.bestPlayerGames[0]).toMatchObject({ year: 2026, playerId: 10, tb: 12 });
    // Curtis is out, so player 12's 2 bags are final; Alex and Bill are still going.
    const live = a.bestPlayerSeasons.filter((p) => p.year === 2026);
    expect(live.map((p) => p.playerId)).toEqual([12]);
    const out = liveInput();
    out.playersOut = new Set(['live:10']);
    expect(almanac(out).bestPlayerSeasons[0]).toMatchObject({ year: 2026, playerId: 10, tb: 17 });
  });

  it('duels the closed rounds but not the season', () => {
    const h = headToHead(a, 'a', 'b')!;
    expect(h.seasons.map((s) => s.year)).toEqual([2021]);
    expect(h.rounds.filter((r) => r.year === 2026).map((r) => [r.round, r.a, r.b])).toEqual([[1, 12, 6]]);
  });

  it('counts its closed rounds in the cut margins', () => {
    // Curtis gets to 4 in round 1: Bill (6) made the cut by 2, Curtis missed it by 2.
    const inp = liveInput();
    inp.stats.push({ ...stat(12, 'F', 2), seasonId: 'live', gameStart: START.F.replace('2021', '2026') });
    const s = scouting(inp, { picks: [], players: [], seriesTeams: [] }, almanac(inp));
    const of = (k: string) => s.find((x) => x.key === k)!;
    expect([of('b').closeEscapes, of('c').heartbreaks]).toEqual([1, 1]);
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

describe('almanacToJson', () => {
  it('survives JSON and comes back with its Maps', () => {
    const inp = input();
    const al = almanac(inp);
    const data = {
      almanac: al,
      managers: new Map(inp.managers.map((m) => [m.key, m.name])),
      accounts: new Map([['a', 'user-a']]),
      players: new Map([[1, 'One'], [4, 'Four']]),
      scouting: [],
      badges: new Map([['a', [{ emoji: '🎯', name: 'Sharp', reason: 'Why' }]]]),
      bets: [{ managerKey: 'a', year: 2021, playerId: 1, pick: 1, xBags: 9.5, bags: 8, diff: -1.5, live: false }],
    };
    const back = almanacFromJson(JSON.parse(JSON.stringify(almanacToJson(data))));
    expect(back).toEqual(data);
    expect(back.almanac.playersByManager.get('a')).toEqual(al.playersByManager.get('a'));
    expect(back.players.get(4)).toBe('Four');
  });
});
