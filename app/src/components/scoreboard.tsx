import { Pressable, StyleSheet, View } from 'react-native';

import {
  type SeriesBlock,
  roundColumns,
  roundSeries,
  roundStandings,
  roundTotals,
  teamSeriesBlocks,
} from '@core/scoreboard.ts';
import type { FantasyRound } from '@core/types.ts';

import { OwnerBadge, YouTag } from '@/components/owner-badge';
import { PlayerName } from '@/components/player-name';
import { type GridRow, ScoreGrid } from '@/components/score-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { type Scores, coreSpells } from '@/lib/scores';
import type { SeasonData } from '@/lib/season';
import { ownerName, teamName } from '@/lib/teams';

/** Height of the round chips' row and the team panel's header, which sit side by side. */
const CHIPS_ROW = 40;

export const ROUNDS: { round: FantasyRound; label: string; series: string }[] = [
  { round: 1, label: 'Round 1', series: 'Wild Card + Division Series' },
  { round: 2, label: 'Round 2', series: 'Championship Series' },
  { round: 3, label: 'Round 3', series: 'World Series' },
];

/** Round picker chips. */
export function RoundChips({ round, onChange }: { round: FantasyRound; onChange: (round: FantasyRound) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.chips} accessibilityRole="tablist">
      {ROUNDS.map((r) => {
        const active = r.round === round;
        return (
          <Pressable
            key={r.round}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(r.round)}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: active ? theme.accent : theme.backgroundElement, boxShadow: pressed ? theme.sunken : theme.raised },
            ]}>
            <ThemedText type="smallBold" style={{ color: active ? theme.accentText : theme.text }}>{r.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The round's standings: TB per game (WC1, DS1, ...) and the round total, with the cut line. */
export function StandingsTable({
  data,
  scores,
  round,
  selectedTeamId,
  onSelectTeam,
}: {
  data: SeasonData;
  scores: Scores;
  round: FantasyRound;
  selectedTeamId?: string | null;
  onSelectTeam: (teamId: string) => void;
}) {
  // Teams eliminated in an earlier round aren't in this one.
  const teams = data.teams.filter((t) => t.eliminated_after_round === null || t.eliminated_after_round >= round);
  const standings = roundStandings(round, teams.map((t) => t.id), scores.games, scores.stats, coreSpells(data));
  const columns = roundColumns(round, scores.games);
  const survivors = data.season.survivors_after_round[round - 1] ?? teams.length;
  const byId = new Map(teams.map((t) => [t.id, t]));
  // Like the old sheet: blue when through, lavender when tied across the cut line (drink-off
  // territory until tiebreakers are in), red when below it.
  const cutTotal = standings[survivors - 1]?.total ?? 0;
  const tieAtCut = standings.length > survivors && standings[survivors].total === cutTotal;
  const standing = (total: number, i: number) =>
    tieAtCut ? (total > cutTotal ? 'safe' : total === cutTotal ? 'tied' : 'out') : i < survivors ? 'safe' : 'out';
  const compact = useLayout() === 'compact';
  // Before a round's first pitch there's nothing to rank.
  const started = columns.some((c) => c.started);

  const rows: GridRow[] = standings.map((s, i) => {
    const team = byId.get(s.teamId)!;
    const owner = ownerName(data, team);
    const mine = team.id === data.myTeam?.id;
    const tied = standings.some((o) => o !== s && o.rank === s.rank);
    return {
      key: s.teamId,
      label: (
        <>
          {/* No rank column before the round starts, so it doesn't eat into long team names. */}
          {started && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.rank}>{tied ? `T${s.rank}` : s.rank}</ThemedText>
          )}
          {!compact && <View style={styles.badge}><OwnerBadge teamId={team.id} owner={owner} photo={team.user_id ? data.photos.get(team.user_id) : null} mine={mine} /></View>}
          <TeamLabel name={teamName(team)} owner={owner} mine={mine} />
        </>
      ),
      cells: columns.map((c) => {
        const value = s.cells.get(`${c.gameType}${c.number}`);
        return value === null || value === undefined ? '' : String(value);
      }),
      total: started ? String(s.total) : '',
      selected: team.id === selectedTeamId,
      mine,
      standing: started ? standing(s.total, i) : undefined,
      cutAfter: started && i === survivors - 1 && standings.length > survivors,
      onPress: () => onSelectTeam(team.id),
    };
  });

  const info = ROUNDS[round - 1];
  const anyLive = columns.some((c) => c.live);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{info.series}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {anyLive ? '● Live · ' : ''}
          {round === 3 ? 'Winner takes it' : `Top ${survivors} advance`}
        </ThemedText>
      </View>
      <ScoreGrid
        columns={columns.map((c, i) => ({ label: c.label, live: c.live, divider: i > 0 && c.number === 1 }))}
        rows={rows}
        labelHeader="Team"
        totalHeader={`RD ${round}`}
        labelWidth={compact ? 160 : 220}
        rowHeight={48}
      />
    </View>
  );
}

/** Team name over the owner's name (or "Open spot"), with a YOU tag on my team. */
function TeamLabel({ name, owner, mine }: { name: string; owner: string | null; mine: boolean }) {
  return (
    <View style={styles.teamLabel}>
      <ThemedText numberOfLines={1} style={styles.teamName}>{name}</ThemedText>
      <View style={styles.ownerLine}>
        <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.owner}>{owner ?? 'Open spot'}</ThemedText>
        {mine && <YouTag />}
      </View>
    </View>
  );
}

