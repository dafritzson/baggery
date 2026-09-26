import { type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Radius, Spacing } from '@/constants/theme';
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
export function TapeRow({ label, a, b, format = String, lowerWins = false, neutral = false, help }: {
  label: string;
  a: number;
  b: number;
  format?: (n: number) => string;
  lowerWins?: boolean;
  /** A style stat with no better side: no arrows. */
  neutral?: boolean;
  help?: string;
}) {
  const colors = useDuelColors();
  // Bars need positive sizes; signed stats (bags above average) are shifted to start at zero.
  const shift = Math.min(a, b, 0);
  const [pa, pb] = [a - shift + 0.01, b - shift + 0.01];
  const [x, y] = lowerWins ? [1 / pa, 1 / pb] : [pa, pb];
  // No winner when they look the same once formatted (e.g. both "−0.1").
  const better = neutral || format(a) === format(b) ? null : (a < b) === lowerWins ? 'a' : 'b';
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
      {help && <ThemedText type="small" themeColor="textSecondary" style={styles.help}>{help}</ThemedText>}
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
            <SvgText fontFamily={Fonts.sans} key={p} x={4} y={y(p) + 4} fontSize={10} fill={theme.textSecondary}>{`${p}`}</SvgText>
          ))}
          <Line x1={pad.l} x2={width - pad.r} y1={y(1)} y2={y(1)} stroke={theme.border} strokeDasharray="3 4" />
          {years.map((yr, i) => (
            <SvgText fontFamily={Fonts.sans} key={yr} x={x(i)} y={height - 6} fontSize={10} fill={theme.textSecondary} textAnchor="middle">{`’${String(yr).slice(2)}`}</SvgText>
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
                <SvgText fontFamily={Fonts.sans} key={`${side}${yr}`} x={x(i)} y={y(1) + 6} fontSize={18} textAnchor="middle">🏆</SvgText>
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

/** Up to 4 round numbers covering [lo, hi], for axis labels. */
function ticks(lo: number, hi: number): number[] {
  const span = hi - lo || 1;
  const step = [1, 2, 5, 10, 20, 25, 50].find((s) => span / s <= 4) ?? 100;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/**
 * A value per year for each manager, as lines with dots, over a dashed league line when given.
 * Years a manager sat out leave a gap in their line.
 */
export function YearLineChart({ years, series, baseline, format = (n) => n.toFixed(0) }: {
  years: number[];
  series: { key: string; color: string; values: Map<number, number> }[];
  /** The league's value each year, drawn dashed behind the managers. */
  baseline?: Map<number, number>;
  format?: (n: number) => string;
}) {
  const theme = useTheme();
  const [width, onLayout] = useWidth();
  const height = 210;
  const pad = { l: 34, r: 14, t: 14, b: 26 };
  const all = [...series.flatMap((s) => [...s.values.values()]), ...(baseline ? [...baseline.values()] : [])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const range = { lo: lo - (hi - lo) * 0.1 - 0.5, hi: hi + (hi - lo) * 0.1 + 0.5 };
  const x = (i: number) => pad.l + (years.length === 1 ? 0.5 : i / (years.length - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - range.lo) / (range.hi - range.lo)) * (height - pad.t - pad.b);
  const runs = (m: Map<number, number>) => {
    const out: string[] = [];
    let run: string[] = [];
    years.forEach((yr, i) => {
      const v = m.get(yr);
      if (v === undefined) {
        if (run.length) out.push(run.join(' '));
        run = [];
      } else run.push(`${x(i)},${y(v)}`);
    });
    if (run.length) out.push(run.join(' '));
    return out;
  };
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {ticks(range.lo, range.hi).map((t) => (
            <Line key={t} x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={theme.border} strokeWidth={t === 0 ? 1.5 : 0.5} />
          ))}
          {ticks(range.lo, range.hi).map((t) => (
            <SvgText fontFamily={Fonts.sans} key={`l${t}`} x={pad.l - 6} y={y(t) + 4} fontSize={10} fill={theme.textSecondary} textAnchor="end">{format(t)}</SvgText>
          ))}
          {years.map((yr, i) => (
            <SvgText fontFamily={Fonts.sans} key={yr} x={x(i)} y={height - 6} fontSize={10} fill={theme.textSecondary} textAnchor="middle">{`’${String(yr).slice(2)}`}</SvgText>
          ))}
          {baseline &&
            runs(baseline).map((pts, i) => (
              <Polyline key={`base${i}`} points={pts} fill="none" stroke={theme.textSecondary} strokeWidth={2} strokeDasharray="4 5" opacity={0.6} />
            ))}
          {series.map((s) =>
            runs(s.values).map((pts, i) => (
              <Polyline key={`${s.key}${i}`} points={pts} fill="none" stroke={s.color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            )),
          )}
          {series.map((s) =>
            years.map((yr, i) => {
              const v = s.values.get(yr);
              return v === undefined ? null : (
                <Circle key={`${s.key}${yr}`} cx={x(i)} cy={y(v)} r={5} fill={s.color} stroke={theme.backgroundElement} strokeWidth={2} />
              );
            }),
          )}
        </Svg>
      )}
    </View>
  );
}

/**
 * Each round's bags, side by side: for every year, a pair of bars per round (round 1, 2, 3 left
 * to right), each manager in their color. A missing bar means they were already out.
 */
export function RoundBarsChart({ years, a, b, colors }: {
  years: number[];
  /** bags by year, then by round. */
  a: Map<number, Map<number, number>>;
  b: Map<number, Map<number, number>>;
  colors: { a: string; b: string };
}) {
  const theme = useTheme();
  const [width, onLayout] = useWidth();
  const height = 190;
  const pad = { t: 16, b: 26 };
  const most = Math.max(1, ...[a, b].flatMap((m) => [...m.values()].flatMap((r) => [...r.values()])));
  const group = width / Math.max(years.length, 1);
  const slot = (group * 0.86) / 3;
  const bar = Math.max(2, slot * 0.38);
  const h = (v: number) => (v / most) * (height - pad.t - pad.b);
  const base = height - pad.b;
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Line x1={0} x2={width} y1={base} y2={base} stroke={theme.border} />
          {years.map((yr, gi) => {
            const left = gi * group + group * 0.07;
            return [1, 2, 3].map((round) => {
              const x0 = left + (round - 1) * slot + (slot - bar * 2 - 2) / 2;
              const va = a.get(yr)?.get(round);
              const vb = b.get(yr)?.get(round);
              return [
                va !== undefined && <Rect key={`a${yr}${round}`} x={x0} y={base - h(va)} width={bar} height={Math.max(1, h(va))} rx={2} fill={colors.a} />,
                vb !== undefined && <Rect key={`b${yr}${round}`} x={x0 + bar + 2} y={base - h(vb)} width={bar} height={Math.max(1, h(vb))} rx={2} fill={colors.b} />,
              ];
            });
          })}
          {years.map((yr, gi) => (
            <SvgText fontFamily={Fonts.sans} key={yr} x={gi * group + group / 2} y={height - 8} fontSize={10} fill={theme.textSecondary} textAnchor="middle">{`’${String(yr).slice(2)}`}</SvgText>
          ))}
        </Svg>
      )}
    </View>
  );
}

