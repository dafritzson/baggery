// Monte Carlo for the ghost team. The rule adopted is --ghost-in-cs (docs/RULES.md); the others
// are the versions it was chosen over. The 2 managers knocked out after the Division Series each
// add a hitter at the end of the Championship Series redraft; the 2 knocked out after the CS each
// add one in the World Series draft. Those 4 hitters are the ghost team,
// scored against the 3 finalists in the WS round. If the 4 eliminated managers' bags (Wild Card
// through CS) plus the bags the ghost's CS picks earn in the CS beat the 3 finalists' bags, the
// ghost picks first in the WS draft; otherwise it picks after the finalists.
//
// With --own-rosters (Alex's version), each eliminated manager instead gives the ghost a hitter
// from their own roster whose team is still alive. A manager with none drafts an undrafted hitter
// with the last pick of that draft, after everyone else, and so does a DS-out manager replacing a
// hitter knocked out in the CS (the redraft version). There's no trigger in this version.
// --two-hitters is the same with a ghost of 2: each pair of eliminated managers (the 2 out after
// the DS, then the 2 out after the CS) gives 1 hitter, the best one still alive on either roster.
//
// With --ghost-in-cs, the ghost plays the CS round with its 2 hitters (drafted with the last picks
// of Draft 3) and always advances; the bottom 2 of the 5 other teams are still the ones out. The 2
// CS-out managers then join it, and it drafts in the WS snake with the finalists, placed by CS
// bags: its first 2 turns add hitters (up to 4), later ones redraft like everyone else's.
//
//   npx tsx scripts/ghost-sim.ts                          1995–2025, 20,000 runs per season
//   npx tsx scripts/ghost-sim.ts --from 2012 --runs 5000 --seed 7 --by-year
//   npx tsx scripts/ghost-sim.ts --real-brackets          each season's real postseason bracket
//   npx tsx scripts/ghost-sim.ts --own-rosters            Alex's version
//   npx tsx scripts/ghost-sim.ts --two-hitters            Alex's version with a ghost of 2
//   npx tsx scripts/ghost-sim.ts --ghost-in-cs            the ghost plays the CS round
//   npx tsx scripts/ghost-sim.ts --ghost-in-cs --release roster
//
// --release puts eliminated managers' hitters back in the pool, for anyone to draft: the 2 out
// after the DS before Draft 3, the 2 out after the CS before Draft 4. `roster` releases the
// hitters on their roster when they're knocked out, `discarded` the ones they dropped in earlier
// redrafts, and `both` both. It also prints how many released hitters each draft gets back
// (counting only those whose MLB team is still playing) and how many of them are drafted again.
//
// Each run takes a real season and plays today's 12-team postseason with its teams: in each
// league the 3 division winners (seeds 1–3, the top 2 with byes) and the 3 best other records.
// Each team's hitters are the non-pitchers who batted for it in the last 30 days of the regular
// season, batting as often per game as they did then, adjusted to how October lineups tighten.
// Series are played game by game from the teams' records, and each plate appearance from the
// hitter's regular-season rates, regressed toward league average. Three adjustments, measured on postseason box scores:
//
//   --postseason-hitting 0.88  hitters produce 88% of the bags their regular-season rates predict
//                              (1995–2025; by season anywhere from 79% to 103%)
//   --series-shrink 0.5        win % pulled halfway to .500: favorites won 53% of 2012–2025
//                              series, where log5 on raw win % predicts 58% (0: coin flips)
//   --swing 0.14               a lineup's bags in a game rise and fall together (same pitcher,
//                              park, weather): 2012–2025 team games vary by about 14% more than
//                              independent plate appearances allow
//
// Seven simulated managers draft by the rules, valuing hitters by expected bags, each with their
// own noise; in redrafts they replace eliminated players and swap for upgrades. The defaults
// match the league's real swap counts (see the sanity check):
//
//   --horizon 0.25   weight on games after the next round when valuing a hitter
//   --upgrade 0.05   how much better an add must look than a live player it drops
//   --noise 0.25     spread of managers' opinions of a hitter (log scale)
//
// The league's real seasons in history/ are printed beside the simulated ones as a sanity check.
// The first run downloads MLB data into history/.cache, which takes a few minutes.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadPostseason,
  type Postseason as RealPostseason,
  regularSeasonGames,
  type SeasonHitting,
  seasonHitting,
  type Standing,
  standings,
  teamPlateAppearances,
} from './history/mlb.ts';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const FROM = arg('from', 1995);
const TO = arg('to', 2025);
const RUNS = arg('runs', 20000);
const SEED = arg('seed', 1);
const REAL_BRACKETS = process.argv.includes('--real-brackets');
const BY_YEAR = process.argv.includes('--by-year');
const TWO_HITTERS = process.argv.includes('--two-hitters');
const OWN_ROSTERS = TWO_HITTERS || process.argv.includes('--own-rosters');
const GHOST_IN_CS = process.argv.includes('--ghost-in-cs');
const RELEASE = process.argv.includes('--release') ? process.argv[process.argv.indexOf('--release') + 1] : 'none';
if (!['none', 'roster', 'discarded', 'both'].includes(RELEASE)) throw new Error('--release takes roster, discarded or both.');
const POSTSEASON_HITTING = arg('postseason-hitting', 0.88);
const SERIES_SHRINK = arg('series-shrink', 0.5);
const SWING = arg('swing', 0.14);
const HORIZON = arg('horizon', 0.25);
const UPGRADE = arg('upgrade', 0.05);
const NOISE = arg('noise', 0.25);

