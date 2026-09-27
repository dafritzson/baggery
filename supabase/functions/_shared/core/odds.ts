// Each postseason team's odds from here on: its chance to win the series it's in (or waiting for)
// and how many more games it expects to play, for the draft table's Adv% and xBags. A simple
// model: regular-season win %, shrunk toward .500, for each team's strength; log5 plus a small
// home edge for each game; the real series formats and home-field patterns; and MLB's fixed
// bracket from the seeds. Series already under way start from their score, so it's never stale.
// Pure, so the unit tests can run it without Supabase.

import type { GameType } from './types.ts';

export interface OddsTeam {
  teamId: number;
  league: 'AL' | 'NL';
  /** 1–6 in its league: 1–3 division winners, 4–6 wild cards. */
  seed: number;
  /** Regular-season wins; losses are taken as 162 − wins. */
  wins: number;
}

/** A series as far as it's got (a `Series` from schedule.ts fits). */
export interface SeriesState {
  gameType: GameType;
  teams: [number, number];
  wins: [number, number];
  winner: number | null;
}

export interface TeamOdds {
  /**
   * Chance to get through the fantasy round it's in: win the Division Series (round 1: Wild Card
   * and Division Series), the LCS (round 2) or the World Series (round 3).
   */
  advance: number;
  /** Expected games still to play this postseason. */
  games: number;
  /** Chance to win the World Series. */
  title: number;
}

/** Games of .500 ball added to a team's record: a season's record overstates how good a team is. */
const SHRINK_GAMES = 70;
const SEASON_GAMES = 162;
/** Home team's chance to win a game between even teams. */
const HOME_WIN = 0.52;

const BEST_OF: Record<GameType, number> = { F: 3, D: 5, L: 7, W: 7 };
/** The series that ends each series' fantasy round. */
const ROUND_ENDS_WITH: Record<GameType, GameType> = { F: 'D', D: 'D', L: 'L', W: 'W' };
/** Which games the higher seed hosts: Wild Card all 3; 2-2-1; 2-3-2. */
const HOSTS: Record<number, boolean[]> = {
  3: [true, true, true],
  5: [true, true, false, false, true],
  7: [true, true, false, false, false, true, true],
};

/** A team's true strength, as a win % against an average team. */
export function strength(wins: number): number {
  return (wins + SHRINK_GAMES / 2) / (SEASON_GAMES + SHRINK_GAMES);
}

/** Chance that a (strength `a`) beats b in one game (log5), with the home edge for whoever hosts. */
export function gameWinChance(a: number, b: number, aHome: boolean): number {
  const logOdds = Math.log((a * (1 - b)) / (b * (1 - a))) + (aHome ? 1 : -1) * Math.log(HOME_WIN / (1 - HOME_WIN));
  return 1 / (1 + Math.exp(-logOdds));
}

/**
 * The higher seed's chance to win a best-of-n series from `wins` (higher seed's first), and the
 * expected games still to play.
 */
export function seriesOdds(high: number, low: number, bestOf: number, wins: [number, number] = [0, 0]): { win: number; games: number } {
  const needed = Math.floor(bestOf / 2) + 1;
  const hosts = HOSTS[bestOf] ?? Array(bestOf).fill(true);
  const memo = new Map<string, { win: number; games: number }>();
  const from = (w: number, l: number): { win: number; games: number } => {
    if (w >= needed) return { win: 1, games: 0 };
    if (l >= needed) return { win: 0, games: 0 };
    const key = `${w}-${l}`;
    const known = memo.get(key);
    if (known) return known;
    const p = gameWinChance(high, low, hosts[w + l] ?? true);
    const won = from(w + 1, l);
    const lost = from(w, l + 1);
    const result = { win: p * won.win + (1 - p) * lost.win, games: 1 + p * won.games + (1 - p) * lost.games };
    memo.set(key, result);
    return result;
  };
  return from(wins[0], wins[1]);
}

/** Who might be in a slot of the bracket, with their chances. */
type Field = Map<number, number>;

/**
 * Every team's odds, walking the bracket: Wild Cards 3 v 6 and 4 v 5, Division Series 1 v the 4/5
 * winner and 2 v the 3/6 winner, the LCS, and the World Series (home field to the better record).
 * Null when the seeds aren't a full 6 per league (e.g. before the pool is synced, or a past
 * season's format).
 */
