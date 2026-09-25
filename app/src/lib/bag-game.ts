/**
 * The Home screen's bag-catching game: which bags fall, when, and where on the field they land,
 * plus the perspective that draws the field. Pure (no React) so it can be unit tested.
 *
 * Field coordinates are in feet from home plate: x toward first base's side (right), z toward
 * center field.
 */

export type BagKind = 'single' | 'double' | 'triple' | 'homer';

/** Each kind's emoji, what it's worth, and how many fall per game. */
export const BAG_KINDS: Record<BagKind, { emoji: string; bags: number; count: number; label: string }> = {
  single: { emoji: '👜', bags: 1, count: 48, label: '' },
  double: { emoji: '🛍️', bags: 2, count: 5, label: 'Double!' },
  triple: { emoji: '🎒', bags: 3, count: 1, label: 'Triple!' },
  homer: { emoji: '💰', bags: 4, count: 2, label: 'Home run!' },
};

const KINDS = Object.keys(BAG_KINDS) as BagKind[];

export const TOTAL_BAGS = KINDS.reduce((n, k) => n + BAG_KINDS[k].count, 0);
/** Catching every bag: 69. The database checks scores against it (bag_game_bests). */
export const PERFECT_SCORE = KINDS.reduce((n, k) => n + BAG_KINDS[k].count * BAG_KINDS[k].bags, 0);

/** "BAGGERY", then "Get yo bags", then the first bag drops. */
export const INTRO_MS = 3000;
/** How long a bag sits on the grass before it disappears. */
export const LINGER_MS = 900;

export interface Bag {
  id: number;
  kind: BagKind;
  /** When it starts falling, in ms from the start of the game (after the intro). */
  spawnAt: number;
  fallMs: number;
  /** Where it lands, in field coordinates. */
  x: number;
  z: number;
  /** Sideways drift and spin while falling, -1 to 1. */
  drift: number;
  spin: number;
}

/** Small seeded random number generator (mulberry32), so a game can be replayed in tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fence distance at an angle from the center field line (radians): 330 ft down the lines, 400 to center. */
export function fenceDistance(angle: number): number {
  return 330 + 70 * Math.cos(2 * angle);
}

/** Fair territory is 45° either side of the center field line. */
const FOUL_LINE = Math.PI / 4;

/**
 * Every bag in one game, in the order they fall: the specials shuffled in among the singles.
 * Bags come slowly at first and faster (and falling faster) near the end.
 */
export function makeSchedule(seed: number = Math.floor(Math.random() * 2 ** 32)): Bag[] {
  const random = seededRandom(seed);
  const kinds = KINDS.flatMap((k) => Array<BagKind>(BAG_KINDS[k].count).fill(k));
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }

  let spawnAt = 0;
  return kinds.map((kind, id) => {
    const progress = id / (kinds.length - 1);
    const fallMs = (1700 - 550 * progress) * (kind === 'single' ? 1 : 0.85);
    // Land anywhere fair, short of the warning track; nearer spots a little more often.
    const angle = (random() * 2 - 1) * (FOUL_LINE - 0.06);
    const distance = 30 + (fenceDistance(angle) - 55) * random() ** 1.2;
    const bag: Bag = {
      id,
      kind,
      spawnAt: Math.round(spawnAt),
      fallMs: Math.round(fallMs),
      x: distance * Math.sin(angle),
      z: distance * Math.cos(angle),
      drift: random() * 2 - 1,
      spin: random() * 2 - 1,
    };
    spawnAt += (850 - 400 * progress) * (0.75 + random() * 0.5);
    return bag;
  });
}

/** Camera: this far behind home plate and this high, looking out toward center field. */
const CAMERA_BACK = 90;
const CAMERA_HEIGHT = 40;
/** The foul poles, 330 ft down each line. */
const POLE = 330 / Math.SQRT2;

export interface Point {
  x: number;
  y: number;
}

export interface FieldView {
  width: number;
  height: number;
  /** Screen y of the horizon (the top of the stands, which are camera height). */
  horizon: number;
  /** Screen position of a spot on the field, `h` feet off the ground. */
  project: (x: number, z: number, h?: number) => Point;
  /** How big things at depth `z` look, relative to home plate (1). */
  scale: (z: number) => number;
}

/**
 * Perspective from behind home plate for a screen `width` × `height`, with home plate just above
 * `bottom` (the lowest visible y; phones have a tab bar over the rest).
 */
export function fieldView(width: number, height: number, bottom: number = height): FieldView {
  const horizon = bottom * 0.28;
  const homeY = bottom - 28;
  // Keep the diamond's proportions on wide screens; the stands fill out the sides.
  const fieldWidth = Math.min(width, bottom * 0.72);
  const vertical = (homeY - horizon) * CAMERA_BACK;
  const horizontal = ((fieldWidth * 0.47) * (POLE + CAMERA_BACK)) / POLE;
  const depth = (z: number) => Math.max(z + CAMERA_BACK, 10);
  return {
    width,
    height,
    horizon,
    project: (x, z, h = 0) => ({
      x: width / 2 + (horizontal * x) / depth(z),
      y: horizon + (vertical * (1 - h / CAMERA_HEIGHT)) / depth(z),
    }),
    scale: (z) => CAMERA_BACK / depth(z),
  };
}
