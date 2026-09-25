import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as DropdownMenu from 'zeego/dropdown-menu';

import { COLUMNS, type ColumnKey, DEFAULT_COLUMNS, type PlayerRow, PlayerTable } from '@/components/player-table';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { useOpenPlayer } from '@/lib/player';
import { usePlayerColumns } from '@/lib/player-columns';
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
      const ab = p.at_bats;
      const h = p.hits;
      const onBase = h === null || ab === null ? null : h + (p.walks ?? 0) + (p.hit_by_pitch ?? 0);
      const obpDenominator = ab === null ? 0 : ab + (p.walks ?? 0) + (p.hit_by_pitch ?? 0) + (p.sac_flies ?? 0);
      const obp = onBase === null || !obpDenominator ? null : onBase / obpDenominator;
      return {
        id: p.mlb_player_id,
        mlbTeamId: p.mlb_team_id,
        name: data.players.get(p.mlb_player_id)?.full_name ?? `Player ${p.mlb_player_id}`,
        team: team?.abbreviation ?? '',
        wins: team?.wins ?? null,
        bye,
        g: p.games_played,
        pa: p.plate_appearances,
        ab,
        h,
        doubles: p.doubles,
        triples: p.triples,
        hr: p.home_runs,
        r: p.runs,
        rbi: p.rbi,
        bb: p.walks,
        so: p.strikeouts,
        avg: h === null || !ab ? null : h / ab,
        obp,
        slg: p.slg,
        ops: obp === null || p.slg === null ? null : obp + p.slg,
        opsPlus: p.ops_plus,
        tbPerGame: p.games_played ? p.regular_season_tb / p.games_played : null,
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
  const [columns, setColumns] = usePlayerColumns();
  const { height } = useWindowDimensions();
  // Desktop web: the table scrolls in its own box, sized to the window, so its scrollbars are in
  // view. In `fill` the parent sets the size; otherwise it's capped a bit under the window height.
  const wide = useLayout() === 'wide';
  const contained = Platform.OS === 'web' && wide;
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<number | null>(null);

  const available = useMemo(() => availablePlayers(data), [data]);
  const q = query.trim().toLowerCase();
  const shown = available.filter(
    (p) => (teamFilter === null || p.mlbTeamId === teamFilter) && (!q || p.name.toLowerCase().includes(q)),
  );
  const columnsMenu = <ColumnsMenu value={columns} onChange={setColumns} />;
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
        (fill && !contained ? (
          <ScrollView style={styles.fill}>
            <PlayerTable rows={shown} onSelect={onSelect ?? openPlayer} selectedId={selectedId} columns={columns} headerAction={columnsMenu} />
          </ScrollView>
        ) : (
          <PlayerTable
            rows={shown}
            onSelect={onSelect ?? openPlayer}
            selectedId={selectedId}
            columns={columns}
            headerAction={columnsMenu}
            contained={contained}
            style={contained ? (fill ? styles.shrink : { maxHeight: Math.max(320, height - 200) }) : undefined}
          />
        ))}
      {shown.length === 0 && data.pool.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary">No matching players.</ThemedText>
      )}
    </View>
  );
}

/** A small icon in the table's header with a checklist of its columns; stays open while you tick. */
function ColumnsMenu({ value, onChange }: { value: ColumnKey[]; onChange: (columns: ColumnKey[]) => void }) {
  const theme = useTheme();
  const toggle = (key: ColumnKey) =>
    onChange(COLUMNS.map((c) => c.key).filter((k) => (k === key ? !value.includes(k) : value.includes(k))));
  const all = COLUMNS.every((c) => value.includes(c.key));
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="menu-trigger menu-trigger-chip" aria-label="Choose columns">
        <View style={styles.columnsButton}>
          <SlidersIcon color={theme.textSecondary} />
        </View>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="menu-content menu-content-scroll" align="start" sideOffset={6} collisionPadding={8}>
        <DropdownMenu.Label className="menu-label menu-label-heading">Columns</DropdownMenu.Label>
        {/* Ticked only when every column shows: ticking shows them all, unticking hides them all. */}
        <DropdownMenu.CheckboxItem
          key="all"
          className="menu-item"
          value={all ? 'on' : 'off'}
          onValueChange={() => onChange(all ? [] : COLUMNS.map((c) => c.key))}
          shouldDismissMenuOnSelect={false}>
          <DropdownMenu.ItemTitle>All columns</DropdownMenu.ItemTitle>
          <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
        </DropdownMenu.CheckboxItem>
        <DropdownMenu.Separator className="menu-separator" />
        {COLUMNS.map((c) => (
          <DropdownMenu.CheckboxItem
            key={c.key}
            className="menu-item"
            value={value.includes(c.key) ? 'on' : 'off'}
            onValueChange={() => toggle(c.key)}
            shouldDismissMenuOnSelect={false}>
            <DropdownMenu.ItemTitle>{`${c.label} · ${c.title}`}</DropdownMenu.ItemTitle>
            <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
        ))}
        <DropdownMenu.Separator className="menu-separator" />
        <DropdownMenu.Item key="reset" className="menu-item" onSelect={() => onChange(DEFAULT_COLUMNS)}>
          <DropdownMenu.ItemTitle>Reset to default</DropdownMenu.ItemTitle>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/** Three slider tracks with knobs: "adjust what's shown". */
function SlidersIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16">
      <Path d="M2 4h12M2 8h12M2 12h12" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Circle cx={10} cy={4} r={2} fill={color} />
      <Circle cx={5} cy={8} r={2} fill={color} />
      <Circle cx={11} cy={12} r={2} fill={color} />
    </Svg>
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
  // Takes the height left in a `fill` list, and no more.
  shrink: { flexShrink: 1, minHeight: 0 },
  columnsButton: { width: 28, height: 28, borderRadius: Spacing.one + 2, alignItems: 'center', justifyContent: 'center' },
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
  // A ScrollView shrinks by default; in a `fill` list the tall table would squash the pills.
  chipRow: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Spacing.four },
});
