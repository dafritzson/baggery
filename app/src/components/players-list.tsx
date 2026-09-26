import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as DropdownMenu from 'zeego/dropdown-menu';

import { COLUMNS, type Column, type ColumnFilters, type ColumnKey, DEFAULT_COLUMNS, type PlayerRow, PlayerTable } from '@/components/player-table';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { type Range, filterRows } from '@/lib/column-filters';
import { useOpenPlayer } from '@/lib/player';
import { usePlayerColumns } from '@/lib/player-columns';
import { projection } from '@/lib/projections';
import type { Draft, SeasonData } from '@/lib/season';
import { supabase } from '@/lib/supabase';

/** Which players a list shows. */
export interface Board {
  /** Players on a fantasy team, left off the list. */
  taken: Set<number>;
  /** MLB teams whose players are listed. */
  teamIds: Set<number>;
  /** Only players on their team's postseason roster. */
  rosterOnly: boolean;
}

/**
 * The board now: players who can still be drafted (on a live postseason roster and on nobody's
 * team). Once the season is over there's nothing left to draft, so it's the whole player pool.
 */
export function currentBoard(data: SeasonData): Board {
  if (data.season.status === 'complete') {
    return { taken: new Set(), teamIds: new Set(data.mlbTeams.keys()), rosterOnly: false };
  }
  return {
    taken: new Set(data.spells.map((s) => s.mlb_player_id)),
    teamIds: new Set([...data.mlbTeams.values()].filter((t) => !t.eliminated).map((t) => t.id)),
    rosterOnly: true,
  };
}

/**
 * A draft's board. A live or upcoming draft uses the current one. A finished draft shows what was
 * left once it was done: players nobody had drafted by then, on the MLB teams playing the series
 * it was before (every postseason team for Draft 1, since Wild Card byes don't play that round).
 */
export function useDraftBoard(data: SeasonData, draft: Draft): Board {
  const [seriesTeams, setSeriesTeams] = useState<Set<number> | null>(null);
  const done = draft.status === 'complete' && draft.before_game_type !== 'F';
  const year = data.season.year;
  useEffect(() => {
    if (!done) return;
    let stale = false;
    supabase
      .from('mlb_games')
      .select('home_team_id, away_team_id')
      .eq('season_year', year)
      .eq('game_type', draft.before_game_type)
      .then(({ data: games }) => {
        if (!stale && games?.length) setSeriesTeams(new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id])));
      });
    return () => {
      stale = true;
    };
  }, [done, year, draft.before_game_type]);

  return useMemo(() => {
    if (draft.status !== 'complete') return currentBoard(data);
    const locks = draft.locks_at ? Date.parse(draft.locks_at) : Infinity;
    return {
      taken: new Set(data.spells.filter((s) => Date.parse(s.from_at) <= locks).map((s) => s.mlb_player_id)),
      teamIds: (done && seriesTeams) || new Set(data.mlbTeams.keys()),
      rosterOnly: true,
    };
  }, [data, draft, done, seriesTeams]);
}

