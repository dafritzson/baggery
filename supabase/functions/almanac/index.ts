// The league's Almanac: every season's rows loaded here, next to the database, and turned into
// the Almanac in one go, so the app makes one request instead of a long chain of them. Any
// signed-in user (every signed-in user can read these tables already).
//
// POST { leagueId }  →  AlmanacJson (see _shared/core/almanac.ts)

import { requireUser } from '../_shared/auth.ts';
import {
  type AlmanacInput,
  type AlmanacJson,
  type ScoutingInput,
  almanac,
  almanacToJson,
  badges,
  scouting,
} from '../_shared/core/almanac.ts';
import { type BustSeason, type Redraft, draftBets, replacementLevels } from '../_shared/core/busts.ts';
import type { GameType } from '../_shared/core/types.ts';
import { type Row, sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** How deep into each season's pool, by regular-season TB, the busts-and-steals board goes. */
const BOARD_DEPTH = 120;

async function loadAlmanac(leagueId: string): Promise<AlmanacJson> {
  const [seasons, teams, managers, spells, drafts, actions, pool, games, stats, profiles, mlbTeams, board, boardBags] = await Promise.all([
    sql`select id, year, status from seasons where league_id = ${leagueId}`,
    sql`
      select t.id, t.season_id, t.user_id, t.manager_id, t.eliminated_after_round
      from fantasy_teams t join seasons s on s.id = t.season_id
      -- Not the ghost team (docs/RULES.md): it isn't a manager, and cuts count only managers' teams.
      where s.league_id = ${leagueId} and not t.is_ghost order by t.id`,
    sql`select id, name, user_id from league_managers where league_id = ${leagueId} order by id`,
    sql`
      select r.season_id, r.fantasy_team_id, r.mlb_player_id, r.from_at, r.to_at
      from roster_spells r join seasons s on s.id = r.season_id join fantasy_teams t on t.id = r.fantasy_team_id
      where s.league_id = ${leagueId} and not t.is_ghost order by r.id`,
    sql`
      select d.id, d.season_id, d.number, d.locks_at
      from drafts d join seasons s on s.id = d.season_id
      where s.league_id = ${leagueId} order by d.id`,
    sql`
      select a.draft_id, a.action_number, a.fantasy_team_id, a.type, a.add_player_id, a.drop_player_id
      from draft_actions a join drafts d on d.id = a.draft_id join seasons s on s.id = d.season_id
      join fantasy_teams t on t.id = a.fantasy_team_id
      where s.league_id = ${leagueId} and not t.is_ghost order by a.id`,
    // Each pool player's MLB team that year.
    sql`
      select p.season_id, p.mlb_player_id, p.mlb_team_id
      from season_player_pool p join seasons s on s.id = p.season_id
      where s.league_id = ${leagueId} order by p.mlb_player_id, p.season_id`,
    // Every postseason game of the league's years, for which MLB teams reached each series.
    sql`
      select g.game_type, g.home_team_id, g.away_team_id, g.status, g.start_time, s.id as season_id
      from mlb_games g join seasons s on s.year = g.season_year
      where s.league_id = ${leagueId}`,
    // Box scores of the players each season's teams rostered.
    sql`
      select st.game_pk, st.mlb_player_id, st.ab, st.h, st.bb, st.hbp, st.sf, st.tb, st.hr, st.r, st.rbi,
             g.game_type, g.start_time, g.series_game_number, s.id as season_id
      from player_game_stats st
      join mlb_games g on g.game_pk = st.game_pk
      join seasons s on s.year = g.season_year
      where s.league_id = ${leagueId}
        and exists (select 1 from roster_spells r where r.season_id = s.id and r.mlb_player_id = st.mlb_player_id)
        -- The season being played: finished games only, so nothing counts that can still change.
        and (s.status = 'complete' or g.status = 'Final')
      order by st.game_pk, st.mlb_player_id`,
    sql`select id, display_name from profiles`,
    // Each season's postseason teams as of Draft 1, for its xBags (core/busts.ts).
    sql`
      select t.season_id, t.mlb_team_id, t.seed, t.wins, t.eliminated, t.rotation, m.league
      from season_mlb_teams t join mlb_teams m on m.id = t.mlb_team_id join seasons s on s.id = t.season_id
      where s.league_id = ${leagueId}`,
    // Every pool hitter's regular season, the board busts and steals rank by xBags and TB. Only
    // the platoon splits xBags uses, to keep the read small.
    sql`
      select p.season_id, p.mlb_player_id, p.mlb_team_id, p.regular_season_tb, p.at_bats, p.plate_appearances, p.games_played,
             case when p.platoon is null then null else jsonb_build_object(
               'L', jsonb_build_object('weighted', p.platoon->'L'->'weighted'),
               'R', jsonb_build_object('weighted', p.platoon->'R'->'weighted')) end as platoon
      from (
        select p.*, row_number() over (partition by p.season_id order by p.regular_season_tb desc) as by_tb
        from season_player_pool p join seasons s on s.id = p.season_id
        where s.league_id = ${leagueId} and p.at_bats > 0
      ) p
      -- Draft 1's picks, and the hitters who could be in a board's top 3: Draft 1 takes 28, and
      -- the best by xBags (volume times slugging) have come from the top 93 by TB at most.
      where p.by_tb <= ${BOARD_DEPTH}
        or exists (
          select 1 from draft_actions a join drafts d on d.id = a.draft_id
          where d.season_id = p.season_id and d.number = 1 and a.add_player_id = p.mlb_player_id)`,
    // Every pool hitter's postseason bags (finished games in the season being played).
    sql`
      select s.id as season_id, st.mlb_player_id, sum(st.tb)::int as tb
      from player_game_stats st join mlb_games g on g.game_pk = st.game_pk join seasons s on s.year = g.season_year
      where s.league_id = ${leagueId} and (s.status = 'complete' or g.status = 'Final')
      group by s.id, st.mlb_player_id`,
  ]);

  // A team counts for its manager; an app-played team whose account isn't linked to a manager
  // yet counts for the account, by the first name on the account.
  const owners = new Map(profiles.map((p) => [p.id as string, String(p.display_name ?? '').split(' ')[0]]));
  const managerNames = new Map(managers.map((m) => [m.id as string, m.name as string]));
  const accounts = new Map<string, string>(managers.filter((m) => m.user_id).map((m) => [m.id, m.user_id]));
  const keyOf = (t: Row) =>
    t.manager_id ?? (t.user_id ? `user:${t.user_id}` : `team:${t.id}`);
  for (const t of teams) {
    const key = keyOf(t);
    if (!managerNames.has(key)) managerNames.set(key, t.user_id ? (owners.get(t.user_id) ?? 'Someone') : 'Open spot');
    if (t.user_id && !t.manager_id) accounts.set(key, t.user_id);
  }

  const draftById = new Map(drafts.map((d) => [d.id as string, d]));
  const picks = actions.filter((p) => p.type === 'pick' && draftById.get(p.draft_id)!.number > 1);
  const input: AlmanacInput = {
    seasons: seasons.map((s) => ({ id: s.id, year: s.year, complete: s.status === 'complete' })),
    teams: teams.map((t) => ({ id: t.id, seasonId: t.season_id, managerKey: keyOf(t), eliminatedAfterRound: t.eliminated_after_round })),
    managers: [...managerNames].map(([key, name]) => ({ key, name })),
    spells: spells.map((s) => ({ seasonId: s.season_id, teamId: s.fantasy_team_id, playerId: s.mlb_player_id, from: iso(s.from_at)!, to: iso(s.to_at) })),
    stats: stats.map((l) => ({
      gamePk: l.game_pk,
      seasonId: l.season_id,
      playerId: l.mlb_player_id,
      gameType: l.game_type,
      gameStart: iso(l.start_time)!,
      seriesGameNumber: l.series_game_number,
      ab: l.ab, h: l.h, bb: l.bb, hbp: l.hbp, sf: l.sf, tb: l.tb, hr: l.hr, r: l.r, rbi: l.rbi,
    })),
    playersOut: new Set(
      pool
        .filter((p) => mlbTeams.some((t) => t.season_id === p.season_id && t.mlb_team_id === p.mlb_team_id && t.eliminated))
        .map((p) => `${p.season_id}:${p.mlb_player_id}`),
    ),
    redrafts: picks
      .filter((p) => p.drop_player_id !== null)
      .map((p) => {
        const d = draftById.get(p.draft_id)!;
        return { seasonId: d.season_id, teamId: p.fantasy_team_id, draftNumber: d.number, add: p.add_player_id, drop: p.drop_player_id, at: iso(d.locks_at)! };
      }),
  };

  // Which MLB teams played each series, for seasons the league rostered anyone in.
  const rostered = new Set(spells.map((s) => s.season_id as string));
  const seriesTeams: ScoutingInput['seriesTeams'] = [];
  for (const seasonId of rostered) {
    for (const type of ['F', 'D', 'L', 'W'] as GameType[]) {
      const ofType = games.filter((g) => g.season_id === seasonId && g.game_type === type);
      if (ofType.length) seriesTeams.push({ seasonId, gameType: type, mlbTeamIds: [...new Set(ofType.flatMap((g) => [g.home_team_id, g.away_team_id]))] });
    }
  }

  const playerIds = [...new Set([...spells.map((s) => s.mlb_player_id as number), ...picks.flatMap((p) => [p.add_player_id, p.drop_player_id])])].filter(
    (id): id is number => id !== null,
  );
  const names: Row[] = playerIds.length ? [...(await sql`select id, full_name from mlb_players where id in ${sql(playerIds)}`)] : [];

  const result = almanac(input);
  const scouted = scouting(
    input,
    {
      picks: actions.map((p) => {
        const d = draftById.get(p.draft_id)!;
        return { seasonId: d.season_id, teamId: p.fantasy_team_id, draftNumber: d.number, actionNumber: p.action_number, type: p.type, add: p.add_player_id, drop: p.drop_player_id };
      }),
      players: pool.map((p) => ({ seasonId: p.season_id, playerId: p.mlb_player_id, mlbTeamId: p.mlb_team_id })),
      seriesTeams,
    },
    result,
  );
  // Draft 1's picks against the board, for busts and steals (core/busts.ts).
  const NEXT_REDRAFT: Record<string, Redraft | null> = { F: 2, D: 3, L: 4, W: null };
  // Replacement level: what each redraft's adds scored from its lock on, over finished seasons.
  const complete = new Set(seasons.filter((s) => s.status === 'complete').map((s) => s.id as string));
  const replacement = replacementLevels(
    actions
      .filter((a) => a.type === 'pick' && a.add_player_id !== null && complete.has(draftById.get(a.draft_id)!.season_id))
      .flatMap((a) => {
        const d = draftById.get(a.draft_id)!;
        if (d.number < 2 || !d.locks_at) return [];
        const from = d.locks_at.getTime();
        const bags = stats
          .filter((l) => l.season_id === d.season_id && l.mlb_player_id === a.add_player_id && l.start_time.getTime() >= from)
          .reduce((sum, l) => sum + l.tb, 0);
        return [{ draft: d.number, bags }];
      }),
  );
  const bustSeasons: BustSeason[] = seasons.flatMap((s) => {
    const draft1 = drafts.find((d) => d.season_id === s.id && d.number === 1);
    if (!draft1?.locks_at) return [];
    const finals = games.filter((g) => g.season_id === s.id && g.status === 'Final');
    const teamGamesPlayed = new Map<number, number>();
    for (const g of finals) for (const id of [g.home_team_id, g.away_team_id]) teamGamesPlayed.set(id, (teamGamesPlayed.get(id) ?? 0) + 1);
    // An eliminated team's last game says which redraft replaced its hitters.
    const replacedAt = (teamId: number): Redraft | null | undefined => {
      const last = finals
        .filter((g) => g.home_team_id === teamId || g.away_team_id === teamId)
        .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
        .at(-1);
      return last ? NEXT_REDRAFT[last.game_type] : 2;
    };
    return [{
      seasonId: s.id,
      year: s.year,
      complete: s.status === 'complete',
      lockedAt: iso(draft1.locks_at)!,
      teams: mlbTeams.filter((t) => t.season_id === s.id).map((t) => ({
        teamId: t.mlb_team_id, league: t.league, seed: t.seed, wins: t.wins, rotation: t.rotation,
        replacedAt: t.eliminated ? replacedAt(t.mlb_team_id) : undefined,
      })),
      players: board.filter((p) => p.season_id === s.id).map((p) => ({
        playerId: p.mlb_player_id, mlbTeamId: p.mlb_team_id, tb: p.regular_season_tb ?? 0, ab: p.at_bats ?? 0,
        pa: p.plate_appearances ?? 0, games: p.games_played ?? 0, platoon: p.platoon,
      })),
      picks: actions
        .filter((a) => a.draft_id === draft1.id && a.type === 'pick' && a.add_player_id !== null)
        .sort((a, b) => a.action_number - b.action_number)
        .map((a) => ({ managerKey: keyOf(teams.find((t) => t.id === a.fantasy_team_id)!), playerId: a.add_player_id })),
      teamGamesPlayed,
      bags: new Map(boardBags.filter((b) => b.season_id === s.id).map((b) => [b.mlb_player_id, b.tb])),
    }];
  });
  const bets = draftBets(bustSeasons, replacement);
  // The hitters picks were measured against, who may never have been rostered: their names too.
  const unnamed = [...new Set(bets.flatMap((b) => b.alternatives))].filter((id) => !playerIds.includes(id));
  if (unnamed.length) names.push(...(await sql`select id, full_name from mlb_players where id in ${sql(unnamed)}`));

  return almanacToJson({
    almanac: result,
    managers: managerNames,
    accounts,
    players: new Map(names.map((p) => [p.id as number, p.full_name as string])),
    scouting: scouted,
    badges: badges(scouted),
    bets,
  });
}

serve(async (req) => {
  await requireUser(req);
  const body = (await req.json().catch(() => null)) as { leagueId?: unknown } | null;
  if (typeof body?.leagueId !== 'string') throw new UserError('leagueId is required.');
  return json(await loadAlmanac(body.leagueId));
});
