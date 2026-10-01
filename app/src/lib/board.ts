// Who owns each player and who can still be drafted, for the draft board. Pure, so tests/ can
// check it without React Native.

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

/** The fantasy team a player is (or was) on, and whether they dropped him. */
export interface Ownership {
  teamId: string;
  dropped: boolean;
}

/**
 * Each drafted player's owner as of `at` (ms since the epoch; now when not given): the team of his
 * latest spell that started by then, dropped if it had ended by then. A player is on one roster
 * ever per season, so a dropped one stays owned (burned) for good.
 */
export function ownership(spells: Spell[], at = Infinity): Map<number, Ownership> {
  const latest = new Map<number, Spell>();
  for (const s of spells) {
    if (Date.parse(s.from_at) > at) continue;
    const seen = latest.get(s.mlb_player_id);
    if (!seen || Date.parse(s.from_at) >= Date.parse(seen.from_at)) latest.set(s.mlb_player_id, s);
  }
  return new Map(
    [...latest].map(([id, s]) => [id, { teamId: s.fantasy_team_id, dropped: s.to_at !== null && Date.parse(s.to_at) <= at }]),
  );
}

/**
 * Who can be drafted now, as the draft function has it: on his MLB team's postseason roster (or
 * on the injured list, with `injured`, for Draft 1), that team still alive, and never on a fantasy
 * roster this season, dropped ones included. Decided apart from what the board lists.
 */
export function draftablePlayers(
  pool: PoolEntry[],
  mlbTeams: Map<number, { eliminated: boolean }>,
  spells: Spell[],
  injured: boolean,
): Set<number> {
  const owned = new Set(spells.map((s) => s.mlb_player_id));
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
