import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { FillSurface, useTheme } from '@/hooks/use-theme';

export interface GridColumn {
  label: string;
  /** A game in this column is being played now. */
  live?: boolean;
  /** Starts a new series: a divider before it. */
  divider?: boolean;
}

export interface GridRow {
  key: string;
  label: ReactNode;
  cells: string[];
  total: string;
  /** Bold, e.g. the team total row. */
  strong?: boolean;
  /** Highlights the row (the team shown beside the standings). */
  selected?: boolean;
  /** My team's row: dark green like my hitters on the Games tab, selected or not. */
  mine?: boolean;
  /** Grays out the numbers, e.g. bags that counted for no fantasy team. */
  muted?: boolean;
  /** Colors the total, like the old scoring sheet: safe, tied at the cut, or out. */
  standing?: 'safe' | 'tied' | 'out';
  /** Draw the cut line under this row. */
  cutAfter?: boolean;
  /** A cell to pick out (by index), e.g. the one the bag just shown landed in. */
  highlight?: number;
  onPress?: () => void;
}

const ROW = 38;
const CELL = 34;
const TOTAL = 52;

/**
 * A spreadsheet-like grid: labels pinned on the left, the round total pinned on the right, and
 * the game columns between them, which scroll sideways on narrow screens.
 */
