// Rounds close by themselves (poll-games, see _shared/close-round.ts). The commissioner steps in
// for what the code can't decide:
//
// POST { seasonId, round, drinkOffWinners: [...] } → closes a round whose cut is a full tie
// POST { seasonId, round }                        → closes a round they reopened
// POST { seasonId, round, reopen: true }         → reopens a round (a stat correction, say)
//   until the draft after it starts; it then waits for them to close it again.

import { requireCommissioner, requireUser } from '../_shared/auth.ts';
import { type Season, closeRound } from '../_shared/close-round.ts';
import type { FantasyRound } from '../_shared/core/types.ts';
import { sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';

serve(async (req) => {
  const userId = await requireUser(req);
  const body = (await req.json().catch(() => null)) as
    | { seasonId?: string; round?: number; drinkOffWinners?: string[]; reopen?: boolean }
    | null;
  if (typeof body?.seasonId !== 'string') throw new UserError('seasonId is required.');
  const seasonId = body.seasonId;
  const round = body.round as FantasyRound;
  if (![1, 2, 3].includes(round)) throw new UserError('round must be 1, 2 or 3.');
  await requireCommissioner(seasonId, userId);

  const result = await sql.begin(async (tx) => {
    const [season] = await tx`
      select id, year, imported_at, survivors_after_round, manual_rounds from seasons where id = ${seasonId} for update`;
    if (!season) throw new UserError('Season not found.', 404);
    if (season.imported_at) throw new UserError('Past seasons were settled in the old sheets.');
    const s = season as unknown as Season;

    if (body.reopen) {
      const teams = await tx`select eliminated_after_round from fantasy_teams where season_id = ${seasonId}`;
      const closed = (r: number) => teams.some((t) => t.eliminated_after_round === r);
      if (!closed(round)) throw new UserError(`Round ${round} isn't closed.`);
      if (round < 3 && closed(round + 1)) throw new UserError(`Reopen round ${round + 1} first.`);
      // The draft after this round (Draft 3 after round 1, Draft 4 after round 2) must not have started.
      const [next] = round < 3 ? await tx`select status from drafts where season_id = ${seasonId} and number = ${round + 2}` : [];
      if (next && next.status !== 'scheduled') throw new UserError(`Draft ${round + 2} has started, so round ${round} can't be reopened.`);
      await tx`update fantasy_teams set eliminated_after_round = null where season_id = ${seasonId} and eliminated_after_round = ${round}`;
      // Left for the commissioner to close again, so the poller doesn't close it straight back.
      await tx`update seasons set manual_rounds = array_append(array_remove(manual_rounds, ${round}::smallint), ${round}::smallint) where id = ${seasonId}`;
      if (round === 3) await tx`update seasons set status = 'active' where id = ${seasonId}`;
      return { reopened: round };
    }
    return await closeRound(tx, s, round, body.drinkOffWinners);
  });
  return json(result);
});
