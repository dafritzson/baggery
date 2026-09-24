import { type FantasyRound, type GameType, type PlayerId, ROUND_FOR_GAME_TYPE, type TeamId } from './types.ts';

export interface StatLine {
  ab: number;
  h: number;
  bb: number;
  hbp: number;
  sf: number;
  tb: number;
  hr: number;
  r: number;
  rbi: number;
}

export interface PlayerGameStat extends StatLine {
  playerId: PlayerId;
  gameType: GameType;
  /** ISO timestamp of the game's scheduled first pitch. */
  gameStart: string;
}

/** A player's time on a fantasy roster: [from, to). `to` is null while still rostered. */
export interface RosterSpell {
  teamId: TeamId;
  playerId: PlayerId;
  from: string;
  to: string | null;
}

export interface TeamTotals extends StatLine {
  teamId: TeamId;
}

const STAT_KEYS: (keyof StatLine)[] = ['ab', 'h', 'bb', 'hbp', 'sf', 'tb', 'hr', 'r', 'rbi'];

export function emptyTotals(teamId: TeamId): TeamTotals {
  return { teamId, ab: 0, h: 0, bb: 0, hbp: 0, sf: 0, tb: 0, hr: 0, r: 0, rbi: 0 };
}

function inSpell(spell: RosterSpell, gameStart: string): boolean {
  const t = Date.parse(gameStart);
  return Date.parse(spell.from) <= t && (spell.to === null || t < Date.parse(spell.to));
}

/**
 * Sums each team's stats for one fantasy round. A game counts for a team if it's in the
 * round and started while the player was on the team's roster.
 */
export function teamRoundTotals(
  round: FantasyRound,
  teamIds: TeamId[],
  spells: RosterSpell[],
  stats: PlayerGameStat[],
): TeamTotals[] {
  const totals = new Map(teamIds.map((id) => [id, emptyTotals(id)]));
  const spellsByPlayer = new Map<PlayerId, RosterSpell[]>();
  for (const s of spells) {
    spellsByPlayer.set(s.playerId, [...(spellsByPlayer.get(s.playerId) ?? []), s]);
  }
  for (const stat of stats) {
    if (ROUND_FOR_GAME_TYPE[stat.gameType] !== round) continue;
    const spell = spellsByPlayer.get(stat.playerId)?.find((s) => inSpell(s, stat.gameStart));
    const team = spell && totals.get(spell.teamId);
    if (!team) continue;
    for (const k of STAT_KEYS) team[k] += stat[k];
  }
  return [...totals.values()];
}

export function slg(t: StatLine): number {
  return t.ab === 0 ? 0 : t.tb / t.ab;
}

export function obp(t: StatLine): number {
  const pa = t.ab + t.bb + t.hbp + t.sf;
  return pa === 0 ? 0 : (t.h + t.bb + t.hbp) / pa;
}

/** Compares two fractions n1/d1 vs n2/d2 exactly (0/0 counts as 0). */
function compareRatio(n1: number, d1: number, n2: number, d2: number): number {
  if (d1 === 0 || d2 === 0) return (d1 === 0 ? 0 : n1 / d1) - (d2 === 0 ? 0 : n2 / d2);
  return n1 * d2 - n2 * d1;
}

/**
 * Negative when `a` ranks ahead of `b`. Tiebreakers: TB, SLG, OBP, HR, R, RBI.
 * Returns 0 when fully tied (drink-off territory).
 */
export function compareTeams(a: StatLine, b: StatLine): number {
  return (
    b.tb - a.tb ||
    compareRatio(b.tb, b.ab, a.tb, a.ab) ||
    compareRatio(b.h + b.bb + b.hbp, b.ab + b.bb + b.hbp + b.sf, a.h + a.bb + a.hbp, a.ab + a.bb + a.hbp + a.sf) ||
    b.hr - a.hr ||
    b.r - a.r ||
    b.rbi - a.rbi
  );
}

export interface RankedTeam extends TeamTotals {
  /** 1-based; fully tied teams share a rank. */
  rank: number;
}

export function rankTeams(totals: TeamTotals[]): RankedTeam[] {
  const sorted = [...totals].sort(compareTeams);
  return sorted.map((t, i) => {
    let rank = i + 1;
    while (rank > 1 && compareTeams(sorted[rank - 2], t) === 0) rank--;
    return { ...t, rank };
  });
}

export interface EliminationResult {
  advancing: TeamId[];
  eliminated: TeamId[];
  /** Teams fully tied across the cut line; the drink-off decides who takes the open spots. */
  drinkOff: { teamIds: TeamId[]; spots: number } | null;
}

export function eliminations(ranked: RankedTeam[], survivors: number): EliminationResult {
  const cutRank = ranked[survivors - 1]?.rank;
  const straddlesCut =
    cutRank !== undefined && survivors < ranked.length && ranked[survivors].rank === cutRank;
  if (!straddlesCut) {
    return {
      advancing: ranked.slice(0, survivors).map((t) => t.teamId),
      eliminated: ranked.slice(survivors).map((t) => t.teamId),
      drinkOff: null,
    };
  }
  const tied = ranked.filter((t) => t.rank === cutRank);
  return {
    advancing: ranked.filter((t) => t.rank < cutRank).map((t) => t.teamId),
    eliminated: ranked.filter((t) => t.rank > cutRank).map((t) => t.teamId),
    drinkOff: { teamIds: tied.map((t) => t.teamId), spots: survivors - (cutRank - 1) },
  };
}
