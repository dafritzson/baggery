// A player's batting stats for the player popup: the shapes the player-stats function returns,
// and the math for "last N games" lines.

/** Counting stats for a game, a stretch of games or a season. */
export interface Counts {
  g: number;
  pa: number;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  hbp: number;
  sf: number;
  tb: number;
}

export interface PlayerGame extends Counts {
  /** YYYY-MM-DD */
  date: string;
  /** Opponent's abbreviation, e.g. "BOS". */
  opponent: string;
  home: boolean;
}

export interface PlayerSeasonRow extends Counts {
  season: number;
  /** Team abbreviation, or "TOT" for a traded player's combined line. */
  team: string;
}

/** The regular season's first and last days, YYYY-MM-DD. */
export interface SeasonDates {
  start: string;
  end: string;
}

export interface PlayerStats {
  person: {
    id: number;
    name: string;
    position: string | null;
    team: string | null;
    age: number | null;
    bats: string | null;
  };
  /** Regular-season totals for the requested season; null if he didn't play. */
  season: Counts | null;
  /** Regular-season games that season, newest first. */
  games: PlayerGame[];
  /** When that regular season runs; null if MLB doesn't say. */
  dates: SeasonDates | null;
  /** Earlier MLB seasons, newest first. */
  years: PlayerSeasonRow[];
}

const KEYS: (keyof Counts)[] = ['g', 'pa', 'ab', 'r', 'h', 'doubles', 'triples', 'hr', 'rbi', 'bb', 'so', 'hbp', 'sf', 'tb'];

export function emptyCounts(): Counts {
  return { g: 0, pa: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sf: 0, tb: 0 };
}

export function sumCounts(lines: Counts[]): Counts {
  const total = emptyCounts();
  for (const line of lines) for (const k of KEYS) total[k] += line[k];
  return total;
}

/** Totals for the latest `n` games (games are newest first). */
export function lastGames(games: PlayerGame[], n: number): Counts {
  return sumCounts(games.slice(0, n));
}

export interface Rates {
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
}

/** AVG/OBP/SLG/OPS from counts; null where the denominator is zero. */
export function rates(c: Counts): Rates {
  const avg = c.ab ? c.h / c.ab : null;
  const obpDen = c.ab + c.bb + c.hbp + c.sf;
  const obp = obpDen ? (c.h + c.bb + c.hbp) / obpDen : null;
  const slg = c.ab ? c.tb / c.ab : null;
  const ops = obp !== null && slg !== null ? obp + slg : null;
  return { avg, obp, slg, ops };
}

/** ".312", "1.045", or "—" when there's no value. */
export function formatRate(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(3).replace(/^0\./, '.');
}

/** Stats the popup's chart can show. Counting stats are per game; rates run across the games shown. */
export type ChartStat = 'tb' | 'h' | 'hr' | 'rbi' | 'r' | 'bb' | 'so' | 'avg' | 'obp' | 'slg' | 'ops';

export const RATE_STATS: readonly ChartStat[] = ['avg', 'obp', 'slg', 'ops'];

export function isRateStat(stat: ChartStat): stat is keyof Rates {
  return RATE_STATS.includes(stat);
}

export interface ChartPoint {
  game: PlayerGame;
  /**
   * The count in that game, his running total, or the rate over the games up to and including it
   * (null before his first AB).
   */
  value: number | null;
}

/** On the season chart, rates only start after this many games, so a 3-for-4 opener doesn't set the scale. */
export const SEASON_RATE_WARMUP = 10;

/**
 * Points for the latest `n` games (all of them when `n` is null), oldest first. Counting stats are
 * that game's number, or with `total` the running total from the first game shown. Rates are running
 * too, so the last point is the rate over the whole stretch; for the season they count from opening
 * day but leave out the first SEASON_RATE_WARMUP games.
 */
export function chartPoints(
  games: PlayerGame[],
  stat: ChartStat,
  n: number | null,
  { total = false }: { total?: boolean } = {},
): ChartPoint[] {
  const shown = (n === null ? games : games.slice(0, n)).slice().reverse();
  if (!isRateStat(stat)) {
    let sum = 0;
    return shown.map((game) => ({ game, value: total ? (sum += game[stat]) : game[stat] }));
  }
  let counts = emptyCounts();
  const points = shown.map((game) => {
    counts = sumCounts([counts, game]);
    return { game, value: rates(counts)[stat] };
  });
  return n === null && points.length > SEASON_RATE_WARMUP ? points.slice(SEASON_RATE_WARMUP) : points;
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (YYYY-MM-DD), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** The date `n` days after `date` (YYYY-MM-DD). */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(date) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Where each point sits on a date axis, in days from `start`: the middle of its day, or for a
 * doubleheader, the middle of its half of the day. Points are oldest first.
 */
export function dayPositions(points: { game: { date: string } }[], start: string): number[] {
  const perDate = new Map<string, number>();
  for (const p of points) perDate.set(p.game.date, (perDate.get(p.game.date) ?? 0) + 1);
  const seen = new Map<string, number>();
  return points.map((p) => {
    const k = seen.get(p.game.date) ?? 0;
    seen.set(p.game.date, k + 1);
    return daysBetween(start, p.game.date) + (k + 0.5) / perDate.get(p.game.date)!;
  });
}

/** Stretches this long without a game are marked on the season chart; the All-Star break isn't. */
export const ABSENCE_DAYS = 10;

/** A stretch of the season with no games: its first and last days, and how many days that is. */
export interface Absence {
  from: string;
  to: string;
  days: number;
}

/**
 * Stretches of at least ABSENCE_DAYS from `start` to `end` in which he didn't play: before his
 * first game, between two games, or since his last one.
 */
export function absences(games: { date: string }[], start: string, end: string): Absence[] {
  if (end < start) return [];
  const dates = [...new Set(games.map((g) => g.date))].filter((d) => d >= start && d <= end).sort();
  // The days he played, with a day before `start` and after `end` as bookends.
  const bounds = [addDays(start, -1), ...dates, addDays(end, 1)];
  const out: Absence[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const days = daysBetween(bounds[i - 1], bounds[i]) - 1;
    if (days >= ABSENCE_DAYS) out.push({ from: addDays(bounds[i - 1], 1), to: addDays(bounds[i], -1), days });
  }
  return out;
}

/**
 * A running line (a total, or a rate) on a date axis, as [day, value] vertices, with days counted
 * from `start` like dayPositions. It stays flat through the days he didn't play and on to the end
 * of `end`, and only moves on the day of a game. With `fromZero` it starts at 0 on `start`. Points
 * without a value (no at-bats yet) are left out.
 */
export function seasonLine(
  points: ChartPoint[],
  start: string,
  end: string,
  { fromZero = false }: { fromZero?: boolean } = {},
): [number, number][] {
  const positions = dayPositions(points, start);
  const out: [number, number][] = fromZero ? [[0, 0]] : [];
  points.forEach((p, i) => {
    if (p.value === null) return;
    const prev = out.at(-1);
    // Hold the last value until the day before this game, so the climb takes one day at most.
    if (prev && positions[i] - prev[0] > 1) out.push([positions[i] - 1, prev[1]]);
    out.push([positions[i], p.value]);
  });
  const last = out.at(-1);
  const edge = daysBetween(start, end) + 1;
  if (last && last[0] < edge) out.push([edge, last[1]]);
  return out;
}
