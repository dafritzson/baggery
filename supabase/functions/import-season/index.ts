// Imports a past season (history/<year>.json from scripts/history/check.ts) for the league's
// commissioner. One transaction writes the season, its teams, drafts and roster spells; the app
// then asks poll-games to load that postseason's games and box scores from MLB.
//
// POST { leagueId, season }   → { seasonId }
//
// Importing a year again replaces it, but only a season that was itself imported: a season
// played in the app can never be overwritten.

import { requireUser } from '../_shared/auth.ts';
import { IMPORT_DRAFTS, importSpells, type SeasonImport, validateSeasonImport } from '../_shared/core/season-import.ts';
import { sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';

serve(async (req) => {
  const userId = await requireUser(req);
  const body = (await req.json().catch(() => null)) as { leagueId?: string; season?: unknown } | null;
  if (typeof body?.leagueId !== 'string') throw new UserError('leagueId is required.');
  const [member] = await sql`
    select 1 from league_members
    where league_id = ${body.leagueId} and user_id = ${userId} and role = 'commissioner'`;
  if (!member) throw new UserError('Only the commissioner can import seasons.', 403);
  const invalid = validateSeasonImport(body.season);
  if (invalid) throw new UserError(invalid);
  const season = body.season as SeasonImport;
  const leagueId = body.leagueId;

  const seasonId = await sql.begin(async (tx) => {
    // Serialize imports into this league, and never touch a season played in the app.
    await tx`select id from leagues where id = ${leagueId} for update`;
    const [played] = await tx`
      select min(year) as year from seasons where league_id = ${leagueId} and imported_at is null`;
    if (played?.year && season.year >= played.year) {
      throw new UserError(`Only seasons before ${played.year} can be imported.`);
    }
    await tx`delete from seasons where league_id = ${leagueId} and year = ${season.year}`;

    await tx`
      insert into mlb_teams ${tx(season.mlbTeams, 'id', 'name', 'abbreviation', 'league')}
      on conflict (id) do nothing`;
    await tx`
      insert into mlb_players ${tx(season.players.map((p) => ({ id: p.id, full_name: p.fullName })), 'id', 'full_name')}
      on conflict (id) do nothing`;

    await tx`
      insert into league_managers ${tx(season.managers.map((m) => ({ league_id: leagueId, name: m.name })), 'league_id', 'name')}
      on conflict (league_id, name) do nothing`;
    const managers = await tx`
      select id, name, user_id from league_managers
      where league_id = ${leagueId} and name in ${tx(season.managers.map((m) => m.name))}`;
    const managerByName = new Map(managers.map((m) => [m.name as string, m]));

    const [{ id }] = await tx`
      insert into seasons (league_id, year, status, imported_at)
      values (${leagueId}, ${season.year}, 'complete', now())
      returning id`;

    // Past teams are named after their manager, and belong to the manager's account if linked.
    const byName = [...season.managers].sort((a, b) => a.name.localeCompare(b.name));
    const teams = await tx`
      insert into fantasy_teams ${tx(
        byName.map((m, i) => ({
          season_id: id,
          slot: i + 1,
          name: m.name,
          manager_id: managerByName.get(m.name)!.id,
          user_id: managerByName.get(m.name)!.user_id,
          eliminated_after_round: m.eliminatedAfterRound,
        })),
        'season_id', 'slot', 'name', 'manager_id', 'user_id', 'eliminated_after_round',
      )}
      returning id, name`;
    const teamId = new Map(teams.map((t) => [t.name as string, t.id as string]));

    await tx`
      insert into season_mlb_teams ${tx(
        season.mlbTeams.map((t) => ({ season_id: id, mlb_team_id: t.id, eliminated: t.eliminated })),
        'season_id', 'mlb_team_id', 'eliminated',
      )}`;
    await tx`
      insert into season_player_pool ${tx(
        season.players.map((p) => ({ season_id: id, mlb_player_id: p.id, mlb_team_id: p.teamId, on_postseason_roster: true })),
        'season_id', 'mlb_player_id', 'mlb_team_id', 'on_postseason_roster',
      )}`;

    const draftId = new Map<number, string>();
    for (const spec of IMPORT_DRAFTS) {
      const d = season.drafts[spec.number - 1];
      const [draft] = await tx`
        insert into drafts (season_id, number, kind, fantasy_round, before_game_type, pick_order, status, locks_at)
        values (${id}, ${spec.number}, ${spec.kind}, ${spec.round}, ${spec.before},
                ${d.pickOrder.map((m) => teamId.get(m)!)}, 'complete', ${d.locksAt})
        returning id`;
      draftId.set(spec.number, draft.id);
      await tx`
        insert into draft_actions ${tx(
          d.actions.map((a, i) => ({
            draft_id: draft.id,
            action_number: i,
            fantasy_team_id: teamId.get(a.manager)!,
            type: a.type,
            add_player_id: a.add,
            drop_player_id: a.drop,
            created_at: d.locksAt,
          })),
          'draft_id', 'action_number', 'fantasy_team_id', 'type', 'add_player_id', 'drop_player_id', 'created_at',
        )}`;
    }

    await tx`
      insert into roster_spells ${tx(
        importSpells(season).map((s) => ({
          season_id: id,
          fantasy_team_id: teamId.get(s.manager)!,
          mlb_player_id: s.playerId,
          from_at: s.from,
          to_at: s.to,
          added_by_draft_id: draftId.get(s.addedByDraft)!,
          dropped_by_draft_id: s.droppedByDraft === null ? null : draftId.get(s.droppedByDraft)!,
        })),
        'season_id', 'fantasy_team_id', 'mlb_player_id', 'from_at', 'to_at', 'added_by_draft_id', 'dropped_by_draft_id',
      )}`;
    return id as string;
  });

  return json({ seasonId });
});
