import { SymbolView } from '@/components/symbol';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Image } from 'expo-image';

import {
  dropKind,
  playerTotals,
  type SeriesBlock,
  roundColumns,
  roundSeries,
  roundStandings,
  roundTotals,
  teamSeriesBlocks,
} from '@core/scoreboard.ts';
import { eliminations, facesCut, inRound } from '@core/scoring.ts';
import { type FantasyRound, ROUND_FOR_GAME_TYPE } from '@core/types.ts';

import { OwnerBadge, YouTag } from '@/components/owner-badge';
import { PlayerName } from '@/components/player-name';
import { RoundRulesButton, RoundRulesSheet } from '@/components/round-rules-sheet';
import { type GridRow, ScoreGrid } from '@/components/score-grid';
import { HeadshotStack } from '@/components/team-roster';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TiebreakSheet } from '@/components/tiebreak-sheet';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { headshotUrl, mlbTeamAbbr } from '@/lib/format';
import { outNameStyle } from '@/lib/out-name';
import { type Scores, coreSpells } from '@/lib/scores';
import type { SeasonData } from '@/lib/season';
import { ownerLine, teamName } from '@/lib/teams';

/** Height of the round toggle and the team panel's header, which sit side by side. */
const CHIPS_ROW = 40;

export const ROUNDS: { round: FantasyRound; label: string; series: string }[] = [
  { round: 1, label: 'Round 1', series: 'Wild Card + Division Series' },
  { round: 2, label: 'Round 2', series: 'Championship Series' },
  { round: 3, label: 'Round 3', series: 'World Series' },
];