/** One team's TB by player and game, a block per series, with the round totals on top. */
export function TeamScoreboard({ data, scores, teamId }: { data: SeasonData; scores: Scores; teamId: string }) {
  const theme = useTheme();
  const compact = useLayout() === 'compact';
  const team = data.teams.find((t) => t.id === teamId);
  if (!team) return null;
  const blocks = teamSeriesBlocks(teamId, scores.games, scores.stats, coreSpells(data), (id) => data.poolByPlayer.get(id)?.mlb_team_id);
  const totals = roundTotals(blocks);
  const out = team.eliminated_after_round;
  const started = (round: FantasyRound) =>
    roundSeries(round).some((s) => scores.games.some((g) => g.gameType === s.gameType && (g.status === 'Live' || g.status === 'Final')));
  // Series with games on the schedule (the Wild Card before it's set), up to the team's elimination.
  const shown = blocks.filter((b, i) => {
    const round = ROUNDS.find((r) => roundSeries(r.round).some((s) => s.gameType === b.gameType))!.round;
    if (out !== null && round > out) return false;
    return i === 0 || scores.games.some((g) => g.gameType === b.gameType);
  });
  const owner = ownerName(data, team);
  const mine = team.id === data.myTeam?.id;

  const photo = team.user_id ? data.photos.get(team.user_id) : null;
  const label = (
    <View style={styles.teamLabel}>
      <ThemedText numberOfLines={1} style={styles.teamTitle}>{teamName(team)}</ThemedText>
      <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.owner}>
        {owner ?? 'Open spot'}{mine ? ' · You' : ''}
      </ThemedText>
    </View>
  );
  const totalsStrip = (
    <ThemedView type="backgroundElement" style={[styles.totals, compact && styles.totalsFull]}>
      {ROUNDS.map((r, i) => (
        <View
          key={r.round}
          style={[styles.totalCell, compact && styles.totalCellFull, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.border }]}>
          <ThemedText themeColor="textSecondary" style={styles.totalLabel}>RD {r.round}</ThemedText>
          <ThemedText style={styles.totalNumber}>
            {out !== null && r.round > out ? 'Out' : started(r.round) ? totals[r.round] : '—'}
          </ThemedText>
        </View>
      ))}
    </ThemedView>
  );

  return (
    <View style={styles.team}>
      {compact ? (
        // Phones: photo, name and owner on top, the round totals across the full width below.
        <View style={styles.teamHeadCompact}>
          <View style={styles.teamNameRow}>
            <OwnerBadge teamId={team.id} owner={owner} photo={photo} size={44} />
            {label}
          </View>
          {totalsStrip}
        </View>
      ) : (
        // As tall as the round chips' row beside it, so both columns' tables start level.
        <View style={styles.teamHead}>
          <OwnerBadge teamId={team.id} owner={owner} photo={photo} mine={mine} size={36} />
          {label}
          {totalsStrip}
        </View>
      )}
      <View style={styles.blocks}>
        {shown.map((b) => (
          <SeriesTable key={b.gameType} data={data} block={b} />
        ))}
      </View>
    </View>
  );
}

function SeriesTable({ data, block }: { data: SeasonData; block: SeriesBlock }) {
  const compact = useLayout() === 'compact';
  const cell = (value: number | null, started: boolean) => (value !== null ? String(value) : started ? '·' : '');
  const rows: GridRow[] = [
    ...block.players.map((p) => {
      const name = data.players.get(p.playerId)?.full_name ?? `Player ${p.playerId}`;
      const mlb = data.mlbTeams.get(data.poolByPlayer.get(p.playerId)?.mlb_team_id ?? 0)?.abbreviation;
      return {
        key: String(p.playerId),
        label: (
          <>
            <PlayerName playerId={p.playerId} type="smallBold" numberOfLines={1}>{name}</PlayerName>
            {mlb && <ThemedText type="small" themeColor="textSecondary">{mlb}</ThemedText>}
          </>
        ),
        cells: p.games.map((v, i) => cell(v, block.columns[i].started)),
        total: String(p.total),
      };
    }),
    {
      key: 'team',
      label: <ThemedText type="smallBold">Team</ThemedText>,
      cells: block.teamGames.map((v) => (v === null ? '' : String(v))),
      total: String(block.total),
      strong: true,
    },
  ];
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{block.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{block.total} TB</ThemedText>
      </View>
      <ScoreGrid
        columns={block.columns.map((c) => ({ label: c.label, live: c.live }))}
        rows={rows}
        labelHeader="Player"
        totalHeader="Total"
        labelWidth={compact ? 150 : 184}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap', minHeight: CHIPS_ROW, alignItems: 'center', alignContent: 'center' },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Radius.md },
  // Section heads are one line of fixed height, so tables side by side start level.
  section: { gap: Spacing.three },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two, height: 16 },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12, lineHeight: 16 },
  rank: { width: 24, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  badge: { marginRight: Spacing.one },
  teamLabel: { flex: 1, minWidth: 0, gap: 1 },
  teamName: { fontSize: 15, lineHeight: 19, fontWeight: 600 },
  ownerLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  owner: { fontSize: 12, lineHeight: 15, flexShrink: 1 },
  team: { gap: Spacing.four },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, height: CHIPS_ROW },
  teamTitle: { fontSize: 18, lineHeight: 22, fontWeight: 700 },
  teamHeadCompact: { gap: Spacing.three },
  teamNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4 },
  totals: { flexDirection: 'row', height: CHIPS_ROW, borderRadius: Radius.md },
  totalsFull: { height: 52 },
  totalCell: { paddingHorizontal: Spacing.three - 2, justifyContent: 'center', alignItems: 'center' },
  totalCellFull: { flex: 1 },
  totalLabel: { fontSize: 10, lineHeight: 12, fontWeight: 700, letterSpacing: 0.5 },
  totalNumber: { fontSize: 16, lineHeight: 20, fontWeight: 700, fontVariant: ['tabular-nums'] },
  blocks: { gap: Spacing.four },
});
