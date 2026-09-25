import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { type PlayerRow, PlayerTable } from '@/components/player-table';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOpenPlayer } from '@/lib/player';
import { projection } from '@/lib/projections';
import type { SeasonData } from '@/lib/season';

/** Players who can still be drafted: on a live postseason roster and on nobody's team. */
export function availablePlayers(data: SeasonData): (PlayerRow & { mlbTeamId: number })[] {
  const taken = new Set(data.spells.map((s) => s.mlb_player_id));
  return data.pool
    .filter((p) => p.on_postseason_roster && !taken.has(p.mlb_player_id) && !data.mlbTeams.get(p.mlb_team_id)?.eliminated)
    .map((p) => {
      const team = data.mlbTeams.get(p.mlb_team_id);
      const { bye, rdslg, tbExpected, rdtb } = projection(data, p);
      return {
        id: p.mlb_player_id,
        mlbTeamId: p.mlb_team_id,
        name: data.players.get(p.mlb_player_id)?.full_name ?? `Player ${p.mlb_player_id}`,
        team: team?.abbreviation ?? '',
        wins: team?.wins ?? null,
        bye,
        pa: p.plate_appearances,
        slg: p.slg,
        opsPlus: p.ops_plus,
        tb: p.regular_season_tb,
        rdslg,
        tbExpected,
        rdtb,
      };
    });
}

/**
 * Search, team filter and the sortable table of available players. Tapping one opens their stats
 * in the popup, unless `onSelect` handles it.
 */
export function PlayersList({
  data,
  onSelect,
  selectedId,
  fill = false,
}: {
  data: SeasonData;
  onSelect?: (playerId: number) => void;
  selectedId?: number | null;
  /** Fill the parent's height, scrolling the table inside it rather than with the page. */
  fill?: boolean;
}) {
  const theme = useTheme();
  const openPlayer = useOpenPlayer();
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<number | null>(null);

  const available = useMemo(() => availablePlayers(data), [data]);
  const q = query.trim().toLowerCase();
  const shown = available.filter(
    (p) => (teamFilter === null || p.mlbTeamId === teamFilter) && (!q || p.name.toLowerCase().includes(q)),
  );
  const mlbTeams = [...data.mlbTeams.values()].filter((t) => !t.eliminated).sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));

  return (
    <View style={[{ gap: Spacing.two }, fill && styles.fill]}>
      <View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search players"
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
        />
        {query !== '' && (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            style={({ pressed }) => [styles.clear, { backgroundColor: theme.textSecondary, opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText type="smallBold" style={[styles.clearText, { color: theme.backgroundElement }]}>✕</ThemedText>
          </Pressable>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chips}>
        <Chip label="All" active={teamFilter === null} onPress={() => setTeamFilter(null)} />
        {mlbTeams.map((t) => (
          <Chip key={t.id} label={t.abbreviation} active={teamFilter === t.id} onPress={() => setTeamFilter(teamFilter === t.id ? null : t.id)} />
        ))}
      </ScrollView>
      {data.pool.length === 0 && (
        <ThemedText themeColor="textSecondary">The player pool is empty. The commissioner needs to sync it from MLB.</ThemedText>
      )}
      {shown.length > 0 &&
        (fill ? (
          <ScrollView style={styles.fill}>
            <PlayerTable rows={shown} onSelect={onSelect ?? openPlayer} selectedId={selectedId} />
          </ScrollView>
        ) : (
          <PlayerTable rows={shown} onSelect={onSelect ?? openPlayer} selectedId={selectedId} />
        ))}
      {shown.length === 0 && data.pool.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary">No matching players.</ThemedText>
      )}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? theme.accent : theme.backgroundElement }]}>
      <ThemedText type="smallBold" style={{ color: active ? theme.accentText : theme.text }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Room on the right for the clear button.
  search: { minHeight: 44, borderRadius: Spacing.two, borderWidth: 1, paddingLeft: Spacing.three, paddingRight: 44, fontSize: 16 },
  clear: {
    position: 'absolute',
    right: Spacing.three,
    top: '50%',
    marginTop: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { fontSize: 12, lineHeight: 14 },
  chipRow: { flexGrow: 0 },
  chips: { gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Spacing.four },
});