const MANAGERS = 7;
/** League-average plate appearances added to each hitter's regular-season line. */
const REGRESS_PA = 200;
/** Playing time comes from each team's last this-many days of the regular season. */
const RECENT_DAYS = 30;
/**
 * [late-season, October] plate appearances per team game, averaged over the hitters of every
 * 2012–2025 playoff team: in October the regulars bat a little more and the bench a lot less.
 */
const OCTOBER_PLAYING_TIME = [
  [0, 0],
  [0.25, 0.14],
  [0.73, 0.47],
  [1.23, 0.95],
  [1.73, 1.5],
  [2.21, 2.09],
  [2.72, 2.87],
  [3.25, 3.54],
  [3.74, 3.97],
  [4.19, 4.21],
  [4.57, 4.44],
];
function octoberPlayingTime(late: number): number {
  const knots = OCTOBER_PLAYING_TIME;
  const k = knots.findIndex(([x]) => x >= late);
  if (k < 0) return knots[knots.length - 1][1];
  if (k === 0) return knots[0][1];
  const [[x0, y0], [x1, y1]] = [knots[k - 1], knots[k]];
  return y0 + ((late - x0) / (x1 - x0)) * (y1 - y0);
}
const HISTORY = join(import.meta.dirname, '../history');

type Round = 'F' | 'D' | 'L' | 'W';
const ROUNDS: Round[] = ['F', 'D', 'L', 'W'];
const [F, D, L, W] = [0, 1, 2, 3];

// Seeded (mulberry32) so a run can be repeated.
let state = SEED;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

interface Hitter {
  id: number;
  team: number;
  /** Expected plate appearances per team game in October. */
  paPerGame: number;
  /** Cumulative chance of a 1B, 2B, 3B, HR per plate appearance. */
  cum: [number, number, number, number];
  /** Expected bags per game. */
  perGame: number;
}

interface Series {
  round: number;
  bestOf: number;
  /** A team with a bye into this round, or the winner of an earlier series (its index). */
  slots: ({ team: number } | { winnerOf: number })[];
}

interface Postseason {
  year: number;
  series: Series[];
  winPct: Map<number, number>;
  hitters: Hitter[];
  /**
   * value[round * hitters.length + i]: what managers draft hitter i by in the draft before that
   * round, before their own noise. His expected bags in the games his team can expect from that
   * round on (later rounds weighted by --horizon), since a hitter you keep saves a redraft pick.
   */
  value: Float64Array;
}

const log5 = (a: number, b: number) => (a - a * b) / (a + b - 2 * a * b);

/** Plays every series; returns the games each team plays in each round. */
function playBracket(series: Series[], winPct: Map<number, number>): Map<number, number>[] {
  const strength = (team: number) => 0.5 + SERIES_SHRINK * ((winPct.get(team) ?? 0.5) - 0.5);
  const winners: number[] = [];
  const games = ROUNDS.map(() => new Map<number, number>());
  for (const s of series) {
    const [a, b] = s.slots.map((slot) => ('team' in slot ? slot.team : winners[slot.winnerOf]));
    const need = Math.ceil(s.bestOf / 2);
    const p = log5(strength(a), strength(b));
    let [wa, wb] = [0, 0];
    while (wa < need && wb < need) rand() < p ? wa++ : wb++;
    winners.push(wa === need ? a : b);
    games[s.round].set(a, wa + wb);
    games[s.round].set(b, wa + wb);
  }
  return games;
}

/**
 * Today's format. In each league the division winners are seeds 1–3 by record and the 3 best
 * other records seeds 4–6; 3 v 6 and 4 v 5 play best-of-3, their winners play 2 and 1 best-of-5.
 */
function currentBracket(year: number, table: Standing[]): Series[] {
  const pct = (t: Standing) => t.wins / (t.wins + t.losses);
  const series: Series[] = [];
  const add = (round: number, bestOf: number, slots: Series['slots']) => series.push({ round, bestOf, slots }) - 1;
  const pennants: number[] = [];
  for (const league of ['AL', 'NL'] as const) {
    const teams = table.filter((t) => t.league === league).sort((a, b) => pct(b) - pct(a));
    const divisions = [...new Set(teams.map((t) => t.divisionId))];
    if (divisions.length !== 3) throw new Error(`${year} ${league}: expected 3 divisions, found ${divisions.length}`);
    const champs = divisions.map((d) => teams.filter((t) => t.divisionId === d).sort((a, b) => a.divisionRank - b.divisionRank)[0]);
    champs.sort((a, b) => pct(b) - pct(a));
    const [s1, s2, s3, s4, s5, s6] = [...champs, ...teams.filter((t) => !champs.includes(t)).slice(0, 3)].map((t) => ({
      team: t.teamId,
    }));
    const wc36 = add(F, 3, [s3, s6]);
    const wc45 = add(F, 3, [s4, s5]);
    const ds1 = add(D, 5, [s1, { winnerOf: wc45 }]);
    const ds2 = add(D, 5, [s2, { winnerOf: wc36 }]);
    pennants.push(add(L, 7, [{ winnerOf: ds1 }, { winnerOf: ds2 }]));
  }
  add(W, 7, pennants.map((i) => ({ winnerOf: i })));
  return series;
}

