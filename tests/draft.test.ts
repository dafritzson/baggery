import { describe, expect, it } from 'vitest';
import {
  type DraftAction,
  type DraftConfig,
  type DraftState,
  applyAction,
  autodraftAction,
  draftable,
  ghostTurns,
  nextTurn,
  randomOrder,
  redraftOrder,
  snakeSlots,
  validateAction,
} from '../supabase/functions/_shared/core/draft.ts';

const order = ['A', 'B', 'C'];
const initial: DraftConfig = { kind: 'initial', order, rounds: 4 };
const redraft: DraftConfig = { kind: 'redraft', order, rounds: 4 };

function state(config: DraftConfig, overrides: Partial<DraftState> = {}): DraftState {
  return {
    config,
    actions: [],
    rosters: new Map(order.map((t) => [t, []])),
    everRostered: new Set(),
    eligible: new Set(Array.from({ length: 100 }, (_, i) => i + 1)),
    ...overrides,
  };
}

const pick = (teamId: string, addPlayerId: number, dropPlayerId?: number): DraftAction => ({
  type: 'pick',
  teamId,
  addPlayerId,
  dropPlayerId,
});
const yieldTurn = (teamId: string): DraftAction => ({ type: 'yield', teamId });

describe('snakeSlots', () => {
  it('reverses every other round', () => {
    expect(snakeSlots(order, 4).join('')).toBe('ABCCBAABCCBA');
  });
});

describe('nextTurn', () => {
  it('starts with the first team in round 1', () => {
    expect(nextTurn(initial, [])).toEqual({ teamId: 'A', round: 1, slot: 0 });
  });

  it('snakes back at the turn', () => {
    const actions = [pick('A', 1), pick('B', 2), pick('C', 3)];
    expect(nextTurn(initial, actions)).toEqual({ teamId: 'C', round: 2, slot: 3 });
  });

  it('returns null when every slot is used', () => {
    const actions = snakeSlots(order, 4).map((t, i) => pick(t, i + 1));
    expect(nextTurn(initial, actions)).toBeNull();
  });

  it('skips a yielded team for the rest of the draft', () => {
    // Round 1: A yields, B, C pick. Round 2 would be C, B, A → A is skipped.
    const actions = [yieldTurn('A'), pick('B', 1, 10), pick('C', 2, 20), pick('C', 3, 21), pick('B', 4, 11)];
    // Round 3 would start with A, but A yielded, so B is up.
    expect(nextTurn(redraft, actions)).toEqual({ teamId: 'B', round: 3, slot: 7 });
  });

  it('completes once every team has yielded', () => {
    expect(nextTurn(redraft, [yieldTurn('A'), yieldTurn('B'), yieldTurn('C')])).toBeNull();
  });
});

describe('validateAction: initial draft', () => {
  it('accepts a legal pick', () => {
    expect(validateAction(state(initial), pick('A', 1))).toBeNull();
  });

  it('rejects picking out of turn', () => {
    expect(validateAction(state(initial), pick('B', 1))).toMatch(/not your turn/);
  });

  it('rejects a player who was ever drafted', () => {
    expect(validateAction(state(initial, { everRostered: new Set([1]) }), pick('A', 1))).toMatch(/already been drafted/);
  });

  it('rejects an ineligible player', () => {
    expect(validateAction(state(initial), pick('A', 999))).toMatch(/not eligible/);
  });

  it('rejects yields and drops', () => {
    expect(validateAction(state(initial), yieldTurn('A'))).toMatch(/cannot yield/);
    expect(validateAction(state(initial), pick('A', 1, 2))).toMatch(/cannot drop/);
  });

  it('applies a full draft to 4 players each', () => {
    let s = state(initial);
    snakeSlots(order, 4).forEach((t, i) => {
      const action = pick(t, i + 1);
      expect(validateAction(s, action)).toBeNull();
      s = applyAction(s, action);
    });
    expect(nextTurn(s.config, s.actions)).toBeNull();
    for (const t of order) expect(s.rosters.get(t)).toHaveLength(4);
  });
});

describe('validateAction: redraft', () => {
  const rosters = new Map([
    ['A', [10, 11, 12, 13]],
    ['B', [20, 21, 22, 23]],
    ['C', [30, 31, 32, 33]],
  ]);
  const everRostered = new Set([...rosters.values()].flat());
  const s = () => state(redraft, { rosters, everRostered });

  it('accepts drop + add', () => {
    expect(validateAction(s(), pick('A', 1, 10))).toBeNull();
  });

  it('requires a drop', () => {
    expect(validateAction(s(), pick('A', 1))).toMatch(/must drop/);
  });

  it('rejects dropping a player not on your roster', () => {
    expect(validateAction(s(), pick('A', 1, 20))).toMatch(/not on your roster/);
  });

  it('never lets a dropped player come back, even to the same team', () => {
    let next = applyAction(s(), pick('A', 1, 10));
    expect(next.rosters.get('A')).toEqual([11, 12, 13, 1]);
    next = applyAction(next, yieldTurn('B'));
    next = applyAction(next, yieldTurn('C'));
    expect(validateAction(next, pick('A', 10, 11))).toMatch(/already been drafted/);
  });

  it('allows yielding', () => {
    expect(validateAction(s(), yieldTurn('A'))).toBeNull();
  });
});

