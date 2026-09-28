import { describe, expect, it } from 'vitest';

import { onTheClockAlert } from '../supabase/functions/_shared/core/draft-alerts.ts';

describe('onTheClockAlert', () => {
  it('asks for a pick in the initial draft', () => {
    expect(onTheClockAlert({ draftNumber: 1, kind: 'initial', round: 2 })).toEqual({
      title: '⏰ You’re on the clock',
      body: 'Draft 1, round 2: pick a hitter',
    });
  });

  it('offers a pass in a redraft', () => {
    expect(onTheClockAlert({ draftNumber: 2, kind: 'redraft', round: 3 }).body).toBe('Draft 2, round 3: pick a hitter or pass');
  });

  it('names the ghost on a ghost turn', () => {
    const ghost = { team: '👻 Ghost', kind: 'add' as const };
    expect(onTheClockAlert({ draftNumber: 3, kind: 'redraft', round: 1, ghost }).body).toBe('Draft 3: pick a hitter for 👻 Ghost');
    expect(onTheClockAlert({ draftNumber: 4, kind: 'redraft', round: 1, ghost: { ...ghost, kind: 'redraft' } }).body).toBe(
      'Draft 4: pick a hitter for 👻 Ghost, or pass',
    );
  });
});
