// Rebuilds a season's draft pool from the MLB Stats API: every hitter on the active
// roster of a postseason team, with regular-season TB for autodraft. Commissioner only.
//
// POST { seasonId, teamIds?: number[] }  (teamIds overrides the clinched-teams lookup)

import { requireCommissioner, requireUser } from '../_shared/auth.ts';
import { sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';

const MLB = 'https://statsapi.mlb.com/api/v1';
const LEAGUES: Record<number, 'AL' | 'NL'> = { 103: 'AL', 104: 'NL' };

// deno-lint-ignore no-explicit-any
async function mlb(path: string): Promise<any> {
  const res = await fetch(`${MLB}${path}`);
  if (!res.ok) throw new Error(`MLB API ${res.status} for ${path}`);
  return res.json();
}

async function clinchedTeamIds(year: number): Promise<number[]> {
  const data = await mlb(`/standings?leagueId=103,104&season=${year}&standingsTypes=regularSeason`);
  return data.records
    .flatMap((r: { teamRecords: { clinched?: boolean; team: { id: number } }[] }) => r.teamRecords)
    .filter((t: { clinched?: boolean }) => t.clinched)
    .map((t: { team: { id: number } }) => t.team.id);
}

interface PoolPlayer {
  id: number;
  fullName: string;
  position: string;
  birthDate: string | null;
  teamId: number;
  regularSeasonTb: number;
}

async function activeHitters(teamId: number, year: number): Promise<PoolPlayer[]> {
  const data = await mlb(
    `/teams/${teamId}/roster?rosterType=active&season=${year}&hydrate=person(stats(type=season,season=${year},group=hitting))`,
  );
  // deno-lint-ignore no-explicit-any
  return data.roster
    .filter((r: any) => r.position.type !== 'Pitcher') // two-way players stay in
    // deno-lint-ignore no-explicit-any
    .map((r: any): PoolPlayer => ({
      id: r.person.id,
      fullName: r.person.fullName,
      position: r.position.abbreviation,
      birthDate: r.person.birthDate ?? null,
      teamId,
      regularSeasonTb: r.person.stats?.[0]?.splits?.[0]?.stat?.totalBases ?? 0,
    }));
}

async function firstPitch(year: number, gameType: string): Promise<Date | null> {
  const data = await mlb(`/schedule?sportId=1&season=${year}&gameType=${gameType}`);
  const times: number[] = data.dates.flatMap((d: { games: { gameDate: string }[] }) =>
    d.games.map((g) => Date.parse(g.gameDate)),
  );
  return times.length ? new Date(Math.min(...times)) : null;
}

serve(async (req) => {
  const userId = await requireUser(req);
  const { seasonId, teamIds } = (await req.json()) as { seasonId: string; teamIds?: number[] };
  if (!seasonId) throw new UserError('seasonId is required.');
  await requireCommissioner(seasonId, userId);

  const [season] = await sql`select year, status from seasons where id = ${seasonId}`;
  if (!season) throw new UserError('Season not found.', 404);
  const year: number = season.year;

  const playoffTeamIds = teamIds?.length ? teamIds : await clinchedTeamIds(year);
  if (!playoffTeamIds.length) throw new UserError('No teams have clinched a postseason spot yet.');

  const teamsData = await mlb(`/teams?sportId=1&season=${year}`);
  // deno-lint-ignore no-explicit-any
  const mlbTeams = teamsData.teams.map((t: any) => ({
    id: t.id,
    name: t.name,
    abbreviation: t.abbreviation,
    league: LEAGUES[t.league?.id] ?? null,
  }));
  const players = (await Promise.all(playoffTeamIds.map((id) => activeHitters(id, year)))).flat();
  const wildCardStart = await firstPitch(year, 'F');

  await sql.begin(async (tx) => {
    await tx`
      insert into mlb_teams ${tx(mlbTeams, 'id', 'name', 'abbreviation', 'league')}
      on conflict (id) do update set name = excluded.name, abbreviation = excluded.abbreviation, league = excluded.league`;

    // Before the season starts, the field can still change. After that, teams only get eliminated.
    if (season.status === 'setup') {
      await tx`delete from season_mlb_teams where season_id = ${seasonId} and not (mlb_team_id = any(${playoffTeamIds}))`;
    }
    await tx`
      insert into season_mlb_teams ${tx(playoffTeamIds.map((id) => ({ season_id: seasonId, mlb_team_id: id })))}
      on conflict do nothing`;

    if (players.length) {
      await tx`
        insert into mlb_players ${tx(
          players.map((p) => ({ id: p.id, full_name: p.fullName, primary_position: p.position, birth_date: p.birthDate })),
        )}
        on conflict (id) do update set full_name = excluded.full_name, primary_position = excluded.primary_position,
          birth_date = excluded.birth_date, updated_at = now()`;

      // Players who left an active roster stay in the pool table (for history) but become ineligible.
      await tx`update season_player_pool set on_postseason_roster = false where season_id = ${seasonId}`;
      await tx`
        insert into season_player_pool ${tx(
          players.map((p) => ({
            season_id: seasonId,
            mlb_player_id: p.id,
            mlb_team_id: p.teamId,
            regular_season_tb: p.regularSeasonTb,
            on_postseason_roster: true,
          })),
        )}
        on conflict (season_id, mlb_player_id) do update set mlb_team_id = excluded.mlb_team_id,
          regular_season_tb = excluded.regular_season_tb, on_postseason_roster = true`;
    }
    if (season.status === 'setup') {
      await tx`delete from season_player_pool where season_id = ${seasonId} and not on_postseason_roster`;
    }

    if (wildCardStart) {
      await tx`
        update drafts set locks_at = ${wildCardStart}
        where season_id = ${seasonId} and number = 1 and status = 'scheduled'`;
    }
  });

  return json({ ok: true, teams: playoffTeamIds.length, players: players.length, draft1LocksAt: wildCardStart });
});
