import { useState } from 'react';
import { Platform } from 'react-native';

import { type SeasonImport, validateSeasonImport } from '@core/season-import.ts';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { useSeason } from '@/lib/season';
import { callFunction, invokeFunction } from '@/lib/supabase';

/** Opens the browser's file picker and reads the chosen file as text. Null when nothing is picked. */
function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Commissioner only: imports a past season from history/<year>.json, which
 * scripts/history/check.ts makes from the league's old Google Sheets. Importing a year again
 * replaces it.
 */
export function ImportSeasonCard() {
  const { data, refetch } = useSeason();
  const [season, setSeason] = useState<SeasonImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'textSecondary' | 'danger' | 'success' } | null>(null);
  if (!data?.isCommissioner) return null;

  async function choose() {
    setMessage(null);
    setSeason(null);
    const text = await pickTextFile('.json,application/json');
    if (text === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return setMessage({ text: 'That file isn’t JSON. Pick a history/<year>.json file.', tone: 'danger' });
    }
    const invalid = validateSeasonImport(parsed);
    if (invalid) return setMessage({ text: invalid, tone: 'danger' });
    setSeason(parsed as SeasonImport);
  }

  async function runImport(s: SeasonImport) {
    setBusy(true);
    setMessage({ text: `Importing ${s.year}…`, tone: 'textSecondary' });
    const { data: result, error } = await invokeFunction<{ seasonId: string }>('import-season', {
      leagueId: data!.season.league_id,
      season: s,
    });
    if (error || !result) {
      setBusy(false);
      return setMessage({ text: error ?? 'Something went wrong.', tone: 'danger' });
    }
    setMessage({ text: `Loading ${s.year}'s games and box scores from MLB…`, tone: 'textSecondary' });
    const gamesError = await callFunction('poll-games', { seasonId: result.seasonId });
    setBusy(false);
    setSeason(null);
    setMessage(
      gamesError
        ? { text: `${s.year} imported, but loading its games failed (${gamesError}). Import it again to retry.`, tone: 'danger' }
        : { text: `${s.year} imported. Switch to it from the year in the top bar.`, tone: 'success' },
    );
    refetch();
  }

  const champion = season?.managers.find((m) => m.eliminatedAfterRound === null)?.name;
  return (
    <Card title="Past seasons">
      {Platform.OS !== 'web' ? (
        <ThemedText themeColor="textSecondary">Import past seasons from the web app.</ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Import a season file made from the old Google Sheets (history/&lt;year&gt;.json). Importing a year
            again replaces it. Seasons played in the app are never touched.
          </ThemedText>
          <Button label="Choose a season file" variant="secondary" onPress={choose} disabled={busy} />
          {season && (
            <>
              <ThemedText>
                {season.year}: {season.managers.length} teams, {season.players.length} players drafted, {champion} won.
              </ThemedText>
              <Button label={busy ? 'Importing…' : `Import ${season.year}`} onPress={() => runImport(season)} disabled={busy} />
            </>
          )}
        </>
      )}
      {message && (
        <ThemedText type="small" themeColor={message.tone}>{message.text}</ThemedText>
      )}
    </Card>
  );
}
