import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { roundStandings } from '@core/scoreboard.ts';
import { eliminations } from '@core/scoring.ts';
import { type FantasyRound, ROUND_FOR_GAME_TYPE } from '@core/types.ts';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type Scores, coreSpells } from '@/lib/scores';
import type { SeasonData } from '@/lib/season';
import { invokeFunction } from '@/lib/supabase';
import { teamName } from '@/lib/teams';

/** "Kyle and Curtis" */
const names = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : (list[0] ?? ''));

/**
 * Commissioner only: once every game of a round is final, closes it, eliminating the teams below
 * the cut by the rules' ranking. A full tie at the cut asks for the drink-off's winners. A closed
 * round can be reopened until the draft after it starts.
 */
export function CloseRoundCard({ data, scores, round, refetch }: { data: SeasonData; scores: Scores; round: FantasyRound; refetch: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [winners, setWinners] = useState<string[]>([]);
  if (!data.isCommissioner || data.season.imported_at) return null;

  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const label = (id: string) => teamName(teamById.get(id)!);
  const closed = data.teams.some((t) => t.eliminated_after_round === round);
  const previousClosed = round === 1 || data.teams.some((t) => t.eliminated_after_round === round - 1);
  const nextDraft = round < 3 ? data.drafts.find((d) => d.number === round + 2) : null;
  const games = scores.games.filter((g) => ROUND_FOR_GAME_TYPE[g.gameType] === round);
  const done = games.length > 0 && games.every((g) => g.status === 'Final');

  async function run(body: object) {
    setBusy(true);
    setError(null);
    const { data: result, error: failed } = await invokeFunction<{ drinkOff?: unknown }>('close-round', { seasonId: data.season.id, round, ...body });
    setBusy(false);
    if (failed) return setError(failed);
    if (result?.drinkOff) return setError('The standings changed: check the drink-off and try again.');
    setWinners([]);
    refetch();
  }

  if (closed) {
    const out = data.teams.filter((t) => t.eliminated_after_round === round).map((t) => t.id);
    const canReopen = round === 3 ? true : !!nextDraft && nextDraft.status === 'scheduled' && !data.teams.some((t) => t.eliminated_after_round === round + 1);
    return (
      <Card title={`Round ${round} closed`}>
        <ThemedText type="small">
          {round === 3 ? `${label(data.teams.find((t) => t.eliminated_after_round === null)!.id)} won it all.` : `${names(out.map(label))} ${out.length === 1 ? 'is' : 'are'} out.`}
        </ThemedText>
        {canReopen && (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Reopen it if a stat correction changes the result{round < 3 ? `, until Draft ${round + 2} starts` : ''}.
            </ThemedText>
            <Button label={busy ? 'Reopening…' : `Reopen round ${round}`} variant="secondary" onPress={() => run({ reopen: true })} disabled={busy} />
          </>
        )}
        {error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}
      </Card>
    );
  }
  if (!previousClosed || !done) return null;

  // The same ranking the server will use: TB, then the tiebreakers.
  const alive = data.teams.filter((t) => t.eliminated_after_round === null).map((t) => t.id);
  const standings = roundStandings(round, alive, scores.games, scores.stats, coreSpells(data));
  const survivors = Math.min(data.season.survivors_after_round[round - 1] ?? 1, standings.length);
  const cut = eliminations(
    standings.map((s) => ({ ...s.totals, teamId: s.teamId, rank: s.rank })),
    survivors,
  );
  const drinkOff = cut.drinkOff;
  const picking = drinkOff && winners.length !== drinkOff.spots;
  const toggle = (id: string) =>
    setWinners((w) => (w.includes(id) ? w.filter((x) => x !== id) : w.length < (drinkOff?.spots ?? 0) ? [...w, id] : w));

  return (
    <Card title={`Close round ${round}`}>
      <ThemedText type="small">
        Every round {round} game is final.{' '}
        {round === 3
          ? `Closing it makes ${names(cut.advancing.map(label)) || 'the drink-off winner'} the champion.`
          : cut.eliminated.length
            ? `Closing it knocks out ${names(cut.eliminated.map(label))}.`
            : 'Closing it records who advances.'}
      </ThemedText>
      {drinkOff && (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="small">
            {names(drinkOff.teamIds.map(label))} are level on every tiebreaker at the cut. Pick the drink-off&apos;s{' '}
            {drinkOff.spots === 1 ? 'winner' : `${drinkOff.spots} winners`}:
          </ThemedText>
          <View style={styles.chips}>
            {drinkOff.teamIds.map((id) => {
              const on = winners.includes(id);
              return (
                <Pressable
                  key={id}
                  onPress={() => toggle(id)}
                  style={[styles.chip, { backgroundColor: on ? theme.accent : theme.background, borderColor: on ? theme.accent : theme.border }]}>
                  <ThemedText type="smallBold" style={{ color: on ? '#fff' : theme.text }}>{on ? '🍺 ' : ''}{label(id)}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      <Button
        label={busy ? 'Closing…' : picking ? 'Pick the drink-off winner first' : `Close round ${round}`}
        onPress={() => run(drinkOff ? { drinkOffWinners: winners } : {})}
        disabled={busy || !!picking}
      />
      {error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Radius.md, borderWidth: 1 },
});
