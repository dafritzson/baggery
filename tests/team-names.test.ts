import { describe, expect, it } from 'vitest';

import { ADJECTIVES, TEAM_NAMES, randomTeamName } from '../app/src/lib/team-name-list.ts';

// Team names must be 1 to 30 characters (enforced in the database).
const MAX = 30;

describe('team name list', () => {
  it('has 200 unique puns that fit the name limit', () => {
    expect(TEAM_NAMES).toHaveLength(200);
    expect(new Set(TEAM_NAMES.map((n) => n.toLowerCase())).size).toBe(TEAM_NAMES.length);
    for (const name of TEAM_NAMES) expect(name.length, name).toBeLessThanOrEqual(MAX);
  });

  it('has unique adjectives short enough for two of them plus "Bags"', () => {
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    const longest = Math.max(...ADJECTIVES.map((a) => a.length));
    expect(longest * 2 + ' '.length * 2 + 'Bags'.length).toBeLessThanOrEqual(MAX);
  });
});

describe('randomTeamName', () => {
  // A scripted random source: returns the given values in order.
  const script = (...values: number[]) => () => values.shift()!;

  it('picks a pun', () => {
    expect(randomTeamName(script(0, 0))).toBe(TEAM_NAMES[0]);
  });

  it('builds "<adjective> Bags"', () => {
    expect(randomTeamName(script(0.5, 0))).toBe(`${ADJECTIVES[0]} Bags`);
  });

  it('builds "<adjective> <adjective> Bags" with two different adjectives', () => {
    // The second pick repeats the first, so it picks again.
    expect(randomTeamName(script(0.9, 0, 0, 0.99))).toBe(`${ADJECTIVES[0]} ${ADJECTIVES.at(-1)} Bags`);
  });

  it('uses all three styles and always fits the limit', () => {
    const names = Array.from({ length: 3000 }, () => randomTeamName());
    for (const name of names) expect(name.length, name).toBeLessThanOrEqual(MAX);
    expect(names.some((n) => TEAM_NAMES.includes(n))).toBe(true);
    expect(names.some((n) => n.split(' ').length === 2 && n.endsWith(' Bags') && ADJECTIVES.includes(n.split(' ')[0]))).toBe(true);
    expect(names.some((n) => n.split(' ').length === 3 && n.endsWith(' Bags') && ADJECTIVES.includes(n.split(' ')[1]))).toBe(true);
  });
});
