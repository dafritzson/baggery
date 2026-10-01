import { describe, expect, it } from 'vitest';

import { draftablePlayers, ownership } from '../app/src/lib/board.ts';

const team = (id: number, eliminated: boolean) => ({ id, eliminated });
const entry = (id: number, teamId: number, roster = true, injuredList: number | null = null) =>
  ({ mlb_player_id: id, mlb_team_id: teamId, on_postseason_roster: roster, injured_list: injuredList });
const spell = (player: number, teamId: string, from: string, to: string | null = null) => ({
  fantasy_team_id: teamId,
  mlb_player_id: player,
  from_at: from,
  to_at: to,
});

describe('draft board', () => {
  const mlbTeams = new Map([
    [1, team(1, false)],
    [2, team(2, true)],
  ]);
  const spells = [spell(10, 'a', '2026-09-30T00:00:00Z'), spell(11, 'b', '2026-09-30T00:00:00Z', '2026-10-05T00:00:00Z')];

  it('never offers an owned or dropped player, or one on an eliminated team', () => {
    const pool = [entry(10, 1), entry(11, 1), entry(12, 1), entry(13, 2)];
    expect([...draftablePlayers(pool, mlbTeams, spells, false)]).toEqual([12]);
  });

  it('offers injured-list hitters off the roster only for Draft 1', () => {
    const pool = [entry(14, 1, false, 10), entry(15, 1, false)];
    expect([...draftablePlayers(pool, mlbTeams, [], true)]).toEqual([14]);
    expect([...draftablePlayers(pool, mlbTeams, [], false)]).toEqual([]);
  });

  it('marks a dropped player as burned, keeping his last owner', () => {
    const owners = ownership(spells);
    expect(owners.get(10)).toEqual({ teamId: 'a', dropped: false });
    expect(owners.get(11)).toEqual({ teamId: 'b', dropped: true });
    expect(owners.has(12)).toBe(false);
  });

  it('as of a moment: before a drop he was still owned, before a pick nobody had him', () => {
    expect(ownership(spells, Date.parse('2026-10-01T00:00:00Z')).get(11)).toEqual({ teamId: 'b', dropped: false });
    expect(ownership(spells, Date.parse('2026-09-29T00:00:00Z')).size).toBe(0);
  });
});
