import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import * as DropdownMenu from 'zeego/dropdown-menu';

import {
  type ChartPoint,
  type ChartStat,
  type Counts,
  type PlayerGame,
  SEASON_RATE_WARMUP,
  chartPoints,
  formatRate,
  isRateStat,
  rates,
} from '@core/player-stats.ts';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
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

/**
 * The dashed line: a level (his season rate, or his season average per game), or for running
 * totals his season pace, which climbs by `perGame` each game.
 */
type Reference = { level: number } | { perGame: number } | null;

/**
 * A player's games as a chart: one stat, per game (bars), as a running total (line) or, for rates,
 * running across the games shown (line).
 */
export function StatChart({ games, season }: { games: PlayerGame[]; season: Counts | null }) {
  const [stat, setStat] = useState<ChartStat>('tb');
  const [span, setSpan] = useState<Span>(30);
  const [total, setTotal] = useState(false);
  const info = STATS.find((s) => s.key === stat)!;
  const rate = isRateStat(stat);
  const running = !rate && total;
  const points = chartPoints(games, stat, span, { total: running });

  let reference: Reference = null;
  if (season && season.g) {
    if (rate) reference = { level: rates(season)[stat] ?? 0 };
    else reference = running ? { perGame: season[stat] / season.g } : { level: season[stat] / season.g };
  }

  let note: string;
  if (rate && span === null && games.length > SEASON_RATE_WARMUP) {
    note = `${info.name} for the season to date, from his ${SEASON_RATE_WARMUP + 1}th game on. Dashed: his season ${info.label}.`;
  } else if (rate) {
    note = `${info.name} across the games shown, game by game. Dashed: his season ${info.label}.`;
  } else if (running) {
    note = `His running total of ${info.name.toLowerCase()} across the games shown. Dashed: his season pace.`;
  } else {
    note = `${info.name} in each game. Dashed: his season average per game.`;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.controls}>
        <View style={styles.controlGroup}>
          <StatMenu value={stat} onChange={setStat} />
          {!rate && (
            <Toggle
              options={[
                { value: false, label: 'Per game' },
                { value: true, label: 'Total' },
              ]}
              value={total}
              onChange={setTotal}
            />
          )}
        </View>
        <Toggle
          options={SPANS.map((n) => ({ value: n, label: n === null ? 'Season' : `Last ${n}` }))}
          value={span}
          onChange={setSpan}
        />
      </View>
      <Plot
        key={`${stat}:${span}:${running}`}
        points={points}
        rate={rate}
        line={rate || running}
        label={info.label}
        reference={reference}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.note}>{note}</ThemedText>
    </View>
  );
}

function Plot({
  points,
  rate,
  line: asLine,
  label,
  reference,
}: {
  points: ChartPoint[];
  /** Values are rates (.312), not counts. */
  rate: boolean;
  /** A line through the games rather than a bar for each. */
  line: boolean;
  label: string;
  reference: Reference;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  // The game the readout describes; the latest one until he hovers or taps another.
  const [active, setActive] = useState(points.length - 1);
  const current = points[Math.min(active, points.length - 1)];

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  // Where the dashed line starts and ends, in data terms; the pace runs from game 1 to the last game.
  const refFrom = reference && ('level' in reference ? reference.level : reference.perGame);
  const refTo = reference && ('level' in reference ? reference.level : reference.perGame * points.length);
  const scale = rate
    ? rateScale([...values, ...(refFrom === null ? [] : [refFrom])])
    : countScale(asLine && refTo !== null ? [...values, refTo] : values);
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
              {asLine ? '  through ' : '  '}
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
            {reference && 'perGame' in reference && points.length > 1 && (
              <Line
                x1={x(0)}
                x2={x(points.length - 1)}
                y1={y(refFrom!)}
                y2={y(refTo!)}
                stroke={theme.textSecondary}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}
            {reference && 'level' in reference && reference.level >= scale.min && reference.level <= scale.max && (
              <Line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(reference.level)}
                y2={y(reference.level)}
                stroke={theme.textSecondary}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}
            {!asLine &&
              points.map((p, i) =>
                p.value ? (
                  <Path
                    key={i}
                    d={barPath(x(i) - barW / 2, y(p.value), barW, y(0) - y(p.value), Math.min(4, barW / 2))}
                    fill={theme.accent}
                  />
                ) : null,
              )}
            {asLine && line.length > 1 && (
              <Path
                d={`M${line.join('L')}`}
                fill="none"
                stroke={theme.accent}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {asLine && current?.value != null && (
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
        <View style={[styles.menuChip, { backgroundColor: theme.backgroundElement, boxShadow: theme.raised }]}>
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

function Toggle<T>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" elevation="sunken" style={styles.toggle}>
      {options.map((o) => (
        <Pressable
          key={o.label}
          onPress={() => onChange(o.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.value }}
          style={[styles.toggleItem, value === o.value && { backgroundColor: theme.background, boxShadow: theme.raised }]}>
          <ThemedText type="smallBold" themeColor={value === o.value ? 'text' : 'textSecondary'} style={styles.toggleText}>
            {o.label}
          </ThemedText>
        </Pressable>
      ))}
    </ThemedView>
  );
}

/** 0 up to a whole-number max, with up to five ticks on a round step (1, 2, 5, 10, 20, 25, 50 …). */
function countScale(values: number[]): { min: number; max: number; ticks: number[] } {
  const top = Math.max(4, ...values);
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  const step = steps.find((s) => Math.ceil(top / s) <= 4) ?? Math.ceil(top / 4);
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
  controlGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  menuChip: { paddingHorizontal: Spacing.two, paddingVertical: 4, borderRadius: Radius.md },
  toggle: { flexDirection: 'row', borderRadius: Radius.md, padding: 2 },
  toggleItem: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.sm },
  toggleText: { fontSize: 13 },
  readout: { fontSize: 13, lineHeight: 18 },
  plot: { height: HEIGHT, borderRadius: Radius.md, overflow: 'hidden' },
  targets: { position: 'absolute', flexDirection: 'row' },
  target: { flex: 1 },
  note: { fontSize: 12, lineHeight: 16 },
});
