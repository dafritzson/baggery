import { describe, expect, it } from 'vitest';

import { type Bag, bagAlert, hitsText, testAlert } from '../supabase/functions/_shared/core/bag-alerts.ts';

const bag = (over: Partial<Bag> = {}): Bag => ({
  player: 'Shohei Ohtani',
  bags: 1,
  singles: 1,
  doubles: 0,
  triples: 0,
  hr: 0,
  team: 'Bag Boys',
  manager: 'Mike',
  yours: false,
  ...over,
});

describe('bagAlert', () => {
  it('names one bag', () => {
    expect(bagAlert(bag())).toEqual({ title: '👜 Shohei Ohtani got a bag', body: '1B for Bag Boys (Mike)' });
  });

  it('shows a bag emoji per bag', () => {
    expect(bagAlert(bag({ bags: 4, singles: 0, hr: 1 })).title).toBe('👜👜👜👜 Shohei Ohtani got 4 bags');
    expect(bagAlert(bag({ bags: 2, singles: 0, doubles: 1 })).title).toBe('👜👜 Shohei Ohtani got 2 bags');
  });

  it('caps the emoji at four', () => {
    expect(bagAlert(bag({ bags: 8, singles: 0, hr: 2 })).title).toBe('👜👜👜👜 Shohei Ohtani got 8 bags');
  });

  it('names your own team without its manager', () => {
    expect(bagAlert(bag({ bags: 4, singles: 0, hr: 1, yours: true })).body).toBe('HR for Bag Boys');
  });

  it('leaves out the manager when there is none or it is the team name', () => {
    expect(bagAlert(bag({ manager: null })).body).toBe('1B for Bag Boys');
    expect(bagAlert(bag({ manager: 'Bag Boys' })).body).toBe('1B for Bag Boys');
  });
});

describe('hitsText', () => {
  const hits = (singles: number, doubles: number, triples: number, hr: number) => hitsText({ singles, doubles, triples, hr });

  it('names each hit', () => {
    expect(hits(1, 0, 0, 0)).toBe('1B');
    expect(hits(0, 1, 0, 0)).toBe('2B');
    expect(hits(0, 0, 1, 0)).toBe('3B');
    expect(hits(0, 0, 0, 1)).toBe('HR');
  });

  it('lists several hits read at once', () => {
    expect(hits(2, 0, 0, 0)).toBe('1B ×2');
    expect(hits(1, 0, 0, 1)).toBe('1B and HR');
    expect(hits(1, 1, 0, 2)).toBe('1B, 2B and HR ×2');
  });

  it('spells the hits out in words', () => {
    expect(hitsText({ singles: 0, doubles: 0, triples: 0, hr: 1 }, true)).toBe('home run');
    expect(hitsText({ singles: 1, doubles: 1, triples: 0, hr: 2 }, true)).toBe('single, double and 2 home runs');
  });

  it('calls a changed hit a scoring change', () => {
    // A single scored a double instead: one more double, one fewer single.
    expect(hits(-1, 1, 0, 0)).toBe('scoring change');
    expect(bagAlert(bag({ singles: -1, doubles: 1 })).body).toBe('Scoring change for Bag Boys (Mike)');
  });
});

describe('testAlert', () => {
  it('matches the chosen scope', () => {
    expect(testAlert('mine').body).toContain('your hitters');
    expect(testAlert('league').body).toContain("anyone's");
    expect(testAlert('off').body).toContain('draft alerts');
  });
});
