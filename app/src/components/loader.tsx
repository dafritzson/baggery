import { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Path, Polygon, Polyline, Rect } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

/** The diamond in a 100×100 box, counter-clockwise like a runner: home, first, second, third. */
const BASES = [
  [50, 86],
  [86, 50],
  [50, 14],
  [14, 50],
] as const;
const SIDE = Math.hypot(36, 36);
const LAP = SIDE * 4;

/** A lap at full speed, in seconds. */
const LAP_TIME = 1.1;
/** Seconds from standing at home to full speed. */
const RAMP = 0.8;
/** How far behind the head the tail runs, in seconds; at full speed that's this share of a lap. */
const TRAIL = 0.45;
const TOP_SPEED = LAP / LAP_TIME;
/** Loads quicker than this (switching tabs, say) show nothing rather than a flash of the loader. */
const SHOW_AFTER_MS = 400;

/** Distance run after `t` seconds: speeding up evenly from a standstill, then steady. */
function distanceRun(t: number): number {
  if (t <= 0) return 0;
  if (t < RAMP) return (TOP_SPEED * t * t) / (2 * RAMP);
  return (TOP_SPEED * RAMP) / 2 + TOP_SPEED * (t - RAMP);
}

/** The point `s` along the base paths from home, going around as many times as it takes. */
function pointAt(s: number): [number, number] {
  const along = ((s % LAP) + LAP) % LAP;
  const side = Math.floor(along / SIDE);
  const f = (along - side * SIDE) / SIDE;
  const [x1, y1] = BASES[side];
  const [x2, y2] = BASES[(side + 1) % 4];
  return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
}

/** The runner's line from `tail` to `head`, bending at each base it passes. */
function runnerPoints(tail: number, head: number): string {
  const points = [pointAt(tail)];
  for (let base = Math.floor(tail / SIDE) + 1; base * SIDE < head; base++) points.push(pointAt(base * SIDE));
  points.push(pointAt(head));
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

/**
 * Loading indicator, centered on the page: a line runs the bases from home plate. It starts as a
 * dot and stretches to full length as it picks up speed (the tail trails the head by a fixed time),
 * then keeps circling. It only appears if loading takes a moment.
 */
export function Loader({ size = 112 }: { size?: number }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  // Tall enough that, starting under the header, its middle is about the middle of the screen.
  const box = { minHeight: height * 0.6 };
  const [shown, setShown] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!shown || reducedMotion) return;
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      setElapsed((now - start) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shown, reducedMotion]);

  if (!shown) return <View style={[styles.wrap, box]} />;

  // Reduced motion: a still runner rounding first.
  const head = reducedMotion ? SIDE * 1.3 : distanceRun(elapsed);
  const tail = reducedMotion ? SIDE * 0.7 : distanceRun(elapsed - TRAIL);
  const outline = `M${BASES.map(([x, y]) => `${x},${y}`).join(' L')} Z`;

  return (
    <View style={[styles.wrap, box]} accessible accessibilityRole="progressbar" accessibilityLabel="Loading">
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path d={outline} fill="none" stroke={theme.textSecondary} strokeOpacity={0.45} strokeWidth={3} strokeLinejoin="round" />
        {BASES.slice(1).map(([x, y]) => (
          <Rect
            key={`${x}-${y}`}
            x={x - 5}
            y={y - 5}
            width={10}
            height={10}
            fill={theme.background}
            stroke={theme.textSecondary}
            strokeWidth={3}
            transform={`rotate(45 ${x} ${y})`}
          />
        ))}
        <Polygon points="44,82 56,82 56,88 50,93 44,88" fill={theme.background} stroke={theme.textSecondary} strokeWidth={3} strokeLinejoin="round" />
        {head > 0.5 && (
          <Polyline
            points={runnerPoints(tail, head)}
            fill="none"
            stroke={theme.accent}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