/** The bracket a season really had: every series after a team's first is fed by its last one. */
function realBracket(ps: RealPostseason): Series[] {
  const grouped = new Map<string, { round: number; teams: number[]; bestOf: number }>();
  for (const g of ps.games) {
    const teams = [g.home_team_id, g.away_team_id].sort((a, b) => a - b);
    const key = `${g.game_type}:${teams.join('-')}`;
    const s = grouped.get(key) ?? { round: ROUNDS.indexOf(g.game_type as Round), teams, bestOf: 0 };
    s.bestOf = Math.max(s.bestOf, g.games_in_series ?? 0, g.series_game_number ?? 0);
    grouped.set(key, s);
  }
  const ordered = [...grouped.values()].sort((a, b) => a.round - b.round);
  return ordered.map((s) => ({
    round: s.round,
    bestOf: s.bestOf,
    slots: s.teams.map((team) => {
      let before = -1;
      ordered.forEach((p, i) => {
        if (p.round < s.round && p.teams.includes(team)) before = i;
      });
      return before >= 0 ? { winnerOf: before } : { team };
    }),
  }));
}

/**
 * Each team's hitters at the end of the regular season, with their playing time and rates.
 * (MLB's active rosters by date are incomplete before about 2009; who batted in the last 30 days
 * is complete, and is the team's lineup going into the postseason.)
 */