/** Round picker: a toggle across the full width, one segment per round, the picked one in the accent. */
export function RoundToggle({ round, onChange }: { round: FantasyRound; onChange: (round: FantasyRound) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.rounds, { backgroundColor: theme.backgroundElement, boxShadow: theme.sunken }]} accessibilityRole="tablist">
      {ROUNDS.map((r) => {
        const active = r.round === round;
        return (
          <Pressable
            key={r.round}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(r.round)}
            style={[styles.roundItem, active && { backgroundColor: theme.accent, boxShadow: theme.raised }]}>
            <ThemedText type="smallBold" numberOfLines={1} style={{ color: active ? theme.accentText : theme.textSecondary }}>
              {r.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The round's standings: TB per game (WC1, DS1, ...) and the round total, with the cut line. The
 * scores can be the season as it stood at some earlier moment (the scrubber below the table).
 */
export function StandingsTable({
  data,
  scores,
  round,
  selectedTeamId,
  onSelectTeam,
  settled = true,
  moves,
  flash,
  moveMs,
}: {
  data: SeasonData;
  scores: Scores;
  round: FantasyRound;
  selectedTeamId?: string | null;
  onSelectTeam: (teamId: string) => void;
  /** Whether the round's recorded result (who went out, drink-offs included) holds at this point. */
  settled?: boolean;
  /** How many places each team moved since the scrubber's previous stop (up is positive). */
  moves?: Map<string, number>;
  /** The cell of the bag the scrubber is on: its team and game column ("D3"). */
  flash?: { teamId: string; column: string } | null;
  /** How long a team's row takes to slide to its new place when the order changes. */
  moveMs?: number;
}) {
  // Teams eliminated in an earlier round aren't in this one. The ghost team plays round 2 without
  // facing its cut: it's listed below everyone, outside the ranking.
  const playing = data.teams.filter((t) => inRound({ eliminatedAfterRound: t.eliminated_after_round, isGhost: t.is_ghost }, round));
  const teams = playing.filter((t) => facesCut({ isGhost: t.is_ghost }, round));
  const aside = playing.filter((t) => !facesCut({ isGhost: t.is_ghost }, round));
  const standings = roundStandings(round, teams.map((t) => t.id), scores.games, scores.stats, coreSpells(data));
  const asideStandings = aside.length ? roundStandings(round, aside.map((t) => t.id), scores.games, scores.stats, coreSpells(data)) : [];
  const columns = roundColumns(round, scores.games);
  const survivors = data.season.survivors_after_round[round - 1] ?? teams.length;
  const byId = new Map(playing.map((t) => [t.id, t]));
  const theme = useTheme();
  const [tieGroup, setTieGroup] = useState<number | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  // Who's through: once the round is closed, whatever was recorded (a drink-off included);
  // until then, the ranking with its tiebreakers. Full ties across the cut are a drink-off.
  const closed = settled && teams.some((t) => t.eliminated_after_round === round);
  const cut = eliminations(
    standings.map((s) => ({ ...s.totals, teamId: s.teamId, rank: s.rank })),
    Math.min(survivors, standings.length),
  );
  const status = (teamId: string): 'safe' | 'tied' | 'out' =>
    closed
      ? byId.get(teamId)!.eliminated_after_round === round ? 'out' : 'safe'
      : cut.advancing.includes(teamId) ? 'safe' : cut.drinkOff?.teamIds.includes(teamId) ? 'tied' : 'out';
  // Teams through first, so the cut line sits between them and the rest.
  const order = { safe: 0, tied: 1, out: 2 };
  const ordered = [...standings].sort((a, b) => order[status(a.teamId)] - order[status(b.teamId)] || a.rank - b.rank);
  const through = ordered.filter((s) => status(s.teamId) !== 'out').length;
  // Groups of two or more teams level on bags: each gets the tiebreaker icon.
  const tiedTotals = [...new Set(ordered.map((s) => s.total))].filter((t) => ordered.filter((s) => s.total === t).length > 1);
  const compact = useLayout() === 'compact';
  // Before a round's first pitch there's nothing to rank.
  const started = columns.some((c) => c.started);

  const anyMoved = ordered.some((s) => (moves?.get(s.teamId) ?? 0) !== 0);
  const rows: GridRow[] = [...ordered, ...asideStandings].map((s, i) => {
    const team = byId.get(s.teamId)!;
    const ranked = i < ordered.length;
    const owner = ownerLine(data, team);
    const mine = team.id === data.myTeam?.id;
    const tied = ranked && ordered.some((o) => o !== s && o.rank === s.rank);
    const levelOnBags = ranked && started && tiedTotals.includes(s.total);
    const moved = moves?.get(s.teamId) ?? 0;
    return {
      key: s.teamId,
      label: (
        <>
          {/* No rank column before the round starts, so it doesn't eat into long team names. */}
          {started && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.rank}>{!ranked ? '–' : tied ? `T${s.rank}` : s.rank}</ThemedText>
          )}
          {!compact && <View style={styles.badge}><OwnerBadge teamId={team.id} owner={team.is_ghost ? '👻' : owner} photo={team.user_id ? data.photos.get(team.user_id) : null} mine={mine} /></View>}
          <TeamLabel name={teamName(team)} owner={owner} mine={mine} />
          {/* Places moved, left of the tiebreaker icon. While any team moved, every row keeps its slot,
              so the arrows line up. */}
          {anyMoved && (
            <View style={styles.moveSlot}>
              {moved !== 0 && (
                <ThemedText
                  style={[styles.move, { color: moved > 0 ? theme.success : theme.danger }]}
                  accessibilityLabel={`${moved > 0 ? 'Up' : 'Down'} ${Math.abs(moved)}`}>
                  {moved > 0 ? `▲${moved}` : `▼${-moved}`}
                </ThemedText>
              )}
            </View>
          )}
          {/* While any team is level on bags, every row keeps the icon's slot, so the move arrows
              line up whether or not the row has the icon. */}
          {started && tiedTotals.length > 0 && (
            <View style={styles.tieSlot}>
              {levelOnBags && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`How the tie at ${s.total} bags was broken`}
                  hitSlop={8}
                  onPress={() => setTieGroup(s.total)}>
                  <SymbolView name={{ ios: 'scalemass', android: 'balance', web: 'balance' }} size={16} tintColor={theme.accent} />
                </Pressable>
              )}
            </View>
          )}
        </>
      ),
      cells: columns.map((c) => {
        const value = s.cells.get(`${c.gameType}${c.number}`);
        return value === null || value === undefined ? '' : String(value);
      }),
      total: started ? String(s.total) : '',
      highlight: flash?.teamId === s.teamId ? columns.findIndex((c) => `${c.gameType}${c.number}` === flash.column) : undefined,
      selected: team.id === selectedTeamId,
      mine,
      standing: started && ranked ? status(s.teamId) : undefined,
      cutAfter: started && i === through - 1 && ordered.length > through,
      onPress: () => onSelectTeam(team.id),
    };
  });

  const info = ROUNDS[round - 1];
  const anyLive = columns.some((c) => c.live);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{info.series}</ThemedText>
        <View style={styles.cutNote}>
          <ThemedText type="small" themeColor="textSecondary">
            {anyLive ? '● Live · ' : ''}
            {round === 3 ? 'Winner takes it' : `Top ${survivors} advance`}
          </ThemedText>
          <RoundRulesButton onPress={() => setRulesOpen(true)} />
        </View>
      </View>
      <RoundRulesSheet
        round={round}
        visible={rulesOpen}
        ranked={teams.length}
        survivors={survivors}
        ghost={playing.some((t) => t.is_ghost)}
        onClose={() => setRulesOpen(false)}
      />
      <ScoreGrid
        columns={columns.map((c, i) => ({ label: c.label, live: c.live, divider: i > 0 && c.number === 1 }))}
        rows={rows}
        labelHeader="Team"
        totalHeader={`RD ${round}`}
        labelWidth={compact ? 160 : 220}
        labelMaxWidth={300}
        keepColumns={4}
        rowHeight={48}
        follow={columns.findLastIndex((c) => c.started)}
        moveMs={moveMs}
      />
      <TiebreakSheet
        title={tieGroup === null ? '' : `Tied at ${tieGroup} bags`}
        onClose={() => setTieGroup(null)}
        teams={
          tieGroup === null
            ? null
            : ordered
                .filter((s) => s.total === tieGroup)
                .map((s) => {
                  const st = status(s.teamId);
                  // Only a tie across the cut line decides who's through.
                  const acrossCut = st === 'tied' || ordered.some((o) => o.total === tieGroup && status(o.teamId) !== st);
                  return {
                    teamId: s.teamId,
                    name: teamName(byId.get(s.teamId)!),
                    totals: s.totals,
                    status: acrossCut ? (st === 'safe' ? 'through' : st === 'out' ? 'out' : 'drink-off') : null,
                  };
                })
        }
      />
    </View>
  );
}

