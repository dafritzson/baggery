import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import type { BagHit } from '@core/bag-celebration.ts';

import { type Drop, dropTransform, makeDrops } from '@/lib/bag-rain';

/** Keyframes per drop: enough that the sway and the ease-in read as curves. */
const STEPS = 12;

/**
 * Web: bag emoji falling past the whole screen, harder for more bags.
 *
 * Each drop is its own GPU layer, drawn once and moved by a Web Animation, which the browser runs
 * off the main thread without repainting anything. (Moving them from JavaScript every frame, as
 * Reanimated does on web, repainted the whole overlay, popup included, for every frame of up to
 * 160 spinning emoji, and Android Chrome flashed: tiles and glyphs dropped out as it fell behind.)
 */
export function BagRain({ bag }: { bag: BagHit }) {
  const { width, height } = useWindowDimensions();
  // Once per celebration: a resize doesn't reshuffle the rain.
  const [drops] = useState(() => makeDrops(bag, width));
  const [fallHeight] = useState(height);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = Array.from(box.current?.children ?? []) as HTMLElement[];
    const animations = els.map((el, i) => el.animate(keyframes(drops[i], fallHeight), {
      delay: drops[i].delay,
      duration: drops[i].duration,
      // The first frame (above the screen) holds while it waits, the last (below it) once it's down.
      fill: 'both',
    }));
    return () => animations.forEach((a) => a.cancel());
  }, [drops, fallHeight]);

  return (
    <div ref={box} aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {drops.map((drop, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 0,
            left: drop.x - drop.size / 2,
            fontSize: drop.size,
            lineHeight: `${drop.size * 1.25}px`,
            userSelect: 'none',
            willChange: 'transform',
            transform: 'translateY(-200px)',
          }}>
          {drop.emoji}
        </div>
      ))}
    </div>
  );
}

/** The fall sampled as it eases in (quadratic), like the native rain. */
function keyframes(drop: Drop, height: number): Keyframe[] {
  return Array.from({ length: STEPS + 1 }, (_, i) => {
    const t = i / STEPS;
    const { translateY, translateX, rotate } = dropTransform(drop, height, t * t);
    return { offset: t, transform: `translateY(${translateY}px) translateX(${translateX}px) rotate(${rotate})` };
  });
}
