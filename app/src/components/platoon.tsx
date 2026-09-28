import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import type { MatchupSeries } from '@core/matchups.ts';
import { type Hand, HANDS, recordSplits, startChance } from '@core/platoon.ts';
import { formatRate } from '@core/player-stats.ts';
import type { GameType } from '@core/types.ts';

import { ThemedText } from '@/components/themed-text';
import { TooltipPortal } from '@/components/tooltip-portal';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type PlayerPlatoon, ordinal } from '@/lib/platoon';
import { useSeason } from '@/lib/season';

const SERIES_NAMES: Record<GameType, string> = { F: 'Wild Card', D: 'Division Series', L: 'LCS', W: 'World Series' };
const SERIES_SHORT: Record<GameType, string> = { F: 'WC', D: 'DS', L: 'LCS', W: 'WS' };
const HAND_NAMES: Record<Hand, string> = { L: 'left', R: 'right' };
const SIDE_NAMES = { L: 'left', R: 'right', S: 'both sides' } as const;

/** A starter's hand, as a small square: filled for a lefty, who's the rarer and more telling one. */
export function HandBox({ hand }: { hand: Hand }) {
  const theme = useTheme();
  const lefty = hand === 'L';
  return (
    <View style={[styles.hand, { backgroundColor: lefty ? theme.accent : theme.backgroundSelected }]}>
      <ThemedText type="smallBold" style={[styles.handText, { color: lefty ? theme.accentText : theme.textSecondary }]}>{hand}</ThemedText>
    </View>
  );
}

/**
 * "vs L" beside a platoon hitter's name in the draft table. On the web, resting the pointer on it
 * shows his splits and the round's likely starters; phones get the same in the player popup.
 */
export function PlatoonChip({ platoon, name }: { platoon: PlayerPlatoon; name: string }) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const web = Platform.OS === 'web';
  const show = () => {
    const el = ref.current as unknown as HTMLElement | null;
    const box = el?.getBoundingClientRect?.();
    if (!box) return;
    const width = TOOLTIP_WIDTH + Spacing.three;
    setAt({ left: Math.max(Spacing.two, Math.min(box.left - Spacing.two, window.innerWidth - width)), top: box.bottom + Spacing.one });
  };
  return (
    <Pressable
      ref={ref}
      onHoverIn={web ? show : undefined}
      onHoverOut={web ? () => setAt(null) : undefined}
      accessibilityLabel={`Platoon: starts against ${HAND_NAMES[platoon.side!]}-handed starters`}
      style={[styles.chip, { backgroundColor: theme.tintStrong }]}>
      <ThemedText type="smallBold" style={[styles.chipText, { color: theme.accent }]}>vs {platoon.side}</ThemedText>
      {at && (
        <TooltipPortal>
          <View
            style={[
              styles.tooltip,
              { left: at.left, top: at.top, backgroundColor: theme.background, boxShadow: theme.floating },
              { position: 'fixed', pointerEvents: 'none' } as unknown as ViewStyle,
            ]}>
            <PlatoonSummary platoon={platoon} name={name} />
          </View>
        </TooltipPortal>
      )}
    </Pressable>
  );
}

const TOOLTIP_WIDTH = 380;

/** The tooltip's contents: who he is, his splits, the likely starters and what it does to xBags. */
function PlatoonSummary({ platoon, name }: { platoon: PlayerPlatoon; name: string }) {
  return (
    <View style={styles.summary}>
      <View>
        <ThemedText type="smallBold">
          {name}
          {platoon.batSide ? ` · bats ${SIDE_NAMES[platoon.batSide]}` : ''}
        </ThemedText>
        {platoon.side && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            Platoon: starts against {HAND_NAMES[platoon.side]}-handed starters
          </ThemedText>
        )}
      </View>
      <PlatoonSplitTable platoon={platoon} />
      {platoon.matchups.length > 0 && (
        <View style={styles.hands}>
          <ThemedText type="small" style={styles.note}>This round&apos;s likely starters against his team:</ThemedText>
          <SeriesHands matchups={platoon.matchups} />
        </View>
      )}
      <Outlook platoon={platoon} />
    </View>
  );
}

