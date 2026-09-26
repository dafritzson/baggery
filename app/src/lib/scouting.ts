import type { ManagerScouting } from '@core/almanac.ts';

export interface ScoutingStat {
  key: string;
  group: 'Drafting' | 'Redrafting' | 'Style' | 'Clutch';
  label: string;
  /** One line on what it measures. */
  help: string;
  value: (s: ManagerScouting) => number | null;
  format: (n: number) => string;
  /** Lower is better (only heartbreaks). Style stats have no better side. */
  lowerWins?: boolean;
  neutral?: boolean;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

/** The scouting stats, in the order the pages show them. */
export const SCOUTING_STATS: ScoutingStat[] = [
  { key: 'firstRound', group: 'Drafting', label: 'Round-1 picks', help: 'Average bags from their round-1 picks in Draft 1', value: (s) => s.firstRoundBags, format: (n) => n.toFixed(1) },
  { key: 'lateRound', group: 'Drafting', label: 'Late picks', help: 'Average bags from their round-3 and -4 picks in Draft 1', value: (s) => s.lateRoundBags, format: (n) => n.toFixed(1) },
  { key: 'draftValue', group: 'Drafting', label: 'Draft value', help: 'Bags per Draft 1 pick above what that pick number usually produces', value: (s) => s.draftValue, format: signed },
  { key: 'crystalBall', group: 'Drafting', label: 'Team picking', help: 'Draft 1 picks whose MLB team reached the Championship Series', value: (s) => s.crystalBall, format: pct },
  { key: 'swaps', group: 'Redrafting', label: 'Swaps a season', help: 'Players swapped in redrafts, per season', value: (s) => s.swapsPerSeason, format: (n) => n.toFixed(1), neutral: true },
  { key: 'swapWins', group: 'Redrafting', label: 'Swaps that paid off', help: 'The added player outscored what the dropped one did after', value: (s) => s.swapWinRate, format: pct },
  { key: 'power', group: 'Style', label: 'Bags from homers', help: 'Share of their bags that came from home runs', value: (s) => s.powerShare, format: pct, neutral: true },
  { key: 'obp', group: 'Style', label: 'On-base', help: 'Team on-base percentage while on their roster', value: (s) => s.obp, format: (n) => n.toFixed(3).replace(/^0/, '') },
  { key: 'topHeavy', group: 'Style', label: 'Star reliance', help: 'Share of a season’s bags from their best player', value: (s) => s.topHeavy, format: pct, neutral: true },
  { key: 'bigStage', group: 'Clutch', label: 'Rounds 2–3', help: 'Bags above or below the round’s average, in rounds 2 and 3', value: (s) => s.bigStage, format: signed },
  { key: 'escapes', group: 'Clutch', label: 'Close escapes', help: 'Cuts made by 3 bags or fewer', value: (s) => s.closeEscapes, format: String },
  { key: 'heartbreaks', group: 'Clutch', label: 'Heartbreaks', help: 'Cuts missed by 3 bags or fewer', value: (s) => s.heartbreaks, format: String, lowerWins: true },
];

/** The radar's axes: skills where more is better. */
export const RADAR_AXES: { label: string; value: (s: ManagerScouting) => number | null }[] = [
  { label: 'Round-1 picks', value: (s) => s.firstRoundBags },
  { label: 'Late picks', value: (s) => s.lateRoundBags },
  { label: 'Team picking', value: (s) => s.crystalBall },
  { label: 'Swap wins', value: (s) => s.swapWinRate },
  { label: 'On-base', value: (s) => s.obp },
  { label: 'Rounds 2–3', value: (s) => s.bigStage },
];

/** A manager's value on each axis, scaled from the league's lowest (0.15) to its highest (1). */
export function radarValues(all: ManagerScouting[], s: ManagerScouting): number[] {
  return RADAR_AXES.map((axis) => {
    const values = all.map(axis.value).filter((v): v is number => v !== null);
    const v = axis.value(s);
    if (v === null || !values.length) return 0.15;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return hi === lo ? 0.6 : 0.15 + (0.85 * (v - lo)) / (hi - lo);
  });
}

/** Where a manager ranks in a stat, e.g. 1 of 9 (ties share a rank). */
export function rankOf(all: ManagerScouting[], stat: ScoutingStat, s: ManagerScouting): { rank: number; of: number } | null {
  const v = stat.value(s);
  const values = all.map(stat.value).filter((x): x is number => x !== null);
  if (v === null) return null;
  const better = values.filter((x) => (stat.lowerWins ? x < v : x > v)).length;
  return { rank: better + 1, of: values.length };
}