/** Team name over the owner line (see ownerLine), with a YOU tag on my team. */
function TeamLabel({ name, owner, mine }: { name: string; owner: string | null; mine: boolean }) {
  // A size smaller on phones, where the names otherwise get cut off.
  const compact = useLayout() === 'compact';
  return (
    <View style={styles.teamLabel}>
      <ThemedText numberOfLines={1} style={[styles.teamName, compact && styles.teamNameCompact]}>{name}</ThemedText>
      <View style={styles.ownerLine}>
        {owner && <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.owner}>{owner}</ThemedText>}
        {mine && <YouTag />}
      </View>
    </View>
  );
}

/** One team's TB by player and game, a block per series, with the round totals on top. */
export function TeamScoreboard({ data, scores, teamId }: { data: SeasonData; scores: Scores; teamId: string }) {
  const theme = useTheme();
  const compact = useLayout() === 'compact';
  // Sections folded or opened by hand, by key; the rest keep their defaults.
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const team = data.teams.find((t) => t.id === teamId);
  if (!team) return null;
  const blocks = teamSeriesBlocks(teamId, scores.games, scores.stats, coreSpells(data), (id) => data.poolByPlayer.get(id)?.mlb_team_id);
  const totals = roundTotals(blocks);
  const out = team.eliminated_after_round;
  const started = (round: FantasyRound) =>
    roundSeries(round).some((s) => scores.games.some((g) => g.gameType === s.gameType && (g.status === 'Live' || g.status === 'Final')));
  const roundOf = (b: SeriesBlock) => ROUND_FOR_GAME_TYPE[b.gameType];
  // Series with games on the schedule (the Wild Card before it's set), up to the team's elimination.
  const shown = blocks.filter((b, i) => {
    if (out !== null && roundOf(b) > out) return false;
    // The ghost team starts in round 2.
    if (team.is_ghost && roundOf(b) === 1) return false;
    return i === 0 || scores.games.some((g) => g.gameType === b.gameType);
  });
  const mine = team.id === data.myTeam?.id;
  const owner = [ownerLine(data, team), mine ? 'You' : null].filter(Boolean).join(' · ');
  const status = (playerId: number) => playerStatus(data, teamId, playerId, scores.games);
  // The series being played (the latest one under way) starts open; the others start folded.
  const playing = shown.findLast((b) => b.columns.some((c) => c.started)) ?? shown[0];
  const isOpen = (key: string, byDefault: boolean) => folds[key] ?? byDefault;
  const toggle = (key: string, byDefault: boolean) => setFolds({ ...folds, [key]: !isOpen(key, byDefault) });

  const photo = team.user_id ? data.photos.get(team.user_id) : null;
  const label = (
    <View style={styles.teamLabel}>
      <ThemedText numberOfLines={1} style={styles.teamTitle}>{teamName(team)}</ThemedText>
      {owner !== '' && <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.owner}>{owner}</ThemedText>}
    </View>
  );
  const roundTotal = (round: FantasyRound) =>
    out !== null && round > out ? 'Out' : team.is_ghost && round === 1 ? '—' : started(round) ? String(totals[round]) : '—';
  const seasonTotal = totals[1] + totals[2] + totals[3];
  const totalsStrip = (
    <ThemedView type="backgroundElement" style={[styles.totals, compact && styles.totalsFull]}>
      {[...ROUNDS.map((r) => ({ key: `RD ${r.round}`, value: roundTotal(r.round) })), { key: 'TOTAL', value: String(seasonTotal) }].map((c, i) => (
        <View
          key={c.key}
          style={[styles.totalCell, compact && styles.totalCellFull, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.border }]}>
          <ThemedText themeColor="textSecondary" style={styles.totalLabel}>{c.key}</ThemedText>
          <ThemedText style={styles.totalNumber}>{c.value}</ThemedText>
        </View>
      ))}
    </ThemedView>
  );

  // Everyone who's played for the team, most bags first: its live hitters, then those whose MLB
  // team is out, then the ones it dropped.
  const ledger = playerTotals(shown);
  const order = (id: number) => (status(id).dropped ? 2 : status(id).out ? 1 : 0);
  ledger.sort((a, b) => order(a.playerId) - order(b.playerId) || b.total - a.total);
  const roundsPlayed = ROUNDS.filter((r) => roundTotal(r.round) !== 'Out');
  const ledgerOpen = isOpen('players', true);

  return (
    <View style={styles.team}>
      {compact ? (
        // Phones: photo, name and owner on top, the round totals across the full width below.
        <View style={styles.teamHeadCompact}>
          <View style={styles.teamNameRow}>
            <OwnerBadge teamId={team.id} owner={team.is_ghost ? '👻' : owner} photo={photo} size={44} />
            {label}
          </View>
          {totalsStrip}
        </View>
      ) : (
        // As tall as the round toggle beside it, so both columns' tables start level.
        <View style={styles.teamHead}>
          <OwnerBadge teamId={team.id} owner={team.is_ghost ? '👻' : owner} photo={photo} mine={mine} size={36} />
          {label}
          {totalsStrip}
        </View>
      )}
      <View style={styles.blocks}>
        {ledger.length > 0 && (
          <View style={styles.section}>
            <FoldHead
              title="Bags by player"
              total={seasonTotal}
              open={ledgerOpen}
              onToggle={() => toggle('players', true)}
              playerIds={ledger.map((p) => p.playerId)}
            />
            {ledgerOpen && (
              <ScoreGrid
                columns={roundsPlayed.map((r) => ({ label: `RD${r.round}` }))}
                rows={[
                  ...ledger.map((p) => ({
                    key: String(p.playerId),
                    label: <PlayerLabel data={data} playerId={p.playerId} status={status(p.playerId)} />,
                    cells: roundsPlayed.map((r) => (roundTotal(r.round) === '—' ? '' : String(p.rounds[r.round]))),
                    total: String(p.total),
                  })),
                  {
                    key: 'team',
                    label: <ThemedText type="smallBold">Team</ThemedText>,
                    cells: roundsPlayed.map((r) => (roundTotal(r.round) === '—' ? '' : String(totals[r.round]))),
                    total: String(seasonTotal),
                    strong: true,
                  },
                ]}
                labelHeader="Player"
                totalHeader="Total"
                labelWidth={compact ? 170 : 200}
                labelMaxWidth={300}
                rowHeight={PLAYER_ROW}
              />
            )}
          </View>
        )}
        {shown.map((b) => {
          const byDefault = b === playing;
          return (
            <SeriesTable
              key={b.gameType}
              data={data}
              block={b}
              status={status}
              open={isOpen(b.gameType, byDefault)}
              onToggle={() => toggle(b.gameType, byDefault)}
            />
          );
        })}
      </View>
    </View>
  );
}

