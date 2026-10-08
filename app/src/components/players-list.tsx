import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as DropdownMenu from 'zeego/dropdown-menu';

import type { MatchupSeries } from '@core/matchups.ts';
import type { TeamOdds } from '@core/odds.ts';
import { expectedBags } from '@core/stats.ts';

import { ColumnInfo } from '@/components/column-info';
import { COLUMNS, type Column, type ColumnFilters, type ColumnKey, DEFAULT_COLUMNS, type PlayerRow, PlayerTable } from '@/components/player-table';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { type Range, filterRows } from '@/lib/column-filters';
import { useOpenPlayer } from '@/lib/player';
import { usePlayerColumns } from '@/lib/player-columns';
import { type PlatoonData, availableGames, matchupsByTeam, playerPlatoon, usePlatoons } from '@/lib/platoon';
import { projection, teamOdds } from '@/lib/projections';
import { useScores } from '@/lib/scores';
import { type Ownership, draftablePlayers, ownership, releasingTeams } from '@/lib/board';
import { type Draft, type SeasonData, injuredDraftable } from '@/lib/season';
import { teamName } from '@/lib/teams';
import { supabase } from '@/lib/supabase';

/** Which players a list shows, and what it says about them. */
export interface Board {
  /** Who owns each drafted player (or did, and dropped him). */
  owners: Map<number, Ownership>;
  /** MLB teams still alive, the ones with a team chip. */
  alive: Set<number>;
  /**
   * Starts filtered to who can be drafted (unowned players on alive teams), with the Owner and
   * Alive filters on, and back on each time the screen comes back into view: a draft's board and
   * Research, until the season is over.
   */
  draftFilters: boolean;
  /** Only players on their team's postseason roster. */
  rosterOnly: boolean;
  /** With `rosterOnly`, hitters on the injured list too (Draft 1). */
  injured: boolean;
  /** Postseason stats count games that started before this (a finished draft's lock); all when not set. */
  statsBefore?: string | null;
}

/** Each player's postseason PA and TB so far, by player id. */
export type PostseasonTotals = Map<number, { pa: number | null; tb: number }>;

/**
 * This postseason's PA and TB per player (games before `before`, if given), loaded once: one small
 * row per hitter. Empty until the postseason has games; null while loading.
 */
export function usePostseasonTotals(year: number, before?: string | null): PostseasonTotals | null {
  const [totals, setTotals] = useState<PostseasonTotals | null>(null);
  useEffect(() => {
    let stale = false;
    supabase.rpc('postseason_totals', { p_year: year, p_before: before ?? null }).then(({ data: rows }) => {
      if (stale) return;
      setTotals(new Map((rows ?? []).map((r: { mlb_player_id: number; pa: number | null; tb: number }) => [r.mlb_player_id, { pa: r.pa, tb: r.tb }])));
    });
    return () => {
      stale = true;
    };
  }, [year, before]);
  return totals;
}

/** Filters a board starts with: only unowned players on alive teams, for a draft's board. */
export function startFilters(board: Board): ColumnFilters {
  return board.draftFilters ? { owner: { min: null, max: 0 }, alive: { min: 1, max: null } } : {};
}

/**
 * The board now: every postseason roster, owned players and eliminated teams included, starting
 * filtered to who can be drafted. Once the season is over it's the whole player pool, unfiltered.
 */
export function currentBoard(data: SeasonData): Board {
  const owners = ownership(data.spells, Infinity, releasingTeams(data.teams));
  const alive = new Set([...data.mlbTeams.values()].filter((t) => !t.eliminated).map((t) => t.id));
  if (data.season.status === 'complete') return { owners, alive, draftFilters: false, rosterOnly: false, injured: true };
  return { owners, alive, draftFilters: true, rosterOnly: true, injured: injuredDraftable(data) };
}

/** Who can be drafted now, whatever the board shows: for the Draft button and the queue. */
export function draftableNow(data: SeasonData): Set<number> {
  return draftablePlayers(data.pool, data.mlbTeams, data.spells, injuredDraftable(data), releasingTeams(data.teams));
}

