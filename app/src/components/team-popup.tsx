import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { gameWinner, neededGames, postseasonSeries, seriesLine } from '@core/schedule.ts';
import { SERIES } from '@core/scoreboard.ts';

import { type Bagger, HitterRow } from '@/components/at-bat';
import { InjuryChip } from '@/components/injury';
import { PlayerName } from '@/components/player-name';
import { PopupSheet, SheetHandle } from '@/components/popup-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Toggle } from '@/components/toggle';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shortDate } from '@/lib/format';
import { inningLabel, ownerOf, statusLine } from '@/lib/game-labels';
import { PlayerProvider } from '@/lib/player';
import { teamOdds } from '@/lib/projections';
import { type GameInfo, type Scores } from '@/lib/scores';
import { type PoolEntry, type SeasonData, type Team, injuredDraftable } from '@/lib/season';
import { supabase } from '@/lib/supabase';
import { ownerName, teamName } from '@/lib/teams';

type Tab = 'hitters' | 'games' | 'available';

const lastName = (name: string) => name.split(' ').slice(1).join(' ') || name;

/** A hitter on the team who is (or was) on someone's fantasy roster, with his bags this postseason. */
interface RosteredHitter {
  playerId: number;
  name: string;
  position: string | null;
  tb: number;
  /** The fantasy team he is on now, or was on last. */
  team: Team | undefined;
  dropped: boolean;
}

/**
 * An MLB team's Baggery stats, opened from its abbreviation on a Games card: where it stands in
 * its series, the hitters on it that managers drafted and their bags, its games with the bags in
 * each, and the hitters nobody has drafted yet. Tapping a hitter opens his popup over this one; a
 * game closes this and opens its box score.
 */
export function TeamPopup({
  data,
  scores,
  mlbTeamId,
  onClose,
  onOpenGame,
}: {
  data: SeasonData;
  scores: Scores;
  mlbTeamId: number;
  onClose: () => void;
  onOpenGame: (gamePk: number) => void;
}) {
  const theme = useTheme();
  const team = data.mlbTeams.get(mlbTeamId);
  const [tab, setTab] = useState<Tab>('hitters');

  const teamGames = useMemo(
    () => neededGames(scores.games).filter((g) => g.homeTeamId === mlbTeamId || g.awayTeamId === mlbTeamId),
    [scores.games, mlbTeamId],
  );
  const series = useMemo(() => postseasonSeries(scores.games).filter((s) => s.teams.includes(mlbTeamId)), [scores.games, mlbTeamId]);
  const current = series.at(-1);
  const odds = useMemo(() => teamOdds(data, scores.games)?.get(mlbTeamId), [data, scores.games, mlbTeamId]);

  const hitters = useMemo(() => rosteredHitters(data, scores, mlbTeamId, teamGames), [data, scores, mlbTeamId, teamGames]);
  const active = hitters.filter((h) => !h.dropped);
  const bags = hitters.reduce((sum, h) => sum + h.tb, 0);
  const eliminated = !!team?.eliminated;
  const canDraftMore = !eliminated && data.season.status !== 'complete';

  if (!team) return null;
  const round = current && SERIES.find((s) => s.gameType === current.gameType)?.name;
  const status = eliminated
    ? `Eliminated${round && current ? ` · ${round} ${seriesLine(current, mlbTeamId)}` : ''}`
    : current?.gameType === 'W' && current.winner === mlbTeamId
      ? 'World Series champions'
      : current && round
        ? `${round} · ${seriesLine(current, mlbTeamId)}`
        : team.has_bye
          ? 'Wild Card bye'
          : 'Hasn’t played yet';
  const subtitle = [team.league, team.seed && `${team.seed} seed`, team.wins !== null && `${team.wins} wins`].filter(Boolean).join(' · ');

  const tabs: { value: Tab; label: string }[] = [
    { value: 'hitters', label: 'Hitters' },
    { value: 'games', label: 'Games' },
    ...(canDraftMore ? [{ value: 'available' as const, label: 'Available' }] : []),
  ];

  return (
    <PopupSheet open onClose={onClose} maxWidth={620} tall>
      {(dragHandlers) => (
        // Its hitters open over it, not behind it under the app's own player popup.
        <PlayerProvider stacked onLeave={onClose}>
          <SheetHandle dragHandlers={dragHandlers} style={[styles.head, { borderBottomColor: theme.border }]}>
            <View style={styles.headTop}>
              <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                <ThemedText style={[styles.badgeText, { color: theme.accentText }]}>{team.abbreviation}</ThemedText>
              </View>
              <View style={styles.headText}>
                <ThemedText style={styles.name} numberOfLines={1}>{team.name}</ThemedText>
                {subtitle !== '' && <ThemedText type="small" themeColor="textSecondary">{subtitle}</ThemedText>}
                <View style={[styles.status, { backgroundColor: eliminated ? theme.backgroundElement : theme.tint }]}>
                  <ThemedText type="smallBold" style={styles.statusText} themeColor={eliminated ? 'textSecondary' : 'text'}>{status}</ThemedText>
                </View>
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <ThemedText themeColor="textSecondary" style={styles.close}>✕</ThemedText>
              </Pressable>
            </View>
            <View style={styles.stats}>
              <Stat value={String(active.length)} label={active.length === 1 ? 'Hitter drafted' : 'Hitters drafted'} />
              <Stat value={String(bags)} label="Postseason TB" />
              {odds && !eliminated ? (
                <Stat value={`${Math.round(odds.advance * 100)}%`} label="To advance" />
              ) : (
                <Stat value={String(teamGames.filter((g) => g.status === 'Final').length)} label="Games played" />
              )}
            </View>
            <Toggle options={tabs} value={tab} onChange={setTab} fill />
          </SheetHandle>
          <ScrollView contentContainerStyle={styles.body}>
            {tab === 'hitters' && <HittersTab data={data} hitters={hitters} />}
            {tab === 'games' && (
              <GamesTab
                data={data}
                scores={scores}
                games={teamGames}
                mlbTeamId={mlbTeamId}
                onOpenGame={(pk) => {
                  onClose();
                  onOpenGame(pk);
                }}
              />
            )}
            {tab === 'available' && <AvailableTab data={data} mlbTeamId={mlbTeamId} gamePks={teamGames.filter((g) => g.status !== 'Preview').map((g) => g.gamePk)} />}
          </ScrollView>
        </PlayerProvider>
      )}
    </PopupSheet>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.stat}>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.statLabel}>{label}</ThemedText>
    </ThemedView>
  );
}

