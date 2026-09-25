import { useEffect, useState } from 'react';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { G, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { type BagKind, type FieldView } from '@/lib/bag-game';
import { type BagGameScores } from '@/lib/bag-game-scores';

/** Specials caught so far, for the varsity board's lamps. */
export type SpecialsCaught = Record<Exclude<BagKind, 'single' | 'decoy'>, number>;

const RED = '#FF3B30';
const GOLD = '#FFD84D';

/**
 * The center-field scoreboard, the game's only score display: the league record (HOME) against
 * your score (GUEST), bags left in the INNING box, and lamps for the specials caught. Sits in the
 * stands above the outfield wall, behind the falling bags. It pulses on each catch, and passing
 * the record makes your side flash.
 */
export function StadiumBoard({ view, scores, score, left, specials, night }: {
  view: FieldView;
  scores: BagGameScores | undefined;
  score: number;
  left: number;
  specials: SpecialsCaught;
  night: boolean;
}) {
  const record = scores?.record ?? null;
  const newRecord = !!scores && score > (record?.score ?? 0);
  const blink = useBlink(newRecord);
  const bump = useSharedValue(0);
  useEffect(() => {
    if (score === 0) return;
    const config = { duration: 70, reduceMotion: ReduceMotion.Never };
    bump.value = withSequence(withTiming(1, config), withTiming(0, { ...config, duration: 200 }));
  }, [score, bump]);
  const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.06 * bump.value }] }));

  const width = Math.min(view.width * 0.5, 220);
  const height = width * 0.52;
  // Bottom edge on top of the center field wall.
  const wallTop = view.project(0, 405, 8);
  const props = {
    top: { name: record ? (record.yours ? 'BEST' : record.name) : 'RECORD', score: record?.score ?? null },
    you: { name: scores?.myName ?? 'YOU', score },
    left,
    specials,
    newRecord,
    blink,
    glow: night,
  };
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: view.width / 2 - width / 2,
          top: wallTop.y - height + 2,
          width,
          height,
          pointerEvents: 'none',
        },
        bumpStyle,
      ]}>
      <Varsity {...props} />
    </Animated.View>
  );
}

interface BoardProps {
  top: { name: string; score: number | null };
  you: { name: string; score: number };
  left: number;
  specials: SpecialsCaught;
  newRecord: boolean;
  /** Flips twice a second while `newRecord`, for flashing. */
  blink: boolean;
  /** Night game: the lights glow. */
  glow: boolean;
}

/** Like a high school field's board, with names for HOME and GUEST and "LEFT" for INNING. */
function Varsity({ top, you, left, specials, newRecord, blink, glow }: BoardProps) {
  const yourColor = newRecord ? (blink ? GOLD : RED) : RED;
  const label = { fill: '#FFFFFF', fontWeight: '900' as const, fontFamily: 'Arial Black, Arial, sans-serif' };
  return (
    <Svg width="100%" height="100%" viewBox="0 0 200 104">
      <Rect x={0} y={0} width={200} height={104} fill="#E4E4E4" />
      <Rect x={3} y={3} width={194} height={98} fill="#2F6E2C" />

      <SvgText x={37} y={20} fontSize={12} textAnchor="middle" {...label}>{fit(top.name, 7)}</SvgText>
      <SvgText x={163} y={20} fontSize={12} textAnchor="middle" {...label} fill={newRecord && blink ? GOLD : '#FFFFFF'}>
        {fit(you.name, 7)}
      </SvgText>

      <Rect x={10} y={26} width={54} height={38} fill="#141414" />
      <Digits x={14} y={30} digitWidth={20} height={30} value={top.score} color={RED} glow={glow} />
      <Rect x={136} y={26} width={54} height={38} fill="#141414" />
      <Digits x={140} y={30} digitWidth={20} height={30} value={you.score} color={yourColor} glow={glow || newRecord} />

      <Rect x={80} y={6} width={40} height={32} fill="#141414" />
      <Digits x={84} y={9} digitWidth={15} height={26} value={left} color={RED} glow={glow} />
      <SvgText x={100} y={56} fontSize={newRecord ? 11 : 15} textAnchor="middle" {...label} opacity={newRecord && !blink ? 0.25 : 1}>
        {newRecord ? 'RECORD!' : 'LEFT'}
      </SvgText>

      <SvgText x={36} y={80} fontSize={11} textAnchor="middle" {...label}>2B</SvgText>
      <SvgText x={100} y={80} fontSize={11} textAnchor="middle" {...label}>3B</SvgText>
      <SvgText x={164} y={80} fontSize={11} textAnchor="middle" {...label}>HR</SvgText>
      <Lamps cx={36} count={5} lit={specials.double} glow={glow} />
      <Lamps cx={100} count={1} lit={specials.triple} glow={glow} />
      <Lamps cx={164} count={2} lit={specials.homer} glow={glow} />
    </Svg>
  );
}

