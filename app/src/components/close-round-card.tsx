import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { roundDecided, roundStandings } from '@core/scoreboard.ts';
import { eliminations } from '@core/scoring.ts';
import type { FantasyRound } from '@core/types.ts';

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
 * Where a round stands once it's over. Rounds close by themselves (poll-games) about 3 hours after
 * every series in them has a winner; the commissioner only steps in for a drink-off (a full tie at
 * the cut), to reopen a round after a stat correction, or to close a round they reopened.
 */
export function CloseRoundCard({ data, scores, round, refetch }: { data: SeasonData; scores: Scores; round: FantasyRound; refetch: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [winners, setWinners] = useState<string[]>([]);
  if (data.season.imported_at) return null;

  const commissioner = data.isCommissioner;
  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const label = (id: string) => teamName(teamById.get(id)!);
  const closed = data.teams.some((t) => t.eliminated_after_round === round);
  const previousClosed = round === 1 || data.teams.some((t) => t.eliminated_after_round === round - 1);
  const nextDraft = round < 3 ? data.drafts.find((d) => d.number === round + 2) : null;
  const decided = roundDecided(round, scores.games);

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
    const champion = data.teams.find((t) => t.eliminated_after_round === null);
    const canReopen =
      commissioner &&
      (round === 3 || (nextDraft?.status === 'scheduled' && !data.teams.some((t) => t.eliminated_after_round === round + 1)));
    return (
      <Card title={`Round ${round} closed`}>
        <ThemedText type="small">
          {round === 3 && champion ? `${label(champion.id)} won it all.` : `${names(out.map(label))} ${out.length === 1 ? 'is' : 'are'} out.`}
        </ThemedText>
        {canReopen && (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Reopen it if a stat correction changes the result{round < 3 ? `, until Draft ${round + 2} starts` : ''}. It then waits for you to close it again.
            </ThemedText>
            <Button label={busy ? 'Reopening…' : `Reopen round ${round}`} variant="secondary" onPress={() => run({ reopen: true })} disabled={busy} />
          </>
        )}
        {error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}
      </Card>
    );
  }
  if (!previousClosed || !decided) return null;

  // The same ranking the server uses: TB, then the tiebreakers.
  const alive = data.teams.filter((t) => t.eliminated_after_round === null).map((t) => t.id);
  const standings = roundStandings(round, alive, scores.games, scores.stats, coreSpells(data));
  const cut = eliminations(
    standings.map((s) => ({ ...s.totals, teamId: s.teamId, rank: s.rank })),
    Math.min(data.season.survivors_after_round[round - 1] ?? 1, standings.length),
  );
  const drinkOff = cut.drinkOff;
  const reopened = data.season.manual_rounds.includes(round);
  const outcome =
    round === 3
      ? cut.advancing.length ? `${label(cut.advancing[0])} wins it all` : null
      : cut.eliminated.length ? `${names(cut.eliminated.map(label))} ${cut.eliminated.length === 1 ? 'is' : 'are'} out` : null;

  if (!drinkOff && !reopened) {
    return (
      <Card title={`Round ${round} is decided`}>
        <ThemedText type="small">
          {outcome ? `${outcome}. ` : ''}The round closes itself about 3 hours after the last out, once MLB&apos;s stat corrections are in.
        </ThemedText>
      </Card>
    );
  }

  const picking = drinkOff && winners.length !== drinkOff.spots;
  const toggle = (id: string) =>
    setWinners((w) => (w.includes(id) ? w.filter((x) => x !== id) : w.length < (drinkOff?.spots ?? 0) ? [...w, id] : w));
  return (
    <Card title={drinkOff ? 'Drink-off' : `Close round ${round}`}>
      {drinkOff ? (
        <ThemedText type="small">
          {names(drinkOff.teamIds.map(label))} are level on every tiebreaker at the cut
          {outcome ? ` (${outcome.replace(/ (is|are) out$/, ' $1 out either way')})` : ''}.{' '}
          {commissioner
            ? `Pick the drink-off's ${drinkOff.spots === 1 ? 'winner' : `${drinkOff.spots} winners`} to close the round:`
            : 'The round closes once the commissioner enters the drink-off’s result.'}
        </ThemedText>
      ) : (
        <ThemedText type="small">
          {commissioner
            ? `You reopened round ${round}. ${outcome ? `Closing it now: ${outcome}.` : ''}`
            : `The commissioner reopened round ${round}.`}
        </ThemedText>
      )}
      {commissioner && drinkOff && (
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
      )}
      {commissioner && (
        <Button
          label={busy ? 'Closing…' : picking ? 'Pick the drink-off winner first' : `Close round ${round}`}
          onPress={() => run(drinkOff ? { drinkOffWinners: winners } : {})}
          disabled={busy || !!picking}
        />
      )}
      {error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Radius.md, borderWidth: 1 },
});
