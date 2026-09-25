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

import { PlayerName } from '@/components/player-name';
import { type GridRow, ScoreGrid } from '@/components/score-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { type Scores, coreSpells } from '@/lib/scores';
import type { SeasonData } from '@/lib/season';
import { ownerName, teamName } from '@/lib/teams';

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
            style={[styles.chip, { backgroundColor: active ? theme.accent : theme.backgroundElement }]}>
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
    return {
      key: s.teamId,
      label: (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.rank}>{started ? s.rank : ''}</ThemedText>
          <View style={styles.teamLabel}>
            <ThemedText type="smallBold" numberOfLines={1}>{teamName(team)}</ThemedText>
            {owner && <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.owner}>{mine ? 'You' : owner}</ThemedText>}
          </View>
        </>
      ),
      cells: columns.map((c) => {
        const value = s.cells.get(`${c.gameType}${c.number}`);
        return value === null || value === undefined ? '' : String(value);
      }),
      total: started ? String(s.total) : '',
      selected: team.id === selectedTeamId,
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
        labelWidth={compact ? 144 : 184}
      />
    </View>
  );
}

/** One team's TB by player and game, a block per series, with the round totals on top. */
export function TeamScoreboard({ data, scores, teamId }: { data: SeasonData; scores: Scores; teamId: string }) {
  const theme = useTheme();
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

  return (
    <View style={styles.section}>
      <View>
        <ThemedText type="subtitle" style={styles.teamTitle}>{teamName(team)}</ThemedText>
        {owner && <ThemedText themeColor="textSecondary">{owner}</ThemedText>}
      </View>
      <View style={styles.totals}>
        {ROUNDS.map((r) => (
          <ThemedView key={r.round} type="backgroundElement" style={[styles.totalBox, { borderColor: theme.border }]}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{r.label}</ThemedText>
            <ThemedText style={styles.totalNumber}>
              {out !== null && r.round > out ? 'Out' : started(r.round) ? totals[r.round] : '—'}
            </ThemedText>
          </ThemedView>
        ))}
      </View>
      {shown.map((b) => (
        <SeriesTable key={b.gameType} data={data} block={b} />
      ))}
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
    <View style={styles.block}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{block.name}</ThemedText>
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
  chips: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Spacing.four },
  section: { gap: Spacing.three },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two, flexWrap: 'wrap' },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12 },
  rank: { width: 16, fontVariant: ['tabular-nums'] },
  teamLabel: { flex: 1, minWidth: 0 },
  owner: { fontSize: 12, lineHeight: 14 },
  teamTitle: { fontSize: 24, lineHeight: 30 },
  totals: { flexDirection: 'row', gap: Spacing.two },
  totalBox: { flex: 1, padding: Spacing.two, borderRadius: Spacing.two, alignItems: 'center', gap: Spacing.half },
  totalNumber: { fontSize: 28, lineHeight: 34, fontWeight: 700, fontVariant: ['tabular-nums'] },
  block: { gap: Spacing.two },
});