/** Everyone on the team who has been on a fantasy roster, current rosters first, then most bags. */
function rosteredHitters(data: SeasonData, scores: Scores, mlbTeamId: number, games: GameInfo[]): RosteredHitter[] {
  const pks = new Set(games.map((g) => g.gamePk));
  const out: RosteredHitter[] = [];
  for (const entry of data.pool) {
    if (entry.mlb_team_id !== mlbTeamId) continue;
    const spells = data.spells.filter((s) => s.mlb_player_id === entry.mlb_player_id);
    if (!spells.length) continue;
    const spell = spells.find((s) => s.to_at === null) ?? spells.reduce((a, b) => (a.from_at > b.from_at ? a : b));
    const player = data.players.get(entry.mlb_player_id);
    out.push({
      playerId: entry.mlb_player_id,
      name: player?.full_name ?? `Player ${entry.mlb_player_id}`,
      position: player?.primary_position ?? null,
      tb: scores.stats.filter((s) => s.playerId === entry.mlb_player_id && pks.has(s.gamePk)).reduce((sum, s) => sum + s.tb, 0),
      team: data.teams.find((t) => t.id === spell.fantasy_team_id),
      dropped: spell.to_at !== null,
    });
  }
  return out.sort((a, b) => Number(a.dropped) - Number(b.dropped) || b.tb - a.tb || a.name.localeCompare(b.name));
}

/** "Big Bags (Kyle)", or just the name when it is the manager's own. */
function managerLabel(data: SeasonData, team: Team): string {
  const owner = ownerName(data, team);
  return owner && owner !== teamName(team) ? `${teamName(team)} (${owner})` : teamName(team);
}

