import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export interface Probable {
  name: string;
  hand: 'L' | 'R' | null;
}

/**
 * The announced starters of the given games, by "gamePk:teamId". Loaded when the games change
 * (another day picked, or one of them starts), ~60 bytes a starter. Empty while loading or if the
 * load failed: the card then says the starter is TBD.
 */
export function useProbables(gamePks: number[]): Map<string, Probable> {
  const key = [...gamePks].sort((a, b) => a - b).join(',');
  const [loaded, setLoaded] = useState<{ key: string; probables: Map<string, Probable> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let stale = false;
    supabase
      .from('mlb_probables')
      .select('game_pk, mlb_team_id, pitcher_name, hand')
      .in('game_pk', key.split(',').map(Number))
      .then(({ data }) => {
        if (stale || !data) return;
        setLoaded({
          key,
          probables: new Map(data.map((r) => [`${r.game_pk}:${r.mlb_team_id}`, { name: r.pitcher_name, hand: r.hand }])),
        });
      });
    return () => {
      stale = true;
    };
  }, [key]);
  return loaded?.key === key ? loaded.probables : EMPTY;
}

const EMPTY = new Map<string, Probable>();
