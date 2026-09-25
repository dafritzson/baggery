import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import * as DropdownMenu from 'zeego/dropdown-menu';

import {
  type ChartPoint,
  type ChartStat,
  type Counts,
  type PlayerGame,
  chartPoints,
  formatRate,
  isRateStat,
  rates,
} from '@core/player-stats.ts';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shortDate } from '@/lib/format';

const STATS: { key: ChartStat; label: string; name: string }[] = [
  { key: 'tb', label: 'TB', name: 'Total bases' },
  { key: 'h', label: 'H', name: 'Hits' },
  { key: 'hr', label: 'HR', name: 'Home runs' },
  { key: 'rbi', label: 'RBI', name: 'Runs batted in' },
  { key: 'r', label: 'R', name: 'Runs' },
  { key: 'bb', label: 'BB', name: 'Walks' },
  { key: 'so', label: 'SO', name: 'Strikeouts' },
  { key: 'avg', label: 'AVG', name: 'Batting average' },
  { key: 'obp', label: 'OBP', name: 'On-base percentage' },
  { key: 'slg', label: 'SLG', name: 'Slugging percentage' },
  { key: 'ops', label: 'OPS', name: 'On-base plus slugging' },
];

/** Last 7/15/30 games, or the whole season (null). */
const SPANS = [7, 15, 30, null] as const;
type Span = (typeof SPANS)[number];

const HEIGHT = 168;
const PAD = { top: 12, right: 8, bottom: 22, left: 40 };
// SVG text doesn't inherit the page font on web.
const FONT = Platform.OS === 'web' ? 'Spline Sans, Inter, system-ui, sans-serif' : undefined;

/** A player's games as a chart: one stat, per game (bars) or running across the games shown (line). */
export function StatChart({ games, season }: { games: PlayerGame[]; season: Counts | null }) {
  const [stat, setStat] = useState<ChartStat>('tb');
  const [span, setSpan] = useState<Span>(30);
  const points = chartPoints(games, stat, span);
  const info = STATS.find((s) => s.key === stat)!;
  const rate = isRateStat(stat);

  // The season's figure as a dashed reference: its rate, or its per-game average for a count.
  const reference = season && season.g ? (rate ? rates(season)[stat] : season[stat] / season.g) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.controls}>
        <StatMenu value={stat} onChange={setStat} />
        <SpanToggle value={span} onChange={setSpan} />
      </View>
      <Plot key={`${stat}:${span}`} points={points} rate={rate} label={info.label} reference={reference} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
        {rate
          ? `${info.name} across the games shown, game by game. Dashed: his season ${info.label}.`
          : `${info.name} in each game. Dashed: his season average per game.`}
      </ThemedText>
    </View>
  );
}

