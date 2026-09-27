import { describe, expect, it } from 'vitest';

import type { Owner } from '../supabase/functions/_shared/core/bag-alerts.ts';
import { type CutSpot, type Sub, cutAlert, cutFlips, cutSpots, subAlert } from '../supabase/functions/_shared/core/game-alerts.ts';
import { emptyTotals, rankTeams } from '../supabase/functions/_shared/core/scoring.ts';

const sub = (over: Partial<Sub> = {}): Sub => ({
  player: 'Kiké Hernández',
  kind: 'in',
  position: 'PH',
  replacement: null,
  team: 'Bag Boys',
  manager: 'Mike',
  yours: false,
  ...over,
});

describe('subAlert', () => {
  it('names how a hitter came off the bench', () => {
    expect(subAlert(sub())).toEqual({ title: '👀 Kiké Hernández is in the game', body: 'Pinch-hitting · Bag Boys (Mike)' });
    expect(subAlert(sub({ position: 'PR' })).body).toBe('Pinch-running · Bag Boys (Mike)');
    expect(subAlert(sub({ position: 'SS' })).body).toBe('Subbed in at SS · Bag Boys (Mike)');
    expect(subAlert(sub({ position: null, yours: true })).body).toBe('Off the bench · Bag Boys');
  });

  it('names who replaced a hitter', () => {
    const out = sub({ player: 'Mookie Betts', kind: 'out', replacement: 'Kiké Hernández' });
    expect(subAlert(out)).toEqual({
      title: '😠 Mookie Betts is out of the game',
      body: 'Replaced by pinch-hitter Kiké Hernández · Bag Boys (Mike)',
    });
    expect(subAlert({ ...out, position: 'PR' }).body).toBe('Replaced by pinch-runner Kiké Hernández · Bag Boys (Mike)');
    expect(subAlert({ ...out, position: '2B', yours: true }).body).toBe('Replaced by Kiké Hernández · Bag Boys');
    expect(subAlert({ ...out, replacement: null }).body).toBe('Out of the lineup · Bag Boys (Mike)');
  });
});

/** Teams ranked on TB alone (the rest level), `a` first in a tie on everything. */
function ranked(tbs: Record<string, number>) {
  return rankTeams(Object.entries(tbs).map(([id, tb]) => ({ ...emptyTotals(id), tb })));
}

describe('cutSpots', () => {
  it('puts the teams below the cut in danger', () => {
    const spots = cutSpots(ranked({ a: 9, b: 7, c: 5, d: 3 }), 2);
    expect(spots.map((s) => [s.teamId, s.danger, s.rank])).toEqual([
      ['a', false, 1],
      ['b', false, 2],
      ['c', true, 3],
      ['d', true, 4],
    ]);
  });

  it('counts a full tie across the cut as danger for everyone in it', () => {
    const spots = cutSpots(ranked({ a: 9, b: 5, c: 5 }), 2);
    expect(spots.find((s) => s.teamId === 'a')).toMatchObject({ danger: false, tied: false });
    expect(spots.filter((s) => s.teamId !== 'a').every((s) => s.danger && s.tied && s.rank === 2)).toBe(true);
  });

  it('keeps everyone safe when all go through', () => {
    expect(cutSpots(ranked({ a: 1, b: 0 }), 5).every((s) => !s.danger)).toBe(true);
  });
});

describe('cutFlips', () => {
  const spots = cutSpots(ranked({ a: 9, b: 7, c: 5 }), 2);

  it('finds the teams that crossed the cut since the last check', () => {
    const flips = cutFlips(new Map([['a', false], ['b', true], ['c', false]]), spots);
    expect(flips.map((f) => [f.teamId, f.danger])).toEqual([
      ['b', false],
      ['c', true],
    ]);
  });

  it("stays quiet about a team with nothing to compare (the round's first check)", () => {
    expect(cutFlips(new Map(), spots)).toEqual([]);
  });
});

describe('cutAlert', () => {
  const spot = (over: Partial<CutSpot & Owner & { survivors: number }> = {}) => ({
    teamId: 'x',
    danger: true,
    rank: 6,
    tied: false,
    survivors: 5,
    team: 'Hot Bag Summer',
    manager: 'Dana',
    yours: true,
    ...over,
  });

  it('tells you you are on the hot seat', () => {
    expect(cutAlert(spot())).toEqual({ title: "🥵 You're on the hot seat", body: 'Down to 6th. The top 5 go through.' });
  });

  it('tells you you are off the chopping block', () => {
    expect(cutAlert(spot({ danger: false, rank: 5 }))).toEqual({
      title: '😮‍💨 Off the chopping block',
      body: 'Up to 5th. The top 5 go through.',
    });
  });

  it("names someone else's team", () => {
    expect(cutAlert(spot({ yours: false })).title).toBe('🥵 Hot Bag Summer (Dana) is on the hot seat');
    expect(cutAlert(spot({ yours: false, danger: false })).title).toBe('😮‍💨 Hot Bag Summer (Dana) is off the chopping block');
  });

  it('calls a tie at the cut a drink-off', () => {
    expect(cutAlert(spot({ rank: 5, tied: true })).body).toBe('Tied for 5th at the cut: a drink-off if it ends this way.');
  });

  it('talks about first place in the last round', () => {
    expect(cutAlert(spot({ rank: 2, survivors: 1 })).body).toBe('Down to 2nd. Only 1st wins it all.');
  });
});
