import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PlayerDetails } from '@/components/player-popup';
import { STATS_WIDTH } from '@/components/player-table';
import { PlayersList, availablePlayers } from '@/components/players-list';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, WideContentWidth } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { type SeasonData, useSeason } from '@/lib/season';

/** Name column width beside the stats panel. */
const NAME_WIDTH = 200;

/** The draft room's player list, to browse and open player stats any time. */
export default function ResearchScreen() {
  const { data, loading } = useSeason();
  const wide = useLayout() === 'wide';
  if (wide && data) return <ResearchWide data={data} />;
  return (
    <Screen width="wide">
      {loading && <ThemedText themeColor="textSecondary">Loading…</ThemedText>}
      {!loading && !data && <ThemedText>No season set up yet.</ThemedText>}
      {data && <PlayersList data={data} />}
    </Screen>
  );
}

/** Desktop: the list on the left, the selected player's stats in a panel on the right. */
function ResearchWide({ data }: { data: SeasonData }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  // Until someone is picked, show the player with the most total bases.
  const top = useMemo(
    () => availablePlayers(data).reduce<{ id: number; tb: number } | null>((best, p) => (!best || p.tb > best.tb ? p : best), null),
    [data],
  );
  const selectedId = picked ?? top?.id ?? null;

  return (
    <ThemedView style={styles.fill}>
      <View style={styles.columns}>
        <View style={styles.list}>
          <PlayersList data={data} onSelect={setPicked} selectedId={selectedId} fill />
        </View>
        <ThemedView style={[styles.panel, { borderColor: theme.border }]}>
          {selectedId !== null ? (
            <PlayerDetails key={selectedId} playerId={selectedId} />
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>Pick a player to see his stats.</ThemedText>
          )}
        </ThemedView>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  columns: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    maxWidth: WideContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  list: { width: NAME_WIDTH + STATS_WIDTH },
  panel: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: Spacing.three, overflow: 'hidden' },
  empty: { padding: Spacing.three },
});