async function lineups(year: number, teams: number[], season: Map<number, SeasonHitting>): Promise<Hitter[]> {
  const games = await regularSeasonGames(year);
  const last = games.reduce((d, g) => (g.date > d ? g.date : d), '');
  const start = new Date(Date.parse(last) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = games.filter((g) => g.date >= start);

  const KEYS = ['pa', 'singles', 'doubles', 'triples', 'hr'] as const;
  const avg: SeasonHitting = { pa: 0, singles: 0, doubles: 0, triples: 0, hr: 0 };
  for (const s of season.values()) if (s.pa >= 100) for (const k of KEYS) avg[k] += s[k];
  const none: SeasonHitting = { pa: 0, singles: 0, doubles: 0, triples: 0, hr: 0 };

  const batted = await Promise.all(teams.map((t) => teamPlateAppearances(t, start, last)));
  const hitters: Hitter[] = [];
  teams.forEach((team, k) => {
    const teamGames = recent.filter((g) => g.teams.includes(team)).length;
    for (const p of batted[k]) {
      // Pitchers aren't draftable hitters; two-way players (TWP) are.
      if (p.position === 'P') continue;
      const paPerGame = octoberPlayingTime(p.pa / teamGames);
      const s = season.get(p.id) ?? none;
      const rate = (key: (typeof KEYS)[number]) =>
        (POSTSEASON_HITTING * (s[key] + (avg[key] * REGRESS_PA) / avg.pa)) / (s.pa + REGRESS_PA);
      const [p1, p2, p3, p4] = [rate('singles'), rate('doubles'), rate('triples'), rate('hr')];
      hitters.push({
        id: p.id,
        team,
        paPerGame,
        cum: [p1, p1 + p2, p1 + p2 + p3, p1 + p2 + p3 + p4],
        perGame: paPerGame * (p1 + 2 * p2 + 3 * p3 + 4 * p4),
      });
    }
  });
  return hitters;
}

async function load(year: number): Promise<Postseason> {
  const [season, table] = await Promise.all([seasonHitting(year), standings(year)]);
  const winPct = new Map(table.map((t) => [t.teamId, t.wins / (t.wins + t.losses)]));
  const series = REAL_BRACKETS ? realBracket(await loadPostseason(year)) : currentBracket(year, table);
  const teams = [...new Set(series.flatMap((s) => s.slots.flatMap((slot) => ('team' in slot ? [slot.team] : []))))];
  const hitters = await lineups(year, teams, season);

  // Each team's outlook before each round, as the managers see it: the games it can expect,
  // given it's still alive then (it plays that round or a later one).
  const OUTLOOK_RUNS = 5000;
  const outlook = ROUNDS.map(() => new Map<number, { alive: number; games: number }>());
  for (let k = 0; k < OUTLOOK_RUNS; k++) {
    const games = playBracket(series, winPct);
    for (const team of teams) {
      const played = games.map((g) => g.get(team) ?? 0);
      let last = -1;
      played.forEach((g, r) => {
        if (g > 0) last = r;
      });
      for (let r = 0; r <= last; r++) {
        const o = outlook[r].get(team) ?? { alive: 0, games: 0 };
        o.alive++;
        o.games += played[r] + HORIZON * played.slice(r + 1).reduce((s, g) => s + g, 0);
        outlook[r].set(team, o);
      }
    }
  }
  const value = new Float64Array(4 * hitters.length);
  for (let r = 0; r < 4; r++) {
    hitters.forEach((h, i) => {
      const o = outlook[r].get(h.team);
      value[r * hitters.length + i] = o ? (h.perGame * o.games) / o.alive : 0;
    });
  }
  return { year, series, winPct, hitters, value };
}

interface Run {
  trigger: boolean;
  /** Ghost's share of the WS round win (ties split like a drink-off), by [redraft][first]. */
  win: number[][];
  /** For the sanity check. */
  topFinalistWS: number;
  gap: number;
  swapsPerManager: number[];
  /**
   * Undrafted regulars (each WS team's 9 hitters who bat most) on the WS teams: after Draft 3
   * (before the ghost's CS picks), and after Draft 4 (what's left for a ghost that picks last).
   */
  regularsLeft: number[];
  /** Bags from the Wild Card through the CS: the 3 finalists', and the 4 eliminated managers'. */
  bagsToCS: number[];
  /**
   * With --own-rosters: DS-out and CS-out managers (pairs, with --two-hitters) who had no hitter
   * still alive to give.
   */
  noneAlive: number[];
  /** With --ghost-in-cs: the ghost's slot in the WS snake (0 = picks first). */
  ghostSlot: number;
  /**
   * With --release, for Drafts 3 and 4: hitters released whose MLB team plays the next round
   * (the ones a manager can draft), and how many of them are drafted again in that draft.
   */
  released: number[];
  retaken: number[];
}

function simulate(ps: Postseason): Run {
  const hs = ps.hitters;
  const n = hs.length;

  // Play the bracket. games[round * n + i]: games hitter i's team plays in that round.
  const teamGames = playBracket(ps.series, ps.winPct);
  const games = new Int32Array(4 * n);
  for (let r = 0; r < 4; r++) for (let i = 0; i < n; i++) games[r * n + i] = teamGames[r].get(hs[i].team) ?? 0;
  const plays = (r: number, i: number) => games[r * n + i] > 0;
  const regulars = new Set(topNine(hs.map((h, i) => ({ team: h.team, id: i, pa: h.paPerGame }))));

  // How hot each team's lineup is in each game (1 = as expected).
  const swings = new Map<string, number[]>();
  const swing = (r: number, team: number, g: number) => {
    const key = `${r}:${team}`;
    let xs = swings.get(key);
    if (!xs) swings.set(key, (xs = []));
    while (xs.length <= g) xs.push(Math.exp(SWING * gauss() - (SWING * SWING) / 2));
    return xs[g];
  };
  // Each hitter's bags in a round, drawn the first time anyone needs them.
  const memo = new Float64Array(4 * n).fill(-1);
  const bags = (r: number, i: number) => {
    if (memo[r * n + i] >= 0) return memo[r * n + i];
    const h = hs[i];
    let tb = 0;
    for (let g = 0; g < games[r * n + i]; g++) {
      const hot = swing(r, h.team, g);
      for (let k = 0; k < 6; k++) {
        if (rand() >= h.paPerGame / 6) continue;
        const u = rand() / hot;
        tb += u < h.cum[0] ? 1 : u < h.cum[1] ? 2 : u < h.cum[2] ? 3 : u < h.cum[3] ? 4 : 0;
      }
    }
    return (memo[r * n + i] = tb);
  };
  const rosterBags = (r: number, roster: number[]) => roster.reduce((s, i) => s + bags(r, i), 0);

  // Each manager's opinion of each hitter in the draft before round r.
  const noise = new Float64Array(MANAGERS * n);
  for (let k = 0; k < noise.length; k++) noise[k] = Math.exp(NOISE * gauss());
  const opinion = (m: number, r: number, i: number) => ps.value[r * n + i] * noise[m * n + i];
  // Draft 1's pool is every postseason team; later ones, the teams playing the next round.
  const best = (m: number, r: number, drafted: Uint8Array) => {
    let pick = -1;
    let top = -1;
    for (let i = 0; i < n; i++) {
      if (drafted[i] || (r > F && !plays(r, i))) continue;
      const o = opinion(m, r, i);
      if (o > top) [pick, top] = [i, o];
    }
    return pick;
  };
  const snake = (order: number[], round: number) => (round % 2 ? [...order].reverse() : order);
  // A team short of 4 hitters adds instead of swapping. `who` is whose opinions a team drafts by.
  // Who each manager has dropped, and with --release, putting eliminated managers' hitters back.
  const dropped: number[][] = Array.from({ length: MANAGERS }, () => []);
  // Returns the released hitters whose team plays round r.
  const release = (out: number[], rosters: number[][], drafted: Uint8Array, r: number) => {
    // A hitter they dropped may have been released before and be on someone's roster again.
    const kept = new Set(rosters.filter((_, m) => !out.includes(m)).flat());
    const usable = new Set<number>();
    for (const m of out) {
      const freed = [
        ...(RELEASE === 'roster' || RELEASE === 'both' ? rosters[m] : []),
        ...(RELEASE === 'discarded' || RELEASE === 'both' ? dropped[m] : []),
      ];
      for (const i of freed) {
        if (kept.has(i)) continue;
        drafted[i] = 0;
        if (plays(r, i)) usable.add(i);
      }
    }
    return [...usable];
  };
  const redraft = (order: number[], rosters: number[][], drafted: Uint8Array, r: number, who = (m: number) => m) => {
    const yielded = new Set<number>();
    let swaps = 0;
    for (let round = 0; round < 4; round++) {
      for (const m of snake(order, round)) {
        if (yielded.has(m)) continue;
        const o = who(m);
        const roster = rosters[m];
        const add = best(o, r, drafted);
        if (roster.length < 4) {
          if (add >= 0) {
            roster.push(add);
            drafted[add] = 1;
          } else {
            yielded.add(m);
          }
          continue;
        }
        const worth = (i: number) => (plays(r, i) ? opinion(o, r, i) : 0);
        const worst = roster.reduce((w, i, k) => (worth(i) < worth(roster[w]) ? k : w), 0);
        const dead = !plays(r, roster[worst]);
        if (add >= 0 && (dead || opinion(o, r, add) > worth(roster[worst]) * (1 + UPGRADE))) {
          dropped[m]?.push(roster[worst]);
          roster[worst] = add;
          drafted[add] = 1;
          swaps++;
        } else {
          yielded.add(m);
        }
      }
    }
    return swaps;
  };
  // Best first; a tie at the cut is a drink-off, a coin flip here.
  const rank = (ms: number[], score: (m: number) => number) => {
    const key = new Map(ms.map((m) => [m, score(m) + rand() / 2]));
    return [...ms].sort((a, b) => key.get(b)! - key.get(a)!);
  };

  // Draft 1 (before the Wild Card) and Draft 2 (before the Division Series).
  const drafted = new Uint8Array(n);
  const rosters: number[][] = Array.from({ length: MANAGERS }, () => []);
  const order1 = shuffle([...Array(MANAGERS).keys()]);
  for (let round = 0; round < 4; round++) {
    for (const m of snake(order1, round)) {
      const pick = best(m, F, drafted);
      rosters[m].push(pick);
      drafted[pick] = 1;
    }
  }
  const total = new Array<number>(MANAGERS).fill(0);
  for (let m = 0; m < MANAGERS; m++) total[m] += rosterBags(F, rosters[m]);
  const swaps2 = redraft(shuffle([...Array(MANAGERS).keys()]), rosters, drafted, D);
  for (let m = 0; m < MANAGERS; m++) total[m] += rosterBags(D, rosters[m]);

  // Fantasy round 1: the bottom 2 are out. Draft 3, then the ghost's CS picks (lower rank first).
  const ranked1 = rank([...Array(MANAGERS).keys()], (m) => total[m]);
  const alive2 = ranked1.slice(0, 5);
  const dsOut = ranked1.slice(5).reverse();
  const released3 = release(dsOut, rosters, drafted, L);
  const swaps3 = redraft(alive2, rosters, drafted, L);
  const regular = (i: number) => plays(W, i) && regulars.has(i);
  const regularsBefore = hs.filter((_, i) => regular(i) && !drafted[i]).length;
  // With --own-rosters, the hitter a manager values most on their own roster whose team plays
  // round r (they're all drafted already, so this takes nothing from the pool).
  const ownPick = (m: number, r: number) => {
    let pick = -1;
    for (const i of rosters[m]) if (plays(r, i) && (pick < 0 || opinion(m, r, i) > opinion(m, r, pick))) pick = i;
    return pick;
  };
  // Who gives the ghost a hitter: each eliminated manager, or with --two-hitters each pair, whose
  // best hitter still alive on either roster goes in. The lower-ranked manager comes first.
  const givers = (out: number[]) => (TWO_HITTERS ? [out] : out.map((m) => [m]));
  const give = (ms: number[], r: number) => {
    let pick: { i: number; by: number } | null = null;
    for (const m of ms) {
      const i = ownPick(m, r);
      if (i >= 0 && (!pick || opinion(m, r, i) > opinion(pick.by, r, pick.i))) pick = { i, by: m };
    }
    return pick;
  };
  const noneAlive = [0, 0];
  const ghostCS: { i: number; by: number }[] = [];
  const draftCS: number[] = [];
  for (const ms of givers(dsOut)) {
    const own = OWN_ROSTERS ? give(ms, L) : null;
    if (own) ghostCS.push(own);
    else draftCS.push(ms[0]);
  }
  if (OWN_ROSTERS) noneAlive[0] = draftCS.length;
  for (const m of draftCS) {
    const i = best(m, L, drafted);
    if (i >= 0) {
      ghostCS.push({ i, by: m });
      drafted[i] = 1;
    }
  }
  const retaken3 = released3.filter((i) => drafted[i]).length;

  // Fantasy round 2: the bottom 2 are out. The trigger compares bags from the Wild Card on.
  const round2 = new Map(alive2.map((m) => [m, rosterBags(L, rosters[m])]));
  for (const [m, b] of round2) total[m] += b;
  const ranked2 = rank(alive2, (m) => round2.get(m)!);
  const finalists = ranked2.slice(0, 3);
  const csOut = ranked2.slice(3).reverse();
  const released4 = release(csOut, rosters, drafted, W);
  const sum = (ms: number[]) => ms.reduce((s, m) => s + total[m], 0);
  const ghostCSBags = ghostCS.reduce((s, g) => s + bags(L, g.i), 0);
  const trigger = !OWN_ROSTERS && !GHOST_IN_CS && sum(dsOut) + ghostCSBags + sum(csOut) > sum(finalists);
  if (OWN_ROSTERS) noneAlive[1] = givers(csOut).filter((ms) => !give(ms, W)).length;

  // Draft 4 and the WS round, with the ghost picking last or first, with or without redrafting
  // CS picks whose team is out. Every version sees the same games and the same bags.
  const wsRound = (ghostRedraft: boolean, ghostFirst: boolean) => {
    const rs = rosters.map((r) => [...r]);
    const d = drafted.slice();
    const ghost = ghostCS.map((g) => ({ ...g }));
    const ghostPicks = () => {
      if (ghostRedraft) {
        for (const g of ghost) {
          const add = plays(W, g.i) ? -1 : best(g.by, W, d);
          if (add >= 0) {
            g.i = add;
            d[add] = 1;
          }
        }
      }
      for (const ms of givers(csOut)) {
        const own = OWN_ROSTERS ? give(ms, W) : null;
        if (own) {
          ghost.push(own);
          continue;
        }
        const add = best(ms[0], W, d);
        if (add >= 0) {
          ghost.push({ i: add, by: ms[0] });
          d[add] = 1;
        }
      }
    };
    if (ghostFirst) ghostPicks();
    const swaps = redraft(finalists, rs, d, W);
    // What a ghost picking last chooses from.
    const left = hs.filter((_, i) => regular(i) && !d[i]).length;
    if (!ghostFirst) ghostPicks();
    const top = Math.max(...finalists.map((m) => rosterBags(W, rs[m])));
    const tied = finalists.filter((m) => rosterBags(W, rs[m]) === top).length;
    const g = ghost.reduce((s, x) => s + bags(W, x.i), 0);
    return { win: g > top ? 1 : g === top ? 1 / (tied + 1) : 0, top, swaps, left, d };
  };
  const plain = wsRound(false, false);

  // With --ghost-in-cs: the ghost (slot G) drafts in the WS snake by its CS bags, by the opinions
  // of the first CS-out manager to join it.
  let ghostSlot = -1;
  let inCSWin = 0;
  let draft4 = plain.d;
  if (GHOST_IN_CS) {
    const G = MANAGERS;
    const rs = [...rosters.map((r) => [...r]), ghostCS.map((g) => g.i)];
    const order = rank([...finalists, G], (m) => (m === G ? ghostCSBags : round2.get(m)!));
    ghostSlot = order.indexOf(G);
    draft4 = drafted.slice();
    redraft(order, rs, draft4, W, (m) => (m === G ? csOut[0] : m));
    const top = Math.max(...finalists.map((m) => rosterBags(W, rs[m])));
    const tied = finalists.filter((m) => rosterBags(W, rs[m]) === top).length;
    const g = rosterBags(W, rs[G]);
    inCSWin = g > top ? 1 : g === top ? 1 / (tied + 1) : 0;
  }

  // With --own-rosters the ghost's draft picks always come last, so "first" is the same as "last".
  const redrafted = wsRound(true, false).win;
  const win = GHOST_IN_CS
    ? [
        [inCSWin, inCSWin],
        [inCSWin, inCSWin],
      ]
    : OWN_ROSTERS
    ? [
        [plain.win, plain.win],
        [redrafted, redrafted],
      ]
    : [
        [plain.win, wsRound(false, true).win],
        [redrafted, wsRound(true, true).win],
      ];

  return {
    trigger,
    win,
    topFinalistWS: plain.top,
    gap: sum(dsOut) + sum(csOut) - sum(finalists),
    swapsPerManager: [swaps2 / 7, swaps3 / 5, plain.swaps / 3],
    regularsLeft: [regularsBefore, plain.left],
    bagsToCS: [sum(finalists), sum(dsOut) + sum(csOut)],
    noneAlive,
    ghostSlot,
    released: [released3.length, released4.length],
    retaken: [retaken3, released4.filter((i) => draft4[i]).length],
  };
}

/** Each team's 9 hitters who bat most per game. */
function topNine<T>(hitters: { team: number; id: T; pa: number }[]): T[] {
  const byTeam = new Map<number, { id: T; pa: number }[]>();
  for (const h of hitters) byTeam.set(h.team, [...(byTeam.get(h.team) ?? []), h]);
  return [...byTeam.values()].flatMap((hs) => hs.sort((a, b) => b.pa - a.pa).slice(0, 9).map((h) => h.id));
}

/** The same numbers from a real league season, when history/ has it. */
async function realSeason(year: number) {
  const file = join(HISTORY, `${year}.json`);
  if (!existsSync(file)) return null;
  const h = JSON.parse(readFileSync(file, 'utf8'));
  const ps = await loadPostseason(year);
  const type = new Map(ps.games.map((g) => [g.game_pk, g.game_type]));
  const tb = new Map<string, number>();
  for (const b of ps.batting) {
    const key = `${type.get(b.game_pk)}:${b.mlb_player_id}`;
    tb.set(key, (tb.get(key) ?? 0) + b.tb);
  }
  const teamGames = new Map<number, number>();
  for (const g of ps.games) for (const t of [g.home_team_id, g.away_team_id]) teamGames.set(t, (teamGames.get(t) ?? 0) + 1);
  const wsTeams = new Set(ps.games.filter((g) => g.game_type === 'W').flatMap((g) => [g.home_team_id, g.away_team_id]));
  const usage = new Map<number, { team: number; pa: number }>();
  for (const b of ps.batting) {
    const u = usage.get(b.mlb_player_id) ?? { team: b.mlb_team_id, pa: 0 };
    u.pa += b.pa;
    usage.set(b.mlb_player_id, u);
  }
  const regulars = topNine(
    [...usage]
      .filter(([id, u]) => wsTeams.has(u.team) && ps.hitters.get(id)?.position !== 'P')
      .map(([id, u]) => ({ team: u.team, id, pa: u.pa / teamGames.get(u.team)! })),
  );
  const drafted = new Set<number>();
  const regularsLeft: number[] = [];

  const rosters = new Map<string, Set<number>>(h.managers.map((m: { name: string }) => [m.name, new Set<number>()]));
  const total = new Map<string, number>(h.managers.map((m: { name: string }) => [m.name, 0]));
  const swaps: number[] = [];
  let topWS = 0;
  for (const d of h.drafts) {
    for (const a of d.actions) {
      if (a.type !== 'pick') continue;
      if (a.drop) rosters.get(a.manager)!.delete(a.drop);
      rosters.get(a.manager)!.add(a.add);
      drafted.add(a.add);
    }
    if (d.number >= 3) regularsLeft.push(regulars.filter((id) => !drafted.has(id)).length);
    if (d.number > 1) swaps.push(d.actions.filter((a: { type: string }) => a.type === 'pick').length / d.pickOrder.length);
    for (const [m, r] of rosters) {
      if (!d.pickOrder.includes(m)) continue;
      const b = [...r].reduce((s, id) => s + (tb.get(`${ROUNDS[d.number - 1]}:${id}`) ?? 0), 0);
      if (d.number < 4) total.set(m, total.get(m)! + b);
      else topWS = Math.max(topWS, b);
    }
  }
  const finalist = (m: { eliminatedAfterRound: number | null }) => m.eliminatedAfterRound === null || m.eliminatedAfterRound === 3;
  const bagsToCS = [0, 0];
  for (const m of h.managers as { name: string; eliminatedAfterRound: number | null }[]) {
    bagsToCS[finalist(m) ? 0 : 1] += total.get(m.name)!;
  }
  return { topWS, gap: bagsToCS[1] - bagsToCS[0], swaps, regularsLeft, bagsToCS };
}

// Run it. 1994 had no postseason, and before it each league had 2 divisions, not today's 3.
if (!REAL_BRACKETS && FROM < 1995) throw new Error("Today's bracket needs 3 divisions a league: use --from 1995 or later.");
const years = Array.from({ length: TO - FROM + 1 }, (_, i) => FROM + i).filter((y) => y !== 1994);
const postseasons: Postseason[] = [];
for (const y of years) {
  process.stderr.write(`Loading ${y}…\r`);
  postseasons.push(await load(y));
}
process.stderr.write('\n');

const LABELS = ['ghost picks last', 'trigger rule', 'ghost always first'];
const winsFor = (r: Run, redraft: number) => [r.win[redraft][0], r.win[redraft][r.trigger ? 1 : 0], r.win[redraft][1]];
const pct = (x: number, digits = 2) => `${(100 * x).toFixed(digits)}%`;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

interface Tally {
  runs: number;
  triggers: number;
  wins: number[][];
  winsTriggered: number;
  winsNot: number;
  top: number;
  gap: number;
  swaps: number[];
  regularsLeft: number[];
  bagsToCS: number[];
  noneAlive: number[];
  ghostSlots: number[];
  released: number[];
  retaken: number[];
  /** Runs with at least 1 usable hitter released, by draft. */
  anyReleased: number[];
}
const tally = (): Tally => ({
  runs: 0,
  triggers: 0,
  wins: [
    [0, 0, 0],
    [0, 0, 0],
  ],
  winsTriggered: 0,
  winsNot: 0,
  top: 0,
  gap: 0,
  swaps: [0, 0, 0],
  regularsLeft: [0, 0],
  bagsToCS: [0, 0],
  noneAlive: [0, 0],
  ghostSlots: [0, 0, 0, 0],
  released: [0, 0],
  retaken: [0, 0],
  anyReleased: [0, 0],
});
const all = tally();
const withReal = tally();
const byYear = new Map<number, Tally>();
const started = Date.now();
for (const ps of postseasons) {
  const t = tally();
  byYear.set(ps.year, t);
  for (let k = 0; k < RUNS; k++) {
    const r = simulate(ps);
    for (const x of [t, all, ...(existsSync(join(HISTORY, `${ps.year}.json`)) ? [withReal] : [])]) {
      x.runs++;
      x.triggers += +r.trigger;
      for (const redraft of [0, 1]) winsFor(r, redraft).forEach((w, v) => (x.wins[redraft][v] += w));
      if (r.trigger) x.winsTriggered += r.win[1][1];
      else x.winsNot += r.win[1][0];
      x.top += r.topFinalistWS;
      x.gap += r.gap;
      r.swapsPerManager.forEach((s, i) => (x.swaps[i] += s));
      r.regularsLeft.forEach((c, i) => (x.regularsLeft[i] += c));
      r.bagsToCS.forEach((b, i) => (x.bagsToCS[i] += b));
      r.noneAlive.forEach((c, i) => (x.noneAlive[i] += c));
      if (r.ghostSlot >= 0) x.ghostSlots[r.ghostSlot]++;
      r.released.forEach((c, i) => {
        x.released[i] += c;
        x.anyReleased[i] += +(c > 0);
        x.retaken[i] += r.retaken[i];
      });
    }
  }
}

// 95% margin on a rate from `runs` runs (normal approximation; runs within a season share its
// teams, so treat the margins on rare events as rough).
const margin = (p: number, runs: number) => `±${(196 * Math.sqrt((p * (1 - p)) / runs)).toFixed(2)}`;
console.log(
  `Ghost team Monte Carlo: ${FROM}–${TO}, ${postseasons.length} seasons in ` +
    `${REAL_BRACKETS ? 'their real brackets' : "today's 12-team bracket"} × ${RUNS.toLocaleString()} runs ` +
    `(${all.runs.toLocaleString()}), seed ${SEED}, ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
console.log(
  `postseason hitting ${POSTSEASON_HITTING}, series shrink ${SERIES_SHRINK}, swing ${SWING}, ` +
    `horizon ${HORIZON}, upgrade ${UPGRADE}, noise ${NOISE}` +
    `${RELEASE === 'none' ? '' : `, eliminated managers' hitters released: ${RELEASE}`}\n`,
);
const REDRAFT_LABELS = ['no redraft', 'redraft dead CS picks'];
if (GHOST_IN_CS) {
  const p = all.wins[0][0] / all.runs;
  console.log(`Chance the ghost wins the WS round (it plays the CS round): ${pct(p)} ${margin(p, all.runs)}`);
  console.log(
    `\nThe ghost's slot in the WS snake, by CS bags: ` +
      all.ghostSlots.map((c, i) => `${['1st', '2nd', '3rd', '4th'][i]} ${pct(c / all.runs, 1)}`).join(', '),
  );
} else if (OWN_ROSTERS) {
  const [givers, who] = TWO_HITTERS ? [1, 'pairs'] : [2, 'managers'];
  console.log(
    `Chance the ghost wins the WS round (each eliminated ${TWO_HITTERS ? 'pair' : 'manager'} gives a hitter ` +
      'from their own roster)',
  );
  REDRAFT_LABELS.forEach((label, redraft) => {
    const p = all.wins[redraft][0] / all.runs;
    console.log(`  ${label.padEnd(26)}${`${pct(p)} ${margin(p, all.runs)}`.padStart(20)}`);
  });
  console.log(
    `\nNo hitter still alive to give: ${pct(all.noneAlive[0] / (givers * all.runs), 1)} of DS-out ${who} and ` +
      `${pct(all.noneAlive[1] / (givers * all.runs), 1)} of CS-out ${who} (they draft with the last pick instead).`,
  );
} else {
  console.log('Chance the ghost wins the WS round');
  console.log(`  ${''.padEnd(26)}${LABELS.map((l) => l.padStart(20)).join('')}`);
  REDRAFT_LABELS.forEach((label, redraft) => {
    const cells = all.wins[redraft].map((w) => `${pct(w / all.runs)} ${margin(w / all.runs, all.runs)}`.padStart(20));
    console.log(`  ${label.padEnd(26)}${cells.join('')}`);
  });
  console.log(
    `\nThe trigger fires in ${pct(all.triggers / all.runs, 1)} of runs. With the trigger rule and redrafts, the ghost wins ` +
      `${pct(all.winsTriggered / Math.max(all.triggers, 1))} of the runs where it fired and ` +
      `${pct(all.winsNot / Math.max(all.runs - all.triggers, 1))} of the rest.`,
  );
}

