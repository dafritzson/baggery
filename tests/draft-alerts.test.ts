import { describe, expect, it } from 'vitest';

import { autopickAlert, draftDoneAlert, draftStartedAlert, onTheClockAlert } from '../supabase/functions/_shared/core/draft-alerts.ts';

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

describe('draftStartedAlert', () => {
  it('says where you pick', () => {
    expect(draftStartedAlert(2, 5)).toEqual({ title: '📣 Draft 2 is live', body: 'You pick 5th in round 1' });
    expect(draftStartedAlert(1, 1).body).toBe('You pick 1st in round 1');
  });

  it('points a manager without a spot at the draft room', () => {
    expect(draftStartedAlert(3, null).body).toBe('Follow the picks in the draft room');
  });
});

describe('autopickAlert', () => {
  const pick = { draftNumber: 2, round: 3, player: 'Juan Soto', dropped: null };

  it('names the hitter taken, and the one dropped', () => {
    expect(autopickAlert(pick)).toEqual({ title: '🤖 Autodraft took Juan Soto', body: 'Draft 2, round 3' });
    expect(autopickAlert({ ...pick, dropped: 'Aaron Judge' }).body).toBe('Draft 2, round 3, dropping Aaron Judge');
  });

  it('says when it passed', () => {
    expect(autopickAlert({ ...pick, player: null }).title).toBe('🤖 Autodraft passed for you');
  });

  it('names the ghost on a ghost turn', () => {
    expect(autopickAlert({ ...pick, ghost: '👻 Ghost' }).title).toBe('🤖 Autodraft took Juan Soto for 👻 Ghost');
    expect(autopickAlert({ ...pick, player: null, ghost: '👻 Ghost' }).title).toBe('🤖 Autodraft passed for 👻 Ghost');
  });
});

describe('draftDoneAlert', () => {
  it('names the draft', () => {
    expect(draftDoneAlert(4).title).toBe('✅ Draft 4 is done');
  });
});
