import { describe, expect, it } from 'vitest';

import { filterRows, inRange, thresholds } from '../app/src/lib/column-filters.ts';

describe('column filters', () => {
  const rows = [
    { name: 'A', pa: 650, bye: 1 },
    { name: 'B', pa: 310, bye: 0 },
    { name: 'C', pa: 120, bye: 1 },
    { name: 'D', pa: null, bye: 0 },
  ];
  const pa = (r: (typeof rows)[number]) => r.pa;
  const bye = (r: (typeof rows)[number]) => r.bye;

  it('keeps rows within the bounds, inclusive', () => {
    expect(filterRows(rows, [{ value: pa, range: { min: 310, max: null } }]).map((r) => r.name)).toEqual(['A', 'B']);
    expect(filterRows(rows, [{ value: pa, range: { min: null, max: 310 } }]).map((r) => r.name)).toEqual(['B', 'C']);
    expect(filterRows(rows, [{ value: pa, range: { min: 200, max: 400 } }]).map((r) => r.name)).toEqual(['B']);
  });

  it('applies every filter', () => {
    const filters = [
      { value: pa, range: { min: 100, max: null } },
      { value: bye, range: { min: 1, max: null } },
    ];
    expect(filterRows(rows, filters).map((r) => r.name)).toEqual(['A', 'C']);
  });

  it('drops a row with no value once its column is filtered, and only then', () => {
    expect(inRange(null, { min: null, max: null })).toBe(true);
    expect(inRange(null, { min: 0, max: null })).toBe(false);
    expect(filterRows(rows, [])).toHaveLength(4);
  });

  it('offers round bounds inside the spread of the values', () => {
    const plateAppearances = Array.from({ length: 101 }, (_, i) => i * 7); // 0 to 700
    expect(thresholds(plateAppearances)).toEqual([100, 200, 300, 400, 500, 600]);
    const slg = Array.from({ length: 101 }, (_, i) => 0.3 + i * 0.003); // .300 to .600
    expect(thresholds(slg)).toEqual([0.35, 0.4, 0.45, 0.5, 0.55]);
  });

  it('ignores outliers at the ends', () => {
    // A 1-for-1 player's 4.000 SLG shouldn't turn the bounds into .500, 1.000, 1.500 …
    const slg = [...Array.from({ length: 60 }, (_, i) => 0.35 + i * 0.004), 0, 0, 4, 4];
    expect(Math.max(...thresholds(slg))).toBeLessThan(0.7);
  });

  it('offers nothing when the values are all the same or missing', () => {
    expect(thresholds([90, 90, 90])).toEqual([]);
    expect(thresholds([null, 5])).toEqual([]);
  });
});