describe('autodraftAction', () => {
  const candidates = [
    { playerId: 1, regularSeasonTb: 200 },
    { playerId: 2, regularSeasonTb: 350 },
    { playerId: 3, regularSeasonTb: 300 },
  ];

  it('initial draft: takes the most regular-season TB available', () => {
    const s = state(initial, { everRostered: new Set([2]) });
    expect(autodraftAction(s, candidates, [])).toEqual(pick('A', 3));
  });

  it('initial draft: passes over injured players, however many TB they have', () => {
    const s = state(initial);
    expect(autodraftAction(s, [...candidates, { playerId: 4, regularSeasonTb: 400, injured: true }], [])).toEqual(pick('A', 2));
  });

  it('redraft: replaces a droppable player with the best available', () => {
    const s = state(redraft, { rosters: new Map([['A', [10, 11, 12, 13]]]) });
    expect(autodraftAction(s, candidates, [12])).toEqual(pick('A', 2, 12));
  });

  it('redraft: yields when nothing needs replacing', () => {
    const s = state(redraft, { rosters: new Map([['A', [10, 11, 12, 13]]]) });
    expect(autodraftAction(s, candidates, [99])).toEqual(yieldTurn('A'));
  });
});

describe('draftable', () => {
  const active = { onActiveRoster: true, injured: false, eliminated: false };
  const injured = { onActiveRoster: false, injured: true, eliminated: false };

  it('takes active hitters in every draft', () => {
    expect([1, 2, 3, 4].map((n) => draftable(active, n))).toEqual([true, true, true, true]);
  });

  it('takes hitters on the injured list in Draft 1 only', () => {
    expect([1, 2, 3, 4].map((n) => draftable(injured, n))).toEqual([true, false, false, false]);
  });

  it('never takes a hitter off the roster, or on an eliminated team', () => {
    expect(draftable({ onActiveRoster: false, injured: false, eliminated: false }, 1)).toBe(false);
    expect(draftable({ ...active, eliminated: true }, 2)).toBe(false);
    expect(draftable({ ...injured, eliminated: true }, 1)).toBe(false);
  });
});

describe('randomOrder', () => {
  it('is a permutation', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    expect(randomOrder(teams).sort()).toEqual(teams);
  });
});

describe('redraftOrder', () => {
  const ranked = [
    { teamId: 'A', rank: 1 },
    { teamId: 'B', rank: 2 },
    { teamId: 'C', rank: 2 },
    { teamId: 'D', rank: 4 },
    { teamId: 'E', rank: 5 },
  ];

  it('orders the survivors by the round’s ranking', () => {
    expect(redraftOrder(ranked, ['D', 'A', 'B'], () => 0)).toEqual(['A', 'B', 'D']);
  });

  it('shuffles only teams fully tied with each other', () => {
    const orders = new Set([0, 0.99].map((r) => redraftOrder(ranked, ['A', 'B', 'C', 'D'], () => r).join('')));
    expect([...orders].sort()).toEqual(['ABCD', 'ACBD']);
  });
});

