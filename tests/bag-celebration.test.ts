import { describe, expect, it } from 'vitest';

import {
  BAG_EMOJI,
  type BagHit,
  bagHitBags,
  bagKey,
  bagParam,
  bagSummary,
  bagsInChanges,
  hitBags,
  hitHeadline,
  ordinal,
  parseBagParam,
  rainCount,
  shakeStrength,
} from '../supabase/functions/_shared/core/bag-celebration.ts';
import { type Row, type Scores, toGame } from '../supabase/functions/_shared/core/score-feed.ts';
import type { RosterSpell } from '../supabase/functions/_shared/core/scoring.ts';

const OHTANI = 660271;
const HARPER = 547180;
const NOW = Date.parse('2026-10-04T23:30:00Z');

const gameRow = (gamePk: number, over: Row = {}): Row => ({
  game_pk: gamePk,
  season_year: 2026,
  game_type: 'D',
  series_game_number: 1,
  start_time: '2026-10-04T22:08:00+00:00',
  start_time_tbd: false,
  official_date: '2026-10-04',
  status: 'Live',
  detailed_state: 'In Progress',
  home_team_id: 119,
  away_team_id: 143,
  home_score: 1,
  away_score: 0,
  live: null,
  games_in_series: 5,
  final_seen_at: null,
  ...over,
});

const statRow = (playerId: number, over: Row = {}): Row => ({
  game_pk: 1,
  mlb_player_id: playerId,
  tb: 0,
  ab: 1,
  h: 0,
  doubles: 0,
  triples: 0,
  hr: 0,
  bb: 0,
  hbp: 0,
  sf: 0,
  r: 0,
  rbi: 0,
  ...over,
});

/** Ohtani is on "mine", Harper on "theirs". */
const spells: RosterSpell[] = [
  { teamId: 'mine', playerId: OHTANI, from: '2026-09-28T00:00:00Z', to: null },
  { teamId: 'theirs', playerId: HARPER, from: '2026-09-28T00:00:00Z', to: null },
];

function scores(over: Partial<Scores> = {}): Scores {
  return {
    games: [toGame(gameRow(1))],
    // Ohtani has a single so far.
    stats: [{ gamePk: 1, playerId: OHTANI, tb: 1 }],
    lines: [{ gamePk: 1, playerId: OHTANI, ab: 2, h: 1, doubles: 0, triples: 0, hr: 0, bb: 0, spot: 3 }],
    ...over,
  };
}

