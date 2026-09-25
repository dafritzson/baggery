import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Button } from '@/components/button';
import { type SpecialsCaught, StadiumBoard } from '@/components/stadium-board';
import { Spacing } from '@/constants/theme';
import type { BagGameScores } from '@/lib/bag-game-scores';
import {
  BAG_KINDS,
  type Bag,
  type BagKind,
  type FieldView,
  FADE_MS,
  INTRO_MS,
  LINGER_MS,
  PERFECT_SCORE,
  type Point,
  TOTAL_BAGS,
  TOTAL_DROPS,
  makeSchedule,
} from '@/lib/bag-game';

export const GAME_FONT = 'LuckiestGuy_400Regular';

/**
 * Always animate, even with the system's reduce motion setting on: the game is nothing but
 * motion, and the Home screen only starts it for those users after they tap Play.
 */
const always = { reduceMotion: ReduceMotion.Never };

/** Popup and glow colors for each kind of bag. */
const KIND_COLORS: Record<BagKind, string> = {
  single: '#FFFFFF',
  double: '#7FDBFF',
  triple: '#D7A8FF',
  homer: '#FFD84D',
  decoy: '#FF5A5F',
};

interface Popup {
  id: number;
  kind: BagKind;
  at: Point;
}

/**
 * One game: the intro, 100 falling bags to tap, and the final score. Drawn over the ballpark;
 * remount (new `key`) for a new game.
 */
export function BagGame({ view, scores, before, night, onFinish, onReplay }: {
  view: FieldView;
  /** High scores as they are now, for the stadium scoreboard; undefined if not loaded. */
  scores: BagGameScores | undefined;
  /** High scores from before this game ended (for the final screen); undefined if not loaded. */
  before: BagGameScores | undefined;
  night: boolean;
  onFinish: (score: number) => void;
  onReplay: () => void;
}) {
  const [bags] = useState(makeSchedule);
  const [specials, setSpecials] = useState<SpecialsCaught>({ double: 0, triple: 0, homer: 0 });
  const [score, setScore] = useState(0);
  // Drops finished (caught or vanished), and how many of them were bags rather than decoys.
  const [gone, setGone] = useState({ all: 0, bags: 0 });
  const [popups, setPopups] = useState<Popup[]>([]);
  const done = gone.all === TOTAL_DROPS;

  const catchBag = useCallback((bag: Bag, at: Point) => {
    // A decoy costs a bag, but the score never goes below zero.
    setScore((s) => Math.max(0, s + BAG_KINDS[bag.kind].bags));
    const { kind } = bag;
    if (kind === 'double' || kind === 'triple' || kind === 'homer') setSpecials((c) => ({ ...c, [kind]: c[kind] + 1 }));
    setPopups((p) => [...p, { id: bag.id, kind: bag.kind, at }]);
  }, []);
  const bagGone = useCallback(
    (bag: Bag) => setGone((g) => ({ all: g.all + 1, bags: g.bags + (bag.kind === 'decoy' ? 0 : 1) })),
    [],
  );
  const popupDone = useCallback((id: number) => setPopups((p) => p.filter((x) => x.id !== id)), []);

  // Report the score once, however often onFinish changes.
  const reported = useRef(false);
  useEffect(() => {
    if (!done || reported.current) return;
    reported.current = true;
    onFinish(score);
  }, [done, score, onFinish]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <StadiumBoard
        view={view}
        scores={scores}
        score={score}
        left={TOTAL_BAGS - gone.bags}
        specials={specials}
        night={night}
      />
      {bags.map((bag) => (
        <Shadow key={bag.id} bag={bag} view={view} />
      ))}
      {bags.map((bag) => (
        <FallingBag key={bag.id} bag={bag} view={view} onCatch={catchBag} onGone={bagGone} />
      ))}
      {popups.map((p) => (
        <ScorePopup key={p.id} popup={p} onDone={popupDone} />
      ))}
      <Intro view={view} />
      {done && <Final view={view} score={score} before={before} onReplay={onReplay} />}
    </View>
  );
}

/** Where a bag is drawn: its emoji size and hit box, centered just above where it lands. */
function bagLayout(bag: Bag, view: FieldView) {
  // Farther bags look smaller, but never too small to tap.
  const size = Math.round(24 + 40 * view.scale(bag.z));
  const hit = Math.max(size + 4, 40);
  // The deep corners run off the sides of a phone; keep every bag fully on screen.
  const spot = view.project(bag.x, bag.z);
  const land = { x: Math.min(Math.max(spot.x, hit / 2), view.width - hit / 2), y: spot.y };
  const center = { x: land.x, y: land.y - size * 0.55 };
  // Starts just above the top of the screen.
  const dropFrom = -(center.y + size);
  return { land, size, hit, center, dropFrom };
}

/**
 * Each bag's animation timeline, shared by the bag and its shadow: 0 before it drops, 1 once
 * it has landed.
 */