/** Rows with a headshot: a little taller than the grid's default. */
const PLAYER_ROW = 44;

interface PlayerStatus {
  /** His MLB team is out (he's still on the roster, or was when he was dropped). */
  out: boolean;
  /** Dropped by the team while his MLB team was still playing. */
  burned: boolean;
  /** No longer on the team. */
  dropped: boolean;
}

/** Whether a hitter is still on a team, and if not, how he left it. */
function playerStatus(data: SeasonData, teamId: string, playerId: number, games: Scores['games']): PlayerStatus {
  const pool = data.poolByPlayer.get(playerId);
  const eliminated = !!pool && !!data.mlbTeams.get(pool.mlb_team_id)?.eliminated;
  const spells = data.spells.filter((s) => s.fantasy_team_id === teamId && s.mlb_player_id === playerId);
  if (!spells.length || spells.some((s) => s.to_at === null)) return { out: eliminated, burned: false, dropped: false };
  if (!pool) return { out: true, burned: false, dropped: true };
  const droppedAt = spells.map((s) => s.to_at!).sort().at(-1)!;
  const kind = dropKind(droppedAt, pool.mlb_team_id, games, { eliminated, onPostseasonRoster: pool.on_postseason_roster });
  return { out: kind === 'out', burned: kind === 'burned', dropped: true };
}