describe('bagsInChanges', () => {
  it('finds a home run by your hitter', () => {
    const changes = { stats: [statRow(OHTANI, { tb: 5, ab: 3, h: 2, hr: 1 })] };
    expect(bagsInChanges(scores(), changes, spells, 'mine', NOW)).toEqual([
      { gamePk: 1, playerId: OHTANI, tb: 5, bags: 4, singles: 0, doubles: 0, triples: 0, hr: 1 },
    ]);
  });

  it("ignores other teams' hitters", () => {
    const changes = { stats: [statRow(HARPER, { tb: 2, h: 1, doubles: 1 })] };
    expect(bagsInChanges(scores(), changes, spells, 'mine', NOW)).toEqual([]);
    expect(bagsInChanges(scores(), changes, spells, 'theirs', NOW)).toHaveLength(1);
  });

  it('ignores lines whose total bases did not go up', () => {
    const changes = { stats: [statRow(OHTANI, { tb: 1, ab: 3, h: 1 })] };
    expect(bagsInChanges(scores(), changes, spells, 'mine', NOW)).toEqual([]);
  });

  it('ignores a scoring change that takes a bag away', () => {
    const changes = { stats: [statRow(OHTANI, { tb: 0, ab: 2, h: 0 })] };
    expect(bagsInChanges(scores(), changes, spells, 'mine', NOW)).toEqual([]);
  });

  it('counts a line it had not seen as starting from nothing', () => {
    const changes = { stats: [statRow(OHTANI, { tb: 2, h: 1, doubles: 1 })] };
    expect(bagsInChanges(scores({ stats: [], lines: [] }), changes, spells, 'mine', NOW)).toEqual([
      { gamePk: 1, playerId: OHTANI, tb: 2, bags: 2, singles: 0, doubles: 1, triples: 0, hr: 0 },
    ]);
  });

  it('counts bags for the team that had the hitter when the game started', () => {
    const traded: RosterSpell[] = [
      { teamId: 'theirs', playerId: OHTANI, from: '2026-09-28T00:00:00Z', to: '2026-10-05T00:00:00Z' },
      { teamId: 'mine', playerId: OHTANI, from: '2026-10-05T00:00:00Z', to: null },
    ];
    const changes = { stats: [statRow(OHTANI, { tb: 2, ab: 3, h: 2 })] };
    expect(bagsInChanges(scores(), changes, traded, 'mine', NOW)).toEqual([]);
    expect(bagsInChanges(scores(), changes, traded, 'theirs', NOW)).toHaveLength(1);
  });

  it('counts a bag read just after the game ended, not a scoring change hours later', () => {
    const changes = (finalSeenAt: string) => ({
      games: [gameRow(1, { status: 'Final', final_seen_at: finalSeenAt })],
      stats: [statRow(OHTANI, { tb: 2, ab: 3, h: 2 })],
    });
    expect(bagsInChanges(scores(), changes('2026-10-04T23:25:00Z'), spells, 'mine', NOW)).toHaveLength(1);
    expect(bagsInChanges(scores(), changes('2026-10-04T20:00:00Z'), spells, 'mine', NOW)).toEqual([]);
  });

  it('guesses the hit when the line from before is gone', () => {
    const changes = { stats: [statRow(OHTANI, { tb: 3, ab: 3, h: 2, doubles: 1 })] };
    expect(bagsInChanges(scores({ lines: [] }), changes, spells, 'mine', NOW)[0]).toMatchObject({ bags: 2, doubles: 1, singles: 0 });
  });

  it('finds nothing in a reload', () => {
    expect(bagsInChanges(scores(), { reload: true }, spells, 'mine', NOW)).toEqual([]);
  });

  it('skips games it does not know yet', () => {
    const changes = { stats: [statRow(OHTANI, { game_pk: 2, tb: 4, h: 1, hr: 1 })] };
    expect(bagsInChanges(scores(), changes, spells, 'mine', NOW)).toEqual([]);
  });
});

describe('bag links', () => {
  const bag: BagHit = { gamePk: 776123, playerId: OHTANI, tb: 6, bags: 4, singles: 0, doubles: 0, triples: 0, hr: 1 };

  it('round-trips a bag', () => {
    expect(parseBagParam(bagParam(bag))).toEqual(bag);
  });

  it('keeps negative hit counts from a scoring change', () => {
    const change = { ...bag, bags: 1, singles: -1, doubles: 1, hr: 0 };
    expect(parseBagParam(bagParam(change))).toEqual(change);
  });

  it('rejects anything else', () => {
    expect(parseBagParam(undefined)).toBeNull();
    expect(parseBagParam('')).toBeNull();
    expect(parseBagParam('1.2.3')).toBeNull();
    expect(parseBagParam('1.2.x.1.1.0.0.0')).toBeNull();
    expect(parseBagParam('1.2.3.0.0.0.0.0')).toBeNull();
  });

  it('names a bag by game, player and total bases', () => {
    expect(bagKey(bag)).toBe(`776123-${OHTANI}-6`);
  });
});

describe('hitHeadline', () => {
  it('names the hit', () => {
    expect(hitHeadline({ singles: 0, doubles: 0, triples: 0, hr: 1 })).toBe('Home run!');
    expect(hitHeadline({ singles: 2, doubles: 0, triples: 0, hr: 0 })).toBe('2 singles!');
    expect(hitHeadline({ singles: -1, doubles: 1, triples: 0, hr: 0 })).toBe('Scoring change');
  });
});