/** "≈2.1 starts of 6.6 expected team games, so xBags 3.1 (7.0 starting every game)". */
function Outlook({ platoon }: { platoon: PlayerPlatoon }) {
  if (platoon.starts === null || platoon.teamGames === null || platoon.xBags === null) return null;
  return (
    <ThemedText type="small" style={styles.note}>
      <ThemedText type="smallBold" style={styles.note}>≈{platoon.starts.toFixed(1)} starts</ThemedText> of{' '}
      {platoon.teamGames.toFixed(1)} expected team games, so{' '}
      <ThemedText type="smallBold" style={styles.note}>xBags {platoon.xBags.toFixed(1)}</ThemedText>
      {platoon.everyDayXBags !== null && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}> ({platoon.everyDayXBags.toFixed(1)} starting every game)</ThemedText>
      )}
    </ThemedText>
  );
}

/** WC vs DET [R][L][R]  DS vs TOR [R][R][L][R][R]. */
function SeriesHands({ matchups }: { matchups: MatchupSeries[] }) {
  const { data } = useSeason();
  return (
    <View style={styles.seriesHands}>
      {matchups.map((s) => (
        <View key={s.gameType} style={styles.seriesHand}>
          <ThemedText type="small" style={styles.note}>
            {SERIES_SHORT[s.gameType]} vs {data?.mlbTeams.get(s.opponentId)?.abbreviation ?? '?'}
            {s.likely ? '?' : ''}
          </ThemedText>
          {s.games.map((g) => (g.starter ? <HandBox key={g.number} hand={g.starter.hand} /> : null))}
        </View>
      ))}
    </View>
  );
}

const COLUMNS: { label: string; width: number; value: (p: PlayerPlatoon, hand: Hand) => string }[] = [
  { label: 'Starts', width: 64, value: (p, h) => `${p.record[h].starts} of ${p.record[h].games}` },
  { label: 'Spot', width: 40, value: (p, h) => ordinal(p.spots[h]) },
  { label: 'PA', width: 36, value: (p, h) => String(p.record[h].line?.pa ?? '—') },
  { label: 'AVG', width: 42, value: (p, h) => rate(p, h, (l) => (l.ab ? l.h / l.ab : null)) },
  { label: 'SLG', width: 42, value: (p, h) => rate(p, h, (l) => (l.ab ? l.tb / l.ab : null)) },
  { label: 'OPS+', width: 42, value: (p, h) => String(p.record[h].opsPlus ?? '—') },
];

function rate(p: PlayerPlatoon, hand: Hand, f: (line: NonNullable<PlayerPlatoon['record']['L']['line']>) => number | null): string {
  const line = p.record[hand].line;
  const v = line ? f(line) : null;
  return v === null ? '—' : formatRate(v);
}

