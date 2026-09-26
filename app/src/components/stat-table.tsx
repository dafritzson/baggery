import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface StatColumn<T> {
  key: string;
  label: string;
  /** What the column sorts by. */
  value: (row: T) => number;
  /** What the cell shows; the value when not given. */
  format?: (row: T) => string;
  /** Sort smallest first when first tapped (e.g. average finish). Largest first otherwise. */
  ascending?: boolean;
  width?: number;
}

const ROW = 40;

/**
 * A sortable table: the label column pinned on the left, stat columns that scroll sideways on
 * narrow screens. Tap a header to sort by it (again to flip); tap a row to open it.
 */
export function StatTable<T>({
  rows,
  rowKey,
  label,
  labelHeader,
  labelWidth = 130,
  columns,
  initialSort,
  onPressRow,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  label: (row: T) => ReactNode;
  labelHeader: string;
  labelWidth?: number;
  columns: StatColumn<T>[];
  /** Column key to sort by at first; the rows' own order when not given. */
  initialSort?: string;
  onPressRow?: (row: T) => void;
}) {
  const theme = useTheme();
  const [sort, setSort] = useState<{ key: string; ascending: boolean } | null>(
    initialSort ? { key: initialSort, ascending: !!columns.find((c) => c.key === initialSort)?.ascending } : null,
  );
  const column = columns.find((c) => c.key === sort?.key);
  const sorted = column
    ? [...rows].sort((a, b) => (sort!.ascending ? 1 : -1) * (column.value(a) - column.value(b)))
    : rows;
  const tap = (c: StatColumn<T>) =>
    setSort((s) => (s?.key === c.key ? { key: c.key, ascending: !s.ascending } : { key: c.key, ascending: !!c.ascending }));

  const border = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border };
  return (
    <ThemedView type="backgroundElement" style={styles.table}>
      <View style={{ width: labelWidth }}>
        <View style={styles.cell}>
          <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1}>{labelHeader}</ThemedText>
        </View>
        {/* Rows are built the same way on both sides (border on the row, height on the cell) so they line up. */}
        {sorted.map((r) => (
          <Pressable key={rowKey(r)} onPress={onPressRow && (() => onPressRow(r))} disabled={!onPressRow} style={border}>
            <View style={[styles.cell, styles.label]}>{label(r)}</View>
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.stats}>
          <View style={styles.row}>
            {columns.map((c) => (
              <Pressable key={c.key} onPress={() => tap(c)} style={[styles.cell, styles.stat, { width: c.width ?? 64 }]}>
                <ThemedText type="smallBold" numberOfLines={1} style={{ color: sort?.key === c.key ? theme.accent : theme.textSecondary }}>
                  {c.label}
                  {sort?.key === c.key ? (sort.ascending ? ' ▴' : ' ▾') : ''}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          {sorted.map((r) => (
            <Pressable key={rowKey(r)} onPress={onPressRow && (() => onPressRow(r))} disabled={!onPressRow} style={[styles.row, border]}>
              {columns.map((c) => (
                <View key={c.key} style={[styles.cell, styles.stat, { width: c.width ?? 64 }]}>
                  <ThemedText type="small" numberOfLines={1}>{c.format ? c.format(r) : String(c.value(r))}</ThemedText>
                </View>
              ))}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  table: { flexDirection: 'row', borderRadius: Radius.lg, overflow: 'hidden' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  stats: { flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'flex-end' },
  cell: { height: ROW, justifyContent: 'center', paddingHorizontal: Spacing.two },
  stat: { alignItems: 'flex-end' },
  label: { overflow: 'hidden' },
});
