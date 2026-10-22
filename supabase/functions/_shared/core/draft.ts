import type { PlayerId, TeamId } from './types.ts';

export type DraftKind = 'initial' | 'redraft';

/** How the order goes round to round: a snake (1..n, n..1, ...) or circular (1..n every round). */
export type DraftPattern = 'snake' | 'circular';

/** Where the first-round order comes from: a shuffle, the previous round's ranking, or a raffle. */
export type DraftOrderBy = 'random' | 'rank' | 'raffle';

/**
 * A turn the ghost team takes, made by one of the eliminated managers (`by`, their team). An add
 * fills an empty spot and can't be yielded (unless nobody undrafted is left); a redraft is an
 * ordinary redraft pick.
 */
export interface GhostTurn {
  by: TeamId;
  kind: 'add' | 'redraft';
}

export interface DraftConfig {
  kind: DraftKind;
  /** Team ids in first-round pick order. */
  order: TeamId[];
  /** Number of rounds. Always 4 today. */
  rounds: number;
  /** Snake when left out. */
  pattern?: DraftPattern;
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
  /** Players who can't be drafted again this season (see takenPlayers). */
  taken: Set<PlayerId>;
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

/** Team for every slot of a circular draft: 1..n every round. */
export function circularSlots(order: TeamId[], rounds: number): TeamId[] {
  return Array.from({ length: rounds }, () => order).flat();
}

/**
 * Every slot of the draft: the snake (or circular order), with the ghost's turns in its own slots (in order; any
 * slots past its last turn are left out) or, when it isn't in the snake, in a round after it.
 */
export function draftTurns(config: DraftConfig): Turn[] {
  const n = config.order.length;
  const teams = config.pattern === 'circular' ? circularSlots(config.order, config.rounds) : snakeSlots(config.order, config.rounds);
  const slots: Turn[] = teams.map((teamId, slot) => ({ teamId, round: Math.floor(slot / n) + 1, slot }));
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
    if (state.config.kind === 'initial') return 'You cannot yield in the initial draft.';
    const empty = mustFill(state, turn.teamId);
    if (turn.ghost && empty > 0) return 'The ghost can’t skip filling a spot.';
    if (empty > 0) return `Fill your ${empty === 1 ? 'empty spot' : `${empty} empty spots`} before you yield.`;
    return null;
  }

  const roster = state.rosters.get(action.teamId) ?? [];
  if (state.taken.has(action.addPlayerId)) return 'That player has already been drafted.';
  if (!state.eligible.has(action.addPlayerId)) return 'That player is not eligible.';

  if (state.config.kind === 'initial') {
    if (action.dropPlayerId !== undefined) return 'You cannot drop players in the initial draft.';
    return roster.length >= ROSTER_SIZE ? 'Your roster is full.' : null;
  }
  if (action.dropPlayerId !== undefined && !roster.includes(action.dropPlayerId)) return 'That player is not on your roster.';

  // A pick fills an empty spot, or swaps out a hitter on the roster.
  const empty = emptySpots(state, action.teamId);
  if (action.dropPlayerId === undefined) {
    if (empty > 0) return null;
    return turn.ghost?.kind === 'add' ? 'Your roster is full.' : 'A redraft pick must drop a player.';
  }
  // The ghost fills its empty spots before it swaps anyone; after that it redrafts like anyone.
  if (turn.ghost?.kind === 'add' || (turn.ghost && empty > 0)) return 'The ghost has an empty spot to fill first.';
  return null;
}

/**
 * A team's empty spots. A hitter whose MLB team is eliminated leaves the roster then (his spell
 * ends), so his spot is simply empty. A redraft pick can fill one without dropping anyone.
 */
export function emptySpots(state: DraftState, teamId: TeamId): number {
  return Math.max(0, ROSTER_SIZE - (state.rosters.get(teamId) ?? []).length);
}

/**
 * How many empty spots a team must fill before it can yield (or pass a ghost turn): all of them,
 * or 0 once nobody undrafted is left to fill them with. Not in the initial draft, which can't yield.
 */
export function mustFill(state: DraftState, teamId: TeamId): number {
  return undraftedLeft(state) ? emptySpots(state, teamId) : 0;
}

/**
 * Whether anyone eligible is still undrafted. Once nobody is, a team with an empty spot can yield
 * (or pass a ghost turn) instead, so the draft can end.
 */
export function undraftedLeft(state: DraftState): boolean {
  for (const p of state.eligible) if (!state.taken.has(p)) return true;
  return false;
}

/** A player's time on a fantasy roster, as far as who can draft him goes. */
export interface Stint {
  teamId: TeamId;
  playerId: PlayerId;
  /** He was dropped (the stint has ended). */
  dropped: boolean;
}

/**
 * Who can't be drafted: everyone on a roster now, and everyone a team still alive has dropped
 * (burned). A player an eliminated manager dropped goes back in the pool, so their discards can
 * be drafted again; once someone does, the same rules apply to him again. (The ghost is cut only
 * after the last round, so its drops stay burned.)
 */
export function takenPlayers(stints: Stint[], eliminatedTeams: Set<TeamId>): Set<PlayerId> {
  return new Set(stints.filter((s) => !s.dropped || !eliminatedTeams.has(s.teamId)).map((s) => s.playerId));
}

