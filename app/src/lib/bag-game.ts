/**
 * The Home screen's bag-catching game: which bags fall, when, and where on the field they land,
 * plus the perspective that draws the field. Pure (no React) so it can be unit tested.
 *
 * Field coordinates are in feet from home plate: x toward first base's side (right), z toward
 * center field.
 */

export type BagKind = 'single' | 'double' | 'triple' | 'homer' | 'decoy';

/** Each kind's emoji, what it's worth, and how many fall per game. Decoys cost a bag. */
export const BAG_KINDS: Record<BagKind, { emoji: string; bags: number; count: number; label: string }> = {
  single: { emoji: '👜', bags: 1, count: 48, label: '' },
  double: { emoji: '🛍️', bags: 2, count: 5, label: 'Double!' },
  triple: { emoji: '🎒', bags: 3, count: 1, label: 'Triple!' },
  homer: { emoji: '💰', bags: 4, count: 2, label: 'Home run!' },
  decoy: { emoji: '🥯', bags: -1, count: 10, label: '' },
};

const KINDS = Object.keys(BAG_KINDS) as BagKind[];
/** The kinds worth catching (not decoys). */
const BAG_ONLY = KINDS.filter((k) => BAG_KINDS[k].bags > 0);

/** Bags per game (decoys don't count). */
export const TOTAL_BAGS = BAG_ONLY.reduce((n, k) => n + BAG_KINDS[k].count, 0);
/** Everything that falls in a game, decoys included. */
export const TOTAL_DROPS = KINDS.reduce((n, k) => n + BAG_KINDS[k].count, 0);
/** Catching every bag and no decoys: 69. The database checks scores against it (bag_game_bests). */
export const PERFECT_SCORE = BAG_ONLY.reduce((n, k) => n + BAG_KINDS[k].count * BAG_KINDS[k].bags, 0);

/** "BAGGERY", then "Get yo bags", then the first bag drops. */
export const INTRO_MS = 3000;
/** How long a bag sits on the grass before it starts to fade, and how long the fade takes. */
export const LINGER_MS = 400;
export const FADE_MS = 150;

/**
 * Difficulty. Each bag's fall time, and the wait before the next one drops, go from the first
 * value to the second over the game. Most of the change comes early (see `ramp`), so it's quick
 * from the start and keeps getting harder.
 */
const FALL_MS = [1125, 720];
const GAP_MS = [700, 380];
/** Doubles, triples and home runs fall faster than singles (and decoys) by this factor. */
const SPECIAL_FALL = 0.8;

export interface Bag {
  id: number;
  kind: BagKind;
  /** When it starts falling, in ms from the start of the game (after the intro). */
  spawnAt: number;
  fallMs: number;
  /** Where it lands, in field coordinates. */
  x: number;
  z: number;
  /** How far it curves in from the side (and spins) while falling, -1 to 1. */
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

/** 0 to 1 over the game, front-loaded: halfway there about 30% of the way in. */
const ramp = (progress: number) => 1 - (1 - progress) ** 2;
const between = ([from, to]: number[], t: number) => from + (to - from) * t;

/**
 * Everything that falls in one game, in order: the specials and decoys shuffled in among the
 * singles.
 * Bags come faster, and fall faster, as the game goes on.
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
    const t = ramp(id / (kinds.length - 1));
    const fallMs = between(FALL_MS, t) * (BAG_KINDS[kind].bags > 1 ? SPECIAL_FALL : 1);
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
    spawnAt += between(GAP_MS, t) * (0.75 + random() * 0.5);
    return bag;
  });
}

/** Camera: this far behind home plate and this high, looking out toward center field. */
const CAMERA_BACK = 160;
const CAMERA_HEIGHT = 40;
/** The foul poles, 330 ft down each line. */
const POLE = 330 / Math.SQRT2;
/**
 * Framing: the horizon this far down the visible area, and the foul poles this far from center
 * (as a share of the field's width; 0.5 is the edge). With the camera distance they set how
 * foreshortened the field looks: a lower horizon and a camera further back look less top-down.
 */
const HORIZON = 0.4;
const POLE_SPREAD = 0.47;

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
  const horizon = bottom * HORIZON;
  const homeY = bottom - 28;
  // Keep the diamond's proportions on wide screens; the stands fill out the sides.
  const fieldWidth = Math.min(width, bottom * 0.72);
  const vertical = (homeY - horizon) * CAMERA_BACK;
  const horizontal = (fieldWidth * POLE_SPREAD * (POLE + CAMERA_BACK)) / POLE;
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

/** Night game from 7 PM to 6 AM, local time: stars in the sky. */
export function isNight(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 19 || hour < 6;
}
