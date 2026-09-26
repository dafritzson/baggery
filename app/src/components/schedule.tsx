import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { type Series, gameWinner, ifNecessary, notNeeded } from '@core/schedule.ts';
import { SERIES } from '@core/scoreboard.ts';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, gameDay } from '@/lib/game-day';
import type { GameInfo } from '@/lib/scores';
import type { SeasonData } from '@/lib/season';
import { zoomKey } from '@/lib/zoom';

export type GameSeries = Series<GameInfo>;

interface ViewProps {
  data: SeasonData;
  /** The day the Day view shows: its games are outlined. */
  day?: string;
  today: string;
  /** Zoom into a game's day. */
  onPick: (game: GameInfo) => void;
}

/** One round of MLB's postseason: a card per series, a square per game with its date and score. */
export function RoundView({ series, ...props }: ViewProps & { series: GameSeries[] }) {
  const wide = useLayout() === 'wide';
  const cards = series.map((s) => <SeriesCard key={s.key} series={s} detailed {...props} />);
  return wide ? <Pairs>{cards}</Pairs> : <View style={styles.column}>{cards}</View>;
}

/**
 * The whole postseason, round by round: side by side like a bracket on desktop, one after the
 * other on phones. A round whose matchups aren't set yet says so.
 */
export function PostseasonView({ series, ...props }: ViewProps & { series: GameSeries[] }) {
  const wide = useLayout() === 'wide';
  return (
    <View style={wide ? styles.bracket : styles.rounds}>
      {SERIES.map((round) => {
        const inRound = series.filter((s) => s.gameType === round.gameType);
        return (
          <View key={round.gameType} style={[styles.round, wide && styles.bracketRound]}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.roundName}>{round.name}</ThemedText>
            {inRound.length ? (
              inRound.map((s) => <SeriesCard key={s.key} series={s} {...props} />)
            ) : (
              <ThemedText type="small" themeColor="textSecondary">Matchups not set yet.</ThemedText>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** Rows of two cards, both as tall as the taller one (like the Day view on desktop). */
function Pairs({ children }: { children: ReactNode[] }) {
  return (
    <View style={styles.column}>
      {children
        .filter((_, i) => i % 2 === 0)
        .map((_, row) => (
          <View key={row} style={styles.row}>
            {children.slice(row * 2, row * 2 + 2).map((card, i) => (
              <View key={i} style={styles.cell}>{card}</View>
            ))}
            {row * 2 + 1 >= children.length && <View style={styles.cell} />}
          </View>
        ))}
    </View>
  );
}

/** "LAD won 3–1", "NYY leads 2–1", "Tied 1–1", or when it starts. */
function seriesStatus(series: GameSeries, abbr: (id: number) => string, today: string): string {
  const [a, b] = series.wins;
  if (series.winner !== null) return series.bestOf === 1 ? `${abbr(series.winner)} won` : `${abbr(series.winner)} won ${Math.max(a, b)}–${Math.min(a, b)}`;
  const started = series.games.some((g) => g && g.status !== 'Preview');
  if (!started) {
    const first = series.games.find((g) => g);
    return first ? `Starts ${dayLabel(gameDay(first), today)}` : '';
  }
  if (a === b) return `Tied ${a}–${b}`;
  return `${abbr(a > b ? series.teams[0] : series.teams[1])} leads ${Math.max(a, b)}–${Math.min(a, b)}`;
}

/** A series: both teams and where it stands, then a square per game it can go. */
function SeriesCard({ data, series, detailed, day, today, onPick }: ViewProps & { series: GameSeries; detailed?: boolean }) {
  const abbr = (id: number) => data.mlbTeams.get(id)?.abbreviation ?? '—';
  const out = (id: number) => series.winner !== null && series.winner !== id;
  return (
    <Card style={[styles.fill, !detailed && styles.compactCard]}>
      <View style={styles.seriesHead}>
        <ThemedText type="smallBold" numberOfLines={1}>
          <ThemedText type="smallBold" themeColor={out(series.teams[0]) ? 'textSecondary' : 'text'}>{abbr(series.teams[0])}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{' vs '}</ThemedText>
          <ThemedText type="smallBold" themeColor={out(series.teams[1]) ? 'textSecondary' : 'text'}>{abbr(series.teams[1])}</ThemedText>
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.seriesStatus}>
          {seriesStatus(series, abbr, today)}
        </ThemedText>
      </View>
      <View style={styles.strip}>
        {series.games.map((game, i) => (
          <GameSquare
            key={i}
            series={series}
            number={i + 1}
            game={game}
            abbr={abbr}
            detailed={detailed}
            selected={!!game && !!day && gameDay(game) === day}
            onPick={onPick}
          />
        ))}
      </View>
    </Card>
  );
}

/** "10/5" */
function shortDay(game: GameInfo): string {
  const [, m, d] = gameDay(game).split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** "7:08" in the viewer's time zone, or "TBD". */
function shortTime(game: GameInfo): string {
  if (game.startTimeTbd) return 'TBD';
  return new Date(game.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
}

/**
 * One game of a series. Played: the winner and the score. Live: the score in red. To come: the
 * date (and time, when detailed), marked if it's only played if needed. A game the series won't
 * need is a faded dash; one not scheduled yet is an empty dashed box.
 */
function GameSquare({
  series,
  number,
  game,
  abbr,
  detailed,
  selected,
  onPick,
}: {
  series: GameSeries;
  number: number;
  game: GameInfo | undefined;
  abbr: (id: number) => string;
  detailed?: boolean;
  selected: boolean;
  onPick: (game: GameInfo) => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const size = detailed ? styles.squareDetailed : styles.squareCompact;

  if (!game || notNeeded(series, number)) {
    const unscheduled = !game && series.winner === null;
    return (
      <View
        style={[styles.square, size, unscheduled ? [styles.unscheduled, { borderColor: theme.border }] : { opacity: 0.35 }]}
        accessibilityLabel={`Game ${number}: ${unscheduled ? 'not scheduled yet' : 'not needed'}`}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.line}>{unscheduled ? `G${number}` : '—'}</ThemedText>
      </View>
    );
  }

  const live = game.status === 'Live';
  const final = game.status === 'Final';
  const postponed = game.detailedState === 'Postponed';
  const winner = final ? gameWinner(game) : null;
  const high = Math.max(game.homeScore ?? 0, game.awayScore ?? 0);
  const low = Math.min(game.homeScore ?? 0, game.awayScore ?? 0);
  const leader = (game.homeScore ?? 0) === (game.awayScore ?? 0) ? null : (game.homeScore ?? 0) > (game.awayScore ?? 0) ? game.homeTeamId : game.awayTeamId;
  const score = `${high}–${low}`;

  let lines: { text: string; bold?: boolean; color?: string; big?: boolean }[];
  if (final) {
    lines = [
      ...(detailed ? [{ text: shortDay(game) }] : []),
      { text: winner ? abbr(winner) : 'Tie', bold: true, color: theme.text },
      { text: score, big: detailed, color: theme.text },
    ];
  } else if (live) {
    const inning = game.live ? `${game.live.inningState === 'Top' ? '▲' : game.live.inningState === 'Bottom' ? '▼' : ''}${game.live.inning}` : 'Live';
    lines = [
      ...(detailed ? [{ text: inning, bold: true, color: theme.danger }] : []),
      { text: leader ? abbr(leader) : 'Tied', bold: true, color: theme.danger },
      { text: score, big: detailed, color: theme.danger },
    ];
  } else {
    const when = postponed ? 'PPD' : shortTime(game);
    const maybe = ifNecessary(series, number) ? 'if nec.' : null;
    lines = [
      { text: shortDay(game), bold: true, color: theme.text },
      ...(detailed ? [{ text: when }, ...(maybe ? [{ text: maybe }] : [])] : [{ text: maybe ?? when }]),
    ];
  }

  const teams = `${abbr(game.awayTeamId)} at ${abbr(game.homeTeamId)}`;
  const label = final
    ? `Game ${number}, ${shortDay(game)}: ${teams}, ${abbr(game.awayTeamId)} ${game.awayScore}, ${abbr(game.homeTeamId)} ${game.homeScore}`
    : `Game ${number}, ${shortDay(game)}: ${teams}${live ? ', live' : ''}${ifNecessary(series, number) ? ', if necessary' : ''}`;

  return (
    <Pressable
      onPress={() => onPick(game)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Show the day.`}
      style={({ pressed }) => [
        styles.square,
        size,
        {
          backgroundColor: hovered || pressed ? theme.backgroundSelected : theme.background,
          borderColor: selected ? theme.accent : live ? theme.danger : 'transparent',
        },
      ]}
      {...zoomKey(`game-${game.gamePk}`)}>
      {lines.map((l, i) => (
        <ThemedText
          key={i}
          type={l.bold ? 'smallBold' : 'small'}
          numberOfLines={1}
          style={[styles.line, l.big && styles.lineBig, { color: l.color ?? theme.textSecondary }]}>
          {l.text}
        </ThemedText>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: { gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three },
  cell: { flex: 1, minWidth: 0 },
  fill: { flexGrow: 1 },
  rounds: { gap: Spacing.four },
  bracket: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  round: { gap: Spacing.two },
  bracketRound: { flex: 1, minWidth: 0 },
  roundName: { textTransform: 'uppercase', letterSpacing: 0.5 },
  compactCard: { padding: Spacing.two + 2 },
  seriesHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two },
  seriesStatus: { flexShrink: 1, minWidth: 0 },
  strip: { flexDirection: 'row', gap: Spacing.one },
  square: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  squareDetailed: { maxWidth: 88, minHeight: 64, paddingVertical: Spacing.one },
  squareCompact: { maxWidth: 44, minHeight: 38, paddingVertical: 2 },
  unscheduled: { borderStyle: 'dashed', borderWidth: 1 },
  line: { fontSize: 10, lineHeight: 13, fontVariant: ['tabular-nums'] },
  lineBig: { fontSize: 14, lineHeight: 18 },
});
