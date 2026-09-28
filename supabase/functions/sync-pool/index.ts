// Rebuilds a season's draft pool from the MLB Stats API: every hitter on the active
// roster of a postseason team, with regular-season stats (TB for autodraft; PA, AB, games, SLG,
// OPS+ and the other counts for the draft room) and each team's wins, Wild Card bye and seed.
// Also platoons and batting order (core/platoon.ts): each hitter's starts and lineup spots against
// each hand's starters and his splits against each hand, and each team's likely rotation.
// Commissioner only. For an imported past season it fills the pool for the Draft and Research
// tabs from that year's end-of-season rosters, for the postseason teams the import stored.
//
// POST { seasonId, teamIds?: number[] }  (teamIds overrides the clinched-teams lookup)

import { requireCommissioner, requireUser } from '../_shared/auth.ts';
import type { Hand } from '../_shared/core/platoon.ts';
import { type Counts, sumCounts } from '../_shared/core/player-stats.ts';
import {
  type BattingLine,
  type StandingsTeam,
  addBattingLines,
  byeTeamIds,
  playoffSeeds,
  emptyBattingLine,
  opsPlus,
  seasonSlg,
} from '../_shared/core/stats.ts';
import { type Tx, sql } from '../_shared/db.ts';
import { UserError, json, serve } from '../_shared/http.ts';
import {
  type Person,
  type PlatoonRecord,
  type TeamGame,
  handSplitRows,
  hitterLineupGames,
  people,
  platoonRecord,
  SPLIT_CODES,
  starterIds,
  teamGames,
  teamRotation,
} from './lineups.ts';

const MLB = 'https://statsapi.mlb.com/api/v1';
const LEAGUES: Record<number, 'AL' | 'NL'> = { 103: 'AL', 104: 'NL' };

// deno-lint-ignore no-explicit-any
async function mlb(path: string): Promise<any> {
  const res = await fetch(`${MLB}${path}`);
  if (!res.ok) throw new Error(`MLB API ${res.status} for ${path}`);
  return res.json();
}

interface TeamStanding extends StandingsTeam {
  wins: number;
  clinched: boolean;
}

async function standings(year: number, leagueOf: Map<number, 'AL' | 'NL'>): Promise<TeamStanding[]> {
  const data = await mlb(`/standings?leagueId=103,104&season=${year}&standingsTypes=regularSeason`);
  // deno-lint-ignore no-explicit-any
  return data.records.flatMap((r: any) => r.teamRecords).flatMap((t: any): TeamStanding[] => {
    const league = leagueOf.get(t.team.id);
    if (!league) return [];
    return [{
      teamId: t.team.id,
      league,
      divisionRank: Number(t.divisionRank),
      leagueRank: Number(t.leagueRank),
      wins: t.wins,
      clinched: !!t.clinched,
    }];
  });
}

/** Every count we keep from an MLB hitting line; a BattingLine and then some. */
// deno-lint-ignore no-explicit-any
function battingLine(stat: any): Counts {
  return {
    g: stat?.gamesPlayed ?? 0,
    pa: stat?.plateAppearances ?? 0,
    ab: stat?.atBats ?? 0,
    r: stat?.runs ?? 0,
    h: stat?.hits ?? 0,
    doubles: stat?.doubles ?? 0,
    triples: stat?.triples ?? 0,
    hr: stat?.homeRuns ?? 0,
    rbi: stat?.rbi ?? 0,
    bb: stat?.baseOnBalls ?? 0,
    so: stat?.strikeOuts ?? 0,
    hbp: stat?.hitByPitch ?? 0,
    sf: stat?.sacFlies ?? 0,
    tb: stat?.totalBases ?? 0,
  };
}

/** A traded player gets one split per team, and sometimes a combined one without a team. */
// deno-lint-ignore no-explicit-any
function seasonLine(splits: any[] = []): Counts {
  const combined = splits.find((s) => !s.team);
  return combined ? battingLine(combined.stat) : sumCounts(splits.map((s) => battingLine(s.stat)));
}

/** League-wide batting totals, for OPS+. Best effort: OPS+ stays blank if this fails. */
async function leagueLines(year: number, leagueOf: Map<number, 'AL' | 'NL'>): Promise<Map<'AL' | 'NL', BattingLine>> {
  const byLeague = new Map<'AL' | 'NL', BattingLine[]>();
  try {
    const data = await mlb(`/teams/stats?season=${year}&group=hitting&stats=season&sportIds=1`);
    for (const split of data.stats?.[0]?.splits ?? []) {
      const league = leagueOf.get(split.team?.id);
      if (league) byLeague.set(league, [...(byLeague.get(league) ?? []), battingLine(split.stat)]);
    }
  } catch (e) {
    console.error('League stats unavailable, OPS+ left blank:', e);
  }
  return new Map([...byLeague].map(([league, lines]) => [league, addBattingLines(lines)]));
}

interface PoolPlayer {
  id: number;
  fullName: string;
  position: string;
  birthDate: string | null;
  teamId: number;
  season: Counts;
}