function useFall(bag: Bag) {
  const fall = useSharedValue(0);
  useEffect(() => {
    fall.value = withDelay(
      INTRO_MS + bag.spawnAt,
      withTiming(1, { duration: bag.fallMs, easing: Easing.in(Easing.quad), ...always }),
      always.reduceMotion,
    );
  }, [bag, fall]);
  return fall;
}

function FallingBag({ bag, view, onCatch, onGone }: {
  bag: Bag;
  view: FieldView;
  onCatch: (bag: Bag, at: Point) => void;
  onGone: (bag: Bag) => void;
}) {
  const kind = BAG_KINDS[bag.kind];
  const { size, hit, center, dropFrom } = bagLayout(bag, view);
  const fall = useFall(bag);
  const thud = useSharedValue(0);
  const fade = useSharedValue(1);
  const pop = useSharedValue(0);
  const [state, setState] = useState<'live' | 'caught' | 'gone'>('live');

  // Once only: a tap can land between the fade ending and the bag being removed.
  const gone = useRef(false);
  const finish = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    setState('gone');
    onGone(bag);
  }, [onGone, bag]);

  useEffect(() => {
    const landed = INTRO_MS + bag.spawnAt + bag.fallMs;
    thud.value = withDelay(
      landed,
      withSequence(withTiming(1, { duration: 80, ...always }), withTiming(0, { duration: 180, ...always })),
      always.reduceMotion,
    );
    fade.value = withDelay(
      landed + LINGER_MS,
      withTiming(0, { duration: FADE_MS, ...always }, (finished) => {
        if (finished) scheduleOnRN(finish);
      }),
      always.reduceMotion,
    );
  }, [bag, thud, fade, finish]);

  function grab() {
    if (state !== 'live' || gone.current) return;
    setState('caught');
    cancelAnimation(fall);
    cancelAnimation(fade);
    cancelAnimation(thud);
    onCatch(bag, { x: center.x, y: center.y + dropFrom * (1 - fall.value) });
    pop.value = withTiming(1, { duration: 180, ...always }, (finished) => {
      if (finished) scheduleOnRN(finish);
    });
  }

  const style = useAnimatedStyle(() => {
    const up = 1 - fall.value;
    return {
      opacity: fade.value * (1 - pop.value),
      transform: [
        // Starts off to the side and curves in toward where it lands.
        { translateX: bag.drift * 90 * up * up },
        { translateY: dropFrom * up },
        { rotate: `${bag.spin * 60 * up}deg` },
        // Squash on landing; puff up when caught.
        { scaleX: 1 + thud.value * 0.18 + pop.value * 0.7 },
        { scaleY: 1 - thud.value * 0.18 + pop.value * 0.7 },
      ],
    };
  });

  if (state === 'gone') return null;
  // Doubles and up glow; decoys don't, so they're not easy to spot.
  const special = kind.bags > 1;
  return (
    <Animated.View
      style={[
        styles.bag,
        { left: center.x - hit / 2, top: center.y - hit / 2, width: hit, height: hit, zIndex: Math.round(1000 - bag.z) },
        style,
      ]}>
      {/* Pointer down, not Pressable: the bag is caught the instant a finger lands, and each
          finger counts on its own (a Pressable takes one press at a time). */}
      <View onPointerDown={grab} style={styles.fill} accessibilityRole="button" accessibilityLabel={bag.kind === 'decoy' ? 'Decoy' : `${kind.label || 'Single'} bag`}>
        <Text
          style={[
            styles.emoji,
            { fontSize: size, lineHeight: size * 1.25 },
            special && { textShadowColor: KIND_COLORS[bag.kind], textShadowRadius: 14 },
          ]}>
          {kind.emoji}
        </Text>
      </View>
    </Animated.View>
  );
}

/** The shadow on the grass under a falling bag: grows darker as the bag gets close. */
function Shadow({ bag, view }: { bag: Bag; view: FieldView }) {
  const { land, size } = bagLayout(bag, view);
  const fall = useFall(bag);
  // Gone a little after the bag lands (it may be caught sooner; a lingering shadow is fine).
  const visible = useSharedValue(1);
  useEffect(() => {
    visible.value = withDelay(
      INTRO_MS + bag.spawnAt + bag.fallMs + LINGER_MS,
      withTiming(0, { duration: FADE_MS, ...always }),
      always.reduceMotion,
    );
  }, [bag, visible]);
  const style = useAnimatedStyle(() => ({
    opacity: fall.value * fall.value * 0.35 * visible.value,
    transform: [{ scale: 0.3 + 0.7 * fall.value }],
  }));
  const width = size * 0.9;
  const height = size * 0.26;
  return (
    <Animated.View
      style={[styles.shadow, { left: land.x - width / 2, top: land.y - height / 2, width, height }, style]}
    />
  );
}

