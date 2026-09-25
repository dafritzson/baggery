import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { currentRound } from '@core/scoreboard.ts';
import type { FantasyRound } from '@core/types.ts';

import { Columns } from '@/components/columns';
import { RoundChips, StandingsTable, TeamScoreboard } from '@/components/scoreboard';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { useScores } from '@/lib/scores';
import { useSeason } from '@/lib/season';
import { teamName } from '@/lib/teams';

/**
 * Fantasy standings: each round's TB by game, and any team's TB by player. Desktops show both
 * side by side; phones switch between them.
 */
export default function StandingsScreen() {
  const { data, loading } = useSeason();
  const { scores } = useScores(data);
  const wide = useLayout() === 'wide';
  const theme = useTheme();
  const [round, setRound] = useState<FantasyRound | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<'standings' | 'team'>('standings');

  if (loading || (data && !scores)) {
    return <Screen width="wide"><ThemedText themeColor="textSecondary">Loading…</ThemedText></Screen>;
  }
  if (!data || !scores) return <Screen width="wide"><ThemedText>No season set up yet.</ThemedText></Screen>;

  const shownRound = round ?? currentRound(scores.games);
  const teamId = picked ?? data.myTeam?.id ?? data.teams[0]?.id ?? null;
  const team = data.teams.find((t) => t.id === teamId);
  const selectTeam = (id: string) => {
    setPicked(id);
    if (!wide) setView('team');
  };

  const standings = (
    <View style={styles.stack}>
      <RoundChips round={shownRound} onChange={setRound} />
      <StandingsTable data={data} scores={scores} round={shownRound} selectedTeamId={wide ? teamId : null} onSelectTeam={selectTeam} />
      {scores.games.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Scores fill in once the postseason schedule is out and games start.
        </ThemedText>
      )}
    </View>
  );
  const teamView = teamId ? <TeamScoreboard data={data} scores={scores} teamId={teamId} /> : null;

  if (wide) {
    return (
      <Screen width="wide">
        <Columns main={standings} side={teamView} sideWidth={520} />
      </Screen>
    );
  }
  return (
    <Screen width="wide">
      <View style={[styles.toggle, { backgroundColor: theme.backgroundElement }]} accessibilityRole="tablist">
        {(['standings', 'team'] as const).map((v) => {
          const active = view === v;
          return (
            <Pressable
              key={v}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setView(v)}
              style={[styles.toggleItem, active && { backgroundColor: theme.background }]}>
              <ThemedText type="smallBold" numberOfLines={1} themeColor={active ? 'text' : 'textSecondary'}>
                {v === 'standings' ? 'Standings' : team ? (team.id === data.myTeam?.id ? 'My team' : teamName(team)) : 'Team'}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {view === 'standings' ? standings : teamView}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.three },
  toggle: { flexDirection: 'row', borderRadius: Spacing.three, padding: 3 },
  toggleItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three - 2 },
});