/**
 * A team's active hitters, today or on `date` (YYYY-MM-DD). Without a date, a past season's
 * "active" roster is everyone who was active at any point that year, so past seasons pass one.
 */
async function activeHitters(teamId: number, year: number, date: string | null): Promise<PoolPlayer[]> {
  const data = await mlb(
    `/teams/${teamId}/roster?rosterType=active&season=${year}${date ? `&date=${date}` : ''}` +
      `&hydrate=person(stats(type=season,season=${year},group=hitting))`,
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
      season: seasonLine(r.person.stats?.[0]?.splits),
    }));
}

/** A jsonb value for an insert, or null. */
function jsonOrNull(tx: Tx, value: unknown) {
  return value == null ? null : tx.json(JSON.parse(JSON.stringify(value)));
}

interface Platoons {
  players: Map<number, { batSide: Person['batSide']; platoon: PlatoonRecord | null }>;
  rotations: Map<number, { pitcherId: number; name: string; hand: Hand }[]>;
}

/** `/people` for many ids, 200 to a request. */
async function peopleById(ids: number[]): Promise<Map<number, Person>> {
  const all = new Map<number, Person>();
  for (let i = 0; i < ids.length; i += 200) {
    for (const [id, p] of people(await mlb(`/people?personIds=${ids.slice(i, i + 200).join(',')}`))) all.set(id, p);
  }
  return all;
}

/** MLB-wide batting against each hand, for the splits' OPS+. */
async function leagueHandLines(year: number): Promise<Partial<Record<Hand, BattingLine>>> {
  const data = await mlb(`/teams/stats?season=${year}&group=hitting&stats=statSplits&sitCodes=vl,vr&sportIds=1&limit=100`);
  const byHand: Partial<Record<Hand, BattingLine[]>> = {};
  for (const split of data.stats?.[0]?.splits ?? []) {
    const hand = SPLIT_CODES[split.split?.code];
    if (hand) (byHand[hand] ??= []).push(battingLine(split.stat));
  }
  return Object.fromEntries(Object.entries(byHand).map(([hand, lines]) => [hand, addBattingLines(lines)]));
}

/**
 * Platoons and batting order for the pool's hitters, and each team's rotation. One schedule read
 * per team (every game's lineup and starters: ~1 MB each, so one at a time), one roster read per
 * team for the splits, and the hands of everyone involved.
 */