describe('rainCount', () => {
  const hit = (over: Partial<BagHit>): BagHit => ({ gamePk: 1, playerId: 1, tb: 1, bags: 1, singles: 1, doubles: 0, triples: 0, hr: 0, ...over });

  it('rains harder for more bags, hardest for a home run', () => {
    const single = rainCount(hit({}));
    const double = rainCount(hit({ bags: 2, singles: 0, doubles: 1 }));
    const homer = rainCount(hit({ bags: 4, singles: 0, hr: 1 }));
    expect(single).toBeLessThan(double);
    expect(double).toBeLessThan(homer);
  });
});

describe('shakeStrength', () => {
  const hit = (over: Partial<BagHit>): BagHit => ({ gamePk: 1, playerId: 1, tb: 1, bags: 1, singles: 1, doubles: 0, triples: 0, hr: 0, ...over });

  it('shakes harder and longer for more bags, hardest for a home run', () => {
    const single = shakeStrength(hit({}));
    const triple = shakeStrength(hit({ bags: 3, singles: 0, triples: 1 }));
    const homer = shakeStrength(hit({ bags: 4, singles: 0, hr: 1 }));
    expect(single.px).toBeLessThan(triple.px);
    expect(single.ms).toBeLessThan(triple.ms);
    expect(triple.px).toBeLessThan(homer.px);
    expect(triple.ms).toBeLessThan(homer.ms);
  });
});

describe('bagSummary', () => {
  const games = [toGame(gameRow(1, { game_type: 'L' })), toGame(gameRow(2, { start_time: '2026-09-30T22:00:00+00:00', status: 'Final' }))];
  const teams = [
    { id: 'mine', eliminatedAfterRound: null },
    { id: 'theirs', eliminatedAfterRound: null },
    { id: 'gone', eliminatedAfterRound: 1 },
  ];
  const stats = [
    { gamePk: 1, playerId: OHTANI, tb: 5, ab: 3, h: 2, hr: 1, rbi: 3 },
    { gamePk: 2, playerId: OHTANI, tb: 2, ab: 4, h: 1 },
    { gamePk: 1, playerId: HARPER, tb: 6, ab: 4, h: 3 },
  ];

  it("gives the hitter's game, postseason and team's place in the round", () => {
    expect(bagSummary({ gamePk: 1, playerId: OHTANI }, { games, stats, lines: [] }, spells, teams)).toEqual({
      game: stats[0],
      postseason: { bags: 7, games: 2 },
      // Championship Series (round 2): the team out after round 1 isn't in it.
      team: { teamId: 'mine', bags: 5, rank: 2, tied: false, of: 2 },
    });
  });

  it('says when the place is shared', () => {
    const even = [...stats.slice(0, 2), { ...stats[0], playerId: HARPER }];
    expect(bagSummary({ gamePk: 1, playerId: OHTANI }, { games, stats: even, lines: [] }, spells, teams).team).toMatchObject({
      rank: 1,
      tied: true,
    });
  });

  it('leaves out the team for a hitter nobody had', () => {
    const summary = bagSummary({ gamePk: 1, playerId: 1 }, { games, stats, lines: [] }, spells, teams);
    expect(summary).toEqual({ game: null, postseason: { bags: 0, games: 0 }, team: null });
  });
});

