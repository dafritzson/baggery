// The commissioner closes a fantasy round once its games are done: the round's lowest-ranked teams
// (by TB, then the rules' tiebreakers) are eliminated. A full tie across the cut line is a
// drink-off, whose winners the commissioner picks. A round can be reopened (a stat correction,
// say) until the draft after it starts.
//
// POST { seasonId, round }                        → { eliminated, advancing } or { drinkOff }
// POST { seasonId, round, drinkOffWinners: [...] } → closes it with those teams through
// POST { seasonId, round, reopen: true }         → { reopened }

import { requireCommissioner, requireUser } from '../_shared/auth.ts';
import { eliminations } from '../_shared/core/scoring.ts';
import type { FantasyRound } from '../_shared/core/types.ts';
import { sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';
import { roundGames, roundRanking } from '../_shared/round-ranking.ts';

serve(async (req) => {
  const userId = await requireUser(req);
  const body = (await req.json().catch(() => null)) as
    | { seasonId?: string; round?: number; drinkOffWinners?: string[]; reopen?: boolean }
    | null;
  if (typeof body?.seasonId !== 'string') throw new UserError('seasonId is required.');
  const round = body.round as FantasyRound;
  if (![1, 2, 3].includes(round)) throw new UserError('round must be 1, 2 or 3.');
  const seasonId = body.seasonId;
  await requireCommissioner(seasonId, userId);

  const result = await sql.begin(async (tx) => {
    const [season] = await tx`
      select id, year, status, imported_at, survivors_after_round from seasons where id = ${seasonId} for update`;
    if (!season) throw new UserError('Season not found.', 404);
    if (season.imported_at) throw new UserError('Past seasons were settled in the old sheets.');
    const teams = await tx`select id, eliminated_after_round from fantasy_teams where season_id = ${season.id}`;
    const closedRound = (r: number) => teams.some((t) => t.eliminated_after_round === r);

    if (body.reopen) {
      if (!closedRound(round)) throw new UserError(`Round ${round} isn't closed.`);
      if (round < 3 && closedRound(round + 1)) throw new UserError(`Reopen round ${round + 1} first.`);
      // The draft after this round (Draft 3 after round 1, Draft 4 after round 2) must not have started.
      const [next] = round < 3 ? await tx`select status from drafts where season_id = ${season.id} and number = ${round + 2}` : [];
      if (next && next.status !== 'scheduled') throw new UserError(`Draft ${round + 2} has started, so round ${round} can't be reopened.`);
      await tx`update fantasy_teams set eliminated_after_round = null where season_id = ${season.id} and eliminated_after_round = ${round}`;
      if (round === 3) await tx`update seasons set status = 'active' where id = ${season.id}`;
      return { reopened: round };
    }

    if (closedRound(round)) throw new UserError(`Round ${round} is already closed.`);
    if (round > 1 && !closedRound(round - 1)) throw new UserError(`Close round ${round - 1} first.`);
    const games = await roundGames(tx, season.year, round);
    if (!games.total) throw new UserError(`Round ${round} hasn't had any games yet.`);
    if (games.unfinished) throw new UserError(`${games.unfinished} of round ${round}'s games aren't final yet.`);

    const alive = teams.filter((t) => t.eliminated_after_round === null).map((t) => t.id as string);
    const survivors: number = season.survivors_after_round[round - 1] ?? 1;
    const ranked = await roundRanking(tx, { id: season.id, year: season.year }, round, alive);
    const cut = eliminations(ranked, Math.min(survivors, ranked.length));
    let { advancing, eliminated } = cut;

    if (cut.drinkOff) {
      const winners = body.drinkOffWinners ?? [];
      const valid = winners.length === cut.drinkOff.spots && winners.every((w) => cut.drinkOff!.teamIds.includes(w));
      // Nothing saved yet: the app asks for the drink-off's winners and calls again.
      if (!valid) return { drinkOff: cut.drinkOff };
      advancing = [...advancing, ...winners];
      eliminated = [...eliminated, ...cut.drinkOff.teamIds.filter((t) => !winners.includes(t))];
    }

    await tx`update fantasy_teams set eliminated_after_round = ${round} where id in ${tx(eliminated)}`;
    if (round === 3) await tx`update seasons set status = 'complete' where id = ${season.id}`;
    return { eliminated, advancing };
  });

  return json(result);
});
