import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { type GestureResponderEvent, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { SERIES, type ScoreStat } from '@core/scoreboard.ts';
import {
  type Bag,
  isDayEnd,
  nearestStop,
  roundLines,
  type Stop,
  stopPosition,
  stopsFor,
  type Timeline,
  type Vertices,
  valueAt,
  type Zoom,
} from '@core/timeline.ts';
import type { FantasyRound } from '@core/types.ts';

import { clipUrl, savantUrl } from '@/components/hit-videos';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { playerName, shortDate } from '@/lib/format';
import { type GameInfo, coreSpells } from '@/lib/scores';
import type { SeasonData } from '@/lib/season';
import { supabase } from '@/lib/supabase';
import { teamName } from '@/lib/teams';

const CHART_H = 120;
const BAR_H = 22;
const ZOOMS: Zoom[] = ['season', 'round', 'day'];
const EVENTS = { '1B': 'Single', '2B': 'Double', '3B': 'Triple', HR: 'Home run' } as const;

/** "Tue, Oct 7" */
const dayName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const colLabel = (g: GameInfo) => `${SERIES.find((s) => s.gameType === g.gameType)!.label}${g.seriesGameNumber}`;

/** The teams in a round (not knocked out before it). */
export function roundTeamIds(data: SeasonData, round: FantasyRound): string[] {
  return data.teams.filter((t) => t.eliminated_after_round === null || t.eliminated_after_round >= round).map((t) => t.id);
}

/**
 * Below the standings: the season as a race (each team's running round total, stepping up bag by
 * bag) with a slider under it that moves the standings to any moment. Zoomed out it stops at the
 * end of each game day; zoomed in on a round or a day, at every bag. Drag or tap anywhere on the
 * chart or the bar, or play it like a video: play, pause, a bag back or on, rewind or fast forward
 * (2×, 4×, 8×, back to 1×).
 * Paused on a bag, its videos (MLB's clip and Savant's) are a tap away under the readout.
 */
export function SeasonScrubber({
  data,
  timeline,
  games,
  stats,
  stop,
  latest,
  zoom,
  onStop,
  onZoom,
  playing,
  speed,
  direction,
  onPlay,
  onStepBack,
  onStep,
  onRewind,
  onFastForward,
}: {
  data: SeasonData;
  timeline: Timeline;
  games: GameInfo[];
  stats: ScoreStat[];
  /** Where the standings are. */
  stop: Stop;
  /** It's the latest moment (the standings keep up with live games). */
  latest: boolean;
  zoom: Zoom;
  onStop: (stop: Stop) => void;
  onZoom: (zoom: Zoom) => void;
  playing: boolean;
  /** Playback speed: 1, 2, 4 or 8. */
  speed: number;
  /** Playing forward (1) or in reverse (-1). */
  direction: 1 | -1;
  onPlay: () => void;
  /** Pauses and goes one bag back; undefined at the start. */
  onStepBack?: () => void;
  /** Pauses and goes one bag on; undefined at the end. */
  onStep?: () => void;
  onRewind: () => void;
  onFastForward: () => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [origin, setOrigin] = useState(0);
  const spells = coreSpells(data);
  const days = timeline.days;
  const day = days[stop.day];
  const round = day.round;
  const mine = data.myTeam?.id;
  const survivors = (r: FantasyRound) => data.season.survivors_after_round[r - 1] ?? roundTeamIds(data, r).length;
  const rounds = ([1, 2, 3] as FantasyRound[]).flatMap((r) => {
    const lines = roundLines(timeline, games, stats, spells, r, roundTeamIds(data, r), survivors(r));
    return lines ? [{ round: r, lines }] : [];
  });
  const current = rounds.find((r) => r.round === round);
  const shown = zoom === 'season' ? rounds : rounds.filter((r) => r.round === round);
  // The x axis runs over days: the whole season, the round, or one day.
  const [c0, c1]: [number, number] =
    zoom === 'season' ? [0, days.length] : zoom === 'round' && current ? [current.lines.from, current.lines.to] : [stop.day, stop.day + 1];
  const at = stopPosition(timeline, stop);
  const X = (p: number) => ((p - c0) / (c1 - c0)) * width;

  // The y scale: from 0 for the season or a round; for one day, from where the round stood before it.
  const everyLine = shown.flatMap((r) => [...r.lines.teams.values(), r.lines.cut].map((line) => ({ line, to: r.lines.to })));
  const top = Math.max(4, ...everyLine.map(({ line, to }) => valueAt(line, Math.min(c1, to))));
  const bottom = zoom === 'day' ? Math.min(...everyLine.map(({ line }) => valueAt(line, c0))) : 0;
  const vmax = Math.max(top, bottom + 4);
  const Y = (v: number) => CHART_H - 6 - ((v - bottom) / (vmax - bottom)) * (CHART_H - 14);

  // A step line between two x positions, as an SVG path.
  const path = (line: Vertices, from: number, to: number) => {
    if (to <= from) return '';
    const points: Vertices = [[from, valueAt(line, from)], ...line.filter(([x]) => x > from && x <= to), [to, valueAt(line, to)]];
    return points.map(([x, v], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  };
  const other = { color: theme.textSecondary, width: 1.5, dash: undefined, opacity: 0.55 };
  const drawn = shown.flatMap((r) => {
    const from = Math.max(c0, r.lines.from);
    const to = Math.min(c1, r.lines.to);
    if (to <= from) return [];
    const ids = [...r.lines.teams.keys()];
    const styled = [
      ...ids.filter((id) => id !== mine).map((id) => ({ key: `${r.round}${id}`, line: r.lines.teams.get(id)!, ...other })),
      ...(r.round < 3 ? [{ key: `${r.round}cut`, line: r.lines.cut, color: theme.danger, width: 1.5, dash: '4 3', opacity: 1 }] : []),
      ...ids.filter((id) => id === mine).map((id) => ({ key: `${r.round}${id}`, line: r.lines.teams.get(id)!, color: theme.accent, width: 2.5, dash: undefined, opacity: 1 })),
    ];
    return styled.map((s) => ({ ...s, past: path(s.line, from, Math.min(to, at)), future: path(s.line, Math.max(from, at), to) }));
  });

  // A point at the end of each day, and one per bag when zoomed in on a day.
  const dots = shown.flatMap((r) =>
    [...r.lines.teams.entries()].flatMap(([id, line]) => {
      const own = id === mine;
      const color = own ? theme.accent : theme.textSecondary;
      const ends = days
        .map((_, d) => d + 1)
        .filter((x) => x > Math.max(c0, r.lines.from) && x <= Math.min(c1, r.lines.to))
        .map((x) => ({ key: `${r.round}${id}e${x}`, x, v: valueAt(line, x), r: own ? 3 : 2, color, past: x <= at }));
      const bags =
        zoom === 'day'
          ? day.bags.flatMap((b, k) =>
              b.teamId === id && b.round === r.round
                ? [{ key: `${r.round}${id}b${k}`, x: stop.day + (k + 1) / day.bags.length, v: valueAt(line, stop.day + (k + 1) / day.bags.length), r: own ? 3.5 : 2.5, color, past: k < stop.bag }]
                : [],
            )
          : [];
      return [...ends, ...bags];
    }),
  );
  const cursorDots = current
    ? [...current.lines.teams.entries()].map(([id, line]) => ({ key: id, v: valueAt(line, at), own: id === mine }))
    : [];

  const dividers =
    zoom === 'season'
      ? rounds.slice(1).map((r) => ({ key: `r${r.round}`, x: r.lines.from, dashed: true }))
      : zoom === 'round'
        ? days.map((_, d) => d).filter((d) => d > c0 && d < c1).map((d) => ({ key: `d${d}`, x: d, dashed: false }))
        : [];
  const dayWidth = width / (c1 - c0);
  const ticks =
    zoom === 'season'
      ? rounds.map((r) => ({ key: `r${r.round}`, x: X(r.lines.from), text: `RD ${r.round}`, center: false, on: r.round === round }))
      : zoom === 'round'
        ? days
            .map((d, i) => ({ d, i }))
            .filter(({ i }) => i >= c0 && i < c1 && (dayWidth >= 36 || (i - c0) % 2 === 0))
            .map(({ d, i }) => ({ key: d.date, x: X(i + 0.5), text: shortDate(d.date), center: true, on: i === stop.day }))
        : [];
  const pieces = (zoom === 'season' ? rounds.map((r) => [r.lines.from, r.lines.to]) : [[c0, c1]]).map(([a, b]) => {
    const left = X(a) + (a > c0 ? 2 : 0);
    const right = X(b) - (b < c1 ? 2 : 0);
    return { key: `${a}`, left, width: right - left, fill: Math.max(0, Math.min(right - left, X(at) - left)) };
  });

  // What the cursor is on.
  const gameByPk = new Map(games.map((g) => [g.gamePk, g]));
  const played = [...new Set(day.gamePks.map((pk) => gameByPk.get(pk)).filter((g) => g !== undefined).map(colLabel))].join(', ');
  // On a bag: any stop but a day's end on the season (playback goes bag by bag there too).
  const bag = stop.bag > 0 && (zoom !== 'season' || !isDayEnd(timeline, stop)) ? day.bags[stop.bag - 1] : null;
  const anyLive = games.some((g) => g.status === 'Live');
  const champion = data.teams.some((t) => t.eliminated_after_round === 3);
  let main: string;
  let sub: string;
  if (bag) {
    const team = data.teams.find((t) => t.id === bag.teamId);
    const game = gameByPk.get(bag.gamePk);
    main = `${playerName(data, bag.playerId)} · ${EVENTS[bag.event]}`;
    sub = `${team ? teamName(team) : ''} +${bag.bags} · ${game ? colLabel(game) : ''} · ${new Date(bag.endedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } else if (!isDayEnd(timeline, stop)) {
    main = `${dayName(day.date)} · first pitch`;
    sub = played;
  } else if (latest) {
    main = `${anyLive ? 'Live' : champion ? 'Final' : 'Latest'} · ${dayName(day.date)}`;
    sub = played;
  } else {
    main = `Through ${dayName(day.date)}`;
    sub = played;
  }

  const list = stopsFor(timeline, zoom, stop);
  // The stop before or after this one (it can be between stops, when playback left it on a bag).
  const step = (by: number) => {
    const next = by > 0 ? list.find((s) => stopPosition(timeline, s) > at) : list.findLast((s) => stopPosition(timeline, s) < at);
    if (next) onStop(next);
  };
  const scrubTo = (x: number) => onStop(nearestStop(timeline, list, c0 + (Math.max(0, Math.min(width, x)) / width) * (c1 - c0)));
  const grant = (e: GestureResponderEvent) => {
    setOrigin(e.nativeEvent.pageX - e.nativeEvent.locationX);
    scrubTo(e.nativeEvent.locationX);
  };
  const hasBags = days.some((d) => d.bags.length > 0);

  return (
    <ThemedView type="backgroundElement" style={[styles.card, { boxShadow: theme.raised }]}>
      <View style={styles.head}>
        <View style={styles.readout}>
          <ThemedText type="smallBold" numberOfLines={2}>{main}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.sub}>{sub}</ThemedText>
          {bag && !playing && <BagVideos bag={bag} />}
        </View>
        <View accessibilityRole="tablist" accessibilityLabel="Zoom" style={[styles.zoom, { backgroundColor: theme.backgroundSelected, boxShadow: theme.sunken }]}>
          {ZOOMS.map((z) => {
            const on = z === zoom;
            const off = z !== 'season' && !hasBags;
            return (
              <Pressable
                key={z}
                accessibilityRole="tab"
                accessibilityState={{ selected: on, disabled: off }}
                accessibilityLabel={z === 'season' ? 'Season' : z === 'round' ? `Round ${round}` : dayName(day.date)}
                hitSlop={{ top: 10, bottom: 10, left: 2, right: 2 }}
                disabled={off}
                onPress={() => onZoom(z)}
                style={[styles.zoomButton, on && { backgroundColor: theme.segment, boxShadow: theme.raised }, off && styles.disabled]}>
                <ThemedText type="smallBold" style={[styles.zoomLabel, { color: on ? theme.text : theme.textSecondary }]}>
                  {z === 'season' ? 'Season' : z === 'round' ? (on ? `Rd ${round}` : 'Rd') : on ? shortDate(day.date) : 'Day'}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.plot} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={CHART_H}>
            {dividers.map((d) => (
              <Line key={d.key} x1={X(d.x)} x2={X(d.x)} y1={0} y2={CHART_H} stroke={theme.border} strokeWidth={1} strokeDasharray={d.dashed ? '3 3' : undefined} />
            ))}
            <Line x1={X(at)} x2={X(at)} y1={0} y2={CHART_H} stroke={theme.textSecondary} strokeWidth={1.5} />
            {drawn.map((l) => (
              <Path key={`${l.key}f`} d={l.future} fill="none" stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash} strokeOpacity={l.opacity * 0.35} strokeLinejoin="round" />
            ))}
            {drawn.map((l) => (
              <Path key={`${l.key}p`} d={l.past} fill="none" stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash} strokeOpacity={l.opacity} strokeLinejoin="round" />
            ))}
            {dots.map((d) => (
              <Circle key={d.key} cx={X(d.x)} cy={Y(d.v)} r={d.r} fill={d.color} opacity={d.past ? 1 : 0.3} />
            ))}
            {cursorDots.map((d) => (
              <Circle
                key={`c${d.key}`}
                cx={X(at)}
                cy={Y(d.v)}
                r={d.own ? 5 : 3.5}
                fill={d.own ? theme.accent : theme.textSecondary}
                stroke={theme.backgroundElement}
                strokeWidth={1.5}
              />
            ))}
          </Svg>
        )}
        <View style={styles.bar}>
          {pieces.map((p) => (
            <View key={p.key} style={[styles.track, { left: p.left, width: p.width, backgroundColor: theme.border }]}>
              <View style={[styles.fill, { width: p.fill, backgroundColor: theme.accent }]} />
            </View>
          ))}
          {width > 0 && <View style={[styles.knob, { left: X(at) - 9, backgroundColor: theme.accent, borderColor: theme.background, boxShadow: theme.raised }]} />}
        </View>
        <View
          style={[StyleSheet.absoluteFill, Platform.OS === 'web' && ({ touchAction: 'pan-y', cursor: 'pointer' } as object)]}
          onStartShouldSetResponder={() => true}
          onResponderGrant={grant}
          onResponderMove={(e) => scrubTo(e.nativeEvent.pageX - origin)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Standings over time"
          accessibilityValue={{ text: `${main}, ${sub}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        />
      </View>

      <View style={styles.ticks}>
        {ticks.map((t) => (
          <ThemedText
            key={t.key}
            style={[styles.tick, t.center ? [styles.centered, { left: t.x - 20 }] : { left: t.x }, { color: t.on ? theme.accent : theme.textSecondary }]}>
            {t.text}
          </ThemedText>
        ))}
        {zoom === 'day' && <ThemedText style={[styles.tick, { left: 0, color: theme.textSecondary }]}>FIRST PITCH</ThemedText>}
        {zoom === 'day' && (
          <ThemedText style={[styles.tick, styles.right, { color: theme.textSecondary }]}>{latest && anyLive ? 'NOW' : 'FINAL'}</ThemedText>
        )}
      </View>

      <View style={styles.footer}>
        {/* The transport, as on a video player: rewind, a bag back, play, a bag on, fast forward. */}
        <View style={[styles.transport, { backgroundColor: theme.background, boxShadow: theme.raised }]}>
          <Shuttle
            label="Rewind"
            icon={{ ios: 'backward.fill', android: 'fast_rewind', web: 'fast_rewind' }}
            speed={playing && direction < 0 ? speed : null}
            onPress={onRewind}
          />
          <TransportButton label="Previous bag" icon={{ ios: 'backward.end.fill', android: 'skip_previous', web: 'skip_previous' }} onPress={onStepBack} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play the season'}
            hitSlop={4}
            onPress={onPlay}
            style={[styles.play, { backgroundColor: theme.accent }]}>
            <SymbolView
              name={playing ? { ios: 'pause.fill', android: 'pause', web: 'pause' } : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
              size={16}
              tintColor={theme.accentText}
            />
          </Pressable>
          <TransportButton label="Next bag" icon={{ ios: 'forward.end.fill', android: 'skip_next', web: 'skip_next' }} onPress={onStep} />
          <Shuttle
            label="Fast forward"
            icon={{ ios: 'forward.fill', android: 'fast_forward', web: 'fast_forward' }}
            speed={playing && direction > 0 && speed > 1 ? speed : null}
            onPress={onFastForward}
          />
        </View>
        <View style={styles.legend}>
          <Key color={theme.accent} width={3} label="You" />
          <Key color={theme.textSecondary} width={1.5} label="Others" />
          {round < 3 && <Key color={theme.danger} width={1.5} dash label="Cut" />}
        </View>
      </View>
    </ThemedView>
  );
}

/**
 * A bag's videos, as links: MLB's clip once one is posted and Savant's, which comes the day after
 * the game. Loaded when playback stops on the bag (one hit, well under 1 KB), never while playing.
 * The row keeps its height while loading, so the card doesn't jump.
 */
function BagVideos({ bag }: { bag: Bag }) {
  const theme = useTheme();
  const [hit, setHit] = useState<{ playId: string; clip: string | null; savant: boolean; soon: boolean } | null>(null);
  useEffect(() => {
    let stale = false;
    supabase
      .from('mlb_hits')
      .select('clip_slug, savant_ready')
      .eq('play_id', bag.playId)
      .maybeSingle()
      .then(({ data }) => {
        if (stale) return;
        setHit({
          playId: bag.playId,
          clip: data?.clip_slug ?? null,
          savant: data?.savant_ready ?? false,
          // Savant posts a game's videos the next day; after that a missing one isn't coming.
          soon: Date.now() - new Date(bag.endedAt).getTime() < 36 * 3600_000,
        });
      });
    return () => {
      stale = true;
    };
  }, [bag.playId, bag.endedAt]);
  const loaded = hit?.playId === bag.playId ? hit : null;
  const chip = (label: string, url: string) => (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label} video`}
      hitSlop={{ top: 10, bottom: 10, left: 2, right: 2 }}
      onPress={() => Linking.openURL(url)}
      style={[styles.chip, { backgroundColor: theme.tint }]}>
      <SymbolView name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }} size={12} tintColor={theme.accent} />
      <ThemedText type="smallBold" themeColor="accent" style={styles.chipText}>{label}</ThemedText>
    </Pressable>
  );
  return (
    <View style={styles.videos}>
      {loaded?.clip && chip('MLB clip', clipUrl(loaded.clip))}
      {loaded?.savant && chip('Savant', savantUrl(bag.playId))}
      {loaded && !loaded.savant && loaded.soon && (
        <View style={[styles.chip, styles.pending, { borderColor: theme.textSecondary }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.chipText}>Savant video tomorrow</ThemedText>
        </View>
      )}
    </View>
  );
}

type Icon = SymbolViewProps['name'];

/** A bag back or on; disabled (no `onPress`) at the start or the end. */
function TransportButton({ label, icon, onPress }: { label: string; icon: Icon; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.transportButton, !onPress && styles.disabled]}>
      <SymbolView name={icon} size={18} tintColor={theme.text} />
    </Pressable>
  );
}

/** Rewind or fast forward, with the speed under it while it's the way playback is going. */
function Shuttle({ label, icon, speed, onPress }: { label: string; icon: Icon; speed: number | null; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={speed ? `${label}, playing at ${speed}×` : label}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={onPress}
      style={styles.transportButton}>
      <SymbolView name={icon} size={18} tintColor={speed ? theme.accent : theme.text} />
      {speed !== null && <ThemedText themeColor="accent" style={styles.speed}>{speed}×</ThemedText>}
    </Pressable>
  );
}

function Key({ color, width, dash, label }: { color: string; width: number; dash?: boolean; label: string }) {
  return (
    <View style={styles.key}>
      <Svg width={18} height={4}>
        <Line x1={1} x2={17} y1={2} y2={2} stroke={color} strokeWidth={width} strokeDasharray={dash ? '4 3' : undefined} strokeLinecap="round" />
      </Svg>
      <ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, padding: Spacing.two + 4, gap: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  readout: { flex: 1, minWidth: 0 },
  sub: { fontSize: 12, lineHeight: 15 },
  videos: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2, minHeight: 24, marginTop: Spacing.one + 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, height: 24, paddingHorizontal: 10, borderRadius: 12 },
  chipText: { fontSize: 12, lineHeight: 16 },
  pending: { borderWidth: 1, borderStyle: 'dashed' },
  zoom: { flexDirection: 'row', alignItems: 'center', height: 22, padding: 2, borderRadius: Radius.md },
  zoomButton: { height: 18, paddingHorizontal: 6, borderRadius: Radius.sm, justifyContent: 'center' },
  zoomLabel: { fontSize: 10, lineHeight: 12 },
  disabled: { opacity: 0.3 },
  plot: { height: CHART_H + BAR_H },
  bar: { height: BAR_H },
  track: { position: 'absolute', top: 8, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6 },
  knob: { position: 'absolute', top: 2, width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
  ticks: { height: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  transport: { flexDirection: 'row', alignItems: 'center', height: 32, paddingHorizontal: 2, borderRadius: 16 },
  play: { width: 28, height: 28, borderRadius: 14, marginHorizontal: 2, alignItems: 'center', justifyContent: 'center' },
  transportButton: { width: 30, height: 32, alignItems: 'center', justifyContent: 'center' },
  speed: { position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center', fontSize: 8, lineHeight: 9, fontWeight: 800 },
  tick: { position: 'absolute', top: 0, fontSize: 10, lineHeight: 14, fontWeight: 700, letterSpacing: 0.5 },
  centered: { width: 40, textAlign: 'center' },
  right: { right: 0 },
  legend: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', columnGap: Spacing.two + 2, rowGap: Spacing.one },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 12, lineHeight: 16 },
});
