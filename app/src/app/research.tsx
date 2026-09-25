import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PlayerDetails } from '@/components/player-popup';
import { statsWidthFor } from '@/components/player-table';
import { PlayersList, availablePlayers } from '@/components/players-list';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing, WideContentWidth } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerColumns } from '@/lib/player-columns';
import { type SeasonData, useSeason } from '@/lib/season';

/** A first guess at the name column's width, until the table has measured it. */
const NAME_WIDTH = 200;
/** Room for the table's vertical scrollbar, so the last column isn't under it. */
const SCROLLBAR = 16;

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
  const [columns] = usePlayerColumns();
  // What the table says it needs (its longest name plus the chosen columns); a guess until then.
  const [tableWidth, setTableWidth] = useState<number | null>(null);
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
        {/* As wide as the chosen columns; it shrinks (and scrolls sideways) once the panel is at its minimum. */}
        <View style={[styles.list, { width: tableWidth ?? NAME_WIDTH + statsWidthFor(columns) + SCROLLBAR }]}>
          <PlayersList data={data} onSelect={setPicked} selectedId={selectedId} fill onTableWidth={setTableWidth} />
        </View>
        <ThemedView style={[styles.panel, { borderColor: theme.border, boxShadow: theme.floating }]}>
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
  list: { flexShrink: 1 },
  panel: { flex: 1, minWidth: 420, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.lg, overflow: 'hidden' },
  empty: { padding: Spacing.three },
});
