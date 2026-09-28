// Platoons and batting order: how often a hitter starts, and where he bats, against left- and
// right-handed starting pitchers. Some hitters only start against one hand (a platoon), and some
// bat 2nd against one hand but 7th against the other, and a leadoff hitter bats nearly a whole
// time more a game than a 9th hitter. From his team's regular-season lineups, weighted toward
// recent games so a lineup change shows up. Pure, so the unit tests can run it without Supabase.

import type { Counts } from './player-stats.ts';

export type Hand = 'L' | 'R';
export const HANDS: Hand[] = ['L', 'R'];

/** One of his team's regular-season games, from its lineup. */
export interface LineupGame {
  /** YYYY-MM-DD. */
  date: string;
  /** Throwing hand of the opposing starter. */
  starterHand: Hand;
  /** Where he batted, 1–9, or null when he didn't start. */
  spot: number | null;
}

/** His record against one hand, with each game weighted by how recent it is. */
export interface HandSplit {
  /** Team games against this hand's starters. */
  games: number;
  /** Games he started. */
  starts: number;
  /** Starts at each spot: index 0 is leadoff. */
  spots: number[];
}

export type Splits = Record<Hand, HandSplit>;

/** What the draft pool keeps of a hitter against each hand (season_player_pool.platoon). */
export interface HandRecord {
  /** Team games against this hand's starters, and how many he started: with his current team. */
  games: number;
  starts: number;
  /** The same, recent games counting for more (lineupSplits). */
  weighted: HandSplit;
  /** His batting line against pitchers of this hand, starters or not; null if MLB had none. */
  line: Counts | null;
  opsPlus: number | null;
}

export type PlatoonRecord = Record<Hand, HandRecord>;

/** The weighted splits of a pool record. */
export function recordSplits(record: PlatoonRecord): Splits {
  return { L: record.L.weighted, R: record.R.weighted };
}

/** A game counts half as much this many days before the latest one. */
export const RECENT_HALF_LIFE_DAYS = 30;
/**
 * Plate appearances a game at each lineup spot, leadoff first: all of MLB in 2026, from the Stats
 * API's b1–b9 team splits. Each spot down bats about a ninth of a time less.
 */
export const PA_BY_SPOT = [4.634, 4.527, 4.423, 4.321, 4.218, 4.107, 3.993, 3.871, 3.751];
/** Plate appearances in a game he doesn't start: the odd pinch-hit or late-inning switch. */
export const BENCH_PA = 0.2;
/**
 * Weighted games of his overall start rate added to each hand's, so a few games against a hand
 * (a lefty-heavy week) don't decide it.
 */
export const START_PRIOR_GAMES = 8;
/** Share of starts by left-handers, league-wide: for games whose starter nobody knows yet. */
export const LEAGUE_LHP_SHARE = 0.27;
/** How much likelier to start against one hand than the other a hitter has to be to count as a platoon. */
const PLATOON_GAP = 0.4;

const DAY_MS = 86_400_000;

function emptySplit(): HandSplit {
  return { games: 0, starts: 0, spots: Array(9).fill(0) };
}

/** His record against each hand from his team's games, recent ones counting for more. */
export function lineupSplits(games: LineupGame[]): Splits {
  const splits: Splits = { L: emptySplit(), R: emptySplit() };
  if (!games.length) return splits;
  const latest = Math.max(...games.map((g) => Date.parse(g.date)));
  for (const g of games) {
    const weight = 0.5 ** ((latest - Date.parse(g.date)) / DAY_MS / RECENT_HALF_LIFE_DAYS);
    const split = splits[g.starterHand];
    split.games += weight;
    if (g.spot !== null && g.spot >= 1 && g.spot <= 9) {
      split.starts += weight;
      split.spots[g.spot - 1] += weight;
    }
  }
  // Scaled back up to the games played: recent games get more say, but the season is still a
  // season's worth of evidence against the prior in startChance.
  const scale = games.length / (splits.L.games + splits.R.games);
  for (const split of Object.values(splits)) {
    split.games *= scale;
    split.starts *= scale;
    split.spots = split.spots.map((w) => w * scale);
  }
  return splits;
}

