import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export interface BagGameScores {
  /** The league record and who holds it (first name), or null before anyone has scored. */
  record: { score: number; name: string } | null;
  /** Your best, 0 if you haven't played. */
  mine: number;
}

/**
 * High scores for the bag game, from bag_game_bests. `scores` is undefined until `refresh` has
 * loaded them (or if loading failed: the game still plays, just without records). `save` records
 * a finished game.
 */
export function useBagGameScores() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [scores, setScores] = useState<BagGameScores>();

  const refresh = useCallback(async () => {
    const next = await fetchScores(userId);
    if (next) setScores(next);
  }, [userId]);

  const save = useCallback(
    async (score: number) => {
      const { error } = await supabase.rpc('record_bag_game', { p_score: score });
      if (!error) await refresh();
    },
    [refresh],
  );

  return { scores, refresh, save };
}

async function fetchScores(userId: string | undefined): Promise<BagGameScores | undefined> {
  const { data, error } = await supabase
    .from('bag_game_bests')
    .select('user_id, score, profile:profiles(display_name)')
    .order('score', { ascending: false })
    .order('scored_at', { ascending: true });
  if (error) return undefined;
  const top = data[0];
  const name = (top?.profile as unknown as { display_name: string } | null)?.display_name.split(' ')[0];
  return {
    record: top && top.score > 0 ? { score: top.score, name: name ?? 'someone' } : null,
    mine: data.find((row) => row.user_id === userId)?.score ?? 0,
  };
}
