import type { PlayerId, TeamId } from './types.ts';

export type DraftKind = 'initial' | 'redraft';

/**
 * A turn the ghost team takes, made by one of the eliminated managers (`by`, their team). An add
 * fills an empty spot and can't be yielded; a redraft is an ordinary redraft pick.
 */
export interface GhostTurn {
  by: TeamId;
  kind: 'add' | 'redraft';
}

export interface DraftConfig {
  kind: DraftKind;
  /** Team ids in first-round pick order. */
  order: TeamId[];
  /** Number of snake rounds. Always 4 today. */
  rounds: number;
  /**
   * The ghost team's turns (Drafts 3 and 4). When the ghost isn't in `order` (Draft 3) they come
   * after the snake; when it is (Draft 4) they fill its snake slots in order.
   */
  ghost?: { teamId: TeamId; turns: GhostTurn[] };
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
  /** On a ghost turn: the eliminated manager's team who makes it, and the kind of turn. */
  ghost?: GhostTurn;
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
  /**
   * Rostered players whose MLB team is eliminated. They can't stay: a team holding one can't yield
   * (or pass a ghost turn) while there's anyone left to replace him with.
   */
  eliminated?: Set<PlayerId>;
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
 * Every slot of the draft: the snake, with the ghost's turns in its own slots (in order; any
 * slots past its last turn are left out) or, when it isn't in the snake, in a round after it.
 */
export function draftTurns(config: DraftConfig): Turn[] {
  const n = config.order.length;
  const slots: Turn[] = snakeSlots(config.order, config.rounds).map((teamId, slot) => ({ teamId, round: Math.floor(slot / n) + 1, slot }));
  const ghost = config.ghost;
  if (!ghost) return slots;
  if (!config.order.includes(ghost.teamId)) {
    return [...slots, ...ghost.turns.map((g, i) => ({ teamId: ghost.teamId, round: config.rounds + 1, slot: slots.length + i, ghost: g }))];
  }
  let next = 0;
  return slots.flatMap((s) => (s.teamId !== ghost.teamId ? [s] : next < ghost.turns.length ? [{ ...s, ghost: ghost.turns[next++] }] : []));
}

/**
 * Whose turn it is, or null when the draft is complete. Teams that have yielded are
 * skipped for the rest of the draft, except the ghost: a pass on a ghost turn passes only that
 * turn, so one eliminated manager never costs another theirs.
 */
export function nextTurn(config: DraftConfig, actions: DraftAction[]): Turn | null {
  const yielded = new Set<TeamId>();
  let next = 0;
  for (const turn of draftTurns(config)) {
    if (yielded.has(turn.teamId)) continue;
    if (next < actions.length) {
      if (actions[next].type === 'yield' && !turn.ghost) yielded.add(turn.teamId);
      next++;
      continue;
    }
    return turn;
  }
  return null;
}

/** Returns an error message, or null if the action is legal. */
export function validateAction(state: DraftState, action: DraftAction): string | null {
  const turn = nextTurn(state.config, state.actions);
  if (!turn) return 'The draft is complete.';
  if (turn.teamId !== action.teamId) return 'It is not your turn.';

  if (action.type === 'yield') {
    if (turn.ghost?.kind === 'add') return 'The ghost can’t skip filling a spot.';
    if (state.config.kind === 'initial') return 'You cannot yield in the initial draft.';
    const out = mustReplace(state, turn.teamId);
    if (out > 0) return `Replace your ${out === 1 ? 'eliminated hitter' : `${out} eliminated hitters`} before you yield.`;
    return null;
  }

  const roster = state.rosters.get(action.teamId) ?? [];
  if (state.everRostered.has(action.addPlayerId)) return 'That player has already been drafted.';
  if (!state.eligible.has(action.addPlayerId)) return 'That player is not eligible.';

  // The ghost fills its empty spots without dropping anyone; after that it redrafts like anyone.
  if (state.config.kind === 'initial' || turn.ghost?.kind === 'add' || (turn.ghost && roster.length < ROSTER_SIZE)) {
    if (action.dropPlayerId !== undefined) {
      return turn.ghost ? 'The ghost has an empty spot to fill first.' : 'You cannot drop players in the initial draft.';
    }
    if (roster.length >= ROSTER_SIZE) return 'Your roster is full.';
    return null;
  }

  if (action.dropPlayerId === undefined) return 'A redraft pick must drop a player.';
  if (!roster.includes(action.dropPlayerId)) return 'That player is not on your roster.';
  return null;
}

/**
 * How many of a team's players are on an eliminated MLB team and must be replaced: 0 once nobody
 * undrafted is left to replace them with.
 */