function HittersTab({ data, hitters }: { data: SeasonData; hitters: RosteredHitter[] }) {
  const theme = useTheme();
  if (!hitters.length) {
    return <ThemedText type="small" themeColor="textSecondary">Nobody has drafted a hitter from this team.</ThemedText>;
  }
  return (
    <View style={styles.list}>
      {hitters.map((h) => {
        const out = !!h.team && h.team.eliminated_after_round !== null;
        const mine = !!h.team && h.team.id === data.myTeam?.id;
        // Dropped hitters and eliminated managers' hitters stay plain, like in a box score.
        const bagger: Bagger = h.dropped || out || !h.team ? null : mine ? 'mine' : 'other';
        const whose = !h.team ? '' : mine ? 'You' : managerLabel(data, h.team);
        return (
          <HitterRow key={h.playerId} bagger={bagger} style={[styles.hitter, !bagger && { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.hitterText}>
              <PlayerName playerId={h.playerId} type="smallBold" numberOfLines={1}>{h.name}</PlayerName>
              <ThemedText type="small" themeColor={bagger ? 'text' : 'textSecondary'} numberOfLines={1} style={styles.whose}>
                {[h.position, h.dropped ? `Dropped by ${whose}` : out ? `${whose} · Eliminated` : whose].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
            <View style={styles.tb}>
              <ThemedText style={styles.tbValue}>{h.tb}</ThemedText>
              <ThemedText type="smallBold" style={styles.tbLabel}>TB</ThemedText>
            </View>
          </HitterRow>
        );
      })}
    </View>
  );
}

/** The next game (if one is scheduled), then the finished ones, newest first. */
function GamesTab({
  data,
  scores,
  games,
  mlbTeamId,
  onOpenGame,
}: {
  data: SeasonData;
  scores: Scores;
  games: GameInfo[];
  mlbTeamId: number;
  onOpenGame: (gamePk: number) => void;
}) {
  const theme = useTheme();
  const started = games.filter((g) => g.status !== 'Preview').sort((a, b) => b.start.localeCompare(a.start));
  const next = games.filter((g) => g.status === 'Preview').sort((a, b) => a.start.localeCompare(b.start))[0];
  const shown = [...(next ? [next] : []), ...started];
  if (!shown.length) return <ThemedText type="small" themeColor="textSecondary">No postseason games yet.</ThemedText>;
  return (
    <View style={styles.list}>
      {shown.map((game) => {
        const home = game.homeTeamId === mlbTeamId;
        const opp = data.mlbTeams.get(home ? game.awayTeamId : game.homeTeamId)?.abbreviation ?? '—';
        const mine = home ? game.homeScore : game.awayScore;
        const theirs = home ? game.awayScore : game.homeScore;
        const score = mine !== null && theirs !== null ? `${mine}–${theirs}` : '';
        const live = game.status === 'Live';
        const result =
          game.status === 'Final'
            ? `${gameWinner(game) === mlbTeamId ? 'W' : 'L'} ${score}`
            : live
              ? `${game.live ? `${inningLabel(game.live)} ` : ''}${score}`
              : statusLine(game);
        const label = SERIES.find((s) => s.gameType === game.gameType)?.label ?? '';
        // This team's hitters that managers drafted, with their bags in the game.
        const baggers = scores.stats
          .filter((s) => s.gamePk === game.gamePk && data.poolByPlayer.get(s.playerId)?.mlb_team_id === mlbTeamId && ownerOf(data, s.playerId, game))
          .sort((a, b) => b.tb - a.tb);
        return (
          <Pressable
            key={game.gamePk}
            onPress={() => onOpenGame(game.gamePk)}
            accessibilityRole="button"
            accessibilityLabel={`${label}${game.seriesGameNumber}, box score`}>
            <ThemedView type="backgroundElement" style={styles.game}>
              <View style={styles.gameTop}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.gameTitle}>
                  {label}
                  {game.seriesGameNumber} {home ? 'vs' : '@'} {opp}
                  <ThemedText type="small" themeColor="textSecondary">{`  ${shortDate(game.officialDate ?? game.start.slice(0, 10))}`}</ThemedText>
                </ThemedText>
                <ThemedText type="smallBold" themeColor={live ? 'danger' : 'textSecondary'}>
                  {live ? '● ' : ''}
                  {result}
                </ThemedText>
              </View>
              {baggers.length > 0 && (
                <View style={styles.chips}>
                  {baggers.map((s) => {
                    const owner = ownerOf(data, s.playerId, game);
                    const fill = owner === data.myTeam?.id ? theme.mineFill : theme.otherFill;
                    return (
                      <View key={s.playerId} style={[styles.chip, { backgroundColor: fill }]}>
                        <ThemedText type="smallBold" style={[styles.chipText, { color: theme.onFill }]}>
                          {lastName(data.players.get(s.playerId)?.full_name ?? '')} {s.tb}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>
              )}
            </ThemedView>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Each hitter's postseason TB for these games, loaded when the tab opens (a few rows). */
function usePostseasonTb(playerIds: number[], gamePks: number[]): Map<number, number> | null {
  const key = `${playerIds.join(',')}:${gamePks.join(',')}`;
  const [result, setResult] = useState<{ key: string; tb: Map<number, number> } | null>(null);
  useEffect(() => {
    if (!playerIds.length || !gamePks.length) return;
    let cancelled = false;
    supabase
      .from('player_game_stats')
      .select('mlb_player_id, tb')
      .in('game_pk', gamePks)
      .in('mlb_player_id', playerIds)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const tb = new Map<number, number>();
        for (const row of data) tb.set(row.mlb_player_id, (tb.get(row.mlb_player_id) ?? 0) + (row.tb ?? 0));
        setResult({ key, tb });
      });
    return () => {
      cancelled = true;
    };
    // `key` stands for the two lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!playerIds.length || !gamePks.length) return new Map();
  return result && result.key === key ? result.tb : null;
}

/** Hitters nobody has drafted (a dropped one can't be drafted again): most bags so far first. */
function AvailableTab({ data, mlbTeamId, gamePks }: { data: SeasonData; mlbTeamId: number; gamePks: number[] }) {
  const entries = useMemo(() => {
    const takenOrDropped = new Set(data.spells.map((s) => s.mlb_player_id));
    const canTakeInjured = injuredDraftable(data);
    return data.pool.filter(
      (e: PoolEntry) =>
        e.mlb_team_id === mlbTeamId && !takenOrDropped.has(e.mlb_player_id) && (e.on_postseason_roster || (e.injured_list !== null && canTakeInjured)),
    );
  }, [data, mlbTeamId]);
  const ids = useMemo(() => entries.map((e) => e.mlb_player_id), [entries]);
  const tb = usePostseasonTb(ids, gamePks);
  const sorted = [...entries].sort(
    (a, b) => (tb?.get(b.mlb_player_id) ?? 0) - (tb?.get(a.mlb_player_id) ?? 0) || b.regular_season_tb - a.regular_season_tb,
  );
  if (!sorted.length) return <ThemedText type="small" themeColor="textSecondary">Every hitter on this team’s postseason roster has been drafted.</ThemedText>;
  return (
    <View style={styles.list}>
      {sorted.map((e) => {
        const player = data.players.get(e.mlb_player_id);
        const played = tb?.get(e.mlb_player_id);
        return (
          <ThemedView key={e.mlb_player_id} type="backgroundElement" style={styles.hitter}>
            <View style={styles.hitterText}>
              <View style={styles.nameLine}>
                <PlayerName playerId={e.mlb_player_id} type="smallBold" numberOfLines={1}>{player?.full_name ?? `Player ${e.mlb_player_id}`}</PlayerName>
                {e.injured_list !== null && <InjuryChip list={e.injured_list} />}
              </View>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.whose}>
                {[player?.primary_position, `${e.regular_season_tb} TB in the regular season`].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
            <View style={styles.tb}>
              <ThemedText style={styles.tbValue}>{played === undefined ? '–' : played}</ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.tbLabel}>TB</ThemedText>
            </View>
          </ThemedView>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.three, padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  headTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  badge: { width: 56, height: 56, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 18, lineHeight: 22, fontWeight: 800, letterSpacing: 0.5 },
  headText: { flex: 1, gap: Spacing.half },
  name: { fontSize: 20, lineHeight: 26, fontWeight: 700 },
  status: { alignSelf: 'flex-start', marginTop: Spacing.half, paddingHorizontal: Spacing.two, paddingVertical: 1, borderRadius: Radius.sm },
  statusText: { fontSize: 12, lineHeight: 18 },
  close: { fontSize: 18, lineHeight: 22, paddingHorizontal: Spacing.one },
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, gap: 1 },
  statValue: { fontSize: 20, lineHeight: 24, fontWeight: 700, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, lineHeight: 16 },
  body: { padding: Spacing.three, paddingBottom: Spacing.five },
  list: { gap: Spacing.two },
  hitter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.md, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  hitterText: { flex: 1, gap: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  whose: { fontSize: 13, lineHeight: 18 },
  tb: { alignItems: 'flex-end', minWidth: 32 },
  tbValue: { fontSize: 20, lineHeight: 22, fontWeight: 800, fontVariant: ['tabular-nums'] },
  tbLabel: { fontSize: 10, lineHeight: 12, letterSpacing: 0.5, opacity: 0.8 },
  game: { borderRadius: Radius.md, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two },
  gameTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  gameTitle: { flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2 },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: 1, borderRadius: Radius.sm },
  chipText: { fontSize: 12, lineHeight: 18 },
});
