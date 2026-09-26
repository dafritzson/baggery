// A fantasy round's ranking from the database, by the rules' tiebreakers (core/scoring.ts), for
// closing a round and ordering the redraft after it.

import { type PlayerGameStat, type RankedTeam, type RosterSpell, rankTeams, teamRoundTotals } from './core/scoring.ts';
import { type FantasyRound, type GameType, ROUND_FOR_GAME_TYPE } from './core/types.ts';
import type { Tx } from './db.ts';

/** The game types a round is scored from (round 1: Wild Card and Division Series). */
export function roundGameTypes(round: FantasyRound): GameType[] {
  return (Object.keys(ROUND_FOR_GAME_TYPE) as GameType[]).filter((t) => ROUND_FOR_GAME_TYPE[t] === round);
}

/** The round's games: how many, and how many aren't final yet. */
export async function roundGames(tx: Tx, year: number, round: FantasyRound): Promise<{ total: number; unfinished: number }> {
  const [row] = await tx`
    select count(*)::int as total, count(*) filter (where status <> 'Final')::int as unfinished
    from mlb_games where season_year = ${year} and game_type in ${tx(roundGameTypes(round))}`;
  return { total: row.total, unfinished: row.unfinished };
}

/** `teamIds` ranked on the round's stats (TB, then SLG, OBP, HR, R, RBI; full ties share a rank). */
export async function roundRanking(
  tx: Tx,
  season: { id: string; year: number },
  round: FantasyRound,
  teamIds: string[],
): Promise<RankedTeam[]> {
  const games = await tx`
    select game_pk, game_type, start_time from mlb_games
    where season_year = ${season.year} and game_type in ${tx(roundGameTypes(round))}`;
  const spells = await tx`select fantasy_team_id, mlb_player_id, from_at, to_at from roster_spells where season_id = ${season.id}`;
  const lines = games.length
    ? await tx`
        select game_pk, mlb_player_id, ab, h, bb, hbp, sf, tb, hr, r, rbi from player_game_stats
        where game_pk in ${tx(games.map((g) => g.game_pk))}`
    : [];
  const gameByPk = new Map(games.map((g) => [g.game_pk as number, g]));
  const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
  const coreSpells: RosterSpell[] = spells.map((s) => ({
    teamId: s.fantasy_team_id,
    playerId: s.mlb_player_id,
    from: iso(s.from_at)!,
    to: iso(s.to_at),
  }));
  const stats: PlayerGameStat[] = lines.map((l) => {
    const g = gameByPk.get(l.game_pk)!;
    return {
      playerId: l.mlb_player_id,
      gameType: g.game_type,
      gameStart: iso(g.start_time)!,
      ab: l.ab, h: l.h, bb: l.bb, hbp: l.hbp, sf: l.sf, tb: l.tb, hr: l.hr, r: l.r, rbi: l.rbi,
    };
  });
  return rankTeams(teamRoundTotals(round, teamIds, coreSpells, stats));
}