/**
 * A radar ("spider") chart: one axis per skill, each manager's shape filled in their color. Values
 * run 0 (center) to 1 (edge).
 */
export function RadarChart({ axes, shapes }: { axes: string[]; shapes: { key: string; color: string; values: number[] }[] }) {
  const theme = useTheme();
  const [width, onLayout] = useWidth();
  const height = 280;
  const cx = width / 2;
  const cy = height / 2;
  // Room at the sides for the axis labels.
  const radius = Math.min(width / 2 - 92, height / 2 - 30);
  const point = (i: number, v: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
    return [cx + Math.cos(angle) * radius * v, cy + Math.sin(angle) * radius * v] as const;
  };
  const ring = (v: number) => axes.map((_, i) => point(i, v).join(',')).join(' ');
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && radius > 0 && (
        <Svg width={width} height={height}>
          {[0.25, 0.5, 0.75, 1].map((v) => (
            <Polygon key={v} points={ring(v)} fill="none" stroke={theme.border} strokeWidth={v === 1 ? 1.5 : 0.75} />
          ))}
          {axes.map((label, i) => {
            const [x, y] = point(i, 1);
            const [lx, ly] = point(i, 1.16);
            return (
              <G key={label}>
                <Line x1={cx} y1={cy} x2={x} y2={y} stroke={theme.border} strokeWidth={0.75} />
                <SvgText fontFamily={Fonts.sans} x={lx} y={ly + 4} fontSize={11} fontWeight="700" fill={theme.textSecondary} textAnchor={Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end'}>
                  {label}
                </SvgText>
              </G>
            );
          })}
          {shapes.map((s) => (
            <Polygon
              key={s.key}
              points={s.values.map((v, i) => point(i, v).join(',')).join(' ')}
              fill={s.color}
              fillOpacity={0.25}
              stroke={s.color}
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          ))}
          {shapes.map((s) =>
            s.values.map((v, i) => {
              const [x, y] = point(i, v);
              return <Circle key={`${s.key}${i}`} cx={x} cy={y} r={3.5} fill={s.color} />;
            }),
          )}
        </Svg>
      )}
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
  help: { fontSize: 11, lineHeight: 14, textAlign: 'center' },
  tapeLabel: { flex: 1, textAlign: 'center' },
  right: { textAlign: 'right' },
  moment: { flexGrow: 1, flexBasis: 150, padding: Spacing.three, borderRadius: Radius.lg, borderWidth: 2, gap: Spacing.half },
  momentEmoji: { fontSize: 30, lineHeight: 36 },
  momentTitle: { textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 },
  momentHeadline: { fontSize: 26, lineHeight: 32, fontWeight: '800' },
});