/** The players on a board, with what the table shows for each. */
export function availablePlayers(data: SeasonData, board: Board = currentBoard(data)): (PlayerRow & { mlbTeamId: number })[] {
  return data.pool
    .filter(
      (p) =>
        (!board.rosterOnly || p.on_postseason_roster) && !board.taken.has(p.mlb_player_id) && board.teamIds.has(p.mlb_team_id),
    )
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
 * Search, team filter and the sortable table of the players on a board (the current one unless
 * given). Tapping one opens their stats in the popup, unless `onSelect` handles it.
 */
export function PlayersList({
  data,
  board,
  onSelect,
  selectedId,
  fill = false,
  onTableWidth,
}: {
  data: SeasonData;
  board?: Board;
  onSelect?: (playerId: number) => void;
  selectedId?: number | null;
  /** Fill the parent's height, scrolling the table inside it rather than with the page. */
  fill?: boolean;
  /** The width the table needs for every chosen column, e.g. to size the list around it. */
  onTableWidth?: (width: number) => void;
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
  const [filters, setFilters] = useState<ColumnFilters>({});

  const shownBoard = useMemo(() => board ?? currentBoard(data), [board, data]);
  const available = useMemo(() => availablePlayers(data, shownBoard), [data, shownBoard]);
  const q = query.trim().toLowerCase();
  const shown = available.filter(
    (p) => (teamFilter === null || p.mlbTeamId === teamFilter) && (!q || p.name.toLowerCase().includes(q)),
  );
  // Only the filters on columns in view: hiding a column drops its filter rather than hiding players for a reason you can't see.
  const active = COLUMNS.filter((c) => columns.includes(c.key) && filters[c.key]);
  const filtered = filterRows(shown, active.map((c) => ({ value: c.value, range: filters[c.key]! })));
  const tableProps = {
    rows: filtered,
    onSelect: onSelect ?? openPlayer,
    selectedId,
    columns,
    headerAction: <ColumnsMenu value={columns} onChange={setColumns} />,
    filters,
    onFiltersChange: setFilters,
    filterSource: available,
    onNaturalWidth: onTableWidth,
  };
  const mlbTeams = [...data.mlbTeams.values()]
    .filter((t) => shownBoard.teamIds.has(t.id))
    .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));

  return (
    <View style={[{ gap: Spacing.two }, fill && styles.fill]}>
      <View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search players"
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border, boxShadow: theme.sunken }]}
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
      {active.length > 0 && (
        <View style={styles.filterLine}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.filterSummary} numberOfLines={1}>
            {filtered.length} of {shown.length} · {active.map((c) => describeFilter(c, filters[c.key]!)).join(' · ')}
          </ThemedText>
          <Pressable onPress={() => setFilters({})} hitSlop={8} accessibilityRole="button">
            <ThemedText type="smallBold" themeColor="accent">Clear filters</ThemedText>
          </Pressable>
        </View>
      )}
      {/* Kept while filters hide every row, so their menus in its header can undo them. */}
      {shown.length > 0 &&
        (fill && !contained ? (
          <ScrollView style={styles.fill}>
            <PlayerTable {...tableProps} />
          </ScrollView>
        ) : (
          <PlayerTable
            {...tableProps}
            contained={contained}
            style={contained ? (fill ? styles.shrink : { maxHeight: Math.max(320, height - 200) }) : undefined}
          />
        ))}
      {filtered.length === 0 && data.pool.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary">No matching players.</ThemedText>
      )}
    </View>
  );
}

/** "PA ≥ 300", "SLG .400–.500", "Bye". */
function describeFilter(c: Column, range: Range): string {
  if (c.flag) return range.min === 1 ? c.flag.yes : c.flag.no;
  const format = (v: number) => (c.format ? c.format(v) : String(v));
  if (range.min !== null && range.max !== null) return `${c.label} ${format(range.min)}–${format(range.max)}`;
  return range.min !== null ? `${c.label} ≥ ${format(range.min)}` : `${c.label} ≤ ${format(range.max!)}`;
}

/** A small icon in the table's header with a checklist of its columns; stays open while you tick. */
function ColumnsMenu({ value, onChange }: { value: ColumnKey[]; onChange: (columns: ColumnKey[]) => void }) {
  const theme = useTheme();
  const toggle = (key: ColumnKey) =>
    onChange(COLUMNS.map((c) => c.key).filter((k) => (k === key ? !value.includes(k) : value.includes(k))));
  const all = COLUMNS.every((c) => value.includes(c.key));
  const isDefault = value.length === DEFAULT_COLUMNS.length && DEFAULT_COLUMNS.every((k) => value.includes(k));
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
        {/* Ticked when exactly the defaults show; ticking goes back to them (unticking leaves them). */}
        <DropdownMenu.CheckboxItem
          key="default"
          className="menu-item"
          value={isDefault ? 'on' : 'off'}
          onValueChange={() => onChange(DEFAULT_COLUMNS)}
          shouldDismissMenuOnSelect={false}>
          <DropdownMenu.ItemTitle>Default columns</DropdownMenu.ItemTitle>
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
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? theme.accent : theme.backgroundElement, boxShadow: pressed ? theme.sunken : theme.raised },
      ]}>
      <ThemedText type="smallBold" style={{ color: active ? theme.accentText : theme.text }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Takes the height left in a `fill` list, and no more.
  shrink: { flexShrink: 1, minHeight: 0 },
  columnsButton: { width: 28, height: 28, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  // Room on the right for the clear button.
  search: { minHeight: 44, borderRadius: Radius.md, borderWidth: 1, paddingLeft: Spacing.three, paddingRight: 44, fontSize: 16 },
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
  filterLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  filterSummary: { flexShrink: 1 },
  chips: { gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Radius.md },
});
