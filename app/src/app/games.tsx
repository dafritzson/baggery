import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SERIES } from '@core/scoreboard.ts';

import { Card } from '@/components/card';
import { PlayerName } from '@/components/player-name';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { type GameInfo, type Scores, useScores } from '@/lib/scores';
import { type SeasonData, useSeason } from '@/lib/season';
import { teamName } from '@/lib/teams';

/** Local calendar day of a game, e.g. "2026-09-29", for grouping. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key: string, today: string): string {
  if (key === today) return 'Today';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
}

/** Today if there are games today, else the next day with games, else the last one. */
function defaultDay(days: string[], today: string): string | undefined {
  return days.find((d) => d >= today) ?? days.at(-1);
}

/** The day's MLB postseason games, with the fantasy players in each and their TB. */
export default function GamesScreen() {
  const { data, loading } = useSeason();
  const { scores } = useScores(data);
  const wide = useLayout() === 'wide';
  const [picked, setPicked] = useState<string | null>(null);

  if (loading || (data && !scores)) {
    return <Screen width="wide"><ThemedText themeColor="textSecondary">Loading…</ThemedText></Screen>;
  }
  if (!data || !scores) return <Screen width="wide"><ThemedText>No season set up yet.</ThemedText></Screen>;

  const today = dayKey(new Date().toISOString());
  const days = [...new Set(scores.games.map((g) => dayKey(g.start)))].sort();
  const day = picked && days.includes(picked) ? picked : defaultDay(days, today);
  const games = scores.games
    .filter((g) => day && dayKey(g.start) === day)
    .sort((a, b) => a.start.localeCompare(b.start));

  return (
    <Screen width="wide">
      {days.length === 0 ? (
        <ThemedText themeColor="textSecondary">Games show up here once the postseason schedule is out.</ThemedText>
      ) : (
        <>
          <DayChips days={days} day={day} today={today} onChange={setPicked} />
          <View style={[styles.grid, wide && styles.gridWide]}>
            {games.map((g) => (
              <GameCard key={g.gamePk} data={data} scores={scores} game={g} style={wide ? styles.cardWide : undefined} />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

function DayChips({ days, day, today, onChange }: { days: string[]; day?: string; today: string; onChange: (day: string) => void }) {
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chips}>
      {days.map((d) => {
        const active = d === day;
        return (
          <Pressable
            key={d}
            onPress={() => onChange(d)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.chip, { backgroundColor: active ? theme.accent : theme.backgroundElement }]}>
            <ThemedText type="smallBold" style={{ color: active ? theme.accentText : theme.text }}>{dayLabel(d, today)}</ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const BAGS = ['👜', '💼', '🎒', '🛍️', '👝', '🧳'];

/**
 * One bag emoji per total base, each picked at random. Seeded by player, game and position, so a
 * row doesn't reshuffle every time the live scores refresh.
 */
function bagEmojis(tb: number, playerId: number, gamePk: number): string {
  return Array.from({ length: tb }, (_, i) => {
    let h = (playerId ^ Math.imul(gamePk, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
    return BAGS[((h ^ (h >>> 16)) >>> 0) % BAGS.length];
  }).join('');
}

/** Room for about eight bags; a bigger game scrolls sideways instead of crowding the card. */
const BAGS_MAX_WIDTH = 176;

function Bags({ tb, playerId, gamePk }: { tb: number | null; playerId: number; gamePk: number }) {
  const [width, setWidth] = useState<number | null>(null);
  if (tb === null) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      onContentSizeChange={(w) => setWidth(w)}
      style={[styles.bags, width !== null && { width: Math.min(width, BAGS_MAX_WIDTH) }]}>
      <ThemedText type="small" numberOfLines={1} accessibilityLabel={`${tb} total bases`}>
        {tb === 0 ? '–' : bagEmojis(tb, playerId, gamePk)}
      </ThemedText>
    </ScrollView>
  );
}

/** "Wild Card · Game 2", or "Division Series · Game 3". */
function seriesLabel(game: GameInfo): string {
  const series = SERIES.find((s) => s.gameType === game.gameType);
  return `${series?.name ?? ''} · Game ${game.seriesGameNumber}`;
}

function statusLine(game: GameInfo): string {
  if (game.status === 'Preview' && game.detailedState !== 'Postponed') {
    return new Date(game.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return game.detailedState ?? game.status;
}

/** Who owned the player when the game started (or owns him now, before it starts). */
function ownerOf(data: SeasonData, playerId: number, game: GameInfo): string | undefined {
  const t = Date.parse(game.start);
  const started = game.status !== 'Preview';
  return data.spells.find(
    (s) =>
      s.mlb_player_id === playerId &&
      (started ? Date.parse(s.from_at) <= t && (s.to_at === null || t < Date.parse(s.to_at)) : s.to_at === null),
  )?.fantasy_team_id;
}

function GameCard({ data, scores, game, style }: { data: SeasonData; scores: Scores; game: GameInfo; style?: object }) {
  const theme = useTheme();
  const live = game.status === 'Live';
  const final = game.status === 'Final';
  const side = (teamId: number, score: number | null, other: number | null) => {
    const team = data.mlbTeams.get(teamId);
    const won = final && score !== null && other !== null && score > other;
    return (
      <View style={styles.scoreRow}>
        <ThemedText type="default" style={[styles.teamAbbr, won && styles.bold]}>{team?.abbreviation ?? '—'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.teamName}>{team?.name ?? ''}</ThemedText>
        <ThemedText type="default" style={[styles.score, won && styles.bold]}>{game.status === 'Preview' ? '' : (score ?? '')}</ThemedText>
      </View>
    );
  };

  // Fantasy-rostered players on either team, with their TB in this game.
  const tb = new Map(scores.stats.filter((s) => s.gamePk === game.gamePk).map((s) => [s.playerId, s.tb]));
  const playerIds = [...new Set(data.spells.map((s) => s.mlb_player_id))];
  const players = playerIds
    .filter((id) => {
      const mlb = data.poolByPlayer.get(id)?.mlb_team_id;
      return mlb === game.homeTeamId || mlb === game.awayTeamId;
    })
    .flatMap((id) => {
      const owner = ownerOf(data, id, game);
      const team = owner ? data.teams.find((t) => t.id === owner) : undefined;
      return team ? [{ id, team, tb: tb.get(id) ?? (game.status === 'Preview' ? null : 0) }] : [];
    })
    .sort((a, b) => (b.tb ?? -1) - (a.tb ?? -1));

  return (
    <Card style={style}>
      <View style={styles.cardHead}>
        <ThemedText type="small" themeColor="textSecondary">{seriesLabel(game)}</ThemedText>
        <ThemedText type="smallBold" style={{ color: live ? theme.danger : theme.textSecondary }}>
          {live ? '● ' : ''}
          {statusLine(game)}
        </ThemedText>
      </View>
      {side(game.awayTeamId, game.awayScore, game.homeScore)}
      {side(game.homeTeamId, game.homeScore, game.awayScore)}
      {players.length > 0 && (
        <View style={[styles.players, { borderTopColor: theme.border }]}>
          {players.map((p) => {
            const mine = p.team.id === data.myTeam?.id;
            return (
              <View
                key={p.id}
                style={[
                  styles.playerCard,
                  { backgroundColor: mine ? theme.mine : theme.background },
                ]}>
                <View style={styles.playerText}>
                  <PlayerName
                    playerId={p.id}
                    type="smallBold"
                    numberOfLines={1}
                    style={styles.playerName}>
                    {data.players.get(p.id)?.full_name ?? `Player ${p.id}`}
                  </PlayerName>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={1}
                    style={styles.owner}>
                    {mine ? 'You' : teamName(p.team)}
                  </ThemedText>
                </View>
                <Bags tb={p.tb} playerId={p.id} gamePk={game.gamePk} />
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexGrow: 0 },
  chips: { gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Spacing.four },
  grid: { gap: Spacing.three },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  cardWide: { width: '48.5%' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  teamAbbr: { width: 48, fontWeight: 600 },
  teamName: { flex: 1 },
  score: { fontSize: 22, lineHeight: 28, fontVariant: ['tabular-nums'], fontWeight: 600 },
  bold: { fontWeight: 800 },
  players: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two + 2, gap: Spacing.one + 2 },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Spacing.two + 2,
  },
  playerText: { flex: 1, minWidth: 0 },
  playerName: { fontSize: 13, lineHeight: 17 },
  owner: { fontSize: 11, lineHeight: 14 },
  bags: { maxWidth: BAGS_MAX_WIDTH, flexGrow: 0, flexShrink: 0 },
});