export function ScoreGrid({
  columns,
  rows,
  labelHeader,
  totalHeader,
  labelWidth,
  labelMaxWidth,
  rowHeight = ROW,
  follow,
}: {
  columns: GridColumn[];
  rows: GridRow[];
  labelHeader: string;
  totalHeader: string;
  labelWidth: number;
  /**
   * Lets the labels widen past `labelWidth`, up to this, into whatever room the game columns
   * don't need, so long names aren't cut off when the columns fit anyway.
   */
  labelMaxWidth?: number;
  /** Body rows' height; the header stays at the default. */
  rowHeight?: number;
  /** A column to keep scrolled into view (the latest one filled in, when the standings are scrubbed). */
  follow?: number;
}) {
  const theme = useTheme();
  const scroller = useRef<ScrollView>(null);
  const [viewWidth, setViewWidth] = useState(0);
  const [gridWidth, setGridWidth] = useState(0);
  const spare = gridWidth - TOTAL - columns.length * CELL - 2 * Spacing.one;
  const labels = labelMaxWidth && gridWidth ? Math.min(labelMaxWidth, Math.max(labelWidth, spare)) : labelWidth;
  useEffect(() => {
    if (follow === undefined || follow < 0 || !viewWidth) return;
    scroller.current?.scrollTo({ x: Math.max(0, (follow + 1) * CELL + Spacing.one - viewWidth), animated: true });
  }, [follow, viewWidth]);
  const standingColor = (r: GridRow) =>
    r.standing && { safe: theme.standingSafe, tied: theme.standingTied, out: theme.standingOut }[r.standing];
  const rowStyle = (r: GridRow, i: number) => [
    styles.row,
    { height: rowHeight },
    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
    rows[i - 1]?.cutAfter && [styles.cut, { borderTopColor: theme.danger }],
    r.selected && { backgroundColor: theme.backgroundSelected },
    r.mine && { backgroundColor: theme.mineFill },
  ];
  const header = (text: string, live?: boolean) => (
    <>
      <ThemedText type="smallBold" numberOfLines={1} style={[styles.headerText, { color: live ? theme.accent : theme.textSecondary }]}>
        {text}
      </ThemedText>
      {live && <View style={[styles.liveDot, { backgroundColor: theme.danger }]} accessibilityLabel="Live" />}
    </>
  );
  const cellText = (text: string, strong?: boolean, muted?: boolean) => (
    <ThemedText
      type={strong ? 'smallBold' : 'small'}
      themeColor={muted || text === '·' ? 'textSecondary' : 'text'}
      style={styles.number}>
      {text}
    </ThemedText>
  );
  // My team's row is dark green, so what's in it reads the theme for that fill (light text). The
  // total keeps the page's colors when it has a standing color of its own.
  const pressable = (r: GridRow, i: number, style: object, content: ReactNode, onFill = true) => {
    const children = <FillSurface fill={r.mine && onFill ? 'mineFill' : null}>{content}</FillSurface>;
    return r.onPress ? (
      <Pressable key={r.key} onPress={r.onPress} style={[rowStyle(r, i), style]}>{children}</Pressable>
    ) : (
      <View key={r.key} style={[rowStyle(r, i), style]}>{children}</View>
    );
  };

  return (
    <ThemedView
      type="backgroundElement"
      style={styles.grid}
      onLayout={labelMaxWidth ? (e) => setGridWidth(e.nativeEvent.layout.width) : undefined}>
      <View style={[{ width: labels, borderRightColor: theme.border }, styles.labels]}>
        <View style={[styles.header, styles.labelCell, { borderBottomColor: theme.border }]}>{header(labelHeader)}</View>
        {rows.map((r, i) => pressable(r, i, styles.labelCell, r.label))}
      </View>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onLayout={(e) => setViewWidth(e.nativeEvent.layout.width)}>
        <View style={styles.fill}>
          <View style={[styles.header, styles.cells, { borderBottomColor: theme.border }]}>
            {columns.map((c) => (
              <View key={c.label} style={[styles.cell, styles.headerCell, c.divider && [styles.divider, { borderLeftColor: theme.border }]]}>
                {header(c.label, c.live)}
              </View>
            ))}
          </View>
          {rows.map((r, i) =>
            pressable(
              r,
              i,
              styles.cells,
              r.cells.map((text, j) => (
                <View key={columns[j].label} style={[styles.cell, columns[j].divider && [styles.divider, { borderLeftColor: theme.border }]]}>
                  {r.highlight === j ? (
                    <View style={[styles.highlight, { backgroundColor: theme.accent }]}>
                      <ThemedText type="smallBold" style={[styles.number, { color: theme.accentText }]}>{text}</ThemedText>
                    </View>
                  ) : (
                    cellText(text, r.strong, r.muted)
                  )}
                </View>
              )),
            ),
          )}
        </View>
      </ScrollView>
      <View style={[styles.totals, { borderLeftColor: theme.border }]}>
        <View style={[styles.header, styles.totalCell, { borderBottomColor: theme.border }]}>{header(totalHeader)}</View>
        {rows.map((r, i) =>
          pressable(r, i, [styles.totalCell, { backgroundColor: standingColor(r) }], cellText(r.total, true, r.muted), !r.standing),
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', borderRadius: Radius.lg, overflow: 'hidden' },
  labels: { borderRightWidth: StyleSheet.hairlineWidth },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  fill: { flexGrow: 1 },
  totals: { borderLeftWidth: StyleSheet.hairlineWidth, width: TOTAL },
  header: { height: ROW, borderBottomWidth: StyleSheet.hairlineWidth },
  headerCell: { height: ROW },
  headerText: { fontSize: 12 },
  liveDot: { position: 'absolute', top: 6, right: 4, width: 6, height: 6, borderRadius: 3 },
  row: { height: ROW },
  cut: { borderTopWidth: 2, borderStyle: 'dashed' },
  labelCell: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two + 2 },
  cells: { flexDirection: 'row', paddingHorizontal: Spacing.one },
  cell: { minWidth: CELL, flexGrow: 1, flexBasis: 0, alignSelf: 'stretch', justifyContent: 'center', alignItems: 'center' },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth },
  totalCell: { justifyContent: 'center', alignItems: 'center' },
  number: { fontVariant: ['tabular-nums'] },
  highlight: { minWidth: 24, paddingHorizontal: 3, borderRadius: Radius.sm, alignItems: 'center' },
});
