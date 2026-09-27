// Bag celebrations: the bag emoji rain and "You got 2 bags!" popup the app shows when one of your
// hitters gets a bag. The app spots bags in the live scores broadcast, the same way the
// collect_bag trigger does for bag alerts, and a tapped bag alert brings its bag in the link.
// Pure, so the unit tests can run it without Supabase.

import { hitsText } from './bag-alerts.ts';
import type { ScoreChanges, Scores } from './score-feed.ts';
import { ownerAt, roundStandings, type ScoreStat } from './scoreboard.ts';
import type { RosterSpell } from './scoring.ts';
import { type PlayerId, ROUND_FOR_GAME_TYPE, type TeamId } from './types.ts';

/** One bag: a batting line's total bases went up. */
export interface BagHit {
  gamePk: number;
  playerId: PlayerId;
  /** The line's total bases after the bag. With the game and player, it names the bag. */
  tb: number;
  /** Total bases gained. */
  bags: number;
  /** Hits gained. A scoring change can make one negative (a single scored a double instead). */
  singles: number;
  doubles: number;
  triples: number;
  hr: number;
}

/** Bags stay news this long after a game ends, as for alerts (the last play is often read late). */
const FINAL_WINDOW_MS = 20 * 60 * 1000;

/** Names a bag, so the same one is never celebrated twice. */
export function bagKey(bag: Pick<BagHit, 'gamePk' | 'playerId' | 'tb'>): string {
  return `${bag.gamePk}-${bag.playerId}-${bag.tb}`;
}

/**
 * Bags in one poll's broadcast for hitters on `teamId` (by who had them when the game started):
 * lines whose total bases went up in a game that's live or just ended. Compared with the scores
 * from before the broadcast was applied; a line the app hadn't seen in a live game started at 0.
 */
export function bagsInChanges(
  scores: Scores,
  changes: ScoreChanges,
  spells: RosterSpell[],
  teamId: TeamId,
  now: number,
): BagHit[] {
  if (changes.reload) return [];
  const games = new Map(scores.games.map((g) => [g.gamePk, g]));
  const bags: BagHit[] = [];
  for (const row of changes.stats ?? []) {
    const game = games.get(row.game_pk);
    // A game the app doesn't know yet (it just started) reloads the scores instead.
    if (!game) continue;
    const gameRow = changes.games?.find((g) => g.game_pk === row.game_pk);
    const status: string = gameRow?.status ?? game.status;
    const finalSeenAt: string | null = gameRow?.final_seen_at ?? game.finalSeenAt;
    const current = status === 'Live' || (status === 'Final' && (!finalSeenAt || now - Date.parse(finalSeenAt) < FINAL_WINDOW_MS));
    if (!current) continue;
    if (ownerAt(spells, row.mlb_player_id, game.start) !== teamId) continue;

    const before = scores.stats.find((s) => s.gamePk === row.game_pk && s.playerId === row.mlb_player_id);
    const oldTb = before?.tb ?? 0;
    if (row.tb <= oldTb) continue;
    const line = scores.lines.find((l) => l.gamePk === row.game_pk && l.playerId === row.mlb_player_id);
    const old = line ?? (oldTb === 0 ? { h: 0, doubles: 0, triples: 0, hr: 0 } : null);
    bags.push({
      gamePk: row.game_pk,
      playerId: row.mlb_player_id,
      tb: row.tb,
      bags: row.tb - oldTb,
      ...(old
        ? hitsBetween(old, row as { h: number; doubles: number; triples: number; hr: number })
        : guessHits(row.tb - oldTb)),
    });
  }
  return bags;
}

type Hits = Pick<BagHit, 'singles' | 'doubles' | 'triples' | 'hr'>;
type Line = { h: number; doubles: number; triples: number; hr: number };

function hitsBetween(old: Line, now: Line): Hits {
  const singles = (l: Line) => l.h - l.doubles - l.triples - l.hr;
  return {
    singles: singles(now) - singles(old),
    doubles: now.doubles - old.doubles,
    triples: now.triples - old.triples,
    hr: now.hr - old.hr,
  };
}

/** Without the line from before (a game that ended since the app loaded): one hit worth that many bags. */
function guessHits(bags: number): Hits {
  return { singles: bags === 1 ? 1 : 0, doubles: bags === 2 ? 1 : 0, triples: bags === 3 ? 1 : 0, hr: bags >= 4 ? 1 : 0 };
}

/**
 * The bag in a bag alert's link (`?bag=`): game, player, TB after, bags, then singles, doubles,
 * triples and home runs, joined by dots.
 */
export function bagParam(bag: BagHit): string {
  return [bag.gamePk, bag.playerId, bag.tb, bag.bags, bag.singles, bag.doubles, bag.triples, bag.hr].join('.');
}

