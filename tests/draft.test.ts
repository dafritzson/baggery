import { describe, expect, it } from 'vitest';
import {
  type DraftAction,
  type DraftConfig,
  type DraftState,
  applyAction,
  autodraftAction,
  nextTurn,
  randomOrder,
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

  it('redraft: replaces a droppable player with the best available', () => {
    const s = state(redraft, { rosters: new Map([['A', [10, 11, 12, 13]]]) });
    expect(autodraftAction(s, candidates, [12])).toEqual(pick('A', 2, 12));
  });

  it('redraft: yields when nothing needs replacing', () => {
    const s = state(redraft, { rosters: new Map([['A', [10, 11, 12, 13]]]) });
    expect(autodraftAction(s, candidates, [99])).toEqual(yieldTurn('A'));
  });
});

describe('randomOrder', () => {
  it('is a permutation', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    expect(randomOrder(teams).sort()).toEqual(teams);
  });
});
