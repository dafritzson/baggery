import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { type TeamSeason, headToHead } from '@core/almanac.ts';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AlmanacData } from '@/lib/almanac';

/** Distinct colors that read on light and dark backgrounds, one per manager. */
const PALETTE = ['#4F8EF7', '#F2762E', '#2BB673', '#E5484D', '#A855F7', '#D9A400', '#14B8A6', '#EC4899', '#84CC16'];

/** A manager's color: the same everywhere in the Almanac, assigned in name order. */
export function managerColor(data: AlmanacData, key: string): string {
  const keys = [...data.almanac.careers].sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.key);
  const i = keys.indexOf(key);
  return PALETTE[(i < 0 ? keys.length : i) % PALETTE.length];
}

/**
 * Every round a manager played, oldest first: a bar up (green) when they beat that round's
 * average, down (red) when they didn't, as far as the difference. Years are labeled under their
 * rounds; trophies mark titles.
 */
export function AboveAverageChart({ seasons }: { seasons: TeamSeason[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const bars = [...seasons]
    .sort((a, b) => a.year - b.year)
    .flatMap((s) => s.rounds.map((r, i) => ({ year: s.year, round: r.round, diff: r.tb - r.average, first: i === 0, title: s.place === 1 })));
  const height = 170;
  const pad = { t: 16, b: 30 };
  const widest = Math.max(1, ...bars.map((b) => Math.abs(b.diff)));
  const mid = pad.t + (height - pad.t - pad.b) / 2;
  const scale = (height - pad.t - pad.b) / 2 / widest;
  // A small gap between seasons, so each year's rounds read as a group.
  const gaps = new Set(bars.map((b, i) => (b.first && i > 0 ? i : -1)));
  const slots = bars.length + gaps.size * 0.6;
  const slot = width / Math.max(slots, 1);
  const placed = bars.map((b, i) => {
    const gapsSoFar = [...gaps].filter((g) => g > 0 && g <= i).length;
    return { ...b, x: (i + gapsSoFar * 0.6) * slot };
  });
  const green = '#2BB673';
  const red = '#E5484D';
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Line x1={0} x2={width} y1={mid} y2={mid} stroke={theme.border} strokeWidth={1} />
          {placed.map((b) => {
            const h = Math.max(2, Math.abs(b.diff) * scale);
            return (
              <Rect
                key={`${b.year}-${b.round}`}
                x={b.x + slot * 0.15}
                y={b.diff >= 0 ? mid - h : mid}
                width={slot * 0.7}
                height={h}
                rx={3}
                fill={b.diff >= 0 ? green : red}
              />
            );
          })}
          {placed
            .filter((b) => b.first)
            .map((b) => {
              const rounds = placed.filter((p) => p.year === b.year).length;
              const cx = b.x + (slot * rounds) / 2;
              return (
                <SvgText key={b.year} x={cx} y={height - 8} fontSize={11} fill={theme.textSecondary} textAnchor="middle">
                  {`${b.title ? '🏆 ' : ''}’${String(b.year).slice(2)}`}
                </SvgText>
              );
            })}
        </Svg>
      )}
    </View>
  );
}

/** A champion's pennant: the year, the manager's name on their color, and the winning bags. */
export function Pennant({ year, name, bags, color, onPress }: { year: number; name: string; bags: number; color: string; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.pennant, { backgroundColor: color, boxShadow: `0 8px 20px ${color}55` }]}>
      <ThemedText style={styles.pennantYear}>{year}</ThemedText>
      <ThemedText style={styles.pennantTrophy}>🏆</ThemedText>
      <ThemedText style={styles.pennantName} numberOfLines={1}>{name}</ThemedText>
      <ThemedText style={styles.pennantBags}>{bags} bags</ThemedText>
      <View style={[styles.pennantNotch, { borderBottomColor: theme.backgroundElement }]} />
    </Pressable>
  );
}