export function mustReplace(state: DraftState, teamId: TeamId): number {
  const eliminated = state.eliminated;
  if (!eliminated?.size) return 0;
  const out = (state.rosters.get(teamId) ?? []).filter((p) => eliminated.has(p)).length;
  if (!out) return 0;
  for (const p of state.eligible) if (!state.everRostered.has(p)) return out;
  return 0;
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

/**
 * Whether a pool player can be drafted: his MLB team is alive and he's on its active roster, or,
 * in Draft 1 only (before postseason rosters are set), on its injured list with time to come back.
 */
export function draftable(
  player: { onActiveRoster: boolean; injured: boolean; eliminated: boolean },
  draftNumber: number,
): boolean {
  return !player.eliminated && (player.onActiveRoster || (draftNumber === 1 && player.injured));
}

export interface AutodraftCandidate {
  playerId: PlayerId;
  regularSeasonTb: number;
  /** On the injured list: managers may take the gamble, autodraft doesn't. */
  injured?: boolean;
}

/** A player a manager queued up for autodraft, and in a redraft who to drop for him. */
export interface QueueEntry {
  playerId: PlayerId;
  /** Unset: whoever autodraft would drop (MLB team eliminated). */
  dropPlayerId?: PlayerId;
}

/**
 * The action autodraft takes for the team on the clock. First the manager's queue (whoever makes
 * the turn), top to bottom: the first queued player still available, dropping the player queued
 * with him (if he's still on the roster) or else a droppable one; entries that can't be made are
 * skipped. The queue may hold injured players: that's the manager's call. Then, as without one:
 * - Initial draft: the available player with the most regular-season TB, passing over injured ones.
 * - Redraft: drop the first droppable player (MLB team eliminated, or an injury the group
 *   voted on) and add the best available player; yield when nothing needs replacing.
 */
export function autodraftAction(
  state: DraftState,
  candidates: AutodraftCandidate[],
  droppable: PlayerId[],
  queue: QueueEntry[] = [],
): DraftAction | null {
  const turn = nextTurn(state.config, state.actions);
  if (!turn) return null;
  const teamId = turn.teamId;
  const available = (id: PlayerId) => state.eligible.has(id) && !state.everRostered.has(id);

  const roster = state.rosters.get(teamId) ?? [];
  const filling = state.config.kind === 'initial' || turn.ghost?.kind === 'add' || (turn.ghost && roster.length < ROSTER_SIZE);
  const autoDrop = droppable.find((p) => roster.includes(p));

  for (const entry of queue) {
    if (!available(entry.playerId)) continue;
    if (filling) return { type: 'pick', teamId, addPlayerId: entry.playerId };
    const drop = entry.dropPlayerId !== undefined && roster.includes(entry.dropPlayerId) ? entry.dropPlayerId : autoDrop;
    if (drop !== undefined) return { type: 'pick', teamId, addPlayerId: entry.playerId, dropPlayerId: drop };
  }

  const best = candidates
    .filter((c) => !c.injured && available(c.playerId))
    .sort((a, b) => b.regularSeasonTb - a.regularSeasonTb || a.playerId - b.playerId)[0];

  if (filling) return best ? { type: 'pick', teamId, addPlayerId: best.playerId } : null;
  if (autoDrop === undefined || !best) return { type: 'yield', teamId };
  return { type: 'pick', teamId, addPlayerId: best.playerId, dropPlayerId: autoDrop };
}

/**
 * The ghost team's turns in a draft, each group of eliminated managers best-ranked first. Draft 3:
 * the 2 out after round 1 each add a hitter. Draft 4: the 2 out after round 2 each add one, then
 * the 2 out after round 1 each make an ordinary redraft pick.
 */
export function ghostTurns(draftNumber: number, outAfterRound1: TeamId[], outAfterRound2: TeamId[]): GhostTurn[] {
  const adds = (draftNumber === 3 ? outAfterRound1 : draftNumber === 4 ? outAfterRound2 : []).map((by): GhostTurn => ({ by, kind: 'add' }));
  const redrafts = draftNumber === 4 ? outAfterRound1.map((by): GhostTurn => ({ by, kind: 'redraft' })) : [];
  return [...adds, ...redrafts];
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

/**
 * The order for a redraft after a round (Draft 3 after round 1, Draft 4 after round 2): the
 * survivors by that round's ranking, best first. Teams fully tied (same rank) are shuffled among
 * themselves.
 */
export function redraftOrder(ranked: { teamId: TeamId; rank: number }[], survivors: TeamId[], random: () => number = Math.random): TeamId[] {
  const alive = ranked.filter((r) => survivors.includes(r.teamId));
  const ranks = [...new Set(alive.map((r) => r.rank))].sort((a, b) => a - b);
  return ranks.flatMap((rank) => randomOrder(alive.filter((r) => r.rank === rank).map((r) => r.teamId), random));
}
