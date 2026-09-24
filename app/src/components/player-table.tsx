import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface PlayerRow {
  id: number;
  name: string;
  team: string;
  wins: number | null;
  bye: boolean;
  pa: number;
  slg: number | null;
  opsPlus: number | null;
  tb: number;
}

type SortKey = 'name' | 'wins' | 'bye' | 'pa' | 'slg' | 'opsPlus' | 'tb' | 'rdslg' | 'tbExpected' | 'rdtb';

interface Column {
  key: SortKey;
  label: string;
  width: number;
  value: (row: PlayerRow) => number | null;
  format?: (value: number) => string;
  /** Formula not decided yet: the column shows blanks and can't be sorted. */
  pending?: boolean;
}

/** ".688", or "1.000" and up. */
function formatRate(value: number): string {
  return value.toFixed(3).replace(/^0\./, '.');
}

const COLUMNS: Column[] = [
  { key: 'wins', label: 'Wins', width: 50, value: (r) => r.wins },
  { key: 'bye', label: 'Bye', width: 44, value: (r) => (r.bye ? 1 : 0), format: (v) => (v ? '✓' : '') },
  { key: 'pa', label: 'PA', width: 44, value: (r) => r.pa },
  { key: 'slg', label: 'SLG', width: 52, value: (r) => r.slg, format: formatRate },
  { key: 'opsPlus', label: 'OPS+', width: 58, value: (r) => r.opsPlus },
  { key: 'tb', label: 'TB', width: 44, value: (r) => r.tb },
  { key: 'rdslg', label: 'RDSLG', width: 60, value: () => null, pending: true },
  { key: 'tbExpected', label: 'TB·E[G]/162', width: 96, value: () => null, pending: true },
  { key: 'rdtb', label: 'RDTB', width: 52, value: () => null, pending: true },
];

/** Name column width on narrow screens; wider tables give the extra room to names. */
const NAME_WIDTH = 156;
export const STATS_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0) + Spacing.two;
const ROW_HEIGHT = 36;

/** Compares with nulls last, whichever way the column is sorted. */
function compareNullable(a: number | null, b: number | null, desc: boolean): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return desc ? b - a : a - b;
}

/**
 * Available players as a spreadsheet-style table: one row each, sortable by any column.
 * The name column stays put while the stats scroll sideways on narrow screens.
 */
export function PlayerTable({
  rows,
  onSelect,
  selectedId = null,
}: {
  rows: PlayerRow[];
  onSelect: (playerId: number) => void;
  /** Highlighted, e.g. the player shown beside the table. */
  selectedId?: number | null;
}) {
  const theme = useTheme();
  const [tableWidth, setTableWidth] = useState(0);
  const nameWidth = Math.max(NAME_WIDTH, tableWidth - STATS_WIDTH);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'tb', desc: true });
  const [pressedId, setPressedId] = useState<number | null>(null);

  const sorted = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sort.key);
    return [...rows].sort(
      (a, b) =>
        (column
          ? compareNullable(column.value(a), column.value(b), sort.desc)
          : (sort.desc ? -1 : 1) * a.name.localeCompare(b.name)) ||
        b.tb - a.tb ||
        a.name.localeCompare(b.name),
    );
  }, [rows, sort]);

  function sortBy(key: SortKey) {
    // Numbers start high to low, names A to Z.
    setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: key !== 'name' });
  }

  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : '');
  const rowStyle = (id: number, i: number) => [
    styles.row,
    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
    selectedId === id && { backgroundColor: theme.tint },
    pressedId === id && { backgroundColor: theme.backgroundSelected },
  ];
  const rowPress = (id: number) => ({
    onPress: () => onSelect(id),
    onPressIn: () => setPressedId(id),
    onPressOut: () => setPressedId(null),
  });

  return (
    <ThemedView
      type="backgroundElement"
      style={styles.table}
      onLayout={(e) => setTableWidth(e.nativeEvent.layout.width)}>
      <View style={[styles.nameColumn, { width: nameWidth, borderRightColor: theme.border }]}>
        <Pressable onPress={() => sortBy('name')} style={[styles.header, styles.nameCell, { borderBottomColor: theme.border }]}>
          <ThemedText type="smallBold" themeColor={sort.key === 'name' ? 'text' : 'textSecondary'} style={styles.headerText}>
            Name{arrow('name')}
          </ThemedText>
        </Pressable>
        {sorted.map((r, i) => (
          <Pressable key={r.id} {...rowPress(r.id)} style={[rowStyle(r.id, i), styles.nameCell, styles.nameRow]}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>{r.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{r.team}</ThemedText>
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.stats}>
        <View>
          <View style={[styles.header, styles.cells, { borderBottomColor: theme.border }]}>
            {COLUMNS.map((c) => (
              <Pressable key={c.key} disabled={c.pending} onPress={() => sortBy(c.key)} style={[styles.cell, { width: c.width }]}>
                <ThemedText
                  type="smallBold"
                  numberOfLines={1}
                  themeColor={sort.key === c.key ? 'text' : 'textSecondary'}
                  style={styles.headerText}>
                  {c.label}{arrow(c.key)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          {sorted.map((r, i) => (
            <Pressable key={r.id} {...rowPress(r.id)} style={[rowStyle(r.id, i), styles.cells]}>
              {COLUMNS.map((c) => {
                const value = c.value(r);
                return (
                  <View key={c.key} style={[styles.cell, { width: c.width }]}>
                    <ThemedText
                      type={c.key === sort.key ? 'smallBold' : 'small'}
                      themeColor={value === null ? 'textSecondary' : 'text'}
                      style={styles.number}>
                      {value === null ? '—' : c.format ? c.format(value) : value}
                    </ThemedText>
                  </View>
                );
              })}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  table: { flexDirection: 'row', borderRadius: Spacing.three, overflow: 'hidden' },
  nameColumn: { borderRightWidth: StyleSheet.hairlineWidth },
  stats: { flexGrow: 1 },
  header: { height: ROW_HEIGHT, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { height: ROW_HEIGHT },
  headerText: { fontSize: 13 },
  nameCell: { justifyContent: 'center', paddingHorizontal: Spacing.two + 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: Spacing.one },
  name: { flexShrink: 1 },
  cells: { flexDirection: 'row', paddingRight: Spacing.two },
  cell: { height: ROW_HEIGHT, justifyContent: 'center', alignItems: 'flex-end', paddingLeft: Spacing.one },
  number: { fontVariant: ['tabular-nums'] },
});