describe('ghost turns', () => {
  // Draft 3: survivors A, B, C snake; the ghost G's 2 adds come after, by X then Y.
  const draft3: DraftConfig = {
    kind: 'redraft',
    order,
    rounds: 1,
    ghost: { teamId: 'G', turns: ghostTurns(3, ['X', 'Y'], []) },
  };
  // Draft 4: G is in the snake (3rd); its first 2 turns add (by P, Q), its last 2 redraft (by X, Y).
  const draft4: DraftConfig = {
    kind: 'redraft',
    order: ['A', 'B', 'G'],
    rounds: 4,
    ghost: { teamId: 'G', turns: ghostTurns(4, ['X', 'Y'], ['P', 'Q']) },
  };
  const rosters4 = () =>
    new Map([
      ['A', [10, 11, 12, 13]],
      ['B', [20, 21, 22, 23]],
      ['G', [30, 31]],
    ]);
  const s4 = (actions: DraftAction[] = []) => {
    let s = state(draft4, { rosters: rosters4(), everRostered: new Set([10, 11, 12, 13, 20, 21, 22, 23, 30, 31]) });
    for (const a of actions) s = applyAction(s, a);
    return s;
  };

  it('ghostTurns: Draft 3 adds by the round-1-out managers; Draft 4 adds then redrafts', () => {
    expect(ghostTurns(3, ['X', 'Y'], [])).toEqual([
      { by: 'X', kind: 'add' },
      { by: 'Y', kind: 'add' },
    ]);
    expect(ghostTurns(4, ['X', 'Y'], ['P', 'Q'])).toEqual([
      { by: 'P', kind: 'add' },
      { by: 'Q', kind: 'add' },
      { by: 'X', kind: 'redraft' },
      { by: 'Y', kind: 'redraft' },
    ]);
    expect(ghostTurns(2, ['X'], ['P'])).toEqual([]);
  });

  it('Draft 3: the ghost picks after the snake, in a round of its own', () => {
    const actions = [pick('A', 1, 10), pick('B', 2, 20), pick('C', 3, 30)];
    expect(nextTurn(draft3, actions)).toEqual({ teamId: 'G', round: 2, slot: 3, ghost: { by: 'X', kind: 'add' } });
    expect(nextTurn(draft3, [...actions, pick('G', 4)])).toEqual({ teamId: 'G', round: 2, slot: 4, ghost: { by: 'Y', kind: 'add' } });
    expect(nextTurn(draft3, [...actions, pick('G', 4), pick('G', 5)])).toBeNull();
  });

  it('Draft 3: the survivors yielding doesn’t skip the ghost', () => {
    const actions = [yieldTurn('A'), yieldTurn('B'), yieldTurn('C')];
    expect(nextTurn(draft3, actions)?.ghost).toEqual({ by: 'X', kind: 'add' });
  });

  it('Draft 4: the ghost’s snake slots take its turns in order', () => {
    // Snake: A B G | G B A | A B G | G B A
    const s = s4([pick('A', 1, 10), pick('B', 2, 20)]);
    expect(nextTurn(s.config, s.actions)).toEqual({ teamId: 'G', round: 1, slot: 2, ghost: { by: 'P', kind: 'add' } });
    const s2 = s4([pick('A', 1, 10), pick('B', 2, 20), pick('G', 3)]);
    expect(nextTurn(s2.config, s2.actions)).toEqual({ teamId: 'G', round: 2, slot: 3, ghost: { by: 'Q', kind: 'add' } });
    const s3 = s4([pick('A', 1, 10), pick('B', 2, 20), pick('G', 3), pick('G', 4), pick('B', 5, 21), pick('A', 6, 11), pick('A', 7, 12), pick('B', 8, 22)]);
    expect(nextTurn(s3.config, s3.actions)).toEqual({ teamId: 'G', round: 3, slot: 8, ghost: { by: 'X', kind: 'redraft' } });
  });

  it('an add fills a spot: no drop, no yield', () => {
    const s = s4([pick('A', 1, 10), pick('B', 2, 20)]);
    expect(validateAction(s, pick('G', 3))).toBeNull();
    expect(validateAction(s, pick('G', 3, 30))).toMatch(/empty spot/);
    expect(validateAction(s, yieldTurn('G'))).toMatch(/can’t skip/);
  });

  it('a redraft turn is an ordinary redraft pick', () => {
    const s = s4([pick('A', 1, 10), pick('B', 2, 20), pick('G', 3), pick('G', 4), pick('B', 5, 21), pick('A', 6, 11), pick('A', 7, 12), pick('B', 8, 22)]);
    expect(validateAction(s, pick('G', 9, 30))).toBeNull();
    expect(validateAction(s, pick('G', 9))).toMatch(/must drop/);
    expect(validateAction(s, pick('G', 9, 10))).toMatch(/not on your roster/);
    expect(validateAction(s, yieldTurn('G'))).toBeNull();
    // A ghost yield skips its last turn too (round 4 opens G, B, A).
    const after = applyAction(s, yieldTurn('G'));
    expect(nextTurn(after.config, after.actions)).toEqual({ teamId: 'B', round: 4, slot: 10 });
  });

  it('autodraft fills an add with the best hitter and redrafts only dead hitters', () => {
    const candidates = [
      { playerId: 1, regularSeasonTb: 200 },
      { playerId: 2, regularSeasonTb: 350 },
    ];
    const add = s4([pick('A', 5, 10), pick('B', 6, 20)]);
    expect(autodraftAction(add, candidates, [])).toEqual(pick('G', 2));
    const redraftTurn = s4([pick('A', 5, 10), pick('B', 6, 20), pick('G', 7), pick('G', 8), pick('B', 9, 21), pick('A', 14, 11), pick('A', 15, 12), pick('B', 16, 22)]);
    expect(autodraftAction(redraftTurn, candidates, [31])).toEqual(pick('G', 2, 31));
    expect(autodraftAction(redraftTurn, candidates, [])).toEqual(yieldTurn('G'));
  });
});
