import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { UNCOUNTED_MISCLICKS } from '@/lib/bag-game';
import { supabase } from '@/lib/supabase';

export interface BagGameScores {
  /**
   * The league record, its misclicks, who holds it (first name) and whether that's you; null
   * before anyone has scored.
   */
  record: { score: number; misclicks: number; name: string; yours: boolean } | null;
  /** Your best, 0 if you haven't played. */
  mine: number;
  /** Your best's misclicks. */
  mineMisclicks: number;
  /** Games you've finished, 0 if none. */
  games: number;
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
    async (score: number, misclicks: number) => {
      const { error } = await supabase.rpc('record_bag_game', { p_score: score, p_misclicks: misclicks });
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
      .select('user_id, score, misclicks, games, profile:profiles(display_name)')
      // More bags, then fewer misclicks (compareRuns); the last to reach a full tie holds it.
      .order('score', { ascending: false })
      .order('misclicks', { ascending: true })
      .order('scored_at', { ascending: false }),
    supabase.from('profiles').select('display_name').eq('id', userId ?? '').maybeSingle(),
  ]);
  if (bests.error) return undefined;
  const top = bests.data[0];
  const mine = bests.data.find((row) => row.user_id === userId);
  const firstName = (name: string | undefined) => name?.split(' ')[0];
  const name = firstName((top?.profile as unknown as { display_name: string } | null)?.display_name);
  return {
    record:
      top && top.score > 0
        ? { score: top.score, misclicks: top.misclicks, name: name ?? 'someone', yours: top.user_id === userId }
        : null,
    mine: mine?.score ?? 0,
    mineMisclicks: mine?.misclicks ?? UNCOUNTED_MISCLICKS,
    games: mine?.games ?? 0,
    myName: firstName(me.data?.display_name) ?? 'You',
  };
}
