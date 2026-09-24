import { describe, expect, it } from 'vitest';

import { ADJECTIVES, randomTeamName, teamNames } from '../app/src/lib/team-name-list.ts';

// Team names must be 1 to 30 characters (enforced in the database).
const MAX = 30;

// The puns are stored scrambled (see scripts/team-names.ts), so these tests never spell them out.
const TEAM_NAMES = teamNames();

describe('team name list', () => {
  it('decodes to 200 unique plain-ASCII puns that fit the name limit', () => {
    expect(TEAM_NAMES).toHaveLength(200);
    expect(new Set(TEAM_NAMES.map((n) => n.toLowerCase())).size).toBe(TEAM_NAMES.length);
    for (const name of TEAM_NAMES) {
      expect(name.length).toBeLessThanOrEqual(MAX);
      expect(name).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('has unique adjectives short enough for "<adjective> Bagger"', () => {
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    const longest = Math.max(...ADJECTIVES.map((a) => a.length));
    expect(longest + ' Bagger'.length).toBeLessThanOrEqual(MAX);
  });
});

describe('randomTeamName', () => {
  // A scripted random source: returns the given values in order.
  const script = (...values: number[]) => () => values.shift()!;

  it('picks a pun', () => {
    expect(randomTeamName(script(0, 0))).toBe(TEAM_NAMES[0]);
  });

  it('builds "<adjective> Bagger"', () => {
    expect(randomTeamName(script(0.7, 0))).toBe(`${ADJECTIVES[0]} Bagger`);
  });

  it('uses both styles and always fits the limit', () => {
    const names = Array.from({ length: 2000 }, () => randomTeamName());
    for (const name of names) expect(name.length).toBeLessThanOrEqual(MAX);
    expect(names.some((n) => TEAM_NAMES.includes(n))).toBe(true);
    expect(names.some((n) => ADJECTIVES.some((a) => n === `${a} Bagger`))).toBe(true);
  });
});
