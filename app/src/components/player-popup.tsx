import { Image } from 'expo-image';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  type GestureResponderHandlers,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  type Counts,
  type PlayerStats,
  absences,
  formatRate,
  lastGames,
  rates,
} from '@core/player-stats.ts';

import { StatChart } from '@/components/stat-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { shortDate } from '@/lib/format';
import type { DraftAction } from '@/lib/player';
import { type Projection, projection } from '@/lib/projections';
import { type SeasonData, useSeason } from '@/lib/season';
import { supabase } from '@/lib/supabase';
import { ownerName, teamName } from '@/lib/teams';

const WINDOWS = [7, 15, 30] as const;

// Stats already fetched this page load, by "playerId:season".
const statsCache = new Map<string, PlayerStats>();

function usePlayerStats(playerId: number | null, season: number | undefined): { stats?: PlayerStats; error?: string } {
  const key = playerId && season ? `${playerId}:${season}` : null;
  const [result, setResult] = useState<{ key: string; stats?: PlayerStats; error?: string } | null>(null);
  const cached = key ? statsCache.get(key) : undefined;

  useEffect(() => {
    if (!key || statsCache.has(key)) return;
    let cancelled = false;
    supabase.functions.invoke('player-stats', { body: { playerId, season } }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setResult({ key, error: "Couldn't load stats from MLB. Try again in a bit." });
      else {
        statsCache.set(key, data as PlayerStats);
        setResult({ key, stats: data as PlayerStats });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, playerId, season]);

  if (cached) return { stats: cached };
  if (result && result.key === key) return result;
  return {};
}

/** A player's stats card in a popup: a centered dialog on desktops, a bottom sheet on phones. */
export function PlayerPopup({
  playerId,
  draftAction,
  onClose,
}: {
  playerId: number | null;
  draftAction: DraftAction | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const wide = useLayout() === 'wide';
  const { drag, handlers } = useDragToClose(playerId, onClose);
  // The backdrop fades as the sheet is dragged down.
  const dim = drag.interpolate({ inputRange: [0, 400], outputRange: [1, 0], extrapolate: 'clamp' });
  return (
    <Modal visible={playerId !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, wide ? styles.backdropWide : styles.backdropCompact]}
        onPress={onClose}
        accessibilityLabel="Close">
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: wide ? 1 : dim }]} pointerEvents="none" />
        {/* Swallows taps so they don't reach the backdrop. */}
        <AnimatedPressable
          onPress={() => {}}
          style={[
            styles.panel,
            wide ? styles.panelWide : styles.panelCompact,
            { backgroundColor: theme.background, boxShadow: theme.floating },
            !wide && { transform: [{ translateY: drag }] },
          ]}>
          {playerId !== null && (
            <PlayerDetails
              playerId={playerId}
              draftAction={draftAction}
              onClose={onClose}
              dragHandlers={wide ? undefined : handlers}
            />
          )}
        </AnimatedPressable>
      </Pressable>
    </Modal>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const nativeDriver = Platform.OS !== 'web';

/**
 * Dragging the bottom sheet down by its header: past a third of the way (or on a quick flick) it
 * slides out and closes; short of that it springs back.
 */
function useDragToClose(playerId: number | null, onClose: () => void) {
  const { height } = useWindowDimensions();
  const [drag] = useState(() => new Animated.Value(0));
  // Back in place each time it opens.
  useEffect(() => {
    if (playerId !== null) drag.setValue(0);
  }, [playerId, drag]);

  const handlers = useMemo(() => {
    const springBack = () =>
      Animated.spring(drag, { toValue: 0, bounciness: 0, useNativeDriver: nativeDriver }).start();
    return PanResponder.create({
      // Touches that start on the header are its own, or the sheet's Pressable would take them.
      // Its buttons are deeper, so they still get their taps; a downward drag from one comes here.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > height / 3 || (g.dy > 40 && g.vy > 0.8)) {
          Animated.timing(drag, { toValue: height, duration: 180, useNativeDriver: nativeDriver }).start(() => onClose());
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: springBack,
    }).panHandlers;
  }, [drag, height, onClose]);

  return { drag, handlers };
}

/**
 * A player's stats: this season, a chart of his games, recent games and past seasons, plus where he stands in the league.
 * Fills its container: the popup, or the side panel on the Research tab.
 */
export function PlayerDetails({
  playerId,
  draftAction = null,
  onClose,
  dragHandlers,
}: {
  playerId: number;
  draftAction?: DraftAction | null;
  /** Shows a close button. */
  onClose?: () => void;
  /** Makes the header a handle for dragging the bottom sheet closed. */
  dragHandlers?: GestureResponderHandlers;
}) {
  const { data } = useSeason();
  const year = data?.season.year;
  const { stats, error } = usePlayerStats(playerId, year);

  const name = stats?.person.name ?? data?.players.get(playerId)?.full_name ?? '';
  const canDraft = !!draftAction?.canDraft(playerId);
  const pool = data?.poolByPlayer.get(playerId);

  return (
    <>
      <Header
        playerId={playerId}
        name={name}
        stats={stats}
        data={data}
        onClose={onClose}
        dragHandlers={dragHandlers}
        draft={
          canDraft && (
            <DraftChip
              label={draftAction!.label}
              onPress={() => {
                onClose?.();
                draftAction!.draft(playerId);
              }}
            />
          )
        }
      />
      <ScrollView contentContainerStyle={styles.body}>
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}
        {!stats && !error && <ActivityIndicator style={{ padding: Spacing.five }} />}
        {stats && year && (
          <StatsBody
            stats={stats}
            year={year}
            opsPlus={pool?.ops_plus ?? null}
            projection={data && pool ? projection(data, pool) : null}
          />
        )}
        <View style={styles.links}>
          <ExternalLink
            label="Baseball-Reference"
            url={`https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(name)}`}
          />
          <ExternalLink label="MLB.com" url={`https://www.mlb.com/player/${playerId}`} />
        </View>
      </ScrollView>
    </>
  );
}

