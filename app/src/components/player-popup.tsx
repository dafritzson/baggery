import { Image } from 'expo-image';
import { router } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderHandlers,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  type Counts,
  type PlayerStats,
  absences,
  formatRate,
  lastGames,
  rates,
} from '@core/player-stats.ts';
import { playerSeries } from '@core/scoreboard.ts';
import { type GameType, ROUND_FOR_GAME_TYPE } from '@core/types.ts';

import { Button } from '@/components/button';
import { hoverTitle, noSelect, useHoldTip } from '@/components/hold-tip';
import { injuryText } from '@/components/injury';
import { MatchupStrip, PlatoonSplitTable } from '@/components/platoon';
import { COLUMNS as DRAFT_COLUMNS, type ColumnKey } from '@/components/player-table';
import { PopupSheet, SheetHandle } from '@/components/popup-sheet';
import { type GridRow, ScoreGrid } from '@/components/score-grid';
import { StatChart } from '@/components/stat-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { headshotUrl, shortDate } from '@/lib/format';
import type { DraftAction } from '@/lib/player';
import { matchupsByTeam, playerPlatoon, usePlatoons } from '@/lib/platoon';
import { type Projection, projection, teamOdds } from '@/lib/projections';
import { coreSpells, usePlayerScores, useScores } from '@/lib/scores';
import { type SeasonData, injuredDraftable, useSeason } from '@/lib/season';
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
  return (
    <PopupSheet open={playerId !== null} onClose={onClose}>
      {(dragHandlers) =>
        playerId !== null && <PlayerDetails playerId={playerId} draftAction={draftAction} onClose={onClose} dragHandlers={dragHandlers} />
      }
    </PopupSheet>
  );
}

/**
 * A player's stats: his bags this postseason, this season, a chart of his games, recent games, his postseasons and past seasons, plus
 * where he stands in the league.
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
  const { data, requestedYear } = useSeason();
  const year = data?.season.year;
  const { stats, error } = usePlayerStats(playerId, year);

  const name = stats?.person.name ?? data?.players.get(playerId)?.full_name ?? '';
  const canDraft = !!draftAction?.canDraft(playerId);
  const queue = draftAction?.queue;
  const queued = !!queue?.has(playerId);
  const canQueue = !!queue && (queued || queue.canQueue(playerId));
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
          (canDraft || canQueue) && (
            <View style={styles.draftButtons}>
              {canDraft && (
                <View style={styles.draftButton}>
                  <Button
                    label={draftAction!.label}
                    onPress={() => {
                      onClose?.();
                      draftAction!.draft(playerId);
                    }}
                  />
                </View>
              )}
              {canQueue && (
                <View style={styles.draftButton}>
                  <Button
                    label={queued ? 'Remove from queue' : 'Add to queue'}
                    variant="secondary"
                    onPress={() => queue!.toggle(playerId)}
                  />
                </View>
              )}
            </View>
          )
        }
      />
      <ScrollView contentContainerStyle={styles.body}>
        {data && <BaggerySection data={data} playerId={playerId} requestedYear={requestedYear} onClose={onClose} />}
        {data && <MatchupsSection data={data} playerId={playerId} />}
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

/**
 * His starts, lineup spots and splits against each hand, and this round's likely starters against
 * his team (components/platoon.tsx). Only for pool players the sync found lineups for.
 */
