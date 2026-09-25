import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface PlayerRow {
  id: number;
  name: string;
  team: string;
  wins: number | null;
  bye: boolean;
  g: number | null;
  pa: number;
  ab: number | null;
  /** The rest of the season line: null until the pool is synced with them. */
  h: number | null;
  doubles: number | null;
  triples: number | null;
  hr: number | null;
  r: number | null;
  rbi: number | null;
  bb: number | null;
  so: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  opsPlus: number | null;
  tb: number;
  tbPerGame: number | null;
  /** Projections, from core/stats.ts. */
  rdslg: number | null;
  tbExpected: number | null;
  rdtb: number | null;
}

export type ColumnKey = Exclude<keyof PlayerRow, 'id' | 'name' | 'team'>;
type SortKey = 'name' | ColumnKey;

export interface Column {
  key: ColumnKey;
  label: string;
  /** What the label stands for, in the column picker. */
  title: string;
  width: number;
  value: (row: PlayerRow) => number | null;
  format?: (value: number) => string;
  /** Shown until someone picks their own columns. */
  default?: boolean;
}

/** ".688", or "1.000" and up. */
function formatRate(value: number): string {
  return value.toFixed(3).replace(/^0\./, '.');
}

const oneDecimal = (v: number) => v.toFixed(1);
const count = (key: ColumnKey, label: string, title: string, width = 40): Column => ({
  key,
  label,
  title,
  width,
  value: (r) => r[key] as number | null,
});
const rate = (key: ColumnKey, label: string, title: string, width = 52): Column => ({
  ...count(key, label, title, width),
  format: formatRate,
});

export const COLUMNS: Column[] = [
  { ...count('wins', 'Wins', 'Team wins', 50), default: true },
  { key: 'bye', label: 'Bye', title: 'Team has a Wild Card bye', width: 44, value: (r) => (r.bye ? 1 : 0), format: (v) => (v ? '✓' : ''), default: true },
  count('g', 'G', 'Games'),
  { ...count('pa', 'PA', 'Plate appearances', 44), default: true },
  count('ab', 'AB', 'At-bats', 44),
  count('h', 'H', 'Hits'),
  count('doubles', '2B', 'Doubles'),
  count('triples', '3B', 'Triples'),
  count('hr', 'HR', 'Home runs'),
  count('r', 'R', 'Runs'),
  count('rbi', 'RBI', 'Runs batted in', 44),
  count('bb', 'BB', 'Walks'),
  count('so', 'SO', 'Strikeouts', 44),
  rate('avg', 'AVG', 'Batting average'),
  rate('obp', 'OBP', 'On-base percentage'),
  { ...rate('slg', 'SLG', 'Slugging percentage'), default: true },
  rate('ops', 'OPS', 'On-base plus slugging', 58),
  { ...count('opsPlus', 'OPS+', 'OPS+ (100 is league average)', 58), default: true },
  { ...count('tb', 'TB', 'Total bases', 44), default: true },
  { ...count('tbPerGame', 'TB/G', 'Total bases per game', 50), format: (v) => v.toFixed(2) },
  { ...rate('rdslg', 'RDSLG', 'SLG regressed toward .435', 60), default: true },
  { ...count('tbExpected', 'TB·E[G]/162', 'TB per game × expected round 1 games', 96), format: oneDecimal, default: true },
  { ...count('rdtb', 'RDTB', 'Regressed TB per game × expected round 1 games', 52), format: oneDecimal, default: true },
];

export const DEFAULT_COLUMNS: ColumnKey[] = COLUMNS.filter((c) => c.default).map((c) => c.key);

/** Longest the name column gets, as a share of the table, so some stats always show beside it. */
const MAX_NAME_SHARE = 0.65;
const statsWidth = (columns: Column[]) => columns.reduce((sum, c) => sum + c.width, 0) + Spacing.two;
/** How wide the stats part of the table is with these columns showing. */
export const statsWidthFor = (keys: ColumnKey[]) => statsWidth(COLUMNS.filter((c) => keys.includes(c.key)));
const ROW_HEIGHT = 36;

