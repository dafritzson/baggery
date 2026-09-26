import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import * as DropdownMenu from 'zeego/dropdown-menu';

import {
  ABSENCE_DAYS,
  type Absence,
  type ChartPoint,
  type ChartStat,
  type Counts,
  type PlayerGame,
  SEASON_RATE_WARMUP,
  type SeasonDates,
  absences,
  chartPoints,
  dayPositions,
  daysBetween,
  formatRate,
  isRateStat,
  rates,
  seasonLine,
} from '@core/player-stats.ts';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Toggle } from '@/components/toggle';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shortDate } from '@/lib/format';
import { dayKey } from '@/lib/game-day';

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
 * running across the games shown (line). The season view runs on the calendar, from opening day to
 * today, so the time he missed shows; the last-N views are one step per game.
 */
export function StatChart({
  games,
  season,
  dates,
}: {
  games: PlayerGame[];
  season: Counts | null;
  dates: SeasonDates | null;
}) {
  const [stat, setStat] = useState<ChartStat>('tb');
  const [span, setSpan] = useState<Span>(30);
  const [total, setTotal] = useState(false);
  const info = STATS.find((s) => s.key === stat)!;
  const rate = isRateStat(stat);
  const running = !rate && total;
  const points = chartPoints(games, stat, span, { total: running });
  const axis = span === null && dates && games.length ? seasonAxis(dates, games) : null;
  const gaps = axis ? absences(games, axis.start, axis.end) : [];

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
  } else if (running && axis) {
    note = `His running total of ${info.name.toLowerCase()} since opening day. Dashed: a steady pace from opening day to his total now.`;
  } else if (running) {
    note = `His running total of ${info.name.toLowerCase()} across the games shown. Dashed: his season pace.`;
  } else {
    note = `${info.name} in each game. Dashed: his season average per game.`;
  }
  if (gaps.length) note += ` Shaded: ${ABSENCE_DAYS} or more days without a game.`;

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
        fromZero={running}
        label={info.label}
        reference={reference}
        axis={axis}
        gaps={gaps}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.note}>{note}</ThemedText>
    </View>
  );
}

/**
 * The season chart's calendar: opening day to today, or to the last day of a finished season.
 * Stretched to cover every game, in case a clock or time zone puts today behind his latest game.
 */
function seasonAxis(dates: SeasonDates, games: PlayerGame[]): SeasonDates {
  const today = dayKey(new Date().toISOString());
  const played = games.map((g) => g.date).sort();
  const end = today < dates.end ? today : dates.end;
  return {
    start: played[0] < dates.start ? played[0] : dates.start,
    end: played.at(-1)! > end ? played.at(-1)! : end,
  };
}

/** A game's slot on the chart, or a stretch without games, that the readout can describe. */
type Selection = { game: number } | { gap: number };

