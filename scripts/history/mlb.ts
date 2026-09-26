// A past postseason from the MLB Stats API: games, box scores and the hitters on each team.
// Responses are cached under history/.cache, since a finished postseason never changes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type BattingRow, type GameRow, boxscoreBatting, scheduleGames } from '../../supabase/functions/poll-games/feed.ts';

const MLB = 'https://statsapi.mlb.com/api/v1';
const CACHE = join(import.meta.dirname, '../../history/.cache');

async function mlb(path: string): Promise<any> {
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

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
