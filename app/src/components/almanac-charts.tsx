import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import type { ManagerScouting, TeamSeason } from '@core/almanac.ts';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
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
                <SvgText fontFamily={Fonts.sans} key={b.year} x={cx} y={height - 8} fontSize={11} fill={theme.textSecondary} textAnchor="middle">
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
  gridHead: { height: 40, justifyContent: 'flex-end', paddingBottom: 4 },
  gridHeadText: { fontSize: 11, lineHeight: 13, textAlign: 'center' },
  gridName: { height: 34, marginBottom: 3, flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingRight: Spacing.two, width: 84 },
  // Fewer than 3 seasons: too few to read much into.
  gridFew: { opacity: 0.5 },
  gridDot: { width: 8, height: 8, borderRadius: 4 },
  gridCell: { height: 34, marginBottom: 3, marginRight: 3, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  lbRow: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.two, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: 'transparent' },
  lbRank: { width: 32, alignItems: 'center', paddingTop: 2 },
  lbBody: { flex: 1, gap: Spacing.one },
  lbLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  lbTitle: { flex: 1, fontWeight: '700' },
  lbLabel: { fontWeight: '800' },
  lbTags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  lbTag: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  lbTagManager: { color: '#fff', fontSize: 11, lineHeight: 16, fontWeight: '800' },
  lbTagText: { fontSize: 11, lineHeight: 16 },
  lbTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  lbFill: { height: 6, borderRadius: 3 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  leaderName: { width: 64 },
  leaderTrack: { flex: 1, height: 14, borderRadius: 7, overflow: 'hidden' },
  leaderBar: { height: 14, borderRadius: 7 },
  leaderValue: { width: 64, textAlign: 'right' },
});

/**
 * Every manager against every skill: a cell per stat, greener the better they are at it compared
 * with the league (grayer for middling, redder for the bottom). Tap a manager to open their page.
 */
export function ScoutingGrid({ data, stats, onPick }: {
  data: AlmanacData;
  stats: { key: string; label: string; value: (s: ManagerScouting) => number | null; format: (n: number) => string }[];
  onPick: (key: string) => void;
}) {
  const theme = useTheme();
  const rows = [...data.scouting].sort((a, b) => b.seasons - a.seasons || a.key.localeCompare(b.key));
  const scale = (stat: (typeof stats)[number], v: number) => {
    const values = data.scouting.map(stat.value).filter((x): x is number => x !== null);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return hi === lo ? 0.5 : (v - lo) / (hi - lo);
  };
  const shade = (t: number) => {
    // Red, through the card color, to green.
    const [r, g, b] = t < 0.5 ? [229, 72, 77] : [43, 182, 115];
    const strength = Math.abs(t - 0.5) * 2;
    return `rgba(${r}, ${g}, ${b}, ${0.15 + strength * 0.7})`;
  };
  const cell = 64;
  return (
    <View style={{ flexDirection: 'row' }}>
      <View>
        <View style={styles.gridHead} />
        {rows.map((s) => (
          <Pressable key={s.key} onPress={() => onPick(s.key)} style={[styles.gridName, s.seasons < 3 && styles.gridFew]}>
            <View style={[styles.gridDot, { backgroundColor: managerColor(data, s.key) }]} />
            <ThemedText type="smallBold" numberOfLines={1}>{data.managers.get(s.key)}</ThemedText>
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={{ flexDirection: 'row' }}>
            {stats.map((st) => (
              <View key={st.key} style={[styles.gridHead, { width: cell }]}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gridHeadText} numberOfLines={2}>{st.label}</ThemedText>
              </View>
            ))}
          </View>
          {rows.map((s) => (
            <Pressable key={s.key} onPress={() => onPick(s.key)} style={[{ flexDirection: 'row' }, s.seasons < 3 && styles.gridFew]}>
              {stats.map((st) => {
                const v = st.value(s);
                return (
                  <View key={st.key} style={[styles.gridCell, { width: cell - 3, backgroundColor: v === null ? theme.background : shade(scale(st, v)) }]}>
                    <ThemedText type="smallBold" style={{ fontSize: 12 }}>{v === null ? '—' : st.format(v)}</ThemedText>
                  </View>
                );
              })}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export interface LeaderboardRow {
  key: string;
  /** The main line, e.g. a player or manager. */
  title: string;
  /** Small tags under it, e.g. "2025 · Round 1". */
  tags: string[];
  /** Who it belongs to: their name and color. */
  manager?: { name: string; color: string };
  /** Sizes the bar; null for no bar. */
  value: number | null;
  /** What's shown on the right, e.g. "58 bags". */
  label: string;
  onPress?: () => void;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * A ranked list: medals for the top three, each row in its manager's color with a bar sized to
 * its value. The leader's row is larger.
 */
export function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const theme = useTheme();
  const most = Math.max(1, ...rows.map((r) => Math.abs(r.value ?? 0)));
  return (
    <View style={{ gap: Spacing.two }}>
      {rows.map((r, i) => {
        const color = r.manager?.color ?? theme.accent;
        const first = i === 0;
        return (
          <Pressable key={r.key} onPress={r.onPress} disabled={!r.onPress} style={[styles.lbRow, first && { backgroundColor: `${color}22`, borderColor: color }]}>
            <View style={styles.lbRank}>
              {i < 3 ? (
                <ThemedText style={{ fontSize: first ? 26 : 20, lineHeight: first ? 32 : 26 }}>{MEDALS[i]}</ThemedText>
              ) : (
                <ThemedText type="smallBold" themeColor="textSecondary">{i + 1}</ThemedText>
              )}
            </View>
            <View style={styles.lbBody}>
              <View style={styles.lbLine}>
                <ThemedText type={first ? 'default' : 'small'} style={styles.lbTitle} numberOfLines={1}>{r.title}</ThemedText>
                <ThemedText style={[styles.lbLabel, { color, fontSize: first ? 20 : 15 }]}>{r.label}</ThemedText>
              </View>
              <View style={styles.lbTags}>
                {r.manager && (
                  <View style={[styles.lbTag, { backgroundColor: color }]}>
                    <ThemedText style={styles.lbTagManager}>{r.manager.name}</ThemedText>
                  </View>
                )}
                {r.tags.map((t) => (
                  <View key={t} style={[styles.lbTag, { backgroundColor: theme.background }]}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.lbTagText}>{t}</ThemedText>
                  </View>
                ))}
              </View>
              {r.value !== null && (
                <View style={[styles.lbTrack, { backgroundColor: theme.background }]}>
                  <View style={[styles.lbFill, { width: `${(Math.abs(r.value) / most) * 100}%`, backgroundColor: color }]} />
                </View>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