function Plot({
  points,
  rate,
  line: asLine,
  fromZero,
  label,
  reference,
  axis,
  gaps,
}: {
  points: ChartPoint[];
  /** Values are rates (.312), not counts. */
  rate: boolean;
  /** A line through the games rather than a bar for each. */
  line: boolean;
  /** On the calendar, the line starts at 0 on opening day (running totals). */
  fromZero: boolean;
  label: string;
  reference: Reference;
  /** Plot on the calendar between these days, rather than one step per game. */
  axis: SeasonDates | null;
  /** Stretches without a game, shaded on the calendar. */
  gaps: Absence[];
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  // What the readout describes; the latest game until he hovers or taps something else.
  const [selected, setSelected] = useState<Selection>({ game: points.length - 1 });
  const gap = 'gap' in selected ? gaps[selected.gap] : undefined;
  const current = 'game' in selected ? points[Math.min(selected.game, points.length - 1)] : undefined;

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  // Positions are in days from opening day on the calendar, or in games; `unit` is one of them in px.
  const days = axis ? daysBetween(axis.start, axis.end) + 1 : points.length;
  const unit = days ? plotW / days : 0;
  const positions = axis ? dayPositions(points, axis.start) : points.map((_, i) => i + 0.5);
  const perDate = new Map<string, number>();
  if (axis) for (const p of points) perDate.set(p.game.date, (perDate.get(p.game.date) ?? 0) + 1);
  // How wide each game's slot is: a day, or half of one for each game of a doubleheader.
  const slotW = (i: number) => unit / (perDate.get(points[i].game.date) ?? 1);
  const x = (pos: number) => PAD.left + unit * pos;
  const gapLeft = (g: Absence) => x(daysBetween(axis!.start, g.from));
  const gapRight = (g: Absence) => x(daysBetween(axis!.start, g.to) + 1);

  const vertices: [number, number][] = axis
    ? seasonLine(points, axis.start, axis.end, { fromZero })
    : points.flatMap((p, i) => (p.value === null ? [] : [[positions[i], p.value] as [number, number]]));

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  // Where the dashed line starts and ends, in data terms. The pace runs from game 1 to the last
  // game, or on the calendar from 0 on opening day to his total now.
  const refFrom = reference && ('level' in reference ? reference.level : axis ? 0 : reference.perGame);
  const refTo = reference && ('level' in reference ? reference.level : reference.perGame * points.length);
  const scale = rate
    ? rateScale([...values, ...(refFrom === null ? [] : [refFrom])])
    : countScale(asLine && refTo !== null ? [...values, refTo] : values);
  const y = (v: number) => PAD.top + plotH * (1 - (v - scale.min) / (scale.max - scale.min));
  const format = (v: number) => (rate ? formatRate(v) : Number.isInteger(v) ? String(v) : v.toFixed(1));
  const path = vertices.map(([pos, v]) => `${x(pos).toFixed(1)},${y(v).toFixed(1)}`);

  const currentIndex = current ? points.indexOf(current) : -1;
  // On a line, a stretch without games reads as where the line sat through it.
  const gapValue = gap && asLine ? valueBefore(points, gap.from, fromZero) : null;

  // Hit targets, left to right, each reaching halfway to its neighbours so the plot has no dead spots.
  const spots = [
    ...points.map((_, i) => ({ select: { game: i } as Selection, l: x(positions[i]) - slotW(i) / 2, r: x(positions[i]) + slotW(i) / 2 })),
    ...gaps.map((g, k) => ({ select: { gap: k } as Selection, l: gapLeft(g), r: gapRight(g) })),
  ].sort((a, b) => a.l - b.l);
  const targets = spots.map((s, j) => {
    const left = j === 0 ? PAD.left : (spots[j - 1].r + s.l) / 2;
    const right = j === spots.length - 1 ? width - PAD.right : (s.r + spots[j + 1].l) / 2;
    return { select: s.select, left: left - PAD.left, width: Math.max(0, right - left) };
  });

  return (
    <View>
      <ThemedText type="small" style={styles.readout} numberOfLines={1}>
        {gap ? (
          <>
            <ThemedText type="smallBold">{asLine ? `${gapValue === null ? '—' : format(gapValue)} ${label}` : 'No games'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {asLine ? '  no games ' : '  '}
              {gapRange(gap)} · {gap.days} days
            </ThemedText>
          </>
        ) : current ? (
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
            {gaps.map((g, k) => (
              <Rect
                key={`g${g.from}`}
                x={gapLeft(g)}
                y={PAD.top}
                width={gapRight(g) - gapLeft(g)}
                height={plotH}
                fill={theme.backgroundSelected}
                opacity={gap === gaps[k] ? 1 : 0.6}
              />
            ))}
            {gaps.map((g) =>
              gapRight(g) - gapLeft(g) >= 60 ? (
                <SvgText
                  key={`gl${g.from}`}
                  x={(gapLeft(g) + gapRight(g)) / 2}
                  y={PAD.top + 14}
                  fontSize={10}
                  fontFamily={FONT}
                  fill={theme.textSecondary}
                  textAnchor="middle">
                  No games
                </SvgText>
              ) : null,
            )}
            {currentIndex >= 0 && (
              <Rect
                x={x(positions[currentIndex]) - Math.max(2, slotW(currentIndex)) / 2}
                y={PAD.top}
                width={Math.max(2, slotW(currentIndex))}
                height={plotH}
                fill={theme.backgroundSelected}
              />
            )}
            {reference && 'perGame' in reference && points.length > 1 && (
              <Line
                x1={axis ? x(0) : x(positions[0])}
                x2={axis ? x(days) : x(positions[points.length - 1])}
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
              points.map((p, i) => {
                if (!p.value) return null;
                const barW = Math.min(24, Math.max(2, slotW(i) - 2));
                return (
                  <Path
                    key={i}
                    d={barPath(x(positions[i]) - barW / 2, y(p.value), barW, y(0) - y(p.value), Math.min(4, barW / 2))}
                    fill={theme.accent}
                  />
                );
              })}
            {asLine && path.length > 1 && (
              <Path
                d={`M${path.join('L')}`}
                fill="none"
                stroke={theme.accent}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {asLine && current?.value != null && (
              <Rect
                x={x(positions[currentIndex]) - 4}
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
            {axis
              ? monthLabels(axis).map((m) => {
                  const edge = x(m.from);
                  const mid = (edge + x(m.to)) / 2;
                  return (
                    <SvgText key={m.label} x={mid} y={HEIGHT - 6} fontSize={11} fontFamily={FONT} fill={theme.textSecondary} textAnchor="middle">
                      {x(m.to) - edge >= 24 ? m.label : ''}
                    </SvgText>
                  );
                })
              : labelIndexes(points.length, plotW).map((i) => (
                  <SvgText
                    key={`d${i}`}
                    // The end labels line up with the plot's edges so they aren't cut off.
                    x={i === points.length - 1 ? width - PAD.right : i === 0 ? PAD.left : x(positions[i])}
                    y={HEIGHT - 6}
                    fontSize={11}
                    fontFamily={FONT}
                    fill={theme.textSecondary}
                    textAnchor={i === points.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>
                    {shortDate(points[i].game.date)}
                  </SvgText>
                ))}
            {axis &&
              monthLabels(axis)
                .slice(1)
                .map((m) => (
                  <Line
                    key={`t${m.label}`}
                    x1={x(m.from)}
                    x2={x(m.from)}
                    y1={y(scale.min)}
                    y2={y(scale.min) + 4}
                    stroke={theme.textSecondary}
                    strokeWidth={1}
                  />
                ))}
          </Svg>
        )}
        {/* A hit target for each game and each stretch without one, the full height of the plot: hover on web, tap on phones. */}
        <View style={[styles.targets, { left: PAD.left, right: PAD.right, top: PAD.top, height: plotH }]}>
          {targets.map((t) => {
            let key: string;
            let description: string;
            if ('game' in t.select) {
              const p = points[t.select.game];
              key = `${p.game.date}:${t.select.game}`;
              description = `${shortDate(p.game.date)}: ${p.value === null ? 'no at-bats' : format(p.value)} ${label}`;
            } else {
              const g = gaps[t.select.gap];
              key = `gap:${g.from}`;
              description = `No games ${gapRange(g)}, ${g.days} days`;
            }
            return (
              <Pressable
                key={key}
                style={[styles.target, { left: t.left, width: t.width }]}
                onHoverIn={() => setSelected(t.select)}
                onPress={() => setSelected(t.select)}
                accessibilityLabel={description}
              />
            );
          })}
        </View>
      </ThemedView>
    </View>
  );
}

/** "6/6 – 9/11". */
function gapRange(g: Absence): string {
  return `${shortDate(g.from)} – ${shortDate(g.to)}`;
}

/** Where the line sat on the day before `date`: the last value before it, or 0 for a running total. */
function valueBefore(points: ChartPoint[], date: string, fromZero: boolean): number | null {
  let value: number | null = fromZero ? 0 : null;
  for (const p of points) if (p.game.date < date && p.value !== null) value = p.value;
  return value;
}

/** Each month the calendar touches, as days from its start (clipped to the axis), with its name. */
function monthLabels(axis: SeasonDates): { label: string; from: number; to: number }[] {
  const out: { label: string; from: number; to: number }[] = [];
  const last = daysBetween(axis.start, axis.end) + 1;
  let first = axis.start;
  while (first <= axis.end) {
    const [y, m] = first.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    out.push({ label: MONTHS[m - 1], from: daysBetween(axis.start, first), to: Math.min(last, daysBetween(axis.start, next)) });
    first = next;
  }
  return out;
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
  toggleText: { fontSize: 13 },
  readout: { fontSize: 13, lineHeight: 18 },
  plot: { height: HEIGHT, borderRadius: Radius.md, overflow: 'hidden' },
  targets: { position: 'absolute' },
  target: { position: 'absolute', top: 0, bottom: 0 },
  note: { fontSize: 12, lineHeight: 16 },
});