/**
 * Two seven-segment digits (a blank tens digit below 10; dashes for no value). Unlit segments
 * show faintly, like a real board; at night the lit ones glow.
 */
function Digits({ x, y, digitWidth, height, value, color, glow }: {
  x: number;
  y: number;
  digitWidth: number;
  height: number;
  value: number | null;
  color: string;
  glow: boolean;
}) {
  const text = value === null ? '--' : String(Math.min(Math.max(value, 0), 99)).padStart(2, ' ');
  const gap = digitWidth * 0.3;
  return (
    <G>
      {[...text].map((ch, i) => (
        <Digit key={i} x={x + i * (digitWidth + gap)} y={y} w={digitWidth} h={height} ch={ch} color={color} glow={glow} />
      ))}
    </G>
  );
}

// Which segments (a–g, clockwise from the top, g in the middle) each character lights.
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
  '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};

function Digit({ x, y, w, h, ch, color, glow }: { x: number; y: number; w: number; h: number; ch: string; color: string; glow: boolean }) {
  const t = w * 0.2; // segment thickness
  const half = h / 2;
  // Each segment as a hexagon: horizontal ones across, vertical ones down.
  const across = (sy: number) => [[x + t / 2, sy], [x + t, sy - t / 2], [x + w - t, sy - t / 2], [x + w - t / 2, sy], [x + w - t, sy + t / 2], [x + t, sy + t / 2]];
  const down = (sx: number, sy: number, ey: number) => [[sx, sy + t / 2], [sx + t / 2, sy + t], [sx + t / 2, ey - t], [sx, ey - t / 2], [sx - t / 2, ey - t], [sx - t / 2, sy + t]];
  const shapes: Record<string, number[][]> = {
    a: across(y + t / 2),
    b: down(x + w - t / 2, y + t / 2, y + half),
    c: down(x + w - t / 2, y + half, y + h - t / 2),
    d: across(y + h - t / 2),
    e: down(x + t / 2, y + half, y + h - t / 2),
    f: down(x + t / 2, y + t / 2, y + half),
    g: across(y + half),
  };
  const lit = SEGMENTS[ch] ?? '';
  return (
    <G>
      {Object.entries(shapes).map(([seg, pts]) => {
        const on = lit.includes(seg);
        const points = pts.map((p) => p.join(',')).join(' ');
        return (
          <G key={seg}>
            {on && glow && <Polygon points={points} fill={color} stroke={color} strokeWidth={t * 0.9} strokeLinejoin="round" opacity={0.3} />}
            <Polygon points={points} fill={color} opacity={on ? 1 : 0.1} />
          </G>
        );
      })}
    </G>
  );
}

/** A row of `count` round lamps under a label, the first `lit` of them on. */
function Lamps({ cx, count, lit, glow }: { cx: number; count: number; lit: number; glow: boolean }) {
  const size = 9;
  const gap = 3;
  const width = count * size + (count - 1) * gap;
  const x0 = cx - width / 2;
  return (
    <G>
      <Rect x={x0 - 3} y={85} width={width + 6} height={size + 6} fill="#141414" />
      {Array.from({ length: count }, (_, i) => {
        const on = i < lit;
        const cxi = x0 + i * (size + gap) + size / 2;
        return (
          <G key={i}>
            {on && glow && <Rect x={cxi - size / 2 - 1.5} y={86.5} width={size + 3} height={size + 3} rx={6} fill={RED} opacity={0.35} />}
            <Rect x={cxi - size / 2} y={88} width={size} height={size} rx={size / 2} fill={RED} opacity={on ? 1 : 0.15} />
          </G>
        );
      })}
    </G>
  );
}

/** Uppercase, cut to `max` characters. */
function fit(name: string, max: number): string {
  const upper = name.toUpperCase();
  return upper.length > max ? upper.slice(0, max) : upper;
}

/** True and false alternately, twice a second, while `on`. */
function useBlink(on: boolean): boolean {
  const [phase, setPhase] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setPhase((p) => !p), 450);
    return () => clearInterval(timer);
  }, [on]);
  return on && phase;
}