function ScorePopup({ popup, onDone }: { popup: Popup; onDone: (id: number) => void }) {
  const rise = useSharedValue(0);
  useEffect(() => {
    rise.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic), ...always }, (finished) => {
      if (finished) scheduleOnRN(onDone, popup.id);
    });
  }, [rise, onDone, popup.id]);
  const style = useAnimatedStyle(() => ({
    opacity: rise.value < 0.6 ? 1 : 1 - (rise.value - 0.6) / 0.4,
    transform: [{ translateY: -60 * rise.value }, { scale: 0.8 + 0.4 * Math.min(rise.value * 4, 1) }],
  }));
  const kind = BAG_KINDS[popup.kind];
  const big = popup.kind !== 'single';
  return (
    <Animated.View style={[styles.popup, { left: popup.at.x - 100, top: popup.at.y - 30 }, style]}>
      <Text style={[styles.gameText, styles.outline, { fontSize: big ? 26 : 22, color: KIND_COLORS[popup.kind] }]}>
        {kind.bags > 0 ? '+' : ''}
        {kind.bags}
        {kind.label ? ` ${kind.label}` : ''}
      </Text>
    </Animated.View>
  );
}

/** "BAGGERY", then "Get yo bags", in the sky before the first bag drops. */
function Intro({ view }: { view: FieldView }) {
  const title = useSharedValue(0);
  const tagline = useSharedValue(0);
  useEffect(() => {
    title.value = withSequence(
      withTiming(1, { duration: 450, easing: Easing.out(Easing.back(2)), ...always }),
      withDelay(1000, withTiming(0, { duration: 350, ...always }), always.reduceMotion),
    );
    tagline.value = withDelay(
      1650,
      withSequence(
        withTiming(1, { duration: 350, ...always }),
        withDelay(650, withTiming(0, { duration: 350, ...always }), always.reduceMotion),
      ),
      always.reduceMotion,
    );
  }, [title, tagline]);
  const titleStyle = useAnimatedStyle(() => ({
    opacity: Math.min(title.value, 1),
    transform: [{ scale: 0.5 + 0.5 * title.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.value,
    transform: [{ translateY: 12 * (1 - tagline.value) }],
  }));
  const fontSize = Math.min(76, view.width / 5.2);
  return (
    <View style={[styles.sky, styles.passThrough, { height: view.horizon }]}>
      <Animated.Text style={[styles.gameText, styles.outline, styles.title, { fontSize, lineHeight: fontSize * 1.15 }, titleStyle]}>
        BAGGERY
      </Animated.Text>
      <Animated.Text style={[styles.gameText, styles.outline, styles.tagline, { fontSize: fontSize * 0.55 }, taglineStyle]}>
        Get yo bags
      </Animated.Text>
    </View>
  );
}

function Final({ view, score, before, onReplay }: {
  view: FieldView;
  score: number;
  /** High scores before this game. */
  before: BagGameScores | undefined;
  onReplay: () => void;
}) {
  const show = useSharedValue(0);
  useEffect(() => {
    show.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.back(1.6)), ...always });
  }, [show]);
  const style = useAnimatedStyle(() => ({ opacity: Math.min(show.value, 1), transform: [{ scale: 0.7 + 0.3 * show.value }] }));
  const newRecord = !!before && score > (before.record?.score ?? 0);
  const note =
    score === PERFECT_SCORE
      ? 'Nice.'
      : newRecord
        ? 'New league record!'
        : before && score > before.mine
        ? 'New personal best!'
        : null;
  // Standings after this game, without waiting for the saved scores to reload.
  const record = newRecord ? { score, name: 'you' } : before?.record;
  const details = before && [
    record && `Record ${record.score} (${record.name})`,
    `Your best ${Math.max(before.mine, score)}`,
  ].filter(Boolean).join(' · ');
  const fontSize = Math.min(56, view.width / 7);
  return (
    <Animated.View style={[styles.sky, styles.final, { minHeight: view.horizon }, style]}>
      <Text style={[styles.gameText, styles.outline, styles.title, { fontSize, lineHeight: fontSize * 1.15 }]}>
        {score} {score === 1 ? 'bag' : 'bags'}
      </Text>
      {note && <Text style={[styles.gameText, styles.outline, styles.note, { color: '#FFD84D' }]}>{note}</Text>}
      {details && <Text style={[styles.gameText, styles.outline, styles.details]}>{details}</Text>}
      <Button label="Play again" onPress={onReplay} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bag: { position: 'absolute' },
  emoji: { textAlign: 'center', userSelect: 'none' },
  shadow: { position: 'absolute', borderRadius: 999, backgroundColor: '#000000', pointerEvents: 'none' },
  popup: { position: 'absolute', width: 200, alignItems: 'center', zIndex: 2000, pointerEvents: 'none' },
  gameText: { fontFamily: GAME_FONT, color: '#FFFFFF', textAlign: 'center', userSelect: 'none' },
  outline: { textShadowColor: 'rgba(10, 30, 60, 0.75)', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 0 },
  sky: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', zIndex: 2100 },
  passThrough: { pointerEvents: 'none' },
  title: { color: '#FFD84D', letterSpacing: 2 },
  tagline: { position: 'absolute', letterSpacing: 1 },
  final: { gap: Spacing.two, paddingTop: Spacing.three },
  note: { fontSize: 20 },
  details: { fontSize: 15 },
});
