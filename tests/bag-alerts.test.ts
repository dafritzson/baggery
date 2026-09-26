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
    expect(bagAlert(bag())).toEqual({ title: '👜 Shohei Ohtani got a bag', body: 'Single for Bag Boys (Mike)' });
  });

  it('shows a bag emoji per bag', () => {
    expect(bagAlert(bag({ bags: 4, singles: 0, hr: 1 })).title).toBe('👜👜👜👜 Shohei Ohtani got 4 bags');
    expect(bagAlert(bag({ bags: 2, singles: 0, doubles: 1 })).title).toBe('👜👜 Shohei Ohtani got 2 bags');
  });

  it('caps the emoji at four', () => {
    expect(bagAlert(bag({ bags: 8, singles: 0, hr: 2 })).title).toBe('👜👜👜👜 Shohei Ohtani got 8 bags');
  });

  it('says "your team" for your own hitter', () => {
    expect(bagAlert(bag({ bags: 4, singles: 0, hr: 1, yours: true })).body).toBe('Home run for your team');
  });

  it('leaves out the manager when there is none or it is the team name', () => {
    expect(bagAlert(bag({ manager: null })).body).toBe('Single for Bag Boys');
    expect(bagAlert(bag({ manager: 'Bag Boys' })).body).toBe('Single for Bag Boys');
  });
});

describe('hitsText', () => {
  const hits = (singles: number, doubles: number, triples: number, hr: number) => hitsText({ singles, doubles, triples, hr });

  it('names each hit', () => {
    expect(hits(1, 0, 0, 0)).toBe('single');
    expect(hits(0, 1, 0, 0)).toBe('double');
    expect(hits(0, 0, 1, 0)).toBe('triple');
    expect(hits(0, 0, 0, 1)).toBe('home run');
  });

  it('lists several hits read at once', () => {
    expect(hits(2, 0, 0, 0)).toBe('2 singles');
    expect(hits(1, 0, 0, 1)).toBe('single and home run');
    expect(hits(1, 1, 0, 2)).toBe('single, double and 2 home runs');
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
  });
});
