// The injured list, for Draft 1's pool: which hitters on it could be activated before the
// postseason ends, and from when.

/** MLB roster status codes for the injured lists, and each list's minimum stay in days. */
export const INJURED_LISTS: Record<string, number> = { D7: 7, D10: 10, D15: 15, D60: 60 };

/** The fields we read from an MLB `/transactions` entry. */
export interface Transaction {
  typeCode?: string;
  date?: string;
  effectiveDate?: string;
  description?: string;
}

/**
 * The day a player's current stint on the injured list began (YYYY-MM-DD): the effective date of
 * his latest placement, which is the day it's backdated to. A move from the 15-day to the 60-day
 * list isn't a placement, since it keeps the clock running from the first day. Null when there's
 * no placement.
 */
export function injuredSince(transactions: Transaction[]): string | null {
  const placements = transactions
    .filter((t) => t.typeCode === 'SC' && t.effectiveDate && /\bplaced\b.*\binjured list\b/i.test(t.description ?? ''))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.effectiveDate!.localeCompare(b.effectiveDate!));
  return placements.at(-1)?.effectiveDate ?? null;
}

/** "2026-09-17" plus 10 days → "2026-09-27". */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The first day a hitter can come off a `days`-day list that he went on `since` (null when
 * unknown), and whether that's by `lastDay` (the postseason's last scheduled day; any day when
 * null). An unknown start counts as today, the latest it could be.
 */
export function injuredListReturn(
  days: number,
  since: string | null,
  today: string,
  lastDay: string | null,
): { returnOn: string | null; inTime: boolean } {
  const earliest = addDays(since ?? today, days);
  return { returnOn: since && earliest, inTime: !lastDay || earliest <= lastDay };
}
