import { LuckiestGuy_400Regular, useFonts } from '@expo-google-fonts/luckiest-guy';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { BAG_EMOJI, type BagHit, bagKey, bagSummary, hitHeadline, ordinal, rainCount, shakeStrength } from '@core/bag-celebration.ts';

import { GAME_FONT } from '@/components/bag-game';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type Celebration, useBagCelebrations } from '@/lib/bag-celebrations';
import { headshotUrl, mlbTeamAbbr, playerName } from '@/lib/format';
import { useOpenPlayer } from '@/lib/player';
import { coreSpells, useScores } from '@/lib/scores';
import { shakeScreen } from '@/lib/screen-shake';
import { useSeason } from '@/lib/season';
import { teamName } from '@/lib/teams';

/** How long the popup stays up, unless it's closed or held. */
const SHOW_MS = 5000;
const FADE_MS = 400;
/** The popup comes in once the rain is going, and lands with a shake of the screen. */
const POPUP_DELAY_MS = 500;
/** Bags keep starting to fall for this long, so the last land about as the popup goes. */
const RAIN_MS = 3200;
/** The app icon's emerald grass. */
const GRASS = '#0E7A4B';
/** The countdown runs even with reduce motion on: it's a timer, not decoration. */
const always = { reduceMotion: ReduceMotion.Never };

/**
 * Bag celebrations over the whole app: bag emoji pour down, the screen shakes and a popup says
 * "You got 2 bags!", for 5 seconds. One at a time; more wait their turn.
 */
export function BagCelebrations() {
  const { current, done } = useBagCelebrations();
  if (!current) return null;
  return <CelebrationView key={bagKey(current.bag)} celebration={current} onDone={done} />;
}

function CelebrationView({ celebration, onDone }: { celebration: Celebration; onDone: () => void }) {
  const { bag, yours } = celebration;
  const reduceMotion = useReducedMotion();
  const rain = yours && !reduceMotion;
  const [fontsLoaded, fontError] = useFonts({ LuckiestGuy_400Regular });
  const openPlayer = useOpenPlayer();

  const enter = useSharedValue(0);
  const progress = useSharedValue(0);
  const leave = useSharedValue(0);
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    cancelAnimation(progress);
    leave.set(
      withTiming(1, { duration: FADE_MS }, (finished) => {
        if (finished) scheduleOnRN(onDone);
      }),
    );
  }, [leave, progress, onDone]);

  const countdown = useCallback(
    (ms: number) =>
      withTiming(1, { duration: ms, easing: Easing.linear, ...always }, (finished) => {
        if (finished) scheduleOnRN(close);
      }),
    [close],
  );

  useEffect(() => {
    const delay = rain ? POPUP_DELAY_MS : 0;
    enter.set(withDelay(delay, withTiming(1, { duration: 450, easing: Easing.out(Easing.back(1.8)) })));
    progress.set(withDelay(delay, countdown(SHOW_MS), always.reduceMotion));
    if (!rain) return;
    const shake = setTimeout(() => shakeScreen(shakeStrength(bag)), POPUP_DELAY_MS);
    return () => clearTimeout(shake);
  }, [rain, bag, enter, progress, countdown]);

  // Holding the popup pauses the countdown; letting go picks it up where it was.
  const pause = () => cancelAnimation(progress);
  const resume = () => {
    if (!closing.current) progress.set(countdown(SHOW_MS * (1 - progress.get())));
  };

  const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.min(enter.value, 1) * (1 - leave.value) }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(enter.value * 2, 1) * (1 - leave.value),
    transform: [{ scale: 0.6 + 0.4 * enter.value - 0.05 * leave.value }],
  }));

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      {rain && <Rain bag={bag} />}
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View style={[styles.cardWrap, cardStyle]}>
          <Pressable
            onPress={() => {
              close();
              openPlayer(bag.playerId);
            }}
            onPressIn={pause}
            onPressOut={resume}
            // A hold only pauses; it doesn't open the player.
            onLongPress={() => {}}
            delayLongPress={250}
            accessibilityRole="button"
            accessibilityHint="Opens the player's stats">
            <Card celebration={celebration} titleFont={fontsLoaded || fontError ? GAME_FONT : undefined} progress={progress} />
          </Pressable>
          <Pressable onPress={close} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

