import { useEffect, useState } from 'react';

import type { PitcherStats } from '@core/box-score.ts';

import { supabase } from '@/lib/supabase';

export interface Probable {
  name: string;
  hand: 'L' | 'R' | null;
  /** Null until poll-games has read them. */
  stats: PitcherStats | null;
}

export interface Previews {
  /** Ballparks, by game. */
  venues: Map<number, string>;
  /** Announced starters, by "gamePk:teamId". */
  probables: Map<string, Probable>;
}

const EMPTY: Previews = { venues: new Map(), probables: new Map() };

/**
 * What the cards of games still to come show beyond the scores: each game's ballpark and its
 * announced starters with their numbers, in one request (~150 bytes a starter). Loaded when the
 * games change (one starts, or more are scheduled). Empty while loading or if the load failed: the
 * cards then leave the ballpark out and say the starters are TBD.
 */
export function usePreviews(gamePks: number[]): Previews {
  const key = [...gamePks].sort((a, b) => a - b).join(',');
  const [loaded, setLoaded] = useState<{ key: string; previews: Previews } | null>(null);
  useEffect(() => {
    if (!key) return;
    let stale = false;
    supabase
      .from('mlb_games')
      .select('game_pk, venue, mlb_probables(mlb_team_id, pitcher_name, hand, stats)')
      .in('game_pk', key.split(',').map(Number))
      .then(({ data }) => {
        if (stale || !data) return;
        const previews: Previews = { venues: new Map(), probables: new Map() };
        for (const g of data) {
          if (g.venue) previews.venues.set(g.game_pk, g.venue);
          for (const p of g.mlb_probables ?? []) {
            previews.probables.set(`${g.game_pk}:${p.mlb_team_id}`, { name: p.pitcher_name, hand: p.hand, stats: p.stats });
          }
        }
        setLoaded({ key, previews });
      });
    return () => {
      stale = true;
    };
  }, [key]);
  return loaded?.key === key ? loaded.previews : EMPTY;
}