function MatchupsSection({ data, playerId }: { data: SeasonData; playerId: number }) {
  const platoons = usePlatoons(data);
  const { scores } = useScores();
  const entry = data.poolByPlayer.get(playerId);
  const platoon = useMemo(() => {
    if (!entry || !platoons || !scores) return null;
    const team = data.mlbTeams.get(entry.mlb_team_id);
    const live = data.season.status !== 'complete' && !team?.eliminated;
    const matchups = live ? (matchupsByTeam(data, platoons, scores.games).get(entry.mlb_team_id) ?? []) : [];
    return playerPlatoon(entry, platoons, matchups, live ? teamOdds(data, scores.games)?.get(entry.mlb_team_id) : undefined);
  }, [data, entry, platoons, scores]);
  if (!platoon) return null;
  return (
    <Section id="matchups" title={platoon.matchups.length ? 'Matchups this round' : 'Against each hand'}>
      {platoon.matchups.length ? <MatchupStrip platoon={platoon} /> : <PlatoonSplitTable platoon={platoon} />}
    </Section>
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
  const injury = data ? injuryText(data.poolByPlayer.get(playerId)) : null;

  return (
    <SheetHandle dragHandlers={dragHandlers} style={[styles.header, { borderBottomColor: theme.border }]}>
      <View style={styles.headerTop}>
        <Image
          source={headshotUrl(playerId)}
          style={[styles.headshot, { backgroundColor: theme.backgroundElement }]}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
        <View style={styles.headerText}>
          <ThemedText type="default" style={styles.name} numberOfLines={1}>{name}</ThemedText>
          {bio !== '' && <ThemedText type="small" themeColor="textSecondary">{bio}</ThemedText>}
          {injury && <ThemedText type="smallBold" style={{ color: theme.danger }}>{injury}</ThemedText>}
          {status && (
            <View style={[styles.status, { backgroundColor: status.available ? theme.tint : theme.backgroundElement }]}>
              <ThemedText type="smallBold" style={styles.statusText} themeColor={status.available ? 'text' : 'textSecondary'}>
                {status.label}
              </ThemedText>
            </View>
          )}
        </View>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <ThemedText type="default" themeColor="textSecondary" style={styles.close}>✕</ThemedText>
          </Pressable>
        )}
      </View>
      {/* Full width under the name, so it's easy to hit on a phone. */}
      {draft}
    </SheetHandle>
  );
}

/** Whose team he's on (or was, before they dropped him), or whether he can be drafted. */
function leagueStatus(data: SeasonData, playerId: number): { label: string; available: boolean } | null {
  // One roster at most per season: a dropped player can't be drafted again.
  const spell = data.spells.find((s) => s.mlb_player_id === playerId);
  const team = spell && data.teams.find((t) => t.id === spell.fantasy_team_id);
  if (team) {
    const owner = ownerName(data, team);
    const label = `${teamName(team)}${owner ? ` · ${owner}` : ''}`;
    return { label: spell.dropped_by_draft_id === null ? label : `Dropped by ${label}`, available: false };
  }
  const entry = data.poolByPlayer.get(playerId);
  if (!entry) return null;
  if (data.mlbTeams.get(entry.mlb_team_id)?.eliminated) return { label: 'Team eliminated', available: false };
  if (!entry.on_postseason_roster && !(entry.injured_list !== null && injuredDraftable(data))) {
    return { label: 'Not on the postseason roster', available: false };
  }
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
  /** What the header stands for, when it isn't a standard stat. */
  tip?: string;
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

/** The draft table's tip for the same stat. */
const draftTip = (key: ColumnKey) => DRAFT_COLUMNS.find((c) => c.key === key)?.title;

/** Blank on the Last N rows. The projections match the draft table's columns. */
const SEASON_COLUMNS: Column[] = [
  { label: 'OPS+', width: 48, tip: draftTip('opsPlus'), value: (_, s) => (s?.opsPlus == null ? '' : String(s.opsPlus)) },
  { label: 'RDSLG', width: 60, tip: draftTip('rdslg'), value: (_, s) => (s?.projection?.rdslg == null ? '' : formatRate(s.projection.rdslg)) },
  {
    label: 'TB·E[G]/162',
    width: 88,
    tip: draftTip('tbExpected'),
    value: (_, s) => (s?.projection?.tbExpected == null ? '' : s.projection.tbExpected.toFixed(1)),
  },
  { label: 'RDTB', width: 50, tip: draftTip('rdtb'), value: (_, s) => (s?.projection?.rdtb == null ? '' : s.projection.rdtb.toFixed(1)) },
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
      <Section id="regular season" title={`${year} regular season`}>
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

      {stats.postseasons.length > 0 && (
        <Section title="Postseason">
          <StatTable
            labelWidth={84}
            columns={COUNT_COLUMNS}
            rows={stats.postseasons.map((y) => ({
              key: `${y.season}`,
              label: `${y.season} ${y.team}`,
              cells: COUNT_COLUMNS.map((c) => c.value(y, null)),
            }))}
          />
        </Section>
      )}

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
        <Section title="Past seasons">
          <StatTable
            labelWidth={84}
            columns={COUNT_COLUMNS}
            rows={stats.years.map((y) => ({
              key: `${y.season}`,
              label: `${y.season} ${y.team}`,
              cells: COUNT_COLUMNS.map((c) => c.value(y, null)),
            }))}
          />
        </Section>
      )}
    </>
  );
}