function Header({
  playerId,
  name,
  stats,
  data,
  draft,
  onClose,
  dragHandlers,
}: {
  playerId: number;
  name: string;
  stats: PlayerStats | undefined;
  data: SeasonData | null;
  draft: ReactNode;
  onClose?: () => void;
  dragHandlers?: GestureResponderHandlers;
}) {
  const theme = useTheme();
  const person = stats?.person;
  const known = data?.players.get(playerId);
  const team = person?.team ?? (data && data.mlbTeams.get(data.poolByPlayer.get(playerId)?.mlb_team_id ?? 0)?.abbreviation);
  const bio = [
    person?.position ?? known?.primary_position,
    team,
    person?.age && `Age ${person.age}`,
    person?.bats && `Bats ${person.bats}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const status = data ? leagueStatus(data, playerId) : null;

  return (
    <View
      style={[styles.header, { borderBottomColor: theme.border }, dragHandlers && styles.dragHandle]}
      {...dragHandlers}>
      {dragHandlers && <View style={[styles.grabber, { backgroundColor: theme.border }]} />}
      <Image
        source={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${playerId}/headshot/67/current`}
        style={[styles.headshot, { backgroundColor: theme.backgroundElement }]}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
      <View style={styles.headerText}>
        <ThemedText type="default" style={styles.name} numberOfLines={1}>{name}</ThemedText>
        {bio !== '' && <ThemedText type="small" themeColor="textSecondary">{bio}</ThemedText>}
        {(status || draft) && (
          <View style={styles.statusRow}>
            {status && (
              <View style={[styles.status, { backgroundColor: status.available ? theme.tint : theme.backgroundElement }]}>
                <ThemedText type="smallBold" style={styles.statusText} themeColor={status.available ? 'text' : 'textSecondary'}>
                  {status.label}
                </ThemedText>
              </View>
            )}
            {draft}
          </View>
        )}
      </View>
      {onClose && (
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <ThemedText type="default" themeColor="textSecondary" style={styles.close}>✕</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

/** The Draft button, sized like the status tag it sits next to. */
function DraftChip({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.status, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}>
      <ThemedText type="smallBold" numberOfLines={1} style={[styles.statusText, { color: theme.accentText }]}>{label}</ThemedText>
    </Pressable>
  );
}

/** Whose team he's on, or whether he can be drafted. */
function leagueStatus(data: SeasonData, playerId: number): { label: string; available: boolean } | null {
  const spell = data.spells.find((s) => s.mlb_player_id === playerId && s.dropped_by_draft_id === null);
  const team = spell && data.teams.find((t) => t.id === spell.fantasy_team_id);
  if (team) {
    const owner = ownerName(data, team);
    return { label: `${teamName(team)}${owner ? ` · ${owner}` : ''}`, available: false };
  }
  const entry = data.poolByPlayer.get(playerId);
  if (!entry) return null;
  if (data.mlbTeams.get(entry.mlb_team_id)?.eliminated) return { label: 'Team eliminated', available: false };
  if (!entry.on_postseason_roster) return { label: 'Not on the postseason roster', available: false };
  return { label: 'Available', available: true };
}

/** Numbers only the season row has: OPS+ and the draft table's projections. */
interface SeasonExtras {
  opsPlus: number | null;
  /** Null for a player outside the draft pool. */
  projection: Projection | null;
}

interface Column {
  label: string;
  width: number;
  value: (c: Counts, season: SeasonExtras | null) => string;
}

const COUNT = (key: keyof Counts, label: string, width = 30): Column => ({ label, width, value: (c) => String(c[key]) });
const RATE = (key: 'avg' | 'obp' | 'slg' | 'ops', label: string): Column => ({
  label,
  width: 44,
  value: (c) => formatRate(rates(c)[key]),
});

// TB first: it's what decides everything in Baggery, so it's in view even on a phone.
const COUNT_COLUMNS: Column[] = [
  COUNT('tb', 'TB', 38),
  COUNT('g', 'G'),
  COUNT('pa', 'PA', 36),
  COUNT('ab', 'AB', 36),
  COUNT('r', 'R'),
  COUNT('h', 'H', 34),
  COUNT('doubles', '2B'),
  COUNT('triples', '3B'),
  COUNT('hr', 'HR'),
  COUNT('rbi', 'RBI', 34),
  COUNT('bb', 'BB'),
  COUNT('so', 'SO', 34),
  RATE('avg', 'AVG'),
  RATE('obp', 'OBP'),
  RATE('slg', 'SLG'),
  RATE('ops', 'OPS'),
];

/** Blank on the Last N rows. The projections match the draft table's columns. */
const SEASON_COLUMNS: Column[] = [
  { label: 'OPS+', width: 48, value: (_, s) => (s?.opsPlus == null ? '' : String(s.opsPlus)) },
  { label: 'RDSLG', width: 60, value: (_, s) => (s?.projection?.rdslg == null ? '' : formatRate(s.projection.rdslg)) },
  {
    label: 'TB·E[G]/162',
    width: 88,
    value: (_, s) => (s?.projection?.tbExpected == null ? '' : s.projection.tbExpected.toFixed(1)),
  },
  { label: 'RDTB', width: 50, value: (_, s) => (s?.projection?.rdtb == null ? '' : s.projection.rdtb.toFixed(1)) },
];

const LINE_COLUMNS = [...COUNT_COLUMNS, ...SEASON_COLUMNS];

const GAME_COLUMNS: Column[] = [
  COUNT('tb', 'TB', 38),
  COUNT('ab', 'AB'),
  COUNT('r', 'R'),
  COUNT('h', 'H'),
  COUNT('doubles', '2B'),
  COUNT('triples', '3B'),
  COUNT('hr', 'HR'),
  COUNT('rbi', 'RBI', 38),
  COUNT('bb', 'BB'),
  COUNT('so', 'SO'),
];

function StatsBody({
  stats,
  year,
  opsPlus,
  projection,
}: {
  stats: PlayerStats;
  year: number;
  opsPlus: number | null;
  /** Null for a player outside the draft pool. */
  projection: Projection | null;
}) {
  const [span, setSpan] = useState<(typeof WINDOWS)[number]>(15);
  const [showYears, setShowYears] = useState(false);
  const games = stats.games.slice(0, span);

  const splits: { label: string; note?: string; line: Counts; season?: SeasonExtras; key?: boolean }[] = [];
  if (stats.season) splits.push({ label: String(year), line: stats.season, season: { opsPlus, projection }, key: true });
  for (const n of WINDOWS) {
    if (stats.games.length < n) continue;
    // A window that reaches back across time he missed says how far back it goes.
    const first = stats.games[n - 1].date;
    const note = absences(stats.games.slice(0, n), first, stats.games[0].date).length ? `since ${shortDate(first)}` : undefined;
    splits.push({ label: `Last ${n}`, note, line: lastGames(stats.games, n) });
  }
  if (!splits.length) {
    return <ThemedText themeColor="textSecondary">No MLB games in {year} yet.</ThemedText>;
  }

  return (
    <>
      <Section title={`${year} regular season`}>
        <StatTable
          labelWidth={72}
          columns={LINE_COLUMNS}
          rows={splits.map((s) => ({
            key: s.label,
            label: s.label,
            note: s.note,
            strong: s.key,
            cells: LINE_COLUMNS.map((c) => c.value(s.line, s.season ?? null)),
          }))}
        />
      </Section>

      {stats.games.length > 0 && (
        <Section title="Chart">
          <StatChart games={stats.games} season={stats.season} dates={stats.dates ?? null} />
        </Section>
      )}

      {stats.games.length > 0 && (
        <Section
          title="Game log"
          action={<WindowToggle value={span} onChange={setSpan} />}>
          <StatTable
            labelWidth={96}
            columns={GAME_COLUMNS}
            rows={games.map((g, i) => ({
              // Index too: a doubleheader is two games on one date against one team.
              key: `${g.date}${g.opponent}${i}`,
              label: `${shortDate(g.date)} ${g.home ? 'vs' : '@'} ${g.opponent}`,
              cells: GAME_COLUMNS.map((c) => c.value(g, null)),
            }))}
          />
        </Section>
      )}

      {stats.years.length > 0 && (
        <Section
          title="Past seasons"
          action={
            <Pressable onPress={() => setShowYears(!showYears)} hitSlop={8} accessibilityRole="button">
              <ThemedText type="smallBold" themeColor="accent">{showYears ? 'Hide' : `Show ${stats.years.length}`}</ThemedText>
            </Pressable>
          }>
          {showYears && (
            <StatTable
              labelWidth={84}
              columns={COUNT_COLUMNS}
              rows={stats.years.map((y) => ({
                key: `${y.season}`,
                label: `${y.season} ${y.team}`,
                cells: COUNT_COLUMNS.map((c) => c.value(y, null)),
              }))}
            />
          )}
        </Section>
      )}
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{title}</ThemedText>
        {action}
      </View>
      {children}
    </View>
  );
}

function WindowToggle({ value, onChange }: { value: number; onChange: (n: (typeof WINDOWS)[number]) => void }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" elevation="sunken" style={styles.toggle}>
      {WINDOWS.map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange(n)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === n }}
          style={[styles.toggleItem, value === n && { backgroundColor: theme.segment, boxShadow: theme.raised }]}>
          <ThemedText type="smallBold" themeColor={value === n ? 'text' : 'textSecondary'} style={styles.toggleText}>
            Last {n}
          </ThemedText>
        </Pressable>
      ))}
    </ThemedView>
  );
}

