// Matches the workbooks' hand-typed player names to MLB player ids. The sheets drop accents,
// suffixes and punctuation, use nicknames and sometimes only a last name, and have typos, so
// matching goes: alias → exact → first initial + last name → close spelling, and a sheet name
// that's only a last name ("Profar") matches the one hitter with that last name.

import type { Hitter } from './mlb.ts';

/** Nicknames and sheet spellings that no rule below recovers, by normalized sheet name. */
const ALIASES: Record<string, string> = {
  'kike hernandez': 'enrique hernandez',
};

export function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.'’]/g, '')
    .replace(/[-_,]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

export type Match = { id: number; how: string } | { id: null; how: string; candidates: string[] };

/** Picks one hitter, preferring position players over pitchers with the same name. */
function one(found: Hitter[], how: string): Match | null {
  const hitters = found.filter((h) => h.position !== 'P');
  const pick = hitters.length ? hitters : found;
  if (pick.length === 1) return { id: pick[0].id, how };
  if (pick.length > 1) return { id: null, how: `ambiguous ${how}`, candidates: pick.map((h) => `${h.fullName} (${h.id})`) };
  return null;
}

export function matchName(name: string, hitters: Hitter[]): Match {
  const alias = ALIASES[normalize(name)];
  const n = alias ?? normalize(name);
  const parts = n.split(' ');
  const last = parts.at(-1)!;
  const byName = (f: (full: string) => boolean) => hitters.filter((h) => f(normalize(h.fullName)));
  if (parts.length === 1) {
    return one(byName((full) => full.split(' ').at(-1) === last), 'last name only') ?? { id: null, how: 'no match', candidates: [] };
  }
  return (
    one(byName((full) => full === n), alias ? 'alias' : 'exact') ??
    one(byName((full) => full.split(' ').at(-1) === last && full[0] === n[0]), 'initial + last name') ??
    one(byName((full) => distance(full, n) <= 2), 'close spelling') ?? { id: null, how: 'no match', candidates: [] }
  );
}