export function postseasonOdds(teams: OddsTeam[], series: SeriesState[]): Map<number, TeamOdds> | null {
  const byId = new Map(teams.map((t) => [t.teamId, t]));
  const seeds = (league: 'AL' | 'NL') => {
    const bySeed = new Map(teams.filter((t) => t.league === league).map((t) => [t.seed, t.teamId]));
    return [1, 2, 3, 4, 5, 6].map((s) => bySeed.get(s));
  };
  const al = seeds('AL');
  const nl = seeds('NL');
  if (al.includes(undefined) || nl.includes(undefined)) return null;

  const games = new Map<number, number>(teams.map((t) => [t.teamId, 0]));
  // Each team's current series (the first one it's in that isn't decided yet) and its chance of
  // being in it; teams that lost a series are out.
  const current = new Map<number, { type: GameType; p: number }>();
  const out = new Set<number>();
  // Who wins each kind of series, with their chances.
  const winners = new Map<GameType, Field>();
  const find = (type: GameType, a: number, b: number) =>
    series.find((s) => s.gameType === type && s.teams.includes(a) && s.teams.includes(b));

  /** Plays one slot of the bracket between two fields; returns who comes out of it. */
  const play = (type: GameType, fieldA: Field, fieldB: Field, hostsFirst: (a: number, b: number) => boolean): Field => {
    const won: Field = new Map();
    // Chance the team is in this slot with the series still open.
    const open = new Map<number, number>();
    const add = (m: Map<number, number>, id: number, p: number) => m.set(id, (m.get(id) ?? 0) + p);
    for (const [a, pa] of fieldA) {
      for (const [b, pb] of fieldB) {
        const p = pa * pb;
        if (p === 0) continue;
        const [high, low] = hostsFirst(a, b) ? [a, b] : [b, a];
        const state = find(type, a, b);
        let win: number;
        let left: number;
        const decided = state?.winner != null;
        if (decided) {
          win = state!.winner === high ? 1 : 0;
          left = 0;
          out.add(win ? low : high);
        } else {
          const w: [number, number] = state ? (state.teams[0] === high ? state.wins : [state.wins[1], state.wins[0]]) : [0, 0];
          ({ win, games: left } = seriesOdds(strength(byId.get(high)!.wins), strength(byId.get(low)!.wins), BEST_OF[type], w));
        }
        games.set(high, games.get(high)! + p * left);
        games.set(low, games.get(low)! + p * left);
        if (!decided) {
          add(open, high, p);
          add(open, low, p);
        }
        add(won, high, p * win);
        add(won, low, p * (1 - win));
      }
    }
    for (const [id, p] of open) if (!current.has(id) && !out.has(id)) current.set(id, { type, p });
    const all = winners.get(type) ?? new Map();
    for (const [id, p] of won) all.set(id, (all.get(id) ?? 0) + p);
    winners.set(type, all);
    return won;
  };

  const one = (id: number): Field => new Map([[id, 1]]);
  const league = (s: (number | undefined)[]) => {
    const [s1, s2, s3, s4, s5, s6] = s as number[];
    const seedOf = new Map(s.map((id, i) => [id!, i + 1]));
    const higherSeed = (a: number, b: number) => seedOf.get(a)! < seedOf.get(b)!;
    const wc36 = play('F', one(s3), one(s6), higherSeed);
    const wc45 = play('F', one(s4), one(s5), higherSeed);
    const ds1 = play('D', one(s1), wc45, higherSeed);
    const ds2 = play('D', one(s2), wc36, higherSeed);
    return play('L', ds1, ds2, higherSeed);
  };
  const alChamp = league(al);
  const nlChamp = league(nl);
  const betterRecord = (a: number, b: number) => byId.get(a)!.wins >= byId.get(b)!.wins;
  const champion = play('W', alChamp, nlChamp, betterRecord);

  const advance = (id: number) => {
    const now = current.get(id);
    if (!now || out.has(id)) return 0;
    return (winners.get(ROUND_ENDS_WITH[now.type])?.get(id) ?? 0) / now.p;
  };
  return new Map(
    teams.map((t) => [t.teamId, { advance: advance(t.teamId), games: games.get(t.teamId) ?? 0, title: champion.get(t.teamId) ?? 0 }]),
  );
}