/** A horizontal bar per manager: the value's share of the largest, in the manager's color. */
export function LeaderBars({ rows, format = String }: {
  rows: { key: string; name: string; value: number; color: string; onPress?: () => void; note?: string }[];
  format?: (n: number) => string;
}) {
  const theme = useTheme();
  const most = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View style={{ gap: Spacing.two }}>
      {rows.map((r) => (
        <Pressable key={r.key} onPress={r.onPress} style={styles.leaderRow}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.leaderName}>{r.name}</ThemedText>
          <View style={[styles.leaderTrack, { backgroundColor: theme.background }]}>
            <View style={[styles.leaderBar, { width: `${(r.value / most) * 100}%`, backgroundColor: r.color }]} />
          </View>
          <ThemedText type="smallBold" style={styles.leaderValue}>{format(r.value)}{r.note ?? ''}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pennant: {
    flexGrow: 1,
    flexBasis: 96,
    maxWidth: 160,
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    paddingHorizontal: Spacing.two,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    gap: 2,
    overflow: 'hidden',
  },
  pennantYear: { color: '#fff', fontWeight: '800', fontSize: 13, opacity: 0.9 },
  pennantTrophy: { fontSize: 26, lineHeight: 32 },
  pennantName: { color: '#fff', fontWeight: '800', fontSize: 18, lineHeight: 22 },
  pennantBags: { color: '#fff', fontSize: 12, opacity: 0.9 },
  // The swallowtail: a triangle cut out of the bottom edge.
  pennantNotch: {
    position: 'absolute',
    bottom: -1,
    width: 0,
    height: 0,
    borderLeftWidth: 18,
    borderRightWidth: 18,
    borderBottomWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  leaderName: { width: 64 },
  leaderTrack: { flex: 1, height: 14, borderRadius: 7, overflow: 'hidden' },
  leaderBar: { height: 14, borderRadius: 7 },
  leaderValue: { width: 64, textAlign: 'right' },
});

/** Red (0%) through gray (50%) to green (100%). */
function winColor(share: number): string {
  const [r1, g1, b1] = share < 0.5 ? [229, 72, 77] : [124, 139, 161];
  const [r2, g2, b2] = share < 0.5 ? [124, 139, 161] : [43, 182, 115];
  const t = share < 0.5 ? share * 2 : (share - 0.5) * 2;
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

/**
 * Every rivalry at once: a square for each pair, colored by how often the row's manager outscored
 * the column's in rounds they both played (green: mostly, red: rarely). Tap one for the details.
 */
export function RivalryGrid({ data, onPick }: { data: AlmanacData; onPick: (a: string, b: string) => void }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const people = data.almanac.careers;
  const label = 64;
  const cell = width ? Math.min(40, Math.floor((width - label) / people.length) - 2) : 0;
  const record = (a: string, b: string) => {
    const h = headToHead(data.almanac, a, b);
    return h && h.rounds.length ? h.record.rounds : null;
  };
  return (
    <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} style={{ gap: 2 }}>
      {cell > 0 && (
        <>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            <View style={{ width: label }} />
            {people.map((c) => (
              <View key={c.key} style={{ width: cell, alignItems: 'center' }}>
                <ThemedText type="smallBold" themeColor="textSecondary">{c.name.slice(0, 3)}</ThemedText>
              </View>
            ))}
          </View>
          {people.map((row) => (
            <View key={row.key} style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
              <ThemedText type="smallBold" numberOfLines={1} style={{ width: label }}>{row.name}</ThemedText>
              {people.map((col) => {
                if (row.key === col.key) return <View key={col.key} style={{ width: cell, height: cell, borderRadius: 6, backgroundColor: theme.background }} />;
                const r = record(row.key, col.key);
                const played = r ? r.a + r.b + r.ties : 0;
                return (
                  <Pressable
                    key={col.key}
                    disabled={!r}
                    onPress={() => onPick(row.key, col.key)}
                    accessibilityLabel={r ? `${row.name} vs ${col.name}: ${r.a}–${r.b}` : `${row.name} and ${col.name} never met`}
                    style={{
                      width: cell,
                      height: cell,
                      borderRadius: 6,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: r ? winColor((r.a + r.ties / 2) / played) : theme.background,
                    }}>
                    {r && <ThemedText style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{`${r.a}-${r.b}`}</ThemedText>}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </>
      )}
    </View>
  );
}
