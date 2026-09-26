import { useState } from 'react';
import { Platform } from 'react-native';

import { type SeasonImport, validateSeasonImport } from '@core/season-import.ts';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { useSeason } from '@/lib/season';
import { callFunction, invokeFunction } from '@/lib/supabase';

type Tone = 'textSecondary' | 'danger' | 'success';

/** Opens the browser's file picker and reads the chosen files as text, by file name. */
function pickTextFiles(accept: string): Promise<{ name: string; text: string }[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))).then(resolve, () => resolve([]));
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** A picked file: a season ready to import, or why it can't be. */
type Picked = { name: string; season: SeasonImport } | { name: string; problem: string };

function readSeasonFile(name: string, text: string): Picked {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { name, problem: 'not a JSON file' };
  }
  const invalid = validateSeasonImport(parsed);
  return invalid ? { name, problem: invalid } : { name, season: parsed as SeasonImport };
}

/**
 * Commissioner only: imports past seasons from history/<year>.json files, which
 * scripts/history/check.ts makes from the league's old Google Sheets. Each import writes the
 * season, then fills its player pool (Draft and Research tabs) and loads its games from MLB.
 * Importing a year again replaces it.
 */
export function ImportSeasonCard() {
  const { data, refetch } = useSeason();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ text: string; tone: Tone }[]>([]);
  if (!data?.isCommissioner) return null;

  const ready = picked.flatMap((p) => ('season' in p ? [p.season] : [])).sort((a, b) => a.year - b.year);

  async function choose() {
    setLog([]);
    const files = await pickTextFiles('.json,application/json');
    setPicked(files.map((f) => readSeasonFile(f.name, f.text)));
  }

  async function importOne(s: SeasonImport): Promise<{ text: string; tone: Tone }> {
    const { data: result, error } = await invokeFunction<{ seasonId: string }>('import-season', {
      leagueId: data!.season.league_id,
      season: s,
    });
    if (error || !result) return { text: `${s.year}: ${error ?? 'Something went wrong.'}`, tone: 'danger' };
    const poolError = await callFunction('sync-pool', { seasonId: result.seasonId });
    const gamesError = await callFunction('poll-games', { seasonId: result.seasonId });
    const failed = [poolError && `player pool (${poolError})`, gamesError && `games (${gamesError})`].filter(Boolean);
    return failed.length
      ? { text: `${s.year} imported, but loading its ${failed.join(' and ')} failed. Import it again to retry.`, tone: 'danger' }
      : { text: `${s.year} imported.`, tone: 'success' };
  }

  async function importAll() {
    setBusy(true);
    setLog([]);
    for (const s of ready) {
      setLog((l) => [...l, { text: `Importing ${s.year}…`, tone: 'textSecondary' }]);
      const done = await importOne(s);
      setLog((l) => [...l.slice(0, -1), done]);
    }
    setBusy(false);
    setPicked([]);
    refetch();
  }

  return (
    <Card title="Past seasons">
      {Platform.OS !== 'web' ? (
        <ThemedText themeColor="textSecondary">Import past seasons from the web app.</ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Import season files made from the old Google Sheets (history/&lt;year&gt;.json); pick several at once.
            Importing a year again replaces it. Seasons played in the app are never touched.
          </ThemedText>
          <Button label="Choose season files" variant="secondary" onPress={choose} disabled={busy} />
          {picked.map((p) =>
            'season' in p ? (
              <ThemedText key={p.name} type="small">
                {p.season.year}: {p.season.managers.length} teams, {p.season.players.length} players drafted,{' '}
                {p.season.managers.find((m) => m.eliminatedAfterRound === null)?.name} won.
              </ThemedText>
            ) : (
              <ThemedText key={p.name} type="small" themeColor="danger">{p.name}: {p.problem}</ThemedText>
            ),
          )}
          {ready.length > 0 && (
            <Button
              label={busy ? 'Importing…' : `Import ${ready.map((s) => s.year).join(', ')}`}
              onPress={importAll}
              disabled={busy}
            />
          )}
          {log.map((l, i) => (
            <ThemedText key={i} type="small" themeColor={l.tone}>{l.text}</ThemedText>
          ))}
          {!busy && log.length > 0 && log.every((l) => l.tone === 'success') && (
            <ThemedText type="small" themeColor="textSecondary">Switch years from the year in the top bar.</ThemedText>
          )}
        </>
      )}
    </Card>
  );
}