/** A hitter in the team's tables: headshot, name (struck through once he's out or dropped), and what became of him. */
function PlayerLabel({ data, playerId, status }: { data: SeasonData; playerId: number; status: PlayerStatus }) {
  const theme = useTheme();
  const name = data.players.get(playerId)?.full_name ?? `Player ${playerId}`;
  const position = data.players.get(playerId)?.primary_position;
  const mlb = mlbTeamAbbr(data, playerId);
  const burned = status.burned;
  const struck = burned ? [outNameStyle(theme), { textDecorationColor: theme.burn }] : status.out ? outNameStyle(theme) : null;
  const note = burned ? '🔥 Burned' : status.out ? 'Out' : null;
  return (
    <View style={styles.player}>
      <Image
        source={headshotUrl(playerId, 96)}
        style={[styles.headshot, { backgroundColor: theme.backgroundSelected }, (status.out || status.dropped) && styles.headshotGone]}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
      <View style={styles.playerText}>
        <PlayerName playerId={playerId} type="smallBold" numberOfLines={1} style={struck}>{name}</PlayerName>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.playerMeta}>
          {[position, mlb].filter(Boolean).join(' · ')}
          {note && (
            <ThemedText type="smallBold" style={[styles.playerMeta, { color: burned ? theme.burn : theme.danger }]}>
              {' · '}
              {note}
            </ThemedText>
          )}
        </ThemedText>
      </View>
    </View>
  );
}