// Web only: the header row and name column stay in view while the table scrolls under them.
const sticky = (edges: { top?: number; left?: number }, zIndex: number) =>
  ({ position: 'sticky', ...edges, zIndex }) as unknown as ViewStyle;

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
  columns: visible = DEFAULT_COLUMNS,
  contained = false,
  headerAction,
  onNaturalWidth,
  style,
}: {
  rows: PlayerRow[];
  onSelect: (playerId: number) => void;
  /** Highlighted, e.g. the player shown beside the table. */
  selectedId?: number | null;
  /** Which columns to show, in the table's own order. */
  columns?: ColumnKey[];
  /**
   * Web: scroll inside the table's own box, both ways, with the header and names pinned, so its
   * scrollbars are always in view. Size the box with `style` (a max height, or flex in a parent).
   */
  contained?: boolean;
  /**
   * At the left end of the Name header, e.g. the column picker; on the left so it stays put however
   * wide the name column gets.
   */
  headerAction?: ReactNode;
  style?: ViewStyle;
  /** The width the table needs to show every chosen column without scrolling sideways. */
  onNaturalWidth?: (width: number) => void;
}) {
  const theme = useTheme();
  const box = contained && Platform.OS === 'web';
  const columns = useMemo(() => COLUMNS.filter((c) => visible.includes(c.key)), [visible]);
  const [tableWidth, setTableWidth] = useState(0);
  // Box mode: the outer width too, so the difference is the vertical scrollbar.
  const [outerWidth, setOuterWidth] = useState(0);
  const [nameWidth, setNameWidth] = useState(0);
  // Just wide enough for the longest name; the stat columns share whatever width is left. On phones
  // it's capped so some stats always show beside it. Not on desktop: Research sizes its list to this
  // table's width, so a cap would shrink the names, then the list, and so on until they're gone.
  const nameColumnWidth = tableWidth && !box ? { maxWidth: tableWidth * MAX_NAME_SHARE } : null;
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
  const scrollbar = box && outerWidth && tableWidth ? outerWidth - tableWidth : 0;
  const naturalWidth = nameWidth ? Math.ceil(nameWidth + statsWidth(columns) + scrollbar) : 0;
  useEffect(() => {
    if (naturalWidth) onNaturalWidth?.(naturalWidth);
  }, [naturalWidth, onNaturalWidth]);
  // Pinned cells need a fill, or the rows scrolling under them show through.
  const fill = { backgroundColor: theme.backgroundElement };

  const stats = (
    <View style={styles.stats}>
      <View style={[styles.header, styles.cells, { borderBottomColor: theme.border }, box && [sticky({ top: 0 }, 1), fill]]}>
        {columns.map((c) => (
          <Pressable key={c.key} onPress={() => sortBy(c.key)} style={[styles.cell, { minWidth: c.width, flexGrow: c.width, flexBasis: c.width }]}>
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
          {columns.map((c) => {
            const value = c.value(r);
            return (
              <View key={c.key} style={[styles.cell, { minWidth: c.width, flexGrow: c.width, flexBasis: c.width }]}>
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
  );

  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.table, box && styles.box, style]}
      onLayout={(e) => (box ? setOuterWidth : setTableWidth)(e.nativeEvent.layout.width)}>
      {box && (
        // The box's width less its vertical scrollbar: sizing the name column to the outer width
        // left the last column under the scrollbar.
        <View pointerEvents="none" style={styles.ruler} onLayout={(e) => setTableWidth(e.nativeEvent.layout.width)} />
      )}
      <View
        onLayout={(e) => setNameWidth(e.nativeEvent.layout.width)}
        style={[styles.nameColumn, nameColumnWidth, { borderRightColor: theme.border }, box && [sticky({ left: 0 }, 2), fill]]}>
        <View style={[styles.header, styles.nameHeader, { borderBottomColor: theme.border }, box && [sticky({ top: 0 }, 3), fill]]}>
          {headerAction}
          <Pressable onPress={() => sortBy('name')} style={[styles.nameCell, styles.nameSort, !!headerAction && styles.nameSortAfterAction]}>
            <ThemedText type="smallBold" themeColor={sort.key === 'name' ? 'text' : 'textSecondary'} style={styles.headerText}>
              Name{arrow('name')}
            </ThemedText>
          </Pressable>
        </View>
        {sorted.map((r, i) => (
          <Pressable key={r.id} {...rowPress(r.id)} style={[rowStyle(r.id, i), styles.nameCell, styles.nameRow]}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>{r.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{r.team}</ThemedText>
          </Pressable>
        ))}
      </View>
      {box ? (
        <View style={styles.stats}>{stats}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.stats}>
          {stats}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  table: { flexDirection: 'row', borderRadius: Radius.lg, overflow: 'hidden' },
  // Web: one box that scrolls both ways (RN's overflow types don't include 'auto').
  box: { overflow: 'auto' as ViewStyle['overflow'], alignItems: 'flex-start' },
  ruler: { position: 'absolute', left: 0, right: 0, top: 0, height: 0 },
  nameColumn: { borderRightWidth: StyleSheet.hairlineWidth },
  stats: { flexGrow: 1 },
  header: { height: ROW_HEIGHT, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { height: ROW_HEIGHT },
  headerText: { fontSize: 13 },
  nameHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.one },
  nameSort: { flex: 1, alignSelf: 'stretch' },
  nameSortAfterAction: { paddingLeft: Spacing.one },
  nameCell: { justifyContent: 'center', paddingHorizontal: Spacing.two + 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: Spacing.one },
  name: { flexShrink: 1 },
  cells: { flexDirection: 'row', paddingRight: Spacing.two },
  cell: { height: ROW_HEIGHT, justifyContent: 'center', alignItems: 'flex-end', paddingLeft: Spacing.one },
  number: { fontVariant: ['tabular-nums'] },
});