/** A compact box-score table; the label column stays put while the numbers scroll on phones. */
function StatTable({
  columns,
  rows,
  labelWidth,
}: {
  columns: Column[];
  rows: { key: string; label: string; note?: string; cells: string[]; strong?: boolean }[];
  labelWidth: number;
}) {
  const theme = useTheme();
  // Room for a note after the label ("Last 30 since 5/12"), only when a row has one.
  const width = labelWidth + (rows.some((r) => r.note) ? 72 : 0);
  const tbIndex = columns.findIndex((c) => c.label === 'TB');
  const rowBorder = (i: number) => i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border };
  return (
    <ThemedView type="backgroundElement" style={styles.table}>
      <View style={[styles.labelColumn, { width, borderRightColor: theme.border }]}>
        <View style={[styles.tableRow, styles.tableHead, { borderBottomColor: theme.border }]} />
        {rows.map((r, i) => (
          <View key={r.key} style={[styles.tableRow, styles.labelCell, rowBorder(i)]}>
            <ThemedText type={r.strong ? 'smallBold' : 'small'} numberOfLines={1} style={styles.cellText}>
              {r.label}
              {r.note && <ThemedText type="small" themeColor="textSecondary" style={styles.cellText}>{` ${r.note}`}</ThemedText>}
            </ThemedText>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flexGrow: 1 }}>
          <View style={[styles.tableRow, styles.tableHead, styles.cells, { borderBottomColor: theme.border }]}>
            {columns.map((c, j) => (
              <View key={c.label} style={[styles.cell, { minWidth: c.width }, j === tbIndex && { backgroundColor: theme.tint }]}>
                <ThemedText type="smallBold" themeColor={j === tbIndex ? 'text' : 'textSecondary'} style={styles.cellText}>
                  {c.label}
                </ThemedText>
              </View>
            ))}
          </View>
          {rows.map((r, i) => (
            <View key={r.key} style={[styles.tableRow, styles.cells, rowBorder(i)]}>
              {r.cells.map((value, j) => (
                <View key={columns[j].label} style={[styles.cell, { minWidth: columns[j].width }, j === tbIndex && { backgroundColor: theme.tint }]}>
                  <ThemedText
                    type={r.strong || j === tbIndex ? 'smallBold' : 'small'}
                    style={[styles.cellText, styles.number]}>
                    {value}
                  </ThemedText>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function ExternalLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => Linking.openURL(url)} accessibilityRole="link" hitSlop={6}>
      <ThemedText type="smallBold" themeColor="accent">{label} ↗</ThemedText>
    </Pressable>
  );
}

const ROW = 30;

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center' },
  dim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  backdropWide: { justifyContent: 'center', padding: Spacing.four },
  backdropCompact: { justifyContent: 'flex-end' },
  panel: { width: '100%', overflow: 'hidden' },
  panelWide: { maxWidth: 760, maxHeight: '90%', borderRadius: Radius.lg },
  panelCompact: { maxHeight: '92%', borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Web: keep the browser from scrolling or selecting text while the header is dragged.
  dragHandle: Platform.select({ web: { touchAction: 'none', userSelect: 'none', cursor: 'grab' } as object, default: {} }),
  grabber: { position: 'absolute', top: 6, alignSelf: 'center', left: '50%', marginLeft: -18, width: 36, height: 5, borderRadius: 3 },
  headshot: { width: 64, height: 64, borderRadius: 32 },
  headerText: { flex: 1, gap: Spacing.half },
  name: { fontSize: 20, lineHeight: 26, fontWeight: 700 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.half },
  status: { paddingHorizontal: Spacing.two, paddingVertical: 1, borderRadius: Radius.sm },
  statusText: { fontSize: 12, lineHeight: 18 },
  close: { fontSize: 18, lineHeight: 22, paddingHorizontal: Spacing.one },
  body: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  section: { gap: Spacing.two },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, minHeight: 28 },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 13 },
  toggle: { flexDirection: 'row', borderRadius: Radius.md, padding: 2 },
  toggleItem: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.sm },
  toggleText: { fontSize: 13 },
  table: { flexDirection: 'row', borderRadius: Radius.md, overflow: 'hidden' },
  labelColumn: { borderRightWidth: StyleSheet.hairlineWidth },
  tableRow: { height: ROW },
  tableHead: { borderBottomWidth: StyleSheet.hairlineWidth },
  labelCell: { justifyContent: 'center', paddingHorizontal: Spacing.two },
  cells: { flexDirection: 'row', paddingRight: Spacing.two },
  cell: { flexGrow: 1, flexBasis: 0, height: '100%', justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: Spacing.one },
  cellText: { fontSize: 13, lineHeight: 18 },
  number: { fontVariant: ['tabular-nums'] },
  links: { flexDirection: 'row', gap: Spacing.four },
});
