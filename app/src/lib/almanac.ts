import { useEffect, useState } from 'react';

import { type AlmanacData, type AlmanacJson, almanacFromJson } from '@core/almanac.ts';

import { useSeason } from '@/lib/season';
import { invokeFunction } from '@/lib/supabase';

export type { AlmanacData };

/** URL slug for a manager: their name, lowercased. */
export const managerSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Every season of the league, as the Almanac: built by the almanac Edge Function, next to the data. */
async function loadAlmanac(leagueId: string): Promise<AlmanacData> {
  const { data, error } = await invokeFunction<AlmanacJson>('almanac', { leagueId });
  if (error || !data) throw new Error(error ?? 'Couldn’t load the Almanac.');
  return almanacFromJson(data);
}

// Kept for a few minutes, so moving between Almanac pages doesn't reload every season. `data` is
// set once the load finishes, so a page opened after that draws straight away.
let cache: { leagueId: string; at: number; promise: Promise<AlmanacData>; data?: AlmanacData } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/** The league's Almanac, loaded once and shared by the Almanac pages. */
export function useAlmanac(): { data: AlmanacData | null; error: string | null } {
  const { data: season } = useSeason();
  // The season reloads on every live change; only a change of league reloads the Almanac.
  const leagueId = season?.season.league_id;
  const [data, setData] = useState<AlmanacData | null>(() => (cache && cache.leagueId === leagueId ? (cache.data ?? null) : null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    if (!cache || cache.leagueId !== leagueId || Date.now() - cache.at > CACHE_MS) {
      const entry: NonNullable<typeof cache> = { leagueId, at: Date.now(), promise: loadAlmanac(leagueId) };
      entry.promise.then((d) => (entry.data = d), () => {});
      cache = entry;
    }
    const entry = cache;
    // An old copy already on screen stays there until the reload lands.
    let stale = false;
    entry.promise.then(
      (d) => !stale && setData(d),
      (e) => {
        if (cache === entry) cache = null;
        if (!stale) setError(e instanceof Error ? e.message : 'Couldn’t load the Almanac.');
      },
    );
    return () => {
      stale = true;
    };
  }, [leagueId]);

  return { data, error };
}