export function parseBagParam(param: string | undefined | null): BagHit | null {
  const parts = (param ?? '').split('.');
  if (parts.length !== 8 || parts.some((p) => !/^-?\d+$/.test(p))) return null;
  const [gamePk, playerId, tb, bags, singles, doubles, triples, hr] = parts.map(Number);
  if (bags < 1 || tb < bags) return null;
  return { gamePk, playerId, tb, bags, singles, doubles, triples, hr };
}

/** The popup's big line for the hit: "Home run!", "Double!", "2 singles!", "Scoring change". */
export function hitHeadline(bag: Hits): string {
  const text = hitsText(bag, true);
  if (text === 'scoring change') return 'Scoring change';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}!`;
}

/** The bag emoji the app draws for total bases (the Games tab, the rain). */
export const BAG_EMOJI = ['👜', '💼', '🎒', '🛍️', '👝', '🧳'];

const HIT_BASES = { '1B': 1, '2B': 2, '3B': 3, HR: 4 } as const;

/** A number from player, game and position, spread evenly: the same inputs, the same number. */
function bagHash(playerId: number, gamePk: number, i: number): number {
  let h = (playerId ^ Math.imul(gamePk, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A player's bags in a game, one emoji per TB, hit by hit in the order they happened: every bag
 * of a hit is the same bag, picked at random for that hit but never the previous hit's. So a
 * double, a single and a homer read as 🎒🎒🧳👜👜👜👜.
 *
 * Seeded by player, game and hit number, so a row stays put as scores refresh and a new hit just
 * adds its bags. TB the known hits don't cover yet (poll-games matches plays a few seconds after
 * the box score) are drawn as the next hit. With no hits known at all (a past season before its
 * videos are loaded), every bag is drawn as its own hit.
 */
export function hitBags(tb: number, events: (keyof typeof HIT_BASES)[], playerId: number, gamePk: number): string[] {
  const sizes: number[] = events.map((e) => HIT_BASES[e]);
  const known = sizes.reduce((a, b) => a + b, 0);
  if (!sizes.length) sizes.push(...Array(Math.max(tb, 0)).fill(1));
  else if (tb > known) sizes.push(tb - known);
  const bags: string[] = [];
  let previous = -1;
  sizes.forEach((size, i) => {
    const n = Math.min(size, tb - bags.length);
    if (n <= 0) return;
    const h = bagHash(playerId, gamePk, i);
    // Any of the six for the first hit; after that, any of the five that aren't the last one.
    let pick = previous < 0 ? h % BAG_EMOJI.length : h % (BAG_EMOJI.length - 1);
    if (previous >= 0 && pick >= previous) pick += 1;
    bags.push(...Array(n).fill(BAG_EMOJI[pick]));
    previous = pick;
  });
  return bags;
}

/** How many bags rain down: more for more bags, a downpour for a home run. */
export function rainCount(bag: BagHit): number {
  return bag.hr > 0 ? 72 : Math.min(24 + 12 * (bag.bags - 1), 60);
}

/** The popup's quick stats. */
export interface BagSummary {
  /** The hitter's line in the bag's game. */
  game: ScoreStat | null;
  /** The hitter's bags and games so far this postseason. */
  postseason: { bags: number; games: number };
  /** The bag's team in its round: bags so far and place (shared only on a full tie). */
  team: { teamId: TeamId; bags: number; rank: number; tied: boolean; of: number } | null;
}

/**
 * The popup's stats for a bag: the hitter's game and postseason, and where the bag's team (whoever
 * had him when the game started) stands in the round. `teams` are the season's teams with the
 * round each went out after (null while alive).
 */
export function bagSummary(
  bag: Pick<BagHit, 'gamePk' | 'playerId'>,
  scores: Scores,
  spells: RosterSpell[],
  teams: { id: TeamId; eliminatedAfterRound: number | null }[],
): BagSummary {
  const lines = scores.stats.filter((s) => s.playerId === bag.playerId);
  const summary: BagSummary = {
    game: lines.find((s) => s.gamePk === bag.gamePk) ?? null,
    postseason: { bags: lines.reduce((n, s) => n + s.tb, 0), games: lines.length },
    team: null,
  };
  const game = scores.games.find((g) => g.gamePk === bag.gamePk);
  const teamId = game && ownerAt(spells, bag.playerId, game.start);
  if (!game || !teamId) return summary;
  const round = ROUND_FOR_GAME_TYPE[game.gameType];
  const inRound = teams.filter((t) => t.eliminatedAfterRound === null || t.eliminatedAfterRound >= round).map((t) => t.id);
  const standings = roundStandings(round, inRound, scores.games, scores.stats, spells);
  const row = standings.find((r) => r.teamId === teamId);
  if (row) {
    const tied = standings.some((r) => r !== row && r.rank === row.rank);
    summary.team = { teamId, bags: row.total, rank: row.rank, tied, of: standings.length };
  }
  return summary;
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}
