import { type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import type { RoundDuel } from '@core/almanac.ts';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The two sides' colors: the app's blue against a warm orange, readable in light and dark. */
export function useDuelColors() {
  const theme = useTheme();
  return { a: theme.accent, b: '#F2762E' };
}

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.round(e.nativeEvent.layout.width))];
}

/** A big initial in the side's color. */
export function Monogram({ name, color, size = 64 }: { name: string; color: string; size?: number }) {
  return (
    <View style={[styles.monogram, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <ThemedText style={{ color: '#fff', fontSize: size * 0.45, lineHeight: size * 0.55, fontWeight: '800' }}>{name[0]}</ThemedText>
    </View>
  );
}

/** A bar split between the two sides by their share; an even split when both are zero. */
export function SplitBar({ a, b, height = 10 }: { a: number; b: number; height?: number }) {
  const colors = useDuelColors();
  const share = a + b === 0 ? 0.5 : a / (a + b);
  return (
    <View style={[styles.split, { height, borderRadius: height / 2 }]}>
      <View style={{ flex: share || 0.0001, backgroundColor: colors.a }} />
      <View style={{ width: 2 }} />
      <View style={{ flex: 1 - share || 0.0001, backgroundColor: colors.b }} />
    </View>
  );
}

/**
 * One line of the tale of the tape: the stat in the middle, each side's value at its end, and a
 * bar leaning toward whoever's better. `lowerWins` for stats like average finish.
 */
export function TapeRow({ label, a, b, format = String, lowerWins = false }: {
  label: string;
  a: number;
  b: number;
  format?: (n: number) => string;
  lowerWins?: boolean;
}) {
  const colors = useDuelColors();
  const [x, y] = lowerWins ? [1 / Math.max(a, 0.01), 1 / Math.max(b, 0.01)] : [a, b];
  const better = a === b ? null : (a < b) === lowerWins ? 'a' : 'b';
  return (
    <View style={styles.tape}>
      <View style={styles.tapeLine}>
        <ThemedText type="smallBold" style={[styles.tapeValue, { color: better === 'a' ? colors.a : undefined }]}>
          {format(a)}{better === 'a' ? ' ◀' : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.tapeLabel}>{label}</ThemedText>
        <ThemedText type="smallBold" style={[styles.tapeValue, styles.right, { color: better === 'b' ? colors.b : undefined }]}>
          {better === 'b' ? '▶ ' : ''}{format(b)}
        </ThemedText>
      </View>
      <SplitBar a={x} b={y} height={6} />
    </View>
  );
}

/**
 * Where each finished, year by year: place 1 at the top, a line per manager, a trophy on titles.
 * Years one of them sat out leave a gap in their line.
 */
export function FinishChart({ years, places, teams, color }: {
  years: number[];
  /** place by year for each side; missing when they didn't play. */
  places: { a: Map<number, number>; b: Map<number, number> };
  teams: number;
  /** One manager's own chart: side a's color instead of the duel blue. */
  color?: string;
}) {
  const theme = useTheme();
  const duel = useDuelColors();
  const colors = color ? { ...duel, a: color } : duel;
  const [width, onLayout] = useWidth();
  const height = 200;
  const pad = { l: 28, r: 16, t: 18, b: 26 };
  const x = (i: number) => pad.l + (years.length === 1 ? 0.5 : i / (years.length - 1)) * (width - pad.l - pad.r);
  const y = (place: number) => pad.t + ((place - 1) / Math.max(teams - 1, 1)) * (height - pad.t - pad.b);
  const segments = (m: Map<number, number>) => {
    // Consecutive years they played, as separate lines.
    const runs: string[] = [];
    let run: string[] = [];
    years.forEach((yr, i) => {
      const p = m.get(yr);
      if (p === undefined) {
        if (run.length) runs.push(run.join(' '));
        run = [];
      } else run.push(`${x(i)},${y(p)}`);
    });
    if (run.length) runs.push(run.join(' '));
    return runs;
  };
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {Array.from({ length: teams }, (_, i) => i + 1).map((p) => (
            <SvgText key={p} x={4} y={y(p) + 4} fontSize={10} fill={theme.textSecondary}>{`${p}`}</SvgText>
          ))}
          <Line x1={pad.l} x2={width - pad.r} y1={y(1)} y2={y(1)} stroke={theme.border} strokeDasharray="3 4" />
          {years.map((yr, i) => (
            <SvgText key={yr} x={x(i)} y={height - 6} fontSize={10} fill={theme.textSecondary} textAnchor="middle">{`’${String(yr).slice(2)}`}</SvgText>
          ))}
          {(['a', 'b'] as const).map((side) =>
            segments(places[side]).map((pts, i) => (
              <Polyline key={`${side}${i}`} points={pts} fill="none" stroke={colors[side]} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            )),
          )}
          {(['a', 'b'] as const).map((side) =>
            years.map((yr, i) => {
              const p = places[side].get(yr);
              if (p === undefined) return null;
              // Side by side when they finished in the same place... which can't happen, but ties can.
              return p === 1 ? (
                <SvgText key={`${side}${yr}`} x={x(i)} y={y(1) + 6} fontSize={18} textAnchor="middle">🏆</SvgText>
              ) : (
                <Circle key={`${side}${yr}`} cx={x(i)} cy={y(p)} r={5} fill={colors[side]} stroke={theme.backgroundElement} strokeWidth={2} />
              );
            }),
          )}
        </Svg>
      )}
    </View>
  );
}

