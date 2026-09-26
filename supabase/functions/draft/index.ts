// Draft room actions. Every action runs in one transaction that locks the draft row, so
// concurrent picks can't interleave. Rules live in the shared core.
//
// POST { draftId, action: 'start' | 'pick' | 'yield' | 'autopick' | 'undo' | 'set-autodraft', ... }

import { isCommissioner, requireUser } from '../_shared/auth.ts';
import {
  type DraftAction,
  type DraftState,
  applyAction,
  autodraftAction,
  nextTurn,
  randomOrder,
  validateAction,
} from '../_shared/core/draft.ts';
import { type Tx, sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';

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
  number: number;
  kind: 'initial' | 'redraft';
  status: 'scheduled' | 'live' | 'complete';
  pick_order: string[];
  rounds: number;
  locks_at: Date | null;
}

interface Ctx {
  draft: DraftRow;
  state: DraftState;
  autodraftTeams: Set<string>;
  /** Rostered players autodraft may replace: MLB team eliminated or not on the active roster. */
  droppable: number[];
  candidates: { playerId: number; regularSeasonTb: number }[];
  teamOwners: Map<string, string | null>;
}

async function load(tx: Tx, draftId: string): Promise<Ctx> {
  const [draft] = await tx<DraftRow[]>`
    select d.id, d.season_id, s.year, d.number, d.kind, d.status, d.pick_order, d.rounds, d.locks_at
    from drafts d join seasons s on s.id = d.season_id
    where d.id = ${draftId}
    for update of d`;
  if (!draft) throw new UserError('Draft not found.', 404);

  const [actions, spells, pool, teams] = await Promise.all([
    tx`select type, fantasy_team_id, add_player_id, drop_player_id
       from draft_actions where draft_id = ${draftId} order by action_number`,
    tx`select fantasy_team_id, mlb_player_id, dropped_by_draft_id
       from roster_spells where season_id = ${draft.season_id}`,
    tx`select p.mlb_player_id, p.regular_season_tb, p.on_postseason_roster, t.eliminated
       from season_player_pool p
       join season_mlb_teams t on t.season_id = p.season_id and t.mlb_team_id = p.mlb_team_id
       where p.season_id = ${draft.season_id}`,
    tx`select id, user_id, autodraft from fantasy_teams where season_id = ${draft.season_id}`,
  ]);

  const rosters = new Map<string, number[]>(draft.pick_order.map((id) => [id, []]));
  for (const s of spells) {
    if (s.dropped_by_draft_id === null) {
      rosters.set(s.fantasy_team_id, [...(rosters.get(s.fantasy_team_id) ?? []), s.mlb_player_id]);
    }
  }
  const available = pool.filter((p) => p.on_postseason_roster && !p.eliminated);
  const unavailable = new Set(pool.filter((p) => !p.on_postseason_roster || p.eliminated).map((p) => p.mlb_player_id));

  return {
    draft,
    state: {
      config: { kind: draft.kind, order: draft.pick_order, rounds: draft.rounds },
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
    candidates: available.map((p) => ({ playerId: p.mlb_player_id, regularSeasonTb: p.regular_season_tb })),
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
  await tx`
    insert into draft_actions (draft_id, action_number, fantasy_team_id, type, add_player_id, drop_player_id, is_auto, made_by)
    values (${draft.id}, ${ctx.state.actions.length}, ${action.teamId}, ${action.type}, ${add}, ${drop}, ${isAuto}, ${madeBy})`;

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
    if (!ctx.autodraftTeams.has(turn.teamId)) break;
    const action = autodraftAction(ctx.state, ctx.candidates, ctx.droppable);
    if (!action) break;
    await commit(tx, ctx, action, null, true);
  }
  if (!nextTurn(ctx.state.config, ctx.state.actions)) {
    await tx`update drafts set status = 'complete' where id = ${ctx.draft.id}`;
  }
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
      select id, season_id, kind, status, pick_order, rounds from drafts where id = ${body.draftId} for update`;
    if (!draft) throw new UserError('Draft not found.', 404);
    const [team] = await tx`select user_id from fantasy_teams where id = ${teamId} and season_id = ${draft.season_id}`;
    if (!team) throw new UserError('Team not found.', 404);
    if (team.user_id !== userId && !(await isCommissioner(draft.season_id, userId))) {
      throw new UserError('Only the commissioner can do that.', 403);
    }
    await tx`update fantasy_teams set autodraft = ${on} where id = ${teamId}`;
    if (!on || draft.status !== 'live') return;

    const actions = await tx`
      select type, fantasy_team_id from draft_actions where draft_id = ${draft.id} order by action_number`;
    const turn = nextTurn(
      { kind: draft.kind, order: draft.pick_order, rounds: draft.rounds },
      actions.map((a): DraftAction =>
        a.type === 'yield' ? { type: 'yield', teamId: a.fantasy_team_id } : { type: 'pick', teamId: a.fantasy_team_id, addPlayerId: 0 },
      ),
    );
    if (turn?.teamId !== teamId) return;
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
      if (ctx.teamOwners.get(turn.teamId) !== userId && !commissioner) {
        throw new UserError('It is not your turn.');
      }
      return turn.teamId;
    };

    switch (body.action) {
      case 'start': {
        commissionerOnly();
        if (ctx.draft.status !== 'scheduled') throw new UserError('This draft has already started.');
        if (ctx.draft.number > 2) throw new UserError('Standings-based draft order is not supported yet.');
        const teams = await tx`
          select id from fantasy_teams where season_id = ${ctx.draft.season_id} and eliminated_after_round is null`;
        const order = randomOrder(teams.map((t) => t.id as string), () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
        await tx`update drafts set status = 'live', pick_order = ${order} where id = ${ctx.draft.id}`;
        await tx`update seasons set status = 'active' where id = ${ctx.draft.season_id} and status = 'setup'`;
        ctx.draft = { ...ctx.draft, status: 'live', pick_order: order };
        ctx.state = { ...ctx.state, config: { ...ctx.state.config, order } };
        for (const id of order) if (!ctx.state.rosters.has(id)) ctx.state.rosters.set(id, []);
        await advance(tx, ctx);
        break;
      }
      case 'pick': {
        await requireLive(ctx);
        const teamId = actingFor();
        if (body.addPlayerId === undefined) throw new UserError('Choose a player.');
        await commit(tx, ctx, { type: 'pick', teamId, addPlayerId: body.addPlayerId, dropPlayerId: body.dropPlayerId }, userId, false);
        await advance(tx, ctx);
        break;
      }
      case 'yield': {
        await requireLive(ctx);
        await commit(tx, ctx, { type: 'yield', teamId: actingFor() }, userId, false);
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
        await advance(tx, ctx);
        break;
      }
      case 'undo': {
        commissionerOnly();
        const [last] = await tx`
          delete from draft_actions where draft_id = ${ctx.draft.id}
          and action_number = (select max(action_number) from draft_actions where draft_id = ${ctx.draft.id})
          returning type, add_player_id, drop_player_id`;
        if (!last) throw new UserError('Nothing to undo.');
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
