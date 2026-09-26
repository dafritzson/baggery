import { describe, expect, it } from 'vitest';

import { type SeasonImport, importSpells, validateSeasonImport } from '../supabase/functions/_shared/core/season-import.ts';

const LOCKS = ['2021-10-05T00:08:00Z', '2021-10-07T18:07:00Z', '2021-10-15T20:07:00Z', '2021-10-26T00:09:00Z'];

/**
 * Three teams: C out after round 1, B after round 2, A champion. Draft 1 is a snake of players
 * 1–12; in Draft 2, B swaps 5 for 13; in Draft 4, A swaps 1 for 14.
 */
function season(): SeasonImport {
  const snake = ['A', 'B', 'C', 'C', 'B', 'A', 'A', 'B', 'C', 'C', 'B', 'A'];
  const pick = (manager: string, add: number, drop: number | null = null) => ({ manager, type: 'pick' as const, add, drop });
  const yieldFor = (manager: string) => ({ manager, type: 'yield' as const, add: null, drop: null });
  return {
    year: 2021,
    managers: [
      { name: 'A', eliminatedAfterRound: null },
      { name: 'B', eliminatedAfterRound: 2 },
      { name: 'C', eliminatedAfterRound: 1 },
    ],
    drafts: [
      { number: 1, locksAt: LOCKS[0], pickOrder: ['A', 'B', 'C'], actions: snake.map((m, i) => pick(m, i + 1)) },
      { number: 2, locksAt: LOCKS[1], pickOrder: ['B', 'A', 'C'], actions: [pick('B', 13, 5), yieldFor('A'), yieldFor('C'), yieldFor('B')] },
      { number: 3, locksAt: LOCKS[2], pickOrder: ['A', 'B'], actions: [yieldFor('A'), yieldFor('B')] },
      { number: 4, locksAt: LOCKS[3], pickOrder: ['A'], actions: [pick('A', 14, 1), yieldFor('A')] },
    ],
    players: Array.from({ length: 14 }, (_, i) => ({ id: i + 1, fullName: `Player ${i + 1}`, teamId: 144 })),
    mlbTeams: [{ id: 144, name: 'Atlanta Braves', abbreviation: 'ATL', league: 'NL', eliminated: false }],
  };
}

describe('validateSeasonImport', () => {
  it('accepts a complete season', () => {
    expect(validateSeasonImport(season())).toBeNull();
  });

  it('rejects a player drafted twice, even after being dropped', () => {
    const s = season();
    s.drafts[3].actions[0] = { manager: 'A', type: 'pick', add: 5, drop: 1 };
    expect(validateSeasonImport(s)).toMatch(/already been drafted/);
  });

  it('rejects dropping a player who is not on the roster', () => {
    const s = season();
    s.drafts[1].actions[0] = { manager: 'B', type: 'pick', add: 13, drop: 1 };
    expect(validateSeasonImport(s)).toMatch(/not on your roster/);
  });

  it('only lets teams still alive into later drafts', () => {
    const s = season();
    s.drafts[2].pickOrder = ['A', 'B', 'C'];
    expect(validateSeasonImport(s)).toMatch(/alive/);
  });

  it('rejects a draft that stops early', () => {
    const s = season();
    s.drafts[1].actions.pop();
    expect(validateSeasonImport(s)).toMatch(/isn't finished/);
  });

  it('rejects out-of-turn actions', () => {
    const s = season();
    s.drafts[1].actions = [{ manager: 'A', type: 'yield', add: null, drop: null }, ...s.drafts[1].actions];
    expect(validateSeasonImport(s)).toMatch(/not your turn/);
  });

  it('needs exactly one champion', () => {
    const s = season();
    s.managers[1].eliminatedAfterRound = null;
    expect(validateSeasonImport(s)).toMatch(/champion/);
  });

  it('rejects drafts whose lock times go backwards', () => {
    const s = season();
    s.drafts[2].locksAt = LOCKS[0];
    expect(validateSeasonImport(s)).toMatch(/lock time/);
  });

  it('rejects players on an MLB team the season does not list', () => {
    const s = season();
    s.players[0].teamId = 999;
    expect(validateSeasonImport(s)).toMatch(/Bad player/);
  });
});

describe('importSpells', () => {
  it('ends a dropped player’s spell where the next one starts, at the draft’s lock', () => {
    const spells = importSpells(season());
    expect(spells).toHaveLength(14);
    expect(spells.find((s) => s.playerId === 5)).toMatchObject({ manager: 'B', from: LOCKS[0], to: LOCKS[1], addedByDraft: 1, droppedByDraft: 2 });
    expect(spells.find((s) => s.playerId === 13)).toMatchObject({ manager: 'B', from: LOCKS[1], to: null, addedByDraft: 2 });
    expect(spells.find((s) => s.playerId === 1)).toMatchObject({ manager: 'A', to: LOCKS[3], droppedByDraft: 4 });
    expect(spells.find((s) => s.playerId === 14)).toMatchObject({ manager: 'A', from: LOCKS[3], to: null });
  });
});