/**
 * His TB in each postseason game, a row per series, with his fantasy team (a player is on one
 * roster at most per season) as a link to it in Standings. Shows once his MLB team has played a
 * postseason game. Bags that counted for no one (before he was drafted, after he was dropped, or
 * once his fantasy team was out) are grayed out. Then a line per stretch of series says whose
 * bags they were, or why they didn't count; when all of them counted, the header says it all.
 */
function BaggerySection({
  data,
  playerId,
  requestedYear,
  onClose,
}: {
  data: SeasonData;
  playerId: number;
  /** The season picked in the header, if any, so Standings shows the same one. */
  requestedYear: number | undefined;
  /** Closes the popup before going to Standings. */
  onClose?: () => void;
}) {
  const mlbTeamId = data.poolByPlayer.get(playerId)?.mlb_team_id;
  const scores = usePlayerScores(playerId, mlbTeamId, data.season.year);
  if (!scores || !mlbTeamId) return null;
  const series = playerSeries(playerId, mlbTeamId, scores.games, scores.stats, coreSpells(data));
  if (!series.length) return null;

  const columns = Array.from({ length: Math.max(...series.map((s) => s.length)) }, (_, i) => ({
    label: `G${i + 1}`,
    live: series.some((s) => s.games.some((g) => g.number === i + 1 && g.live)),
  }));
  const myTeamId = data.myTeam?.id;
  const counted = (teamId: string | null, gameType: GameType) => {
    const out = data.teams.find((t) => t.id === teamId)?.eliminated_after_round;
    return teamId !== null && (out == null || ROUND_FOR_GAME_TYPE[gameType] <= out);
  };
  const rows: GridRow[] = series.map((s) => ({
    key: s.gameType,
    label: <ThemedText type="smallBold">{s.label}</ThemedText>,
    cells: columns.map((_, i) => {
      const game = s.games.find((g) => g.number === i + 1);
      return !game ? '' : game.tb === null ? '·' : String(game.tb);
    }),
    total: String(s.total),
    muted: s.games.every((g) => !counted(g.teamId, s.gameType)),
    mine: !!myTeamId && s.games.some((g) => g.teamId === myTeamId && counted(g.teamId, s.gameType)),
  }));
  // Whose bags they were: a line per stretch of games on one roster (or none), with its series.
  const stints: { teamId: string | null; out: boolean; dropped: boolean; labels: string[] }[] = [];
  for (const s of series) {
    for (const g of s.games) {
      const last = stints.at(-1);
      const out = g.teamId !== null && !counted(g.teamId, s.gameType);
      if (!last || last.teamId !== g.teamId || last.out !== out || last.dropped !== g.dropped) {
        stints.push({ teamId: g.teamId, out, dropped: g.dropped, labels: [s.label] });
      } else if (!last.labels.includes(s.label)) {
        last.labels.push(s.label);
      }
    }
  }
  const allCounted = stints.every((st) => st.teamId !== null && !st.out);

  const spell = data.spells.find((s) => s.mlb_player_id === playerId);
  const team = spell && data.teams.find((t) => t.id === spell.fantasy_team_id);
  const owner = team && ownerName(data, team);
  const openTeam = (teamId: string) => {
    onClose?.();
    router.navigate({ pathname: '/standings', params: requestedYear ? { team: teamId, year: requestedYear } : { team: teamId } });
  };

  return (
    <Section
      id="baggery"
      title={`${data.season.year} Baggery`}
      beside={
        team && (
          <ThemedText
            type="smallBold"
            themeColor="accent"
            numberOfLines={1}
            style={styles.sectionLink}
            accessibilityRole="link"
            onPress={() => openTeam(team.id)}>
            {owner && owner !== teamName(team) ? `${teamName(team)} (${owner})` : teamName(team)} ›
          </ThemedText>
        )
      }
      action={<ThemedText type="small" themeColor="textSecondary">{series.reduce((a, s) => a + s.total, 0)} TB</ThemedText>}>
      <ScoreGrid columns={columns} rows={rows} labelHeader="" totalHeader="TB" labelWidth={48} rowHeight={32} />
      {!allCounted && (
        <View style={styles.stints}>
          {stints.map((st, i) => (
            <ThemedText key={i} type="small" themeColor="textSecondary" numberOfLines={1}>
              <ThemedText type="smallBold" themeColor="textSecondary">{st.labels.join(', ')}</ThemedText>
              {'  '}
              {stintTeam(data, st.teamId, st.out, st.dropped)}
            </ThemedText>
          ))}
        </View>
      )}
    </Section>
  );
}