/** A section's title and TB, which folds it; folded, it shows the players' headshots. */
function FoldHead({
  title,
  total,
  open,
  onToggle,
  playerIds,
}: {
  title: string;
  total: number;
  open: boolean;
  onToggle: () => void;
  playerIds: number[];
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${title}, ${total} TB`}
      style={[styles.sectionHead, styles.foldHead]}>
      <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1} style={[styles.sectionTitle, styles.sectionTitleFill]}>{title}</ThemedText>
      {!open && <HeadshotStack roster={playerIds} surface={theme.background} />}
      <ThemedText type="small" themeColor="textSecondary">{total} TB</ThemedText>
      <SymbolView
        name={open ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' } : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
        size={18}
        tintColor={theme.textSecondary}
      />
    </Pressable>
  );
}

function SeriesTable({
  data,
  block,
  status,
  open,
  onToggle,
}: {
  data: SeasonData;
  block: SeriesBlock;
  status: (playerId: number) => PlayerStatus;
  open: boolean;
  onToggle: () => void;
}) {
  const compact = useLayout() === 'compact';
  const cell = (value: number | null, started: boolean) => (value !== null ? String(value) : started ? '·' : '');
  const rows: GridRow[] = [
    ...block.players.map((p) => ({
      key: String(p.playerId),
      label: <PlayerLabel data={data} playerId={p.playerId} status={status(p.playerId)} />,
      cells: p.games.map((v, i) => cell(v, block.columns[i].started)),
      total: String(p.total),
    })),
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
      <FoldHead title={block.name} total={block.total} open={open} onToggle={onToggle} playerIds={block.players.map((p) => p.playerId)} />
      {open && (
        <ScoreGrid
          columns={block.columns.map((c) => ({ label: c.label, live: c.live }))}
          rows={rows}
          labelHeader="Player"
          totalHeader="Total"
          labelWidth={compact ? 170 : 200}
          labelMaxWidth={300}
          keepColumns={4}
          rowHeight={PLAYER_ROW}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Wide enough for "▼9"; a rare "▼12" just grows it. Sits right after the name.
  moveSlot: { minWidth: 16, marginLeft: 4, alignItems: 'flex-end' },
  tieSlot: { width: 16, alignItems: 'center' },
  move: { fontSize: 11, lineHeight: 14, fontWeight: 700, fontVariant: ['tabular-nums'] },
  // As tall as the team panel's header beside it on desktops, like the Standings / My team toggle.
  rounds: { flexDirection: 'row', height: CHIPS_ROW, borderRadius: Radius.lg, padding: 3 },
  roundItem: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.lg },
  // Section heads are one line of fixed height, so tables side by side start level.
  section: { gap: Spacing.three },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two, height: 16 },
  // Centered for the chevron and headshots, which stand a little taller than the line.
  foldHead: { alignItems: 'center' },
  sectionTitleFill: { flex: 1, minWidth: 0 },
  cutNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12, lineHeight: 16 },
  rank: { width: 20, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  badge: { marginRight: Spacing.one },
  teamLabel: { flex: 1, minWidth: 0, gap: 1 },
  teamName: { fontSize: 15, lineHeight: 19, fontWeight: 600 },
  teamNameCompact: { fontSize: 13, lineHeight: 17 },
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
  player: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headshot: { width: 28, height: 28, borderRadius: 14 },
  headshotGone: { opacity: 0.55 },
  playerText: { flex: 1, minWidth: 0 },
  playerMeta: { fontSize: 12, lineHeight: 15 },
});
