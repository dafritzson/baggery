// A past postseason from the MLB Stats API: games, box scores and the hitters on each team.
// Responses are cached under history/.cache, since a finished postseason never changes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type BattingRow, type GameRow, boxscoreBatting, scheduleGames } from '../../supabase/functions/poll-games/feed.ts';

const MLB = 'https://statsapi.mlb.com/api/v1';
const CACHE = join(import.meta.dirname, '../../history/.cache');

export async function mlb(path: string): Promise<any> {
  const file = join(CACHE, `${path.replace(/[^a-zA-Z0-9]+/g, '_')}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const res = await fetch(`${MLB}${path}`);
  if (!res.ok) throw new Error(`MLB API ${res.status} for ${path}`);
  const data = await res.json();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  return data;
}

export interface MlbTeam {
  id: number;
  name: string;
  abbreviation: string;
  league: 'AL' | 'NL' | null;
}

export interface Hitter {
  id: number;
  fullName: string;
  /** Teams he was on that year, among the postseason teams. */
  teamIds: number[];
  position: string | null;
}

export interface Postseason {
  year: number;
  teams: MlbTeam[];
  games: GameRow[];
  batting: BattingRow[];
  /** Everyone who batted in the postseason or was on a postseason team's roster that year. */
  hitters: Map<number, Hitter>;
}

export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function loadPostseason(year: number): Promise<Postseason> {
  const allTeams = await mlb(`/teams?sportId=1&season=${year}`);
  const LEAGUES: Record<number, 'AL' | 'NL'> = { 103: 'AL', 104: 'NL' };
  const teamsById = new Map<number, MlbTeam>(allTeams.teams.map((t: any) => [
    t.id,
    { id: t.id, name: t.name, abbreviation: t.abbreviation, league: LEAGUES[t.league?.id] ?? null },
  ]));
  const schedule = await mlb(`/schedule?sportId=1&season=${year}&gameType=F,D,L,W`);
  const games = scheduleGames(schedule, year, new Set(teamsById.keys())).filter((g) => g.status === 'Final');
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];

  const hitters = new Map<number, Hitter>();
  const add = (id: number, fullName: string, teamId: number, position: string | null) => {
    const h = hitters.get(id) ?? { id, fullName, teamIds: [], position };
    if (!h.teamIds.includes(teamId)) h.teamIds.push(teamId);
    if (position && position !== 'P') h.position = position;
    hitters.set(id, h);
  };
  const rosters = await pool(teamIds, 6, (id) => mlb(`/teams/${id}/roster?rosterType=fullSeason&season=${year}`));
  rosters.forEach((r, i) => {
    for (const p of r.roster ?? []) add(p.person.id, p.person.fullName, teamIds[i], p.position?.abbreviation ?? null);
  });

  const batting: BattingRow[] = [];
  const boxes = await pool(games, 8, (g) => mlb(`/game/${g.game_pk}/boxscore`));
  boxes.forEach((box, i) => {
    const { rows, players } = boxscoreBatting(games[i].game_pk, box);
    batting.push(...rows);
    for (const p of players) {
      const teamId = rows.find((r) => r.mlb_player_id === p.id)!.mlb_team_id;
      add(p.id, p.full_name, teamId, null);
    }
  });
  // Pitchers who never batted can't be drafted hitters; keep two-way players.
  for (const [id, h] of hitters) if (h.position === 'P' && !batting.some((b) => b.mlb_player_id === id)) hitters.delete(id);

  return { year, teams: teamIds.map((id) => teamsById.get(id)!), games, batting, hitters };
}

/** A hitter's regular-season line, all teams combined. */
export interface SeasonHitting {
  pa: number;
  singles: number;
  doubles: number;
  triples: number;
  hr: number;
}

export async function seasonHitting(year: number): Promise<Map<number, SeasonHitting>> {
  const data = await mlb(`/stats?stats=season&group=hitting&season=${year}&sportId=1&playerPool=ALL&limit=5000`);
  const lines = new Map<number, SeasonHitting>();
  for (const s of data.stats?.[0]?.splits ?? []) {
    const st = s.stat;
    lines.set(s.player.id, {
      pa: st.plateAppearances ?? 0,
      singles: (st.hits ?? 0) - (st.doubles ?? 0) - (st.triples ?? 0) - (st.homeRuns ?? 0),
      doubles: st.doubles ?? 0,
      triples: st.triples ?? 0,
      hr: st.homeRuns ?? 0,
    });
  }
  return lines;
}

export interface Standing {
  teamId: number;
  league: 'AL' | 'NL';
  divisionId: number;
  /** 1 for the division winner (tiebreaker games included). */
  divisionRank: number;
  wins: number;
  losses: number;
}

/** Each team's final regular-season record. */
export async function standings(year: number): Promise<Standing[]> {
  const data = await mlb(`/standings?leagueId=103,104&season=${year}`);
  const LEAGUES: Record<number, 'AL' | 'NL'> = { 103: 'AL', 104: 'NL' };
  return (data.records ?? []).flatMap((r: any) =>
    (r.teamRecords ?? []).map((t: any) => ({
      teamId: t.team.id,
      league: LEAGUES[r.league?.id],
      divisionId: r.division?.id,
      divisionRank: Number(t.divisionRank),
      wins: t.wins,
      losses: t.losses,
    })),
  );
}

/** Every regular-season game that was played: its date and the two teams. */
export async function regularSeasonGames(year: number): Promise<{ date: string; teams: [number, number] }[]> {
  const fields = 'dates,games,gamePk,officialDate,status,abstractGameState,detailedState,teams,away,home,team,id';
  const data = await mlb(`/schedule?sportId=1&season=${year}&gameType=R&fields=${fields}`);
  const games = new Map<number, { date: string; teams: [number, number] }>();
  for (const g of (data.dates ?? []).flatMap((d: any) => d.games ?? [])) {
    if (g.status?.abstractGameState !== 'Final' || /Postponed|Cancelled/.test(g.status?.detailedState ?? '')) continue;
    games.set(g.gamePk, { date: g.officialDate, teams: [g.teams.away.team.id, g.teams.home.team.id] });
  }
  return [...games.values()];
}

/** Everyone who batted for a team between two dates: plate appearances and position. */
export async function teamPlateAppearances(
  teamId: number,
  start: string,
  end: string,
): Promise<{ id: number; position: string; pa: number }[]> {
  const data = await mlb(
    `/stats?stats=byDateRange&group=hitting&startDate=${start}&endDate=${end}&sportId=1&teamId=${teamId}&playerPool=ALL`,
  );
  return (data.stats?.[0]?.splits ?? [])
    .map((s: any) => ({ id: s.player.id, position: s.position?.abbreviation ?? '', pa: s.stat.plateAppearances ?? 0 }))
    .filter((p: { pa: number }) => p.pa > 0);
}