/** His chance to start against a hand's starter, pulled toward his overall rate by a few games. */
export function startChance(splits: Splits, hand: Hand): number {
  const games = splits.L.games + splits.R.games;
  if (games === 0) return 0;
  const overall = (splits.L.starts + splits.R.starts) / games;
  const split = splits[hand];
  return (split.starts + START_PRIOR_GAMES * overall) / (split.games + START_PRIOR_GAMES);
}

/** Where he usually bats against a hand (1–9), or null if he hasn't started against it. */
export function usualSpot(split: HandSplit): number | null {
  let best = -1;
  split.spots.forEach((w, i) => {
    if (w > 0 && (best < 0 || w > split.spots[best])) best = i;
  });
  return best < 0 ? null : best + 1;
}

/** Plate appearances a start against a hand gives him, from where he bats against it. */
export function paPerStart(splits: Splits, hand: Hand): number {
  // No starts against this hand: where he bats against the other.
  const split = splits[hand].starts > 0 ? splits[hand] : splits[hand === 'L' ? 'R' : 'L'];
  if (split.starts === 0) return PA_BY_SPOT[8];
  return split.spots.reduce((sum, w, i) => sum + w * PA_BY_SPOT[i], 0) / split.starts;
}

/**
 * The hand he mostly plays against, if he's a platoon hitter: likelier to start against it than the
 * other by 40 points or more. Null for everyday players and for bench players who rarely start
 * against either.
 */
export function platoonSide(splits: Splits): Hand | null {
  const l = startChance(splits, 'L');
  const r = startChance(splits, 'R');
  if (Math.abs(l - r) < PLATOON_GAP) return null;
  return l > r ? 'L' : 'R';
}

/** Plate appearances he can expect against a hand's starter: starts at his spot, plus the odd bench game. */
export function expectedPa(splits: Splits, hand: Hand): number {
  const start = startChance(splits, hand);
  return start * paPerStart(splits, hand) + (1 - start) * BENCH_PA;
}

/**
 * Plate appearances he can expect in one team game whose starter is left-handed with chance
 * `lhpChance`.
 */
export function expectedPaPerGame(splits: Splits, lhpChance: number): number {
  return lhpChance * expectedPa(splits, 'L') + (1 - lhpChance) * expectedPa(splits, 'R');
}

/** A start by one of a team's pitchers. */
export interface PitcherStart {
  /** YYYY-MM-DD. */
  date: string;
  pitcherId: number;
  hand: Hand;
}

export interface RotationPitcher {
  pitcherId: number;
  hand: Hand;
}

/** Postseason rotations are 4 deep: the 5th starter goes to the bullpen. */
export const ROTATION_SIZE = 4;
/** Starts this recent show who's in the rotation now. */
const ROTATION_DAYS = 30;

/**
 * A team's likely postseason rotation: its pitchers with the most starts in the last 30 days, in
 * the order they last pitched, so the next time through starts with whoever's rested longest.
 */
export function likelyRotation(starts: PitcherStart[]): RotationPitcher[] {
  if (!starts.length) return [];
  const latest = Math.max(...starts.map((s) => Date.parse(s.date)));
  const recent = starts.filter((s) => latest - Date.parse(s.date) <= ROTATION_DAYS * DAY_MS);
  const byPitcher = new Map<number, { hand: Hand; starts: number; last: number }>();
  for (const s of recent) {
    const p = byPitcher.get(s.pitcherId) ?? { hand: s.hand, starts: 0, last: 0 };
    p.starts++;
    p.last = Math.max(p.last, Date.parse(s.date));
    byPitcher.set(s.pitcherId, p);
  }
  return [...byPitcher]
    .sort(([, a], [, b]) => b.starts - a.starts || b.last - a.last)
    .slice(0, ROTATION_SIZE)
    .sort(([, a], [, b]) => a.last - b.last)
    .map(([pitcherId, p]) => ({ pitcherId, hand: p.hand }));
}

