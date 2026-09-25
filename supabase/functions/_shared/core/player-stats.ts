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
  /** The count in that game, or the rate over the games shown up to and including it (null before his first AB). */
  value: number | null;
}

/**
 * Points for the latest `n` games (all of them when `n` is null), oldest first. Counting stats are
 * that game's number; rates are running totals from the first game shown, so the last point is the
 * rate over the whole stretch.
 */
export function chartPoints(games: PlayerGame[], stat: ChartStat, n: number | null): ChartPoint[] {
  const shown = (n === null ? games : games.slice(0, n)).slice().reverse();
  if (!isRateStat(stat)) return shown.map((game) => ({ game, value: game[stat] }));
  let total = emptyCounts();
  return shown.map((game) => {
    total = sumCounts([total, game]);
    return { game, value: rates(total)[stat] };
  });
}
