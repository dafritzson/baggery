// Who owns each player and who can still be drafted, for the draft board. Pure, so tests/ can
// check it without React Native.

import { takenPlayers } from '@core/draft.ts';

// The parts of lib/season's rows these read (that file needs the app's imports).
interface Spell {
  fantasy_team_id: string;
  mlb_player_id: number;
  from_at: string;
  to_at: string | null;
}
interface PoolEntry {
  mlb_player_id: number;
  mlb_team_id: number;
  on_postseason_roster: boolean;
  injured_list: number | null;
}

/**
 * The fantasy teams whose drops are back in the pool: the eliminated ones, or with `draftNumber`,
 * the ones eliminated before that draft (after round 1 for Draft 3, after round 2 for Draft 4).
 */
export function releasingTeams(teams: { id: string; eliminated_after_round: number | null }[], draftNumber = Infinity): Set<string> {
  return new Set(teams.filter((t) => t.eliminated_after_round !== null && t.eliminated_after_round <= draftNumber - 2).map((t) => t.id));
}

/** The fantasy team a player is (or was) on, and whether they dropped him. */
export interface Ownership {
  teamId: string;
  dropped: boolean;
}

/**
 * Each drafted player's owner as of `at` (ms since the epoch; now when not given): the team of his
 * latest spell that started by then, dropped if it had ended by then. A dropped player stays owned
 * (burned), unless the team that dropped him is one of `released` (eliminated): then he's back in
 * the pool, owned by nobody.
 */
export function ownership(spells: Spell[], at = Infinity, released = new Set<string>()): Map<number, Ownership> {
  const latest = new Map<number, Spell>();
  for (const s of spells) {
    if (Date.parse(s.from_at) > at) continue;
    const seen = latest.get(s.mlb_player_id);
    if (!seen || Date.parse(s.from_at) >= Date.parse(seen.from_at)) latest.set(s.mlb_player_id, s);
  }
  const owners = new Map<number, Ownership>();
  for (const [id, s] of latest) {
    const dropped = s.to_at !== null && Date.parse(s.to_at) <= at;
    if (!dropped || !released.has(s.fantasy_team_id)) owners.set(id, { teamId: s.fantasy_team_id, dropped });
  }
  return owners;
}

/**
 * Who can be drafted now, as the draft function has it: on his MLB team's postseason roster (or
 * on the injured list, with `injured`, for Draft 1), that team still alive, and not taken (on a
 * roster, or burned: dropped by a team that isn't one of `released`). Decided apart from what the
 * board lists.
 */
export function draftablePlayers(
  pool: PoolEntry[],
  mlbTeams: Map<number, { eliminated: boolean }>,
  spells: Spell[],
  injured: boolean,
  released = new Set<string>(),
): Set<number> {
  const owned = takenPlayers(
    spells.map((s) => ({ teamId: s.fantasy_team_id, playerId: s.mlb_player_id, dropped: s.to_at !== null })),
    released,
  );
  return new Set(
    pool
      .filter(
        (p) =>
          !owned.has(p.mlb_player_id) &&
          mlbTeams.get(p.mlb_team_id)?.eliminated === false &&
          (p.on_postseason_roster || (injured && p.injured_list !== null)),
      )
      .map((p) => p.mlb_player_id),
  );
}
