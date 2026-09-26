// A past season to import: what scripts/history/check.ts makes from the league's old workbooks,
// and what the import-season Edge Function writes. Games and box scores aren't included; the
// poller loads them from MLB after the import.

import { applyAction, type DraftAction, type DraftState, nextTurn, validateAction } from './draft.ts';
import type { GameType, PlayerId } from './types.ts';

export interface SeasonImport {
  year: number;
  /** Managers by first name. The champion's eliminatedAfterRound is null. */
  managers: { name: string; eliminatedAfterRound: 1 | 2 | 3 | null }[];
  /** Drafts 1–4, each a complete snake in the app's model (a yield sits a team out for good). */
  drafts: {
    number: number;
    /** First pitch of the series the draft was before; roster changes take effect here. */
    locksAt: string;
    /** Manager names in first-round order. */
    pickOrder: string[];
    actions: { manager: string; type: 'pick' | 'yield'; add: PlayerId | null; drop: PlayerId | null }[];
  }[];
  /** Every rostered player, with the MLB team he played for that postseason. */
  players: { id: PlayerId; fullName: string; teamId: number }[];
  /** The postseason's MLB teams; every one but the World Series winner was eliminated. */
  mlbTeams: { id: number; name: string; abbreviation: string; league: 'AL' | 'NL' | null; eliminated: boolean }[];
}

/** Draft n: the fantasy round it sets rosters for, and the series it's before. */
export const IMPORT_DRAFTS: { number: number; kind: 'initial' | 'redraft'; round: 1 | 2 | 3; before: GameType }[] = [
  { number: 1, kind: 'initial', round: 1, before: 'F' },
  { number: 2, kind: 'redraft', round: 1, before: 'D' },
  { number: 3, kind: 'redraft', round: 2, before: 'L' },
  { number: 4, kind: 'redraft', round: 3, before: 'W' },
];

/** A player's time on a manager's roster, [from, to). */
export interface ImportSpell {
  manager: string;
  playerId: PlayerId;
  from: string;
  to: string | null;
  addedByDraft: number;
  droppedByDraft: number | null;
}

// deno-lint-ignore no-explicit-any
type Loose = any;

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/**
 * Why `data` isn't an importable season, or null. Replays every draft with the draft room's own
 * rules, so an imported draft always makes sense in the app.
 */
export function validateSeasonImport(data: unknown): string | null {
  const s = data as Loose;
  if (!s || typeof s !== 'object') return 'That file is not a season.';
  if (!isInt(s.year) || s.year < 1900 || s.year > 2100) return 'The season has no valid year.';
  if (!Array.isArray(s.managers) || s.managers.length < 2) return 'The season needs at least two managers.';
  const names = new Set<string>();
  for (const m of s.managers) {
    if (typeof m?.name !== 'string' || !/^\S.{0,29}$/.test(m.name) || m.name !== m.name.trim()) {
      return `Bad manager name: ${JSON.stringify(m?.name)}`;
    }
    if (names.has(m.name.toLowerCase())) return `Manager ${m.name} is listed twice.`;
    names.add(m.name.toLowerCase());
    if (m.eliminatedAfterRound !== null && ![1, 2, 3].includes(m.eliminatedAfterRound)) {
      return `Bad elimination round for ${m.name}.`;
    }
  }
  const managers = (s.managers as SeasonImport['managers']).map((m) => m.name);
  if (s.managers.filter((m: Loose) => m.eliminatedAfterRound === null).length !== 1) {
    return 'Exactly one manager must be the champion.';
  }

  if (!Array.isArray(s.mlbTeams) || !s.mlbTeams.length) return 'The season has no MLB teams.';
  for (const t of s.mlbTeams) {
    if (!isInt(t?.id) || typeof t.name !== 'string' || typeof t.abbreviation !== 'string' || typeof t.eliminated !== 'boolean') {
      return 'Bad MLB team.';
    }
  }
  const mlbTeamIds = new Set<number>(s.mlbTeams.map((t: Loose) => t.id));
  if (!Array.isArray(s.players)) return 'The season has no players.';
  for (const p of s.players) {
    if (!isInt(p?.id) || typeof p.fullName !== 'string' || !mlbTeamIds.has(p.teamId)) {
      return `Bad player: ${JSON.stringify(p)}`;
    }
  }
  const playerIds = new Set<PlayerId>(s.players.map((p: Loose) => p.id));

  if (!Array.isArray(s.drafts) || s.drafts.length !== 4) return 'The season needs drafts 1 to 4.';
  const rosters = new Map<string, PlayerId[]>(managers.map((m) => [m, []]));
  let everRostered = new Set<PlayerId>();
  let lastLock = '';
  for (const spec of IMPORT_DRAFTS) {
    const d = s.drafts[spec.number - 1];
    const label = `Draft ${spec.number}`;
    if (d?.number !== spec.number) return `The drafts must be in order: expected ${label}.`;
    if (!isTime(d.locksAt) || d.locksAt <= lastLock) return `${label} has no valid lock time.`;
    lastLock = d.locksAt;
    // Drafts 3 and 4 are only for the teams still alive in the round they set rosters for.
    const expected = s.managers
      .filter((m: Loose) => m.eliminatedAfterRound === null || m.eliminatedAfterRound >= spec.round)
      .map((m: Loose) => m.name);
    if (
      !Array.isArray(d.pickOrder) ||
      d.pickOrder.length !== expected.length ||
      !expected.every((m: string) => d.pickOrder.includes(m))
    ) {
      return `${label}'s pick order must be exactly the teams alive for it.`;
    }
    if (!Array.isArray(d.actions)) return `${label} has no actions.`;
    let state: DraftState = {
      config: { kind: spec.kind, order: d.pickOrder, rounds: 4 },
      actions: [],
      rosters: new Map(d.pickOrder.map((m: string) => [m, rosters.get(m)!])),
      everRostered,
      eligible: playerIds,
    };
    for (const [i, a] of d.actions.entries()) {
      const action: DraftAction = a?.type === 'yield'
        ? { type: 'yield', teamId: a.manager }
        : { type: 'pick', teamId: a?.manager, addPlayerId: a?.add, dropPlayerId: a?.drop ?? undefined };
      if (a?.type !== 'yield' && (a?.type !== 'pick' || !isInt(a.add) || (a.drop !== null && !isInt(a.drop)))) {
        return `${label}, action ${i + 1}: bad action.`;
      }
      const problem = validateAction(state, action);
      if (problem) return `${label}, action ${i + 1} (${a.manager}): ${problem}`;
      state = applyAction(state, action);
    }
    if (nextTurn(state.config, state.actions)) return `${label} isn't finished.`;
    for (const [m, r] of state.rosters) rosters.set(m, r);
    for (const r of state.rosters.values()) {
      if (r.length !== 4) return `After ${label}, a roster doesn't have 4 players.`;
    }
    everRostered = state.everRostered;
  }
  return null;
}

/** Roster spells from the drafts: each pick ends the dropped player's spell and starts the added one's. */
export function importSpells(season: SeasonImport): ImportSpell[] {
  const spells: ImportSpell[] = [];
  for (const d of season.drafts) {
    for (const a of d.actions) {
      if (a.type !== 'pick') continue;
      const dropped = spells.find((s) => s.playerId === a.drop && s.to === null);
      if (dropped) {
        dropped.to = d.locksAt;
        dropped.droppedByDraft = d.number;
      }
      spells.push({ manager: a.manager, playerId: a.add!, from: d.locksAt, to: null, addedByDraft: d.number, droppedByDraft: null });
    }
  }
  return spells;
}