function Plot({
  points,
  rate,
  label,
  reference,
}: {
  points: ChartPoint[];
  rate: boolean;
  label: string;
  reference: number | null;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  // The game the readout describes; the latest one until he hovers or taps another.
  const [active, setActive] = useState(points.length - 1);
  const current = points[Math.min(active, points.length - 1)];

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const scale = rate ? rateScale([...values, ...(reference === null ? [] : [reference])]) : countScale(values);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = points.length ? plotW / points.length : 0;
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const y = (v: number) => PAD.top + plotH * (1 - (v - scale.min) / (scale.max - scale.min));
  const format = (v: number) => (rate ? formatRate(v) : Number.isInteger(v) ? String(v) : v.toFixed(1));

  const barW = Math.min(24, Math.max(2, slot - 2));
  const line = points
    .map((p, i) => (p.value === null ? null : `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`))
    .filter(Boolean);
  const dateLabels = labelIndexes(points.length, plotW);
  const activeIndex = points.indexOf(current);

  return (
    <View>
      <ThemedText type="small" style={styles.readout} numberOfLines={1}>
        {current ? (
          <>
            <ThemedText type="smallBold">{current.value === null ? '—' : format(current.value)} {label}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {rate ? '  through ' : '  '}
              {shortDate(current.game.date)} {current.game.home ? 'vs' : '@'} {current.game.opponent} · {current.game.h}-for-
              {current.game.ab}
            </ThemedText>
          </>
        ) : (
          ' '
        )}
      </ThemedText>
      <ThemedView
        type="backgroundElement"
        style={styles.plot}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`${label} chart`}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            {scale.ticks.map((t) => (
              <Line
                key={t}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={theme.border}
                strokeWidth={1}
              />
            ))}
            {scale.ticks.map((t) => (
              <SvgText
                key={`l${t}`}
                x={PAD.left - 6}
                y={y(t) + 4}
                fontSize={11}
                fontFamily={FONT}
                fill={theme.textSecondary}
                textAnchor="end">
                {rate ? formatRate(t) : String(t)}
              </SvgText>
            ))}
            {activeIndex >= 0 && (
              <Rect
                x={PAD.left + slot * activeIndex}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill={theme.backgroundSelected}
              />
            )}
            {reference !== null && reference >= scale.min && reference <= scale.max && (
              <Line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(reference)}
                y2={y(reference)}
                stroke={theme.textSecondary}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}
            {!rate &&
              points.map((p, i) =>
                p.value ? (
                  <Path
                    key={i}
                    d={barPath(x(i) - barW / 2, y(p.value), barW, y(0) - y(p.value), Math.min(4, barW / 2))}
                    fill={theme.accent}
                  />
                ) : null,
              )}
            {rate && line.length > 1 && (
              <Path
                d={`M${line.join('L')}`}
                fill="none"
                stroke={theme.accent}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {rate && current?.value != null && (
              <Rect
                x={x(activeIndex) - 4}
                y={y(current.value) - 4}
                width={8}
                height={8}
                rx={4}
                fill={theme.accent}
                stroke={theme.backgroundElement}
                strokeWidth={2}
              />
            )}
            <Line x1={PAD.left} x2={width - PAD.right} y1={y(scale.min)} y2={y(scale.min)} stroke={theme.textSecondary} strokeWidth={1} />
            {dateLabels.map((i) => (
              <SvgText
                key={`d${i}`}
                // The end labels line up with the plot's edges so they aren't cut off.
                x={i === points.length - 1 ? width - PAD.right : i === 0 ? PAD.left : x(i)}
                y={HEIGHT - 6}
                fontSize={11}
                fontFamily={FONT}
                fill={theme.textSecondary}
                textAnchor={i === points.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>
                {shortDate(points[i].game.date)}
              </SvgText>
            ))}
          </Svg>
        )}
        {/* One hit target per game, the full height of the plot: hover on web, tap on phones. */}
        <View style={[styles.targets, { left: PAD.left, right: PAD.right, top: PAD.top, height: plotH }]}>
          {points.map((p, i) => (
            <Pressable
              key={p.game.date + i}
              style={styles.target}
              onHoverIn={() => setActive(i)}
              onPress={() => setActive(i)}
              accessibilityLabel={`${shortDate(p.game.date)}: ${p.value === null ? 'no at-bats' : format(p.value)} ${label}`}
            />
          ))}
        </View>
      </ThemedView>
    </View>
  );
}

function StatMenu({ value, onChange }: { value: ChartStat; onChange: (s: ChartStat) => void }) {
  const theme = useTheme();
  const current = STATS.find((s) => s.key === value)!;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="menu-trigger menu-trigger-chip" aria-label={`Stat: ${current.name}, change stat`}>
        <View style={[styles.menuChip, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" style={styles.toggleText}>{current.label} ▾</ThemedText>
        </View>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        className="menu-content menu-content-narrow menu-content-over-modal"
        align="start"
        sideOffset={6}
        collisionPadding={8}>
        {STATS.map((s) => (
          <DropdownMenu.CheckboxItem
            key={s.key}
            className="menu-item"
            value={s.key === value ? 'on' : 'off'}
            onValueChange={() => onChange(s.key)}>
            <DropdownMenu.ItemTitle>{`${s.label} · ${s.name}`}</DropdownMenu.ItemTitle>
            <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function SpanToggle({ value, onChange }: { value: Span; onChange: (s: Span) => void }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={styles.toggle}>
      {SPANS.map((n) => (
        <Pressable
          key={String(n)}
          onPress={() => onChange(n)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === n }}
          style={[styles.toggleItem, value === n && { backgroundColor: theme.background }]}>
          <ThemedText type="smallBold" themeColor={value === n ? 'text' : 'textSecondary'} style={styles.toggleText}>
            {n === null ? 'Season' : `Last ${n}`}
          </ThemedText>
        </Pressable>
      ))}
    </ThemedView>
  );
}

/** 0 up to a whole-number max, with a few whole-number ticks. */
function countScale(values: number[]): { min: number; max: number; ticks: number[] } {
  const top = Math.max(4, ...values);
  const step = top <= 4 ? 1 : top <= 8 ? 2 : Math.ceil(top / 4);
  const max = Math.ceil(top / step) * step;
  const ticks = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { min: 0, max, ticks };
}

/** A padded range around the rates, on a round step (.050, .100, .250 …). */
function rateScale(values: number[]): { min: number; max: number; ticks: number[] } {
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1].find((s) => (hi - lo) / s <= 4) ?? 1;
  const min = Math.max(0, Math.floor(lo / step) * step);
  const max = Math.max(min + step, Math.ceil(hi / step) * step);
  const ticks = [];
  for (let i = 0; min + i * step <= max + 1e-9; i++) ticks.push(Number((min + i * step).toFixed(3)));
  return { min, max, ticks };
}

/** A bar with its top corners rounded and its bottom square on the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Which games get a date under the axis: evenly spaced, always the latest, ~64px apart. */
function labelIndexes(count: number, width: number): number[] {
  if (!count || !width) return [];
  const fit = Math.max(1, Math.floor(width / 64));
  const every = Math.ceil(count / fit);
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= every) out.unshift(i);
  return out;
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  menuChip: { paddingHorizontal: Spacing.two, paddingVertical: 4, borderRadius: Spacing.two },
  toggle: { flexDirection: 'row', borderRadius: Spacing.two, padding: 2 },
  toggleItem: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Spacing.one + 2 },
  toggleText: { fontSize: 13 },
  readout: { fontSize: 13, lineHeight: 18 },
  plot: { height: HEIGHT, borderRadius: Spacing.two, overflow: 'hidden' },
  targets: { position: 'absolute', flexDirection: 'row' },
  target: { flex: 1 },
  note: { fontSize: 12, lineHeight: 16 },
});
