import { describe, expect, it } from 'vitest';

import type { ManagerScouting } from '../supabase/functions/_shared/core/almanac.ts';
import { SCOUTING_STATS, extremeOf } from '../app/src/lib/scouting.ts';

const power = SCOUTING_STATS.find((s) => s.key === 'power')!;
const league = [0.5, 0.45, 0.4, 0.4, 0.3, 0.2, null].map((powerShare) => ({ powerShare }) as ManagerScouting);

describe('extremeOf', () => {
  it('counts from whichever end is nearer', () => {
    expect(league.slice(0, 6).map((s) => extremeOf(league, power, s))).toEqual([
      { place: 1, side: 'most' },
      { place: 2, side: 'most' },
      { place: 3, side: 'most' },
      { place: 3, side: 'most' },
      { place: 2, side: 'least' },
      { place: 1, side: 'least' },
    ]);
  });

  it('is null for a manager without the stat', () => {
    expect(extremeOf(league, power, league[6])).toBeNull();
  });
});