async function platoons(year: number, teamIds: number[], players: PoolPlayer[], rosterDate: string | null): Promise<Platoons> {
  const games = new Map<number, TeamGame[]>();
  for (const teamId of teamIds) {
    games.set(teamId, teamGames(await mlb(`/schedule?sportId=1&teamId=${teamId}&season=${year}&gameType=R&hydrate=lineups,probablePitcher`), teamId));
  }
  const persons = await peopleById([...new Set([...[...games.values()].flatMap(starterIds), ...players.map((p) => p.id)])]);
  // deno-lint-ignore no-explicit-any
  const splitRows = new Map<number, Partial<Record<Hand, any[]>>>();
  for (const teamId of teamIds) {
    const data = await mlb(
      `/teams/${teamId}/roster?rosterType=active&season=${year}${rosterDate ? `&date=${rosterDate}` : ''}` +
        `&hydrate=person(stats(type=statSplits,sitCodes=[vl,vr],season=${year},group=hitting))`,
    );
    for (const r of data.roster ?? []) splitRows.set(r.person.id, handSplitRows(r.person.stats?.[0]?.splits));
  }
  const league = await leagueHandLines(year).catch((e) => {
    console.error('League splits unavailable, split OPS+ left blank:', e);
    return {} as Partial<Record<Hand, BattingLine>>;
  });

  const result: Platoons = { players: new Map(), rotations: new Map() };
  for (const [teamId, list] of games) result.rotations.set(teamId, teamRotation(list, persons));
  for (const p of players) {
    const rows = splitRows.get(p.id) ?? {};
    const lines = Object.fromEntries(Object.entries(rows).map(([hand, r]) => [hand, seasonLine(r)]));
    const platoon = platoonRecord(hitterLineupGames(games.get(p.teamId) ?? [], p.id, persons), lines, (line, hand) => {
      const lg = league[hand];
      return lg ? opsPlus(line, lg) : null;
    });
    result.players.set(p.id, { batSide: persons.get(p.id)?.batSide ?? null, platoon });
  }
  return result;
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

  const [season] = await sql`
    select year, status, imported_at, year = (select max(year) from seasons s where s.league_id = seasons.league_id) as latest
    from seasons where id = ${seasonId}`;
  if (!season) throw new UserError('Season not found.', 404);
  const year: number = season.year;
  // An imported season already knows its postseason teams.
  const importedTeamIds = season.imported_at
    ? (await sql`select mlb_team_id from season_mlb_teams where season_id = ${seasonId}`).map((r) => r.mlb_team_id as number)
    : [];
  // Its rosters as they were the day before the Wild Card started, when Draft 1 was made.
  const [draft1] = season.imported_at
    ? await sql`select to_char(locks_at - interval '1 day', 'YYYY-MM-DD') as day from drafts where season_id = ${seasonId} and number = 1`
    : [];
  const rosterDate: string | null = draft1?.day ?? null;

  const teamsData = await mlb(`/teams?sportId=1&season=${year}`);
  // deno-lint-ignore no-explicit-any
  const mlbTeams: { id: number; name: string; abbreviation: string; league: 'AL' | 'NL' | null }[] = teamsData.teams.map((t: any) => ({
    id: t.id,
    name: t.name,
    abbreviation: t.abbreviation,
    league: LEAGUES[t.league?.id] ?? null,
  }));
  const leagueOf = new Map(mlbTeams.flatMap((t) => (t.league ? [[t.id, t.league] as const] : [])));

  const table = await standings(year, leagueOf);
  const standingOf = new Map(table.map((t) => [t.teamId, t]));
  const byes = byeTeamIds(table);
  const playoffTeamIds = teamIds?.length
    ? teamIds
    : importedTeamIds.length
      ? importedTeamIds
      : table.filter((t) => t.clinched).map((t) => t.teamId);
  if (!playoffTeamIds.length) throw new UserError('No teams have clinched a postseason spot yet.');
  const seeds = playoffSeeds(table, playoffTeamIds);

  // One entry per player, in case a player turns up on two teams' rosters.
  const players = [
    ...new Map(
      (await Promise.all(playoffTeamIds.map((id) => activeHitters(id, year, rosterDate)))).flat().map((p) => [p.id, p]),
    ).values(),
  ];
  const leagues = await leagueLines(year, leagueOf);
  const leagueTotals = (teamId: number) => {
    const league = leagueOf.get(teamId);
    return (league && leagues.get(league)) || emptyBattingLine();
  };
  const wildCardStart = await firstPitch(year, 'F');
  // Best effort: without them the draft table falls back to season-long playing time.
  const platoon = await platoons(year, playoffTeamIds, players, rosterDate).catch((e) => {
    console.error('Lineups unavailable, platoons left blank:', e);
    return null;
  });

  await sql.begin(async (tx) => {
    // Every season shares mlb_teams, so only the latest season's names are kept: a past year
    // mustn't turn the Guardians back into the Indians.
    await tx`
      insert into mlb_teams ${tx(mlbTeams, 'id', 'name', 'abbreviation', 'league')}
      on conflict (id) do ${season.latest
        ? tx`update set name = excluded.name, abbreviation = excluded.abbreviation, league = excluded.league`
        : tx`nothing`}`;

    // Before the season starts, the field can still change. After that, teams only get eliminated.
    if (season.status === 'setup') {
      await tx`delete from season_mlb_teams where season_id = ${seasonId} and not (mlb_team_id = any(${playoffTeamIds}))`;
    }
    await tx`
      insert into season_mlb_teams ${tx(
        playoffTeamIds.map((id) => ({
          season_id: seasonId,
          mlb_team_id: id,
          wins: standingOf.get(id)?.wins ?? null,
          has_bye: byes.has(id),
          seed: seeds.get(id) ?? null,
          rotation: jsonOrNull(tx, platoon?.rotations.get(id)),
        })),
      )}
      on conflict (season_id, mlb_team_id) do update set wins = excluded.wins, has_bye = excluded.has_bye, seed = excluded.seed,
        rotation = coalesce(excluded.rotation, season_mlb_teams.rotation)`;

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
            regular_season_tb: p.season.tb,
            plate_appearances: p.season.pa,
            at_bats: p.season.ab,
            games_played: p.season.g,
            hits: p.season.h,
            doubles: p.season.doubles,
            triples: p.season.triples,
            home_runs: p.season.hr,
            runs: p.season.r,
            rbi: p.season.rbi,
            walks: p.season.bb,
            strikeouts: p.season.so,
            hit_by_pitch: p.season.hbp,
            sac_flies: p.season.sf,
            slg: seasonSlg(p.season),
            ops_plus: opsPlus(p.season, leagueTotals(p.teamId)),
            bat_side: platoon?.players.get(p.id)?.batSide ?? null,
            platoon: jsonOrNull(tx, platoon?.players.get(p.id)?.platoon),
            on_postseason_roster: true,
          })),
        )}
        on conflict (season_id, mlb_player_id) do update set mlb_team_id = excluded.mlb_team_id,
          regular_season_tb = excluded.regular_season_tb, plate_appearances = excluded.plate_appearances,
          at_bats = excluded.at_bats, games_played = excluded.games_played, hits = excluded.hits,
          doubles = excluded.doubles, triples = excluded.triples, home_runs = excluded.home_runs, runs = excluded.runs,
          rbi = excluded.rbi, walks = excluded.walks, strikeouts = excluded.strikeouts,
          hit_by_pitch = excluded.hit_by_pitch, sac_flies = excluded.sac_flies, slg = excluded.slg,
          ops_plus = excluded.ops_plus, bat_side = coalesce(excluded.bat_side, season_player_pool.bat_side),
          platoon = coalesce(excluded.platoon, season_player_pool.platoon), on_postseason_roster = true`;
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

  return json({ ok: true, teams: playoffTeamIds.length, players: players.length, draft1LocksAt: wildCardStart, platoons: !!platoon });
});
