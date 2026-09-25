import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
  /** Colors the total, like the old scoring sheet: safe, tied at the cut, or out. */
  standing?: 'safe' | 'tied' | 'out';
  /** Draw the cut line under this row. */
  cutAfter?: boolean;
  onPress?: () => void;
}

const ROW = 38;
const CELL = 34;

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
}: {
  columns: GridColumn[];
  rows: GridRow[];
  labelHeader: string;
  totalHeader: string;
  labelWidth: number;
}) {
  const theme = useTheme();
  const standingColor = (r: GridRow) =>
    r.standing && { safe: theme.standingSafe, tied: theme.standingTied, out: theme.standingOut }[r.standing];
  const rowStyle = (r: GridRow, i: number) => [
    styles.row,
    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
    rows[i - 1]?.cutAfter && [styles.cut, { borderTopColor: theme.danger }],
    r.selected && { backgroundColor: theme.backgroundSelected },
  ];
  const header = (text: string, live?: boolean) => (
    <>
      <ThemedText type="smallBold" numberOfLines={1} style={[styles.headerText, { color: live ? theme.accent : theme.textSecondary }]}>
        {text}
      </ThemedText>
      {live && <View style={[styles.liveDot, { backgroundColor: theme.danger }]} accessibilityLabel="Live" />}
    </>
  );
  const cellText = (text: string, strong?: boolean) => (
    <ThemedText
      type={strong ? 'smallBold' : 'small'}
      themeColor={text === '·' ? 'textSecondary' : 'text'}
      style={styles.number}>
      {text}
    </ThemedText>
  );
  const pressable = (r: GridRow, i: number, style: object, children: ReactNode) =>
    r.onPress ? (
      <Pressable key={r.key} onPress={r.onPress} style={[rowStyle(r, i), style]}>{children}</Pressable>
    ) : (
      <View key={r.key} style={[rowStyle(r, i), style]}>{children}</View>
    );

  return (
    <ThemedView type="backgroundElement" style={styles.grid}>
      <View style={[{ width: labelWidth, borderRightColor: theme.border }, styles.labels]}>
        <View style={[styles.header, styles.labelCell, { borderBottomColor: theme.border }]}>{header(labelHeader)}</View>
        {rows.map((r, i) => pressable(r, i, styles.labelCell, r.label))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.fill}>
          <View style={[styles.header, styles.cells, { borderBottomColor: theme.border }]}>
            {columns.map((c) => (
              <View key={c.label} style={[styles.cell, c.divider && [styles.divider, { borderLeftColor: theme.border }]]}>
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
                  {cellText(text, r.strong)}
                </View>
              )),
            ),
          )}
        </View>
      </ScrollView>
      <View style={[styles.totals, { borderLeftColor: theme.border }]}>
        <View style={[styles.header, styles.totalCell, { borderBottomColor: theme.border }]}>{header(totalHeader)}</View>
        {rows.map((r, i) =>
          pressable(r, i, [styles.totalCell, { backgroundColor: standingColor(r) }], cellText(r.total, true)),
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
  totals: { borderLeftWidth: StyleSheet.hairlineWidth, width: 52 },
  header: { height: ROW, borderBottomWidth: StyleSheet.hairlineWidth },
  headerText: { fontSize: 12 },
  liveDot: { position: 'absolute', top: 6, right: 4, width: 6, height: 6, borderRadius: 3 },
  row: { height: ROW },
  cut: { borderTopWidth: 2, borderStyle: 'dashed' },
  labelCell: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two + 2 },
  cells: { flexDirection: 'row', paddingHorizontal: Spacing.one },
  cell: { minWidth: CELL, flexGrow: 1, flexBasis: 0, height: ROW, justifyContent: 'center', alignItems: 'center' },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth },
  totalCell: { justifyContent: 'center', alignItems: 'center' },
  number: { fontVariant: ['tabular-nums'] },
});