/**
 * Who starts each game of a series: the announced probable where there is one, and otherwise the
 * rotation in turn, picking up after the last probable. Null where there's no rotation to go on.
 */
export function seriesStarters(
  rotation: RotationPitcher[],
  probables: (RotationPitcher | null)[],
  games: number,
): (RotationPitcher & { announced: boolean } | null)[] {
  const starters: (RotationPitcher & { announced: boolean } | null)[] = [];
  let next = 0;
  for (let n = 0; n < games; n++) {
    const probable = probables[n];
    if (probable) {
      starters.push({ ...probable, announced: true });
      const i = rotation.findIndex((p) => p.pitcherId === probable.pitcherId);
      next = i < 0 ? next : i + 1;
    } else if (rotation.length) {
      starters.push({ ...rotation[next % rotation.length], announced: false });
      next++;
    } else starters.push(null);
  }
  return starters;
}

/** One game a team might play: its chance of being played, and of a left-handed starter. */
export interface ExpectedGame {
  chance: number;
  lhpChance: number;
  /** When it starts (ms): scheduled, or estimated (core/matchups.ts expectedGames). */
  start?: number;
}

/**
 * A hitter on the injured list: he plays no games before `from` (ms), and every game after, as if
 * he'd never been hurt. `now` is where the postseason games we know nothing about start from.
 */
export interface Sidelined {
  from: number;
  now: number;
}

/** A postseason team plays about a game every day and a half, with travel and off days between. */
export const DAYS_PER_POSTSEASON_GAME = 1.5;

/**
 * Plate appearances he can expect over `totalGames` expected team games: the games we know
 * something about (the current series), and league-average starters for the rest. None in games
 * before he's back from the injured list.
 */
export function expectedPaOver(splits: Splits, known: ExpectedGame[], totalGames: number, sidelined: Sidelined | null = null): number {
  return overGames(known, totalGames, (lhp) => expectedPaPerGame(splits, lhp), sidelined);
}

/** Games he can expect to start over `totalGames` expected team games, like expectedPaOver. */
export function expectedStartsOver(splits: Splits, known: ExpectedGame[], totalGames: number, sidelined: Sidelined | null = null): number {
  return overGames(known, totalGames, (lhp) => lhp * startChance(splits, 'L') + (1 - lhp) * startChance(splits, 'R'), sidelined);
}

/** Of `totalGames` expected team games, how many he can expect to be there for (all of them unless he's injured). */
export function expectedGamesAvailable(known: ExpectedGame[], totalGames: number, sidelined: Sidelined | null = null): number {
  return overGames(known, totalGames, () => 1, sidelined);
}

function overGames(known: ExpectedGame[], totalGames: number, perGame: (lhpChance: number) => number, sidelined: Sidelined | null): number {
  const plays = (g: ExpectedGame) => !sidelined || g.start === undefined || g.start >= sidelined.from;
  const knownGames = known.reduce((sum, g) => sum + g.chance, 0);
  let rest = Math.max(0, totalGames - knownGames);
  if (sidelined) {
    // The rest come after the known games, one every DAYS_PER_POSTSEASON_GAME days: he misses the
    // ones before he's back.
    const after = Math.max(sidelined.now, ...known.map((g) => g.start ?? -Infinity));
    rest = Math.max(0, rest - Math.max(0, (sidelined.from - after) / (DAYS_PER_POSTSEASON_GAME * DAY_MS)));
  }
  return known.reduce((sum, g) => sum + (plays(g) ? g.chance * perGame(g.lhpChance) : 0), 0) + rest * perGame(LEAGUE_LHP_SHARE);
}
