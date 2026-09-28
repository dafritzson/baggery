// Draft room actions. Every action runs in one transaction that locks the draft row, so
// concurrent picks can't interleave. Rules live in the shared core.
//
// POST { draftId, action: 'start' | 'pick' | 'yield' | 'autopick' | 'undo' | 'set-autodraft', ... }

import { isCommissioner, requireUser } from '../_shared/auth.ts';
import {
  type AutodraftCandidate,
  type Turn,
  type DraftAction,
  type DraftState,
  type GhostTurn,
  applyAction,
  autodraftAction,
  draftable,
  ghostTurns,
  nextTurn,
  randomOrder,
  redraftOrder,
  validateAction,
} from '../_shared/core/draft.ts';
import type { FantasyRound } from '../_shared/core/types.ts';
import { type Tx, sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';
import { logCommissioner, playerName, teamLabel } from '../_shared/league-log.ts';
import { roundRanking } from '../_shared/round-ranking.ts';

interface Body {
  draftId: string;
  action: 'start' | 'pick' | 'yield' | 'autopick' | 'undo' | 'set-autodraft';
  addPlayerId?: number;
  dropPlayerId?: number;
  teamId?: string;
  autodraft?: boolean;
}

interface DraftRow {
  id: string;
  season_id: string;
  year: number;
  /** The season's status: a finished season's drafts are history and can't be changed. */
  season_status: 'setup' | 'active' | 'complete';
  number: number;
  kind: 'initial' | 'redraft';
  status: 'scheduled' | 'live' | 'complete';
  pick_order: string[];
  rounds: number;
  locks_at: Date | null;
  ghost_turns: GhostTurn[];
}

interface Ctx {
  draft: DraftRow;
  state: DraftState;
  autodraftTeams: Set<string>;
  /** Rostered players autodraft may replace: MLB team eliminated or not on the active roster. */
  droppable: number[];
  candidates: AutodraftCandidate[];
  teamOwners: Map<string, string | null>;
}

/** Who acts on a turn: the team on the clock, or on a ghost turn the eliminated manager's team making it. */
const turnOwner = (turn: Turn) => turn.ghost?.by ?? turn.teamId;

async function load(tx: Tx, draftId: string): Promise<Ctx> {
  const [draft] = await tx<DraftRow[]>`
    select d.id, d.season_id, s.year, s.status as season_status, d.number, d.kind, d.status, d.pick_order, d.rounds, d.locks_at, d.ghost_turns
    from drafts d join seasons s on s.id = d.season_id
    where d.id = ${draftId}
    for update of d`;
  if (!draft) throw new UserError('Draft not found.', 404);

  const [actions, spells, pool, teams] = await Promise.all([
    tx`select type, fantasy_team_id, add_player_id, drop_player_id
       from draft_actions where draft_id = ${draftId} order by action_number`,
    tx`select fantasy_team_id, mlb_player_id, dropped_by_draft_id
       from roster_spells where season_id = ${draft.season_id}`,
    tx`select p.mlb_player_id, p.regular_season_tb, p.on_postseason_roster, p.injured_list, t.eliminated
       from season_player_pool p
       join season_mlb_teams t on t.season_id = p.season_id and t.mlb_team_id = p.mlb_team_id
       where p.season_id = ${draft.season_id}`,
    tx`select id, user_id, autodraft, is_ghost from fantasy_teams where season_id = ${draft.season_id}`,
  ]);

  const ghostId: string | undefined = teams.find((t) => t.is_ghost)?.id;
  const ghost = ghostId && draft.ghost_turns.length ? { teamId: ghostId, turns: draft.ghost_turns } : undefined;
  const rosters = new Map<string, number[]>([...draft.pick_order, ...(ghost ? [ghost.teamId] : [])].map((id) => [id, []]));
  for (const s of spells) {
    if (s.dropped_by_draft_id === null) {
      rosters.set(s.fantasy_team_id, [...(rosters.get(s.fantasy_team_id) ?? []), s.mlb_player_id]);
    }
  }
  // Draft 1 also takes hitters on the injured list; later drafts only the postseason roster.
  const canDraft = (p: (typeof pool)[number]) =>
    draftable({ onActiveRoster: p.on_postseason_roster, injured: p.injured_list !== null, eliminated: p.eliminated }, draft.number);
  const available = pool.filter(canDraft);
  const unavailable = new Set(pool.filter((p) => !canDraft(p)).map((p) => p.mlb_player_id));

  return {
    draft,
    state: {
      config: { kind: draft.kind, order: draft.pick_order, rounds: draft.rounds, ghost },
      actions: actions.map(
        (a): DraftAction =>
          a.type === 'yield'
            ? { type: 'yield', teamId: a.fantasy_team_id }
            : {
                type: 'pick',
                teamId: a.fantasy_team_id,
                addPlayerId: a.add_player_id,
                dropPlayerId: a.drop_player_id ?? undefined,
              },
      ),
      rosters,
      everRostered: new Set(spells.map((s) => s.mlb_player_id)),
      eligible: new Set(available.map((p) => p.mlb_player_id)),
    },
    autodraftTeams: new Set(teams.filter((t) => t.autodraft).map((t) => t.id)),
    droppable: spells.filter((s) => s.dropped_by_draft_id === null && unavailable.has(s.mlb_player_id)).map((s) => s.mlb_player_id),
    candidates: available.map((p) => ({
      playerId: p.mlb_player_id,
      regularSeasonTb: p.regular_season_tb,
      injured: p.injured_list !== null,
    })),
    teamOwners: new Map(teams.map((t) => [t.id, t.user_id])),
  };
}

/** When roster changes take effect. Initial-draft players count from the start of the year. */
function effectiveAt(draft: DraftRow): Date {
  if (draft.kind === 'initial') return new Date(Date.UTC(draft.year, 0, 1));
  if (!draft.locks_at) throw new UserError('Set the lock time before running a redraft.');
  return draft.locks_at;
}

async function commit(tx: Tx, ctx: Ctx, action: DraftAction, madeBy: string | null, isAuto: boolean) {
  const error = validateAction(ctx.state, action);
  if (error) throw new UserError(error);

  const { draft } = ctx;
  const add = action.type === 'pick' ? action.addPlayerId : null;
  const drop = action.type === 'pick' ? action.dropPlayerId ?? null : null;
  const by = nextTurn(ctx.state.config, ctx.state.actions)?.ghost?.by ?? null;
  await tx`
    insert into draft_actions (draft_id, action_number, fantasy_team_id, type, add_player_id, drop_player_id, is_auto, made_by, by_team_id)
    values (${draft.id}, ${ctx.state.actions.length}, ${action.teamId}, ${action.type}, ${add}, ${drop}, ${isAuto}, ${madeBy}, ${by})`;

  if (action.type === 'pick') {
    const at = effectiveAt(draft);
    if (drop !== null) {
      await tx`
        update roster_spells set to_at = ${at}, dropped_by_draft_id = ${draft.id}
        where season_id = ${draft.season_id} and mlb_player_id = ${drop}`;
    }
    await tx`
      insert into roster_spells (season_id, fantasy_team_id, mlb_player_id, from_at, added_by_draft_id)
      values (${draft.season_id}, ${action.teamId}, ${add}, ${at}, ${draft.id})`;
  }
  ctx.state = applyAction(ctx.state, action);
  ctx.droppable = ctx.droppable.filter((p) => p !== drop);
}

/** Makes picks for autodraft teams while they're on the clock, then marks the draft complete if done. */
async function advance(tx: Tx, ctx: Ctx) {
  for (let turn = nextTurn(ctx.state.config, ctx.state.actions); turn; turn = nextTurn(ctx.state.config, ctx.state.actions)) {
    if (!ctx.autodraftTeams.has(turnOwner(turn))) break;
    const action = autodraftAction(ctx.state, ctx.candidates, ctx.droppable);
    if (!action) break;
    await commit(tx, ctx, action, null, true);
  }
  if (!nextTurn(ctx.state.config, ctx.state.actions)) {
    await tx`update drafts set status = 'complete' where id = ${ctx.draft.id}`;
  }
}

/** Logs a pick the commissioner made for someone else's team. */
async function logPick(tx: Tx, ctx: Ctx, userId: string, action: 'pick' | 'autopick', teamId: string, add: number, drop: number | null) {
  const dropped = drop !== null ? `, dropping ${await playerName(tx, drop)}` : '';
  await logCommissioner(tx, {
    seasonId: ctx.draft.season_id,
    userId,
    action,
    summary: `${action === 'autopick' ? 'Autopicked' : 'Picked'} ${await playerName(tx, add)} for ${await teamLabel(tx, teamId)}${dropped} in Draft ${ctx.draft.number}`,
    details: { draftId: ctx.draft.id, teamId, addPlayerId: add, dropPlayerId: drop },
  });
}

/** The season's ghost team, created on first use: the spot after the managers', named Ghost. */
async function ghostTeam(tx: Tx, seasonId: string): Promise<string> {
  const [existing] = await tx`select id from fantasy_teams where season_id = ${seasonId} and is_ghost`;
  if (existing) return existing.id;
  const [created] = await tx`
    insert into fantasy_teams (season_id, slot, name, is_ghost)
    select ${seasonId}, coalesce(max(slot), 0) + 1, 'Ghost', true from fantasy_teams where season_id = ${seasonId}
    returning id`;
  return created.id;
}

async function requireLive(ctx: Ctx) {
  if (ctx.draft.status !== 'live') throw new UserError('The draft is not live.');
}

/**
 * The autodraft switch, kept light because managers flip it and wait for it: it locks just the
 * draft row, and loads the full draft (players, rosters, the pool) only when switching on for
 * the team that's on the clock, which is the one case where it has to pick right away.
 */
async function setAutodraft(body: Body, userId: string) {
  const teamId = body.teamId;
  if (!teamId) throw new UserError('teamId is required.');
  const on = !!body.autodraft;
  await sql.begin(async (tx) => {
    const [draft] = await tx<DraftRow[]>`
      select id, season_id, kind, status, pick_order, rounds, ghost_turns from drafts where id = ${body.draftId} for update`;
    if (!draft) throw new UserError('Draft not found.', 404);
    const [team] = await tx`select user_id from fantasy_teams where id = ${teamId} and season_id = ${draft.season_id}`;
    if (!team) throw new UserError('Team not found.', 404);
    if (team.user_id !== userId && !(await isCommissioner(draft.season_id, userId))) {
      throw new UserError('Only the commissioner can do that.', 403);
    }
    await tx`update fantasy_teams set autodraft = ${on} where id = ${teamId}`;
    if (team.user_id !== userId) {
      await logCommissioner(tx, {
        seasonId: draft.season_id,
        userId,
        action: 'set-autodraft',
        summary: `Turned autodraft ${on ? 'on' : 'off'} for ${await teamLabel(tx, teamId)}`,
        details: { draftId: draft.id, teamId, autodraft: on },
      });
    }
    if (!on || draft.status !== 'live') return;

    const actions = await tx`
      select type, fantasy_team_id from draft_actions where draft_id = ${draft.id} order by action_number`;
    const [ghostTeam] = draft.ghost_turns.length
      ? await tx`select id from fantasy_teams where season_id = ${draft.season_id} and is_ghost`
      : [];
    const turn = nextTurn(
      {
        kind: draft.kind,
        order: draft.pick_order,
        rounds: draft.rounds,
        ghost: ghostTeam ? { teamId: ghostTeam.id, turns: draft.ghost_turns } : undefined,
      },
      actions.map((a): DraftAction =>
        a.type === 'yield' ? { type: 'yield', teamId: a.fantasy_team_id } : { type: 'pick', teamId: a.fantasy_team_id, addPlayerId: 0 },
      ),
    );
    if (!turn || turnOwner(turn) !== teamId) return;
    await advance(tx, await load(tx, draft.id));
  });
}

serve(async (req) => {
  const started = Date.now();
  const userId = await requireUser(req);
  const body = (await req.json()) as Body;
  if (!body.draftId) throw new UserError('draftId is required.');

  if (body.action === 'set-autodraft') {
    await setAutodraft(body, userId);
    // Visible in the function's logs, to see where a slow toggle spends its time.
    console.log(JSON.stringify({ action: body.action, ms: Date.now() - started }));
    return json({ ok: true });
  }

  await sql.begin(async (tx) => {
    const ctx = await load(tx, body.draftId);
    const commissioner = await isCommissioner(ctx.draft.season_id, userId);
    const commissionerOnly = () => {
      if (!commissioner) throw new UserError('Only the commissioner can do that.', 403);
    };
    const turn = nextTurn(ctx.state.config, ctx.state.actions);
    const actingFor = () => {
      if (!turn) throw new UserError('The draft is complete.');
      if (ctx.teamOwners.get(turnOwner(turn)) !== userId && !commissioner) {
        throw new UserError('It is not your turn.');
      }
      return turn.teamId;
    };
    // Acting for someone else's turn (logged): on a ghost turn, the manager making it.
    const forSomeoneElse = () => !turn || ctx.teamOwners.get(turnOwner(turn)) !== userId;

    switch (body.action) {
      case 'start': {
        commissionerOnly();
        if (ctx.draft.status !== 'scheduled') throw new UserError('This draft has already started.');
        const teams = await tx`
          select id, eliminated_after_round from fantasy_teams where season_id = ${ctx.draft.season_id} and not is_ghost`;
        const alive = teams.filter((t) => t.eliminated_after_round === null).map((t) => t.id as string);
        const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
        let order: string[];
        let ghost: DraftState['config']['ghost'];
        if (ctx.draft.number <= 2) {
          order = randomOrder(alive, random);
        } else {
          // Drafts 3 and 4 go in the previous round's order (the best-ranked team first), once
          // that round is closed.
          const round = (ctx.draft.number - 2) as FantasyRound;
          const season = { id: ctx.draft.season_id, year: ctx.draft.year };
          const out = (r: number) => teams.filter((t) => t.eliminated_after_round === r).map((t) => t.id as string);
          if (!out(round).length) throw new UserError(`Close round ${round} first (on the Standings page), so the draft order can follow it.`);
          // The ghost team: created for Draft 3, where the managers out after round 1 give it its first
          // hitters. In Draft 4 it drafts in the snake, placed by its round 2 ranking like everyone.
          const ghostId = await ghostTeam(tx, ctx.draft.season_id);
          const ranked1 = await roundRanking(tx, season, 1, teams.map((t) => t.id as string));
          const outAfter1 = redraftOrder(ranked1, out(1), random);
          if (round === 1) {
            order = redraftOrder(ranked1, alive, random);
            ghost = { teamId: ghostId, turns: ghostTurns(3, outAfter1, []) };
          } else {
            const ranked2 = await roundRanking(tx, season, 2, [...alive, ...out(2), ghostId]);
            order = redraftOrder(ranked2, [...alive, ghostId], random);
            ghost = { teamId: ghostId, turns: ghostTurns(4, outAfter1, redraftOrder(ranked2, out(2), random)) };
          }
        }
        const ghostTurnList = ghost?.turns ?? [];
        await tx`update drafts set status = 'live', pick_order = ${order}, ghost_turns = ${tx.json(JSON.parse(JSON.stringify(ghostTurnList)))} where id = ${ctx.draft.id}`;
        await tx`update seasons set status = 'active' where id = ${ctx.draft.season_id} and status = 'setup'`;
        ctx.draft = { ...ctx.draft, status: 'live', pick_order: order, ghost_turns: ghostTurnList };
        ctx.state = { ...ctx.state, config: { ...ctx.state.config, order, ghost } };
        for (const id of [...order, ...(ghost ? [ghost.teamId] : [])]) if (!ctx.state.rosters.has(id)) ctx.state.rosters.set(id, []);
        await logCommissioner(tx, {
          seasonId: ctx.draft.season_id,
          userId,
          action: 'start',
          summary: `Started Draft ${ctx.draft.number}`,
          details: { draftId: ctx.draft.id, order },
        });
        await advance(tx, ctx);
        break;
      }
      case 'pick': {
        await requireLive(ctx);
        const teamId = actingFor();
        if (body.addPlayerId === undefined) throw new UserError('Choose a player.');
        await commit(tx, ctx, { type: 'pick', teamId, addPlayerId: body.addPlayerId, dropPlayerId: body.dropPlayerId }, userId, false);
        if (forSomeoneElse()) {
          await logPick(tx, ctx, userId, 'pick', teamId, body.addPlayerId, body.dropPlayerId ?? null);
        }
        await advance(tx, ctx);
        break;
      }
      case 'yield': {
        await requireLive(ctx);
        const teamId = actingFor();
        await commit(tx, ctx, { type: 'yield', teamId }, userId, false);
        if (forSomeoneElse()) {
          await logCommissioner(tx, {
            seasonId: ctx.draft.season_id,
            userId,
            action: 'yield',
            summary: `Passed for ${await teamLabel(tx, teamId)} in Draft ${ctx.draft.number}`,
            details: { draftId: ctx.draft.id, teamId },
          });
        }
        await advance(tx, ctx);
        break;
      }
      case 'autopick': {
        // Commissioner picks the autodraft choice for whoever is on the clock.
        commissionerOnly();
        await requireLive(ctx);
        const action = autodraftAction(ctx.state, ctx.candidates, ctx.droppable);
        if (!action) throw new UserError('No eligible players left.');
        await commit(tx, ctx, action, userId, true);
        if (action.type === 'pick') {
          await logPick(tx, ctx, userId, 'autopick', action.teamId, action.addPlayerId, action.dropPlayerId ?? null);
        } else {
          await logCommissioner(tx, {
            seasonId: ctx.draft.season_id,
            userId,
            action: 'autopick',
            summary: `Autodrafted a pass for ${await teamLabel(tx, action.teamId)} in Draft ${ctx.draft.number}`,
            details: { draftId: ctx.draft.id, teamId: action.teamId },
          });
        }
        await advance(tx, ctx);
        break;
      }
      case 'undo': {
        commissionerOnly();
        if (ctx.draft.season_status === 'complete') throw new UserError('That season is over, so its drafts can’t be changed.');
        const [last] = await tx`
          delete from draft_actions where draft_id = ${ctx.draft.id}
          and action_number = (select max(action_number) from draft_actions where draft_id = ${ctx.draft.id})
          returning action_number, fantasy_team_id, type, add_player_id, drop_player_id, is_auto, made_by`;
        if (!last) throw new UserError('Nothing to undo.');
        const team = await teamLabel(tx, last.fantasy_team_id);
        const what =
          last.type === 'pick'
            ? `${last.is_auto ? 'autopick' : 'pick'} of ${await playerName(tx, last.add_player_id)}` +
              (last.drop_player_id !== null ? `, dropping ${await playerName(tx, last.drop_player_id)},` : '')
            : last.is_auto ? 'autodraft pass' : 'pass';
        await logCommissioner(tx, {
          seasonId: ctx.draft.season_id,
          userId,
          action: 'undo',
          summary: `Undid ${team}'s ${what} in Draft ${ctx.draft.number}`,
          details: {
            draftId: ctx.draft.id,
            actionNumber: last.action_number,
            teamId: last.fantasy_team_id,
            type: last.type,
            addPlayerId: last.add_player_id,
            dropPlayerId: last.drop_player_id,
            isAuto: last.is_auto,
            madeBy: last.made_by,
          },
        });
        if (last.type === 'pick') {
          await tx`delete from roster_spells where season_id = ${ctx.draft.season_id} and mlb_player_id = ${last.add_player_id}`;
          if (last.drop_player_id !== null) {
            await tx`
              update roster_spells set to_at = null, dropped_by_draft_id = null
              where season_id = ${ctx.draft.season_id} and mlb_player_id = ${last.drop_player_id}`;
          }
        }
        await tx`update drafts set status = 'live' where id = ${ctx.draft.id}`;
        break;
      }
      default:
        throw new UserError('Unknown action.');
    }
  });

  console.log(JSON.stringify({ action: body.action, ms: Date.now() - started }));
  return json({ ok: true });
});
