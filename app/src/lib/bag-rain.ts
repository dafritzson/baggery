import { BAG_EMOJI, type BagHit, rainCount } from '@core/bag-celebration.ts';

/** Bags keep starting to fall for this long, so the last land about as the popup goes. */
export const RAIN_MS = 3200;

/** One falling bag emoji. */
export interface Drop {
  emoji: string;
  x: number;
  size: number;
  delay: number;
  duration: number;
  spin: number;
  sway: number;
}

export function makeDrops(bag: BagHit, width: number): Drop[] {
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

/** Where a drop is `fall` of the way down (0 to 1, already eased): its CSS transform. */
export function dropTransform(drop: Drop, height: number, fall: number) {
  return {
    translateY: -drop.size * 1.5 + fall * (height + drop.size * 3),
    translateX: drop.sway * 40 * Math.sin(fall * Math.PI),
    rotate: `${drop.spin * 200 * fall}deg`,
  };
}