if (RELEASE !== 'none') {
  console.log('\nReleased hitters still playing, per draft (what managers can draft again)');
  for (const [i, d] of [3, 4].entries()) {
    console.log(
      `  Draft ${d}: ${(all.released[i] / all.runs).toFixed(2)} on average, at least 1 in ` +
        `${pct(all.anyReleased[i] / all.runs, 0)} of runs; ${(all.retaken[i] / all.runs).toFixed(2)} drafted again`,
    );
  }
}

if (BY_YEAR && GHOST_IN_CS) {
  console.log('\nBy season');
  for (const [year, t] of byYear) console.log(`  ${year}  ${pct(t.wins[0][0] / t.runs)}`);
} else if (BY_YEAR && OWN_ROSTERS) {
  console.log('\nBy season');
  console.log(`  year${REDRAFT_LABELS.map((l) => l.padStart(26)).join('')}`);
  for (const [year, t] of byYear) console.log(`  ${year}${t.wins.map((w) => pct(w[0] / t.runs).padStart(26)).join('')}`);
} else if (BY_YEAR) {
  console.log('\nBy season (redraft dead CS picks)');
  console.log(`  year  trigger${LABELS.map((l) => l.padStart(20)).join('')}`);
  for (const [year, t] of byYear) {
    console.log(`  ${year}  ${pct(t.triggers / t.runs, 0).padStart(7)}${t.wins[1].map((w) => pct(w / t.runs).padStart(20)).join('')}`);
  }
}

