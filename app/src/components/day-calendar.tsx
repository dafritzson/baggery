import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const CELL = 40;
const PAD = Spacing.two + 2;
const WIDTH = CELL * 7 + PAD * 2;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-10" for a local date. */
function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parse(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The weeks, Sunday to Saturday, from the first game day's week to the last one's. */
function weeksOf(first: string, last: string): Date[][] {
  const start = parse(first);
  start.setDate(start.getDate() - start.getDay());
  const end = parse(last);
  const weeks: Date[][] = [];
  for (const d = start; d <= end || d.getDay() !== 0; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) weeks.push([]);
    weeks.at(-1)!.push(new Date(d));
  }
  return weeks;
}

/**
 * The postseason as a calendar, opened under the Games tab's day chip: one grid of weeks from the
 * first game day to the last, the 1st of a month labeled ("Oct 1"). A day with games is tappable,
 * with a dot per game under it; the day on show is filled, today is ringed.
 */
export function DayCalendar({
  open,
  anchor,
  days,
  counts,
  value,
  today,
  onPick,
  onClose,
}: {
  open: boolean;
  /** Where the chip is on screen, to open under it. */
  anchor: { x: number; y: number; height: number } | null;
  /** Days with games, sorted. */
  days: string[];
  /** Games on each day. */
  counts: Map<string, number>;
  value?: string;
  today: string;
  onPick: (day: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  if (!days.length) return null;
  const weeks = weeksOf(days[0], days.at(-1)!);
  const left = Math.max(Spacing.two, Math.min(anchor?.x ?? Spacing.three, windowWidth - WIDTH - Spacing.two));
  const top = (anchor ? anchor.y + anchor.height : 120) + Spacing.one + 2;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[styles.panel, { top, left, backgroundColor: theme.backgroundElement, borderColor: theme.border, boxShadow: theme.raised }]}
        accessibilityRole="menu"
        aria-label="Pick a day">
        <View style={styles.week}>
          {WEEKDAYS.map((w, i) => (
            <ThemedText key={i} type="small" themeColor="textSecondary" style={styles.weekday}>
              {w}
            </ThemedText>
          ))}
        </View>
        {weeks.map((week) => (
          <View key={key(week[0])} style={styles.week}>
            {week.map((d) => {
              const k = key(d);
              const n = counts.get(k) ?? 0;
              const picked = k === value;
              const label = d.getDate() === 1 ? `${MONTHS[d.getMonth()]} 1` : String(d.getDate());
              const color = picked ? theme.accentText : n ? theme.text : theme.textSecondary;
              const cell = (
                <View
                  style={[
                    styles.day,
                    picked && { backgroundColor: theme.accent },
                    k === today && !picked && { borderColor: theme.accent, borderWidth: 1.5 },
                    !n && styles.noGames,
                  ]}>
                  <ThemedText type={n ? 'smallBold' : 'small'} style={[styles.date, d.getDate() === 1 && styles.monthStart, { color }]}>
                    {label}
                  </ThemedText>
                  <View style={styles.dots}>
                    {Array.from({ length: Math.min(n, 4) }, (_, i) => (
                      <View key={i} style={[styles.dot, { backgroundColor: picked ? theme.accentText : theme.accent }]} />
                    ))}
                  </View>
                </View>
              );
              return n ? (
                <Pressable
                  key={k}
                  onPress={() => {
                    onPick(k);
                    onClose();
                  }}
                  accessibilityRole="menuitem"
                  aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${n} ${n === 1 ? 'game' : 'games'}`}
                  aria-selected={picked}
                  style={styles.cell}>
                  {cell}
                </Pressable>
              ) : (
                <View key={k} style={styles.cell}>
                  {cell}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', width: WIDTH, padding: PAD, borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  week: { flexDirection: 'row' },
  weekday: { width: CELL, textAlign: 'center', fontSize: 11, lineHeight: 16 },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  day: { width: CELL - 4, height: CELL - 4, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', gap: 2 },
  noGames: { opacity: 0.45 },
  date: { fontSize: 14, lineHeight: 16, fontVariant: ['tabular-nums'] },
  monthStart: { fontSize: 10 },
  dots: { flexDirection: 'row', gap: 2, height: 4 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
