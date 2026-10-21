import { useEffect, useState } from 'react';

import type { Hand } from '@core/platoon.ts';

import { supabase } from '@/lib/supabase';

/**
 * Each player's postseason so far, by player id: PA, TB, starts (all, and against each hand's
 * starters) and PA in his starts. Starts are null for rows without a batting order.
 */
export type PostseasonTotals = Map<
  number,
  { pa: number | null; tb: number; starts: number | null; startsVs: Record<Hand, number> | null; startPa: number | null }
>;

interface TotalsRow {
  mlb_player_id: number;
  pa: number | null;
  tb: number;
  starts: number | null;
  starts_vs_l: number | null;
  starts_vs_r: number | null;
  start_pa: number | null;
}

/**
 * This postseason's PA, TB and starts per player (games before `before`, if given; one player's
 * when `playerId` is given): one small row per hitter. Loaded once `finals` (the count of finished
 * games) is known, and again when it changes, so xBags doesn't count a new game as one he sat out.
 * Empty until the postseason has games; null while loading.
 */
export function usePostseasonTotals(year: number, before: string | null | undefined, finals: number | null, playerId?: number): PostseasonTotals | null {
  const [totals, setTotals] = useState<PostseasonTotals | null>(null);
  useEffect(() => {
    if (finals === null) return;
    let stale = false;
    supabase
      .rpc('postseason_totals', { p_year: year, p_before: before ?? null, p_player: playerId ?? null })
      .then(({ data: rows }) => {
        if (stale) return;
        setTotals(
          new Map(
            ((rows ?? []) as TotalsRow[]).map((r) => [
              r.mlb_player_id,
              {
                pa: r.pa,
                tb: r.tb,
                starts: r.starts,
                startsVs: r.starts_vs_l === null || r.starts_vs_r === null ? null : { L: r.starts_vs_l, R: r.starts_vs_r },
                startPa: r.start_pa,
              },
            ]),
          ),
        );
      });
    return () => {
      stale = true;
    };
  }, [year, before, finals, playerId]);
  return totals;
}