/** Against left- and right-handed pitching: starts (against starters of that hand), spot and line. */
export function PlatoonSplitTable({ platoon }: { platoon: PlayerPlatoon }) {
  const theme = useTheme();
  return (
    <View>
      <View style={styles.tableRow}>
        <View style={styles.tableLabel} />
        {COLUMNS.map((c) => (
          <ThemedText key={c.label} type="smallBold" themeColor="textSecondary" style={[styles.tableCell, styles.tableHead, { width: c.width }]}>
            {c.label}
          </ThemedText>
        ))}
      </View>
      {HANDS.map((hand) => (
        <View
          key={hand}
          style={[
            styles.tableRow,
            { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
            platoon.side === hand && { backgroundColor: theme.tint },
          ]}>
          <ThemedText type="smallBold" style={[styles.tableLabel, styles.tableText]}>vs {hand}HP</ThemedText>
          {COLUMNS.map((c) => (
            <ThemedText key={c.label} type="small" style={[styles.tableCell, styles.tableText, { width: c.width }]}>
              {c.value(platoon, hand)}
            </ThemedText>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * The player popup's Round matchups: a tile per game this round, with the opposing starter (named
 * once announced, else the rotation's turn), his chance to start as a bar, and where he'd bat.
 * Games that may not be played are faded.
 */
export function MatchupStrip({ platoon }: { platoon: PlayerPlatoon }) {
  const theme = useTheme();
  const { data } = useSeason();
  const splits = recordSplits(platoon.record);
  return (
    <View style={styles.strip}>
      <PlatoonSplitTable platoon={platoon} />
      <View style={styles.seriesRow}>
        {platoon.matchups.map((s) => (
          <View key={s.gameType} style={styles.series}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.seriesName}>
              {SERIES_NAMES[s.gameType]} vs {data?.mlbTeams.get(s.opponentId)?.abbreviation ?? '?'}
              {s.likely ? ' (likelier)' : ''}
            </ThemedText>
            <View style={styles.tiles}>
              {s.games.map((g) => {
                const start = g.starter ? startChance(splits, g.starter.hand) : null;
                const status = g.played
                  ? 'Played'
                  : start === null
                    ? '—'
                    : start >= 0.6
                      ? `Bats ${ordinal(platoon.spots[g.starter!.hand])}`
                      : start <= 0.3
                        ? 'Likely sits'
                        : `${Math.round(start * 100)}% to start`;
                const lastName = g.starter?.name.split(' ').slice(-1)[0] ?? 'TBD';
                return (
                  <View
                    key={g.number}
                    style={[
                      styles.tile,
                      { backgroundColor: theme.backgroundElement, boxShadow: theme.raised },
                      { opacity: g.played ? 0.5 : Math.max(0.35, g.chance) },
                    ]}>
                    <View style={styles.tileHead}>
                      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.tileSmall}>G{g.number}</ThemedText>
                      {!g.played && g.chance < 0.995 && (
                        <ThemedText type="small" themeColor="textSecondary" style={styles.tileTiny}>{Math.round(g.chance * 100)}%</ThemedText>
                      )}
                    </View>
                    <View style={styles.tilePitcher}>
                      {g.starter && <HandBox hand={g.starter.hand} />}
                      <ThemedText
                        type="small"
                        numberOfLines={1}
                        themeColor={g.starter?.announced ? 'text' : 'textSecondary'}
                        style={[styles.tileSmall, styles.tileName]}>
                        {lastName}
                      </ThemedText>
                    </View>
                    <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
                      {start !== null && <View style={[styles.barFill, { width: `${Math.round(start * 100)}%`, backgroundColor: theme.success }]} />}
                    </View>
                    <ThemedText
                      type={start !== null && start >= 0.6 && !g.played ? 'smallBold' : 'small'}
                      themeColor={start !== null && start >= 0.6 && !g.played ? 'text' : 'textSecondary'}
                      numberOfLines={1}
                      style={styles.tileSmall}>
                      {status}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>
      <Outlook platoon={platoon} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.legend}>
        Starters are the announced ones, or else the rotation in turn (in gray). The bar is his chance to start against
        that hand, from his starts this season (recent ones count more). Faded games may not be played.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: Radius.sm, paddingHorizontal: 5, marginLeft: 2 },
  chipText: { fontSize: 11, lineHeight: 16 },
  tooltip: { width: TOOLTIP_WIDTH, borderRadius: Radius.lg, padding: Spacing.three - 2, zIndex: 1000 },
  summary: { gap: Spacing.two + 2 },
  note: { fontSize: 13, lineHeight: 18 },
  hands: { gap: Spacing.one },
  seriesHands: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  seriesHand: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  hand: { width: 16, height: 16, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  handText: { fontSize: 11, lineHeight: 16 },
  tableRow: { flexDirection: 'row', alignItems: 'center' },
  tableLabel: { width: 58 },
  tableHead: { fontSize: 12, lineHeight: 18, paddingBottom: 2 },
  tableCell: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  tableText: { fontSize: 13, lineHeight: 26 },
  strip: { gap: Spacing.three },
  seriesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  series: { gap: Spacing.one },
  seriesName: { fontSize: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { width: 72, borderRadius: Radius.md, paddingHorizontal: 6, paddingVertical: 6, gap: 3 },
  tileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tilePitcher: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileName: { flexShrink: 1 },
  tileSmall: { fontSize: 12, lineHeight: 16 },
  tileTiny: { fontSize: 10, lineHeight: 14 },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 2 },
  barFill: { height: '100%' },
  legend: { fontSize: 12, lineHeight: 17 },
});