function Card({
  celebration,
  titleFont,
  progress,
}: {
  celebration: Celebration;
  titleFont: string | undefined;
  /** The countdown, 0 to 1. */
  progress: SharedValue<number>;
}) {
  const { bag, teamId, yours } = celebration;
  const theme = useTheme();
  const { data } = useSeason();
  const { scores } = useScores();
  const barStyle = useAnimatedStyle(() => ({ width: `${(1 - progress.value) * 100}%` }));
  const summary = useMemo(
    () =>
      data && scores
        ? bagSummary(
            bag,
            scores,
            coreSpells(data),
            data.teams.map((t) => ({ id: t.id, eliminatedAfterRound: t.eliminated_after_round, isGhost: t.is_ghost })),
          )
        : null,
    [bag, data, scores],
  );
  if (!data) return null;
  const team = data.teams.find((t) => t.id === teamId);
  const count = bag.bags === 1 ? 'a bag' : `${bag.bags} bags`;
  const title = yours ? `You got ${count}!` : `${team ? teamName(team) : playerName(data, bag.playerId)} got ${count}`;
  const game = summary?.game;
  const place = summary?.team;

  const rows: [string, string][] = [];
  if (game) {
    const extras = [
      game.hr ? (game.hr === 1 ? 'HR' : `${game.hr} HR`) : null,
      game.rbi ? `${game.rbi} RBI` : null,
      `${game.tb} ${game.tb === 1 ? 'bag' : 'bags'}`,
    ].filter(Boolean);
    rows.push(['This game', [`${game.h ?? 0}-for-${game.ab ?? 0}`, ...extras].join(' · ')]);
  }
  if (summary && summary.postseason.games > 0) {
    const { bags, games } = summary.postseason;
    rows.push(['Postseason', `${bags} ${bags === 1 ? 'bag' : 'bags'} in ${games} ${games === 1 ? 'game' : 'games'}`]);
  }
  if (place) {
    rows.push([
      // The title already names someone else's team.
      yours ? 'Your team' : 'Team',
      `${place.bags} bags this round · ${place.tied ? 'T-' : ''}${ordinal(place.rank)} of ${place.of}`,
    ]);
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.background, boxShadow: theme.floating }]}>
      <View style={styles.band}>
        <Text style={[styles.title, titleFont ? { fontFamily: titleFont } : styles.titleFallback]} numberOfLines={2}>
          {title}
        </Text>
      </View>
      <Image
        source={headshotUrl(bag.playerId)}
        style={[styles.headshot, { backgroundColor: theme.backgroundElement, borderColor: theme.background }]}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
      <View style={styles.body}>
        <View style={styles.who}>
          <ThemedText type="subtitle" style={styles.name} numberOfLines={1}>{playerName(data, bag.playerId)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{mlbTeamAbbr(data, bag.playerId)}</ThemedText>
        </View>
        <Text style={[styles.hit, { color: theme.success }, titleFont ? { fontFamily: titleFont } : styles.titleFallback]}>
          {hitHeadline(bag)} {'👜'.repeat(Math.min(Math.max(bag.bags, 1), 4))}
        </Text>
        {rows.length > 0 && (
          <View style={[styles.rows, { borderTopColor: theme.border }]}>
            {rows.map(([label, value]) => (
              <View key={label} style={styles.row}>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.label}>{label}</ThemedText>
                <ThemedText type="smallBold" style={styles.value}>{value}</ThemedText>
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        <Animated.View style={[styles.bar, barStyle]} />
      </View>
    </View>
  );
}

interface Drop {
  emoji: string;
  x: number;
  size: number;
  delay: number;
  duration: number;
  spin: number;
  sway: number;
}

function makeDrops(bag: BagHit, width: number): Drop[] {
  return Array.from({ length: rainCount(bag) }, () => ({
    emoji: BAG_EMOJI[Math.floor(Math.random() * BAG_EMOJI.length)],
    x: Math.random() * width,
    size: 24 + Math.random() * 44,
    // Front-loaded, so it starts as a downpour and keeps going.
    delay: Math.random() ** 1.4 * RAIN_MS,
    duration: 1500 + Math.random() * 900,
    spin: (Math.random() - 0.5) * 2,
    sway: (Math.random() - 0.5) * 2,
  }));
}

/** Bag emoji falling past the whole screen, harder for more bags. */
function Rain({ bag }: { bag: BagHit }) {
  const { width, height } = useWindowDimensions();
  // Once per celebration: a resize doesn't reshuffle the rain.
  const [drops] = useState(() => makeDrops(bag, width));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {drops.map((drop, i) => (
        <FallingEmoji key={i} drop={drop} height={height} />
      ))}
    </View>
  );
}

function FallingEmoji({ drop, height }: { drop: Drop; height: number }) {
  const fall = useSharedValue(0);
  useEffect(() => {
    fall.set(withDelay(drop.delay, withTiming(1, { duration: drop.duration, easing: Easing.in(Easing.quad) })));
  }, [drop, fall]);
  const style = useAnimatedStyle(() => ({
    opacity: fall.value > 0 ? 1 : 0,
    transform: [
      { translateY: -drop.size * 1.5 + fall.value * (height + drop.size * 3) },
      { translateX: drop.sway * 40 * Math.sin(fall.value * Math.PI) },
      { rotate: `${drop.spin * 200 * fall.value}deg` },
    ],
  }));
  return (
    <Animated.View style={[styles.drop, { left: drop.x - drop.size / 2 }, style]}>
      <Text style={{ fontSize: drop.size, lineHeight: drop.size * 1.25 }}>{drop.emoji}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 1000 },
  dim: { backgroundColor: 'rgba(0, 0, 0, 0.35)' },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  cardWrap: { width: '100%', maxWidth: 360 },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  band: {
    backgroundColor: GRASS,
    paddingTop: Spacing.four,
    paddingBottom: 56,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 30,
    lineHeight: 36,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
    userSelect: 'none',
  },
  titleFallback: { fontWeight: 800 },
  headshot: { width: 96, height: 96, borderRadius: 48, borderWidth: 4, alignSelf: 'center', marginTop: -48 },
  body: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two, alignItems: 'center' },
  who: { alignItems: 'center' },
  name: { fontSize: 22, lineHeight: 28, textAlign: 'center' },
  hit: { fontSize: 22, lineHeight: 28, textAlign: 'center', userSelect: 'none' },
  rows: { alignSelf: 'stretch', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: Spacing.one },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.three },
  label: { flexShrink: 1 },
  value: { textAlign: 'right' },
  track: { height: 4 },
  bar: { height: 4, backgroundColor: GRASS },
  close: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  closeText: { color: '#FFFFFF', fontSize: 16, fontWeight: 700 },
  drop: { position: 'absolute', top: 0 },
});