/**
 * A draft's board. A live or upcoming draft uses the current one. A finished draft shows how it
 * ended: who owned whom by then, and the MLB teams playing the series it was before as the alive
 * ones (every postseason team for Draft 1, since Wild Card byes don't play that round).
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
    // Starts filtered to who can still be drafted, while there's a draft left.
    if (draft.status !== 'complete') return currentBoard(data);
    const locks = draft.locks_at ? Date.parse(draft.locks_at) : Infinity;
    return {
      owners: ownership(data.spells, locks, releasingTeams(data.teams, draft.number)),
      alive: (done && seriesTeams) || new Set(data.mlbTeams.keys()),
      draftFilters: true,
      rosterOnly: true,
      injured: draft.number === 1,
      statsBefore: draft.locks_at,
    };
  }, [data, draft, done, seriesTeams]);
}

/**
 * The players on a board, with what the table shows for each. Once the postseason has games, a
 * player missing from `totals` hasn't batted yet: 0 PA and 0 TB if his team has played, empty (a
 * dash) if it hasn't, like a Wild Card bye.
 */
export function boardPlayers(
  data: SeasonData,
  board: Board = currentBoard(data),
  totals: PostseasonTotals | null = null,
  odds: Map<number, TeamOdds> | null = null,
  platoons: PlatoonData | null = null,
  matchups: Map<number, MatchupSeries[]> = new Map(),
): (PlayerRow & { mlbTeamId: number })[] {
  const postseason = !!totals?.size;
  // Teams that have played: any of their hitters has a postseason line.
  const played = new Set(data.pool.filter((p) => totals?.has(p.mlb_player_id)).map((p) => p.mlb_team_id));
  // The odds are from the draft's lock for a finished one; xBags counts injured games from then.
  const now = board.statsBefore ? Date.parse(board.statsBefore) : Date.now();
  const teamsById = new Map(data.teams.map((t) => [t.id, t]));
  return data.pool
    .filter(
      (p) =>
        (!board.rosterOnly || p.on_postseason_roster || (board.injured && p.injured_list !== null)) &&
        data.mlbTeams.has(p.mlb_team_id),
    )
    .map((p) => {
      const team = data.mlbTeams.get(p.mlb_team_id);
      const owner = board.owners.get(p.mlb_player_id);
      const fantasyTeam = owner && teamsById.get(owner.teamId);
      const teamOdd = odds?.get(p.mlb_team_id);
      const { bye, rdslg, tbExpected, rdtb } = projection(data, p);
      const teamMatchups = matchups.get(p.mlb_team_id) ?? [];
      const platoon = playerPlatoon(p, platoons, teamMatchups, teamOdd, now);
      const gamesLeft = availableGames(p, teamMatchups, teamOdd, now);
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
        owner: owner ? (fantasyTeam ? teamName(fantasyTeam) : '—') : null,
        burned: !!owner?.dropped,
        alive: board.alive.has(p.mlb_team_id),
        injuredList: p.injured_list,
        wins: team?.wins ?? null,
        adv: teamOdd ? 100 * teamOdd.advance : null,
        // From his starts and lineup spots against each hand when the pool has them.
        xBags:
          platoon?.xBags ??
          (gamesLeft !== null && ab !== null && p.games_played !== null ? expectedBags(p.regular_season_tb, ab, p.games_played, gamesLeft) : null),
        spot: platoon?.spots[platoon.primary] ?? null,
        platoon,
        bye,
        postPa: postseason && played.has(p.mlb_team_id) ? (totals!.get(p.mlb_player_id)?.pa ?? 0) : null,
        postTb: postseason && played.has(p.mlb_team_id) ? (totals!.get(p.mlb_player_id)?.tb ?? 0) : null,
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
  const [chosen, setColumns] = usePlayerColumns();
  const { height } = useWindowDimensions();
  // Desktop web: the table scrolls in its own box, sized to the window, so its scrollbars are in
  // view. In `fill` the parent sets the size; otherwise it's capped a bit under the window height.
  const wide = useLayout() === 'wide';
  const contained = Platform.OS === 'web' && wide;
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<number | null>(null);
  const shownBoard = useMemo(() => board ?? currentBoard(data), [board, data]);
  const [filters, setFilters] = useState<ColumnFilters>(() => startFilters(shownBoard));
  // Coming back to the screen turns the Owner and Alive filters back on, keeping any others. Not
  // when the board refreshes while in view, which would undo clearing them.
  const boardRef = useRef(shownBoard);
  useEffect(() => {
    boardRef.current = shownBoard;
  }, [shownBoard]);
  useFocusEffect(
    useCallback(() => {
      const start = startFilters(boardRef.current);
      if (Object.keys(start).length) setFilters((f) => ({ ...f, ...start }));
    }, []),
  );
  const totals = usePostseasonTotals(data.season.year, shownBoard.statsBefore);
  const { scores } = useScores();
  // Waits for the games, so a series under way isn't shown from 0-0.
  const odds = useMemo(() => (scores ? teamOdds(data, scores.games, shownBoard.statsBefore) : null), [data, scores, shownBoard.statsBefore]);
  const platoons = usePlatoons(data);
  const matchups = useMemo(
    () => matchupsByTeam(data, platoons, scores?.games ?? null, shownBoard.statsBefore),
    [data, platoons, scores, shownBoard.statsBefore],
  );
  const available = useMemo(
    () => boardPlayers(data, shownBoard, totals, odds, platoons, matchups),
    [data, shownBoard, totals, odds, platoons, matchups],
  );
  // Postseason columns only once it has games (before that they'd be empty), Draft 1's (Bye) only
  // before; the odds columns only with odds.
  const offered = useMemo(
    () => COLUMNS.filter((c) => (totals?.size ? !c.draft1 : !c.postseason) && (odds || !c.odds)),
    [totals, odds],
  );
  const columns = useMemo(() => chosen.filter((k) => offered.some((c) => c.key === k)), [chosen, offered]);
  const q = query.trim().toLowerCase();
  const shown = available.filter(
    (p) => (teamFilter === null || p.mlbTeamId === teamFilter) && (!q || p.name.toLowerCase().includes(q)),
  );
  // Only the filters on columns in view: hiding a column drops its filter rather than hiding players
  // for a reason you can't see. Owner and Alive keep theirs; the line above the table says so.
  const active = COLUMNS.filter((c) => (columns.includes(c.key) || c.keepsFilter) && filters[c.key]);
  const clearFilter = (key: ColumnKey) => {
    const next = { ...filters };
    delete next[key];
    setFilters(next);
  };
  const filtered = filterRows(shown, active.map((c) => ({ value: c.value, range: filters[c.key]! })));
  const tableProps = {
    rows: filtered,
    onSelect: onSelect ?? openPlayer,
    selectedId,
    columns,
    headerAction: <ColumnsMenu offered={offered} value={chosen} onChange={setColumns} />,
    filters,
    onFiltersChange: setFilters,
    filterSource: available,
    onNaturalWidth: onTableWidth,
  };
  // Alive teams only: All is every postseason team, alive or not. After the season, all of them.
  const mlbTeams = [...data.mlbTeams.values()]
    .filter((t) => data.season.status === 'complete' || shownBoard.alive.has(t.id))
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
          <ThemedText type="small" themeColor="textSecondary">
            {filtered.length} of {shown.length}
          </ThemedText>
          {active.map((c) => (
            <FilterPill key={c.key} label={describeFilter(c, filters[c.key]!)} onClear={() => clearFilter(c.key)} />
          ))}
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

/**
 * A small icon in the table's header with a checklist of its columns; stays open while you tick.
 * Each is just its name, with an info icon to tap for what it is.
 */
function ColumnsMenu({ offered, value, onChange }: {
  /** The columns it lists: the postseason ones once it has games, Draft 1's before. */
  offered: Column[];
  value: ColumnKey[];
  onChange: (columns: ColumnKey[]) => void;
}) {
  const theme = useTheme();
  const toggle = (key: ColumnKey) =>
    onChange(COLUMNS.map((c) => c.key).filter((k) => (k === key ? !value.includes(k) : value.includes(k))));
  const all = offered.every((c) => value.includes(c.key));
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
        {offered.map((c) => (
          <DropdownMenu.CheckboxItem
            key={c.key}
            className="menu-item"
            value={value.includes(c.key) ? 'on' : 'off'}
            onValueChange={() => toggle(c.key)}
            shouldDismissMenuOnSelect={false}>
            <DropdownMenu.ItemTitle>{c.label}</DropdownMenu.ItemTitle>
            <ColumnInfo text={c.title} label={c.label} />
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

/** An active filter above the table, with ✕ to clear it (the Owner and Alive ones may be on hidden columns). */
function FilterPill({ label, onClear }: { label: string; onClear: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onClear}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`Clear filter: ${label}`}
      style={({ pressed }) => [styles.pill, { backgroundColor: pressed ? theme.tintStrong : theme.tint }]}>
      <ThemedText type="smallBold" style={styles.pillText}>{label}</ThemedText>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.pillText}>✕</ThemedText>
    </Pressable>
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
  filterLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  pill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.md },
  pillText: { fontSize: 12, lineHeight: 16 },
  chips: { gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Radius.md },
});