/**
 * "Big Bags (Kyle)", with "You" for my team (just the name when it's the manager's own), or why
 * the bags didn't count: "Undrafted" (not drafted yet), "Dropped" (a team let him go), or
 * "Big Bags (Kyle) · Eliminated".
 */
function stintTeam(data: SeasonData, teamId: string | null, out: boolean, dropped: boolean): string {
  const team = teamId ? data.teams.find((t) => t.id === teamId) : undefined;
  if (!team) return dropped ? 'Dropped' : 'Undrafted';
  const name = teamName(team);
  const owner = ownerName(data, team);
  const label = owner && owner !== name ? `${name} (${owner})` : name;
  if (out) return `${label} · Eliminated`;
  return team.id === data.myTeam?.id ? `${label} · You` : label;
}

// Sections collapsed this page load, by id, so they stay collapsed from one player to the next.
const collapsedSections = new Set<string>();

/** A titled part of the popup. Tapping the title collapses it; every section starts expanded. */
function Section({
  id,
  title,
  beside,
  action,
  children,
}: {
  /** Remembers it collapsed across players; defaults to the title (pass one when it has a year). */
  id?: string;
  title: string;
  /** Shown right after the title, e.g. a link. */
  beside?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const key = id ?? title;
  const [open, setOpen] = useState(() => !collapsedSections.has(key));
  const toggle = () => {
    if (open) collapsedSections.add(key);
    else collapsedSections.delete(key);
    setOpen(!open);
  };
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionTitleRow}>
          <Pressable
            onPress={toggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={`${title}, ${open ? 'collapse' : 'expand'}`}
            style={styles.sectionToggle}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionChevron}>{open ? '▾' : '▸'}</ThemedText>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{title}</ThemedText>
          </Pressable>
          {beside}
        </View>
        {open && action}
      </View>
      {open && children}
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
  // Phones: a finger held on a header with a tip says what it is.
  const { hold, tip } = useHoldTip();
  // Room for a note after the label ("Last 30 since 5/12"), only when a row has one.
  const width = labelWidth + (rows.some((r) => r.note) ? 72 : 0);
  const tbIndex = columns.findIndex((c) => c.label === 'TB');
  const rowBorder = (i: number) => i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border };
  return (
    <ThemedView type="backgroundElement" style={styles.table}>
      {tip}
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
            {columns.map((c, j) => {
              const cell = [styles.cell, { minWidth: c.width }, j === tbIndex && { backgroundColor: theme.tint }];
              const label = (
                <ThemedText type="smallBold" themeColor={j === tbIndex ? 'text' : 'textSecondary'} style={styles.cellText}>
                  {c.label}
                </ThemedText>
              );
              return c.tip ? (
                <Pressable key={c.label} ref={hoverTitle(c.tip)} onLongPress={hold()} style={[cell, noSelect]}>
                  {label}
                </Pressable>
              ) : (
                <View key={c.label} style={cell}>{label}</View>
              );
            })}
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
  // Draft and queue side by side, full width under the name.
  draftButtons: { flexDirection: 'row', gap: Spacing.two },
  draftButton: { flex: 1 },
  header: { gap: Spacing.three, padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  headshot: { width: 64, height: 64, borderRadius: 32 },
  headerText: { flex: 1, gap: Spacing.half },
  name: { fontSize: 20, lineHeight: 26, fontWeight: 700 },
  status: { alignSelf: 'flex-start', marginTop: Spacing.half, paddingHorizontal: Spacing.two, paddingVertical: 1, borderRadius: Radius.sm },
  statusText: { fontSize: 12, lineHeight: 18 },
  close: { fontSize: 18, lineHeight: 22, paddingHorizontal: Spacing.one },
  body: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },
  section: { gap: Spacing.two },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, minHeight: 28 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  sectionToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  sectionChevron: { fontSize: 15, width: 14 },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 13 },
  sectionLink: { fontSize: 13, flexShrink: 1 },
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
  stints: { gap: Spacing.half },
});
