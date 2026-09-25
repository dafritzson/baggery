import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export interface BagGameScores {
  /** The league record, who holds it (first name) and whether that's you; null before anyone has scored. */
  record: { score: number; name: string; yours: boolean } | null;
  /** Your best, 0 if you haven't played. */
  mine: number;
  /** Your first name, for the stadium scoreboard. */
  myName: string;
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
    // A couple of retries, so one failed request doesn't leave the scoreboard blank all game.
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = await fetchScores(userId);
      if (next) return setScores(next);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
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
  const [bests, me] = await Promise.all([
    supabase
      .from('bag_game_bests')
      .select('user_id, score, profile:profiles(display_name)')
      .order('score', { ascending: false })
      .order('scored_at', { ascending: true }),
    supabase.from('profiles').select('display_name').eq('id', userId ?? '').maybeSingle(),
  ]);
  if (bests.error) return undefined;
  const top = bests.data[0];
  const firstName = (name: string | undefined) => name?.split(' ')[0];
  const name = firstName((top?.profile as unknown as { display_name: string } | null)?.display_name);
  return {
    record: top && top.score > 0 ? { score: top.score, name: name ?? 'someone', yours: top.user_id === userId } : null,
    mine: bests.data.find((row) => row.user_id === userId)?.score ?? 0,
    myName: firstName(me.data?.display_name) ?? 'You',
  };
}