/** Applies a legal action to the roster state. Does not validate. */
export function applyAction(state: DraftState, action: DraftAction): DraftState {
  const rosters = new Map(state.rosters);
  const taken = new Set(state.taken);
  if (action.type === 'pick') {
    const roster = (rosters.get(action.teamId) ?? []).filter((p) => p !== action.dropPlayerId);
    rosters.set(action.teamId, [...roster, action.addPlayerId]);
    taken.add(action.addPlayerId);
  }
  return { ...state, actions: [...state.actions, action], rosters, taken };
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
  /** Unset: he fills an empty spot. */
  dropPlayerId?: PlayerId;
}

/**
 * The action autodraft takes for the team on the clock. First the manager's queue (whoever makes
 * the turn), top to bottom: the first queued player still available, swapping out the hitter queued
 * with him (if he's still on the roster) or else filling an empty spot (emptySpots);
 * entries that can't be made are skipped. The ghost fills its empty spots before it swaps anyone.
 * The queue may hold injured players: that's the manager's call. Then, as without one:
 * - Initial draft: the available player with the most regular-season TB, passing over injured ones.
 * - Redraft: fill an empty spot with the best available player; yield when there's none.
 */
export function autodraftAction(state: DraftState, candidates: AutodraftCandidate[], queue: QueueEntry[] = []): DraftAction | null {
  const turn = nextTurn(state.config, state.actions);
  if (!turn) return null;
  const teamId = turn.teamId;
  const available = (id: PlayerId) => state.eligible.has(id) && !state.taken.has(id);

  const roster = state.rosters.get(teamId) ?? [];
  const empty = emptySpots(state, teamId) > 0;
  const canSwap = state.config.kind === 'redraft' && turn.ghost?.kind !== 'add' && !(turn.ghost && empty);

  for (const entry of queue) {
    if (!available(entry.playerId)) continue;
    const swap = entry.dropPlayerId;
    if (canSwap && swap !== undefined && roster.includes(swap)) {
      return { type: 'pick', teamId, addPlayerId: entry.playerId, dropPlayerId: swap };
    }
    if (empty) return { type: 'pick', teamId, addPlayerId: entry.playerId };
  }

  const best = candidates
    .filter((c) => !c.injured && available(c.playerId))
    .sort((a, b) => b.regularSeasonTb - a.regularSeasonTb || a.playerId - b.playerId)[0];

  if (state.config.kind === 'initial') return best ? { type: 'pick', teamId, addPlayerId: best.playerId } : null;
  if (empty && best) return { type: 'pick', teamId, addPlayerId: best.playerId };
  // Nobody but injured hitters left: an empty spot can't be passed while anyone undrafted is.
  if (empty && undraftedLeft(state)) return null;
  return { type: 'yield', teamId };
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

/**
 * Whether actions already taken still line up with a draft's turns: every one was made by the team
 * on the clock. Changing the order or pattern mid-draft is fine only while this holds.
 */
export function actionsFit(config: DraftConfig, actions: DraftAction[]): boolean {
  return actions.every((a, i) => nextTurn(config, actions.slice(0, i))?.teamId === a.teamId);
}

/**
 * The order sources a draft can use. Draft 1 is random only; Draft 2 can follow the Wild Card
 * ranking; Drafts 3 and 4 follow the previous round, and can raffle its cut-line bags.
 */
export function orderByOptions(draftNumber: number): DraftOrderBy[] {
  return draftNumber <= 1 ? ['random'] : draftNumber === 2 ? ['random', 'rank'] : ['random', 'rank', 'raffle'];
}

/** A draft's order source when the commissioner hasn't set one. */
export function defaultOrderBy(draftNumber: number): DraftOrderBy {
  return draftNumber <= 2 ? 'random' : 'rank';
}

/** A team in a raffle draw and its tickets. */
export interface RaffleEntry {
  teamId: TeamId;
  tickets: number;
}

/**
 * Raffle tickets after a round: bags minus the cut line plus 1, for each team ranked at or above
 * the cut, where the cut line is the bags of the best-ranked eliminated manager. A survivor who
 * advanced on a tiebreaker still gets 1. A team ranked below that manager (the ghost can be) gets
 * none. `ranked` holds the teams in the draft, best first; `cut` is that eliminated manager.
 */
export function raffleTickets(ranked: { teamId: TeamId; rank: number; tb: number }[], cut: { rank: number; tb: number }): RaffleEntry[] {
  return ranked.map((t) => ({ teamId: t.teamId, tickets: t.rank <= cut.rank ? Math.max(1, t.tb - cut.tb + 1) : 0 }));
}

/**
 * The raffle's pick order: draw a ticket, its team picks next and its tickets leave the pot, until
 * nobody holding tickets is left. Teams without tickets pick after, in the order given.
 */
export function raffleDraw(entries: RaffleEntry[], random: () => number = Math.random): TeamId[] {
  const pot = entries.filter((e) => e.tickets > 0);
  const order: TeamId[] = [];
  while (pot.length) {
    let ticket = Math.floor(random() * pot.reduce((sum, e) => sum + e.tickets, 0));
    const i = pot.findIndex((e) => (ticket -= e.tickets) < 0);
    order.push(pot.splice(i, 1)[0].teamId);
  }
  return [...order, ...entries.filter((e) => e.tickets <= 0).map((e) => e.teamId)];
}
