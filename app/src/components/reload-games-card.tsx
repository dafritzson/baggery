import { useState } from 'react';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { useSeason } from '@/lib/season';
import { callFunction, invokeFunction } from '@/lib/supabase';

/**
 * Commissioner only: reloads the season picked in the top bar from MLB, its games and box scores,
 * then its hits' videos a few games at a time (poll-games `videos`), e.g. to fill in a past
 * postseason or catch up after an outage.
 */
export function ReloadGamesCard() {
  const { data, refetch } = useSeason();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: 'textSecondary' | 'success' | 'danger' } | null>(null);
  if (!data?.isCommissioner) return null;
  const { id: seasonId, year } = data.season;

  async function reload() {
    setBusy(true);
    setStatus({ text: 'Loading games…', tone: 'textSecondary' });
    const gamesError = await callFunction('poll-games', { seasonId });
    if (gamesError) {
      setStatus({ text: gamesError, tone: 'danger' });
      setBusy(false);
      return;
    }
    let after: number | null = 0;
    let hits = 0;
    while (after !== null) {
      setStatus({ text: `Finding videos… ${hits} hits so far`, tone: 'textSecondary' });
      const { data: batch, error }: { data: { hits: number; next: number | null } | null; error: string | null } =
        await invokeFunction('poll-games', { seasonId, videos: true, after });
      if (error || !batch) {
        setStatus({ text: `Games reloaded, but finding videos failed: ${error ?? 'no response'}. Reload again to retry.`, tone: 'danger' });
        setBusy(false);
        return;
      }
      hits += batch.hits;
      after = batch.next;
    }
    setStatus({ text: `${year} reloaded: games, box scores and ${hits} hits' videos.`, tone: 'success' });
    setBusy(false);
    refetch();
  }

  return (
    <Card title={`Games · ${year}`}>
      <ThemedText type="small" themeColor="textSecondary">
        Reload this season&apos;s postseason from MLB: schedule, scores, box scores and the videos of every hit. Pick
        another year in the top bar to reload that one.
      </ThemedText>
      <Button label={busy ? 'Reloading…' : `Reload ${year} from MLB`} variant="secondary" onPress={reload} disabled={busy} />
      {status && <ThemedText type="small" themeColor={status.tone}>{status.text}</ThemedText>}
    </Card>
  );
}
