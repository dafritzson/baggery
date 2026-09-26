import type { GameInfo } from '@/lib/scores';

/** Local calendar day of a game, e.g. "2026-09-29", for grouping. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The day a game belongs to: MLB's official date, so a game with no start time yet (listed at a
 * 3:33 AM ET placeholder) or a late West Coast game stays on its day. Local day as a fallback.
 */
export function gameDay(game: GameInfo): string {
  return game.officialDate ?? dayKey(game.start);
}

/** "Wed, 9/30", or "Today · 9/29" (short enough for the Games tab's chip beside its toggle on phones). */
export function dayLabel(key: string, today: string): string {
  const [y, m, d] = key.split('-').map(Number);
  if (key === today) return `Today · ${m}/${d}`;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
}
