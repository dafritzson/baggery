import type { PlayerId, TeamId } from './types.ts';

export type DraftKind = 'initial' | 'redraft';

export interface DraftConfig {
  kind: DraftKind;
  /** Team ids in first-round pick order. */
  order: TeamId[];
  /** Number of snake rounds. Always 4 today. */
  rounds: number;
}

export type DraftAction =
  | { type: 'pick'; teamId: TeamId; addPlayerId: PlayerId; dropPlayerId?: PlayerId }
  | { type: 'yield'; teamId: TeamId };

export interface Turn {
  teamId: TeamId;
  /** 1-based snake round. */
  round: number;
  /** 0-based index into the full snake sequence. */
  slot: number;
}

/** Everything needed to validate an action. Built by the caller from the database. */
export interface DraftState {
  config: DraftConfig;
  /** Actions already taken in this draft, in order. */
  actions: DraftAction[];
  /** Current roster of each team participating in this draft. */
  rosters: Map<TeamId, PlayerId[]>;
  /** Every player who has ever been on any roster this season. */
  everRostered: Set<PlayerId>;
  /** Players currently eligible to be drafted (in the pool and their MLB team alive). */
  eligible: Set<PlayerId>;
}

export const ROSTER_SIZE = 4;

/** Team for every slot of a snake draft: 1..n, n..1, 1..n, ... */
export function snakeSlots(order: TeamId[], rounds: number): TeamId[] {
  const slots: TeamId[] = [];
  for (let r = 0; r < rounds; r++) {
    slots.push(...(r % 2 === 0 ? order : [...order].reverse()));
  }
  return slots;
}

/**
 * Whose turn it is, or null when the draft is complete. Teams that have yielded are
 * skipped for the rest of the draft.
 */
export function nextTurn(config: DraftConfig, actions: DraftAction[]): Turn | null {
  const slots = snakeSlots(config.order, config.rounds);
  const yielded = new Set<TeamId>();
  let next = 0;
  for (let slot = 0; slot < slots.length; slot++) {
    const teamId = slots[slot];
    if (yielded.has(teamId)) continue;
    if (next < actions.length) {
      if (actions[next].type === 'yield') yielded.add(teamId);
      next++;
      continue;
    }
    return { teamId, round: Math.floor(slot / config.order.length) + 1, slot };
  }
  return null;
}

/** Returns an error message, or null if the action is legal. */
export function validateAction(state: DraftState, action: DraftAction): string | null {
  const turn = nextTurn(state.config, state.actions);
  if (!turn) return 'The draft is complete.';
  if (turn.teamId !== action.teamId) return 'It is not your turn.';

  if (action.type === 'yield') {
    return state.config.kind === 'initial' ? 'You cannot yield in the initial draft.' : null;
  }

  const roster = state.rosters.get(action.teamId) ?? [];
  if (state.everRostered.has(action.addPlayerId)) return 'That player has already been drafted.';
  if (!state.eligible.has(action.addPlayerId)) return 'That player is not eligible.';

  if (state.config.kind === 'initial') {
    if (action.dropPlayerId !== undefined) return 'You cannot drop players in the initial draft.';
    if (roster.length >= ROSTER_SIZE) return 'Your roster is full.';
    return null;
  }

  if (action.dropPlayerId === undefined) return 'A redraft pick must drop a player.';
  if (!roster.includes(action.dropPlayerId)) return 'That player is not on your roster.';
  return null;
}

/** Applies a legal action to the roster state. Does not validate. */
export function applyAction(state: DraftState, action: DraftAction): DraftState {
  const rosters = new Map(state.rosters);
  const everRostered = new Set(state.everRostered);
  if (action.type === 'pick') {
    const roster = (rosters.get(action.teamId) ?? []).filter((p) => p !== action.dropPlayerId);
    rosters.set(action.teamId, [...roster, action.addPlayerId]);
    everRostered.add(action.addPlayerId);
  }
  return { ...state, actions: [...state.actions, action], rosters, everRostered };
}

export interface AutodraftCandidate {
  playerId: PlayerId;
  regularSeasonTb: number;
}

/**
 * The action autodraft takes for the team on the clock.
 * - Initial draft: the available player with the most regular-season TB.
 * - Redraft: drop the first droppable player (MLB team eliminated, or an injury the group
 *   voted on) and add the best available player; yield when nothing needs replacing.
 */
export function autodraftAction(
  state: DraftState,
  candidates: AutodraftCandidate[],
  droppable: PlayerId[],
): DraftAction | null {
  const turn = nextTurn(state.config, state.actions);
  if (!turn) return null;
  const teamId = turn.teamId;

  const best = candidates
    .filter((c) => state.eligible.has(c.playerId) && !state.everRostered.has(c.playerId))
    .sort((a, b) => b.regularSeasonTb - a.regularSeasonTb || a.playerId - b.playerId)[0];

  if (state.config.kind === 'initial') {
    return best ? { type: 'pick', teamId, addPlayerId: best.playerId } : null;
  }

  const roster = state.rosters.get(teamId) ?? [];
  const drop = droppable.find((p) => roster.includes(p));
  if (drop === undefined || !best) return { type: 'yield', teamId };
  return { type: 'pick', teamId, addPlayerId: best.playerId, dropPlayerId: drop };
}

/** Fisher–Yates shuffle. `random` returns a float in [0, 1). */
export function randomOrder(teamIds: TeamId[], random: () => number = Math.random): TeamId[] {
  const order = [...teamIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