/**
 * Every round both played, as a tug of war: a bar from the middle toward whoever scored more,
 * as long as the margin, with both scores at the ends.
 */
export function RoundDuels({ rounds }: { rounds: RoundDuel[] }) {
  const theme = useTheme();
  const colors = useDuelColors();
  const widest = Math.max(1, ...rounds.map((r) => Math.abs(r.a - r.b)));
  return (
    <View style={{ gap: Spacing.one }}>
      {rounds.map((r) => {
        const margin = r.a - r.b;
        const share = Math.abs(margin) / widest;
        return (
          <View key={`${r.year}-${r.round}`} style={styles.duelRow}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.duelWhen}>’{String(r.year).slice(2)} R{r.round}</ThemedText>
            <ThemedText type="smallBold" style={[styles.duelScore, { color: r.winner === 'a' ? colors.a : undefined }]}>{r.a}</ThemedText>
            <View style={styles.duelTrack}>
              <View style={styles.duelHalf}>
                {margin > 0 && <View style={[styles.duelBar, styles.duelLeft, { width: `${share * 100}%`, backgroundColor: colors.a }]} />}
              </View>
              <View style={[styles.duelAxis, { backgroundColor: theme.border }]} />
              <View style={styles.duelHalf}>
                {margin < 0 && <View style={[styles.duelBar, { width: `${share * 100}%`, backgroundColor: colors.b }]} />}
              </View>
            </View>
            <ThemedText type="smallBold" style={[styles.duelScore, styles.right, { color: r.winner === 'b' ? colors.b : undefined }]}>{r.b}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

/** A bold highlight card: a big emoji, a title, the headline number and a line of detail. */
export function MomentCard({ emoji, title, headline, detail, color }: {
  emoji: string;
  title: string;
  headline: ReactNode;
  detail: ReactNode;
  color: string;
}) {
  return (
    <ThemedView type="backgroundElement" style={[styles.moment, { borderColor: color, boxShadow: `0 6px 18px ${color}33` }]}>
      <ThemedText style={styles.momentEmoji}>{emoji}</ThemedText>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.momentTitle}>{title}</ThemedText>
      <ThemedText style={[styles.momentHeadline, { color }]}>{headline}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  monogram: { alignItems: 'center', justifyContent: 'center' },
  split: { flexDirection: 'row', overflow: 'hidden' },
  tape: { gap: Spacing.one },
  tapeLine: { flexDirection: 'row', alignItems: 'baseline' },
  tapeValue: { width: 72 },
  tapeLabel: { flex: 1, textAlign: 'center' },
  right: { textAlign: 'right' },
  duelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, height: 24 },
  duelWhen: { width: 52 },
  duelScore: { width: 26 },
  duelTrack: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 14 },
  duelHalf: { flex: 1, height: 14, justifyContent: 'center' },
  duelBar: { height: 12, borderRadius: 6 },
  duelLeft: { alignSelf: 'flex-end' },
  duelAxis: { width: 2, height: 20 },
  moment: { flexGrow: 1, flexBasis: 150, padding: Spacing.three, borderRadius: Radius.lg, borderWidth: 2, gap: Spacing.half },
  momentEmoji: { fontSize: 30, lineHeight: 36 },
  momentTitle: { textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 },
  momentHeadline: { fontSize: 26, lineHeight: 32, fontWeight: '800' },
});