describe('ordinal', () => {
  it('adds the suffix', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});

describe('hitBags', () => {
  /** The bags split into runs of the same emoji. */
  const runs = (bags: string[]) =>
    bags.reduce<string[][]>((out, b) => {
      if (out.length && out[out.length - 1][0] === b) out[out.length - 1].push(b);
      else out.push([b]);
      return out;
    }, []);

  it('draws every bag of a hit alike, hit by hit, in order', () => {
    // A double, a single and a homer: 2 + 1 + 4.
    const bags = hitBags(7, ['2B', '1B', 'HR'], OHTANI, 813032);
    expect(bags).toHaveLength(7);
    expect(runs(bags).map((r) => r.length)).toEqual([2, 1, 4]);
    for (const b of bags) expect(BAG_EMOJI).toContain(b);
  });

  it("never repeats the previous hit's bag, across many players and games", () => {
    for (let player = 1; player <= 200; player++) {
      const bags = hitBags(8, ['1B', '1B', '1B', '1B', '1B', '1B', '1B', '1B'], player, 700000 + player);
      for (let i = 1; i < bags.length; i++) expect(bags[i]).not.toBe(bags[i - 1]);
    }
  });

  it('uses all six bags', () => {
    const seen = new Set<string>();
    for (let player = 1; player <= 300; player++) seen.add(hitBags(1, ['1B'], player, 1)[0]);
    expect(seen).toEqual(new Set(BAG_EMOJI));
  });

  it("keeps a row's bags as new hits come in", () => {
    const before = hitBags(3, ['2B', '1B'], OHTANI, 1);
    expect(hitBags(7, ['2B', '1B', 'HR'], OHTANI, 1).slice(0, 3)).toEqual(before);
  });

  it("draws the line's hits no play is matched to yet next, the same bags once they are", () => {
    // The box score has a homer that isn't matched to a play yet: drawn as one hit already,
    // and the same bags once it is.
    const line = { h: 2, doubles: 1, triples: 0, hr: 1 };
    const early = hitBags(6, ['2B'], OHTANI, 1, line);
    expect(runs(early).map((r) => r.length)).toEqual([2, 4]);
    expect(hitBags(6, ['2B', 'HR'], OHTANI, 1, line)).toEqual(early);
    // A scoring change took bags away before the plays were read again.
    expect(hitBags(2, ['2B', 'HR'], OHTANI, 1, line)).toEqual(early.slice(0, 2));
  });

  it('never draws two unmatched singles as a double', () => {
    for (let player = 1; player <= 200; player++) {
      const withLine = hitBags(3, ['1B'], player, 1, { h: 3, doubles: 0, triples: 0, hr: 0 });
      expect(runs(withLine).map((r) => r.length)).toEqual([1, 1, 1]);
      // Without the line, TB no hit covers are drawn a bag per hit.
      expect(runs(hitBags(3, ['1B'], player, 1)).map((r) => r.length)).toEqual([1, 1, 1]);
    }
  });

  it('draws each bag as its own hit when no hits are known', () => {
    const bags = hitBags(5, [], OHTANI, 1);
    expect(bags).toHaveLength(5);
    for (let i = 1; i < bags.length; i++) expect(bags[i]).not.toBe(bags[i - 1]);
    expect(hitBags(0, [], OHTANI, 1)).toEqual([]);
  });

  it("draws a past season's hits from its lines when no plays are known", () => {
    const bags = hitBags(4, [], OHTANI, 1, { h: 3, doubles: 1, triples: 0, hr: 0 });
    // Biggest first: the double, then the two singles, each its own bag.
    expect(runs(bags).map((r) => r.length)).toEqual([2, 1, 1]);
  });
});

describe('bagHitBags', () => {
  const bag = { gamePk: 813032, playerId: OHTANI, tb: 4, bags: 2, singles: 0, doubles: 0, triples: 0, hr: 0 };

  it('draws two singles as two different bags, and a double as two alike', () => {
    for (let tb = 2; tb < 200; tb++) {
      const singles = bagHitBags({ ...bag, tb, singles: 2 });
      expect(singles).toHaveLength(2);
      expect(singles[0]).not.toBe(singles[1]);
      const double = bagHitBags({ ...bag, tb, doubles: 1 });
      expect(double[0]).toBe(double[1]);
    }
  });

  it('draws a bag per TB when a scoring change leaves the hits short', () => {
    // A single scored a double instead: +1 bag, -1 single, +1 double.
    expect(bagHitBags({ ...bag, bags: 1, singles: -1, doubles: 1 })).toHaveLength(1);
  });
});
