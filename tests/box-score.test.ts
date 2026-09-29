import { describe, expect, it } from 'vitest';

import { type BoxLine, boxTotals, extraBaseHits, lastName, teamBox } from '../supabase/functions/_shared/core/box-score.ts';

const line = (playerId: number, name: string, order: number | null, stats: Partial<BoxLine> = {}): BoxLine => ({
  playerId,
  teamId: 119,
  name,
  order,
  position: null,
  ab: 0,
  r: 0,
  h: 0,
  rbi: 0,
  bb: 0,
  so: 0,
  tb: 0,
  doubles: 0,
  triples: 0,
  hr: 0,
  ...stats,
});

describe('a team box', () => {
  it('lists hitters in batting order with each sub under the hitter he replaced', () => {
    const rows = teamBox([
      line(3, 'Kiké Hernández', 601),
      line(2, 'Mookie Betts', 200),
      line(1, 'Shohei Ohtani', 100),
      line(6, 'Max Muncy', 600),
    ]);
    expect(rows.map((r) => [r.name, r.spot, r.sub])).toEqual([
      ['Shohei Ohtani', 1, false],
      ['Mookie Betts', 2, false],
      ['Max Muncy', 6, false],
      ['Kiké Hernández', 6, true],
    ]);
  });

  it('fills in starters from the posted lineup who have not batted yet', () => {
    const rows = teamBox([line(1, 'Shohei Ohtani', 100, { ab: 1 })], [
      { id: 1, name: 'Shohei Ohtani', pos: 'DH' },
      { id: 2, name: 'Mookie Betts', pos: 'SS' },
    ]);
    expect(rows.map((r) => [r.name, r.spot, r.line === null, r.position])).toEqual([
      ['Shohei Ohtani', 1, false, null],
      ['Mookie Betts', 2, true, 'SS'],
    ]);
  });

  it('leaves out a posted starter when someone else started in his spot', () => {
    const rows = teamBox([line(9, 'Chris Taylor', 200)], [
      { id: 1, name: 'Shohei Ohtani', pos: 'DH' },
      { id: 2, name: 'Mookie Betts', pos: 'SS' },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Shohei Ohtani', 'Chris Taylor']);
  });

  it('puts hitters outside the batting order last', () => {
    const rows = teamBox([line(5, 'A Pitcher', null), line(1, 'Shohei Ohtani', 100)]);
    expect(rows.map((r) => [r.name, r.spot])).toEqual([
      ['Shohei Ohtani', 1],
      ['A Pitcher', null],
    ]);
  });
});

describe('box totals and extra-base hits', () => {
  const lines = [
    line(1, 'Shohei Ohtani', 100, { ab: 4, r: 2, h: 2, rbi: 2, bb: 1, so: 1, tb: 9, hr: 2, doubles: 0 }),
    line(2, 'Mookie Betts', 200, { ab: 5, r: 1, h: 1, so: 1, tb: 2, doubles: 1 }),
    line(3, 'Vladimir Guerrero Jr.', 300, { ab: 3, h: 1, tb: 2, doubles: 1 }),
  ];

  it('adds up the columns', () => {
    expect(boxTotals(lines)).toEqual({ ab: 12, r: 3, h: 4, rbi: 2, bb: 1, so: 2, tb: 13 });
  });

  it('lists the extra-base hits by last name, with a count past one', () => {
    expect(extraBaseHits(lines)).toEqual([
      { label: '2B', text: 'Betts, Guerrero Jr.' },
      { label: 'HR', text: 'Ohtani 2' },
    ]);
    expect(extraBaseHits([])).toEqual([]);
  });

  it('shortens names to the last name', () => {
    expect(lastName('Shohei Ohtani')).toBe('Ohtani');
    expect(lastName('Ichiro')).toBe('Ichiro');
  });
});