const reals = (await Promise.all(years.map(realSeason))).filter((r) => r !== null);
if (reals.length) {
  const sims = withReal;
  const row = (label: string, sim: number, real: number) =>
    console.log(`  ${label.padEnd(44)}${sim.toFixed(1).padStart(8)}${real.toFixed(1).padStart(8)}`);
  console.log(`\nSanity check: simulated vs the league's real seasons (the ${reals.length} in history/)`);
  console.log(`  ${''.padEnd(44)}${'sim'.padStart(8)}${'real'.padStart(8)}`);
  row("best finalist's WS bags", sims.top / sims.runs, mean(reals.map((r) => r.topWS)));
  row("3 finalists' bags, Wild Card through CS", sims.bagsToCS[0] / sims.runs, mean(reals.map((r) => r.bagsToCS[0])));
  row("4 eliminated managers' bags, same", sims.bagsToCS[1] / sims.runs, mean(reals.map((r) => r.bagsToCS[1])));
  row('4 eliminated minus 3 finalists', sims.gap / sims.runs, mean(reals.map((r) => r.gap)));
  for (const [i, d] of [2, 3, 4].entries()) {
    row(`swaps per manager, Draft ${d}`, sims.swaps[i] / sims.runs, mean(reals.map((r) => r.swaps[i])));
  }
  for (const [i, when] of ['before', 'after'].entries()) {
    row(`undrafted WS regulars ${when} Draft 4`, sims.regularsLeft[i] / sims.runs, mean(reals.map((r) => r.regularsLeft[i])));
  }
}
