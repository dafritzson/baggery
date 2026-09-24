// One player's batting stats for the player popup: this season's regular-season line, every
// game that season (the app totals the last 7/15/30) and earlier MLB seasons. Read from the MLB
// Stats API and cached briefly, so opening a popup doesn't hit MLB every time. Any signed-in user.
//
// POST { playerId: number, season: number }  →  PlayerStats (see _shared/core/player-stats.ts)

import { requireUser } from '../_shared/auth.ts';
import {
  type Counts,
  type PlayerGame,
  type PlayerSeasonRow,
  type PlayerStats,
  sumCounts,
} from '../_shared/core/player-stats.ts';
import { UserError, json, serve } from '../_shared/http.ts';

const MLB = 'https://statsapi.mlb.com/api/v1';
const CACHE_MS = 10 * 60 * 1000;

// deno-lint-ignore no-explicit-any
async function mlb(path: string): Promise<any> {
  const res = await fetch(`${MLB}${path}`);
  if (!res.ok) throw new Error(`MLB API ${res.status} for ${path}`);
  return res.json();
}

// deno-lint-ignore no-explicit-any
function counts(stat: any): Counts {
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

// Team id → abbreviation, for opponents in the game log and teams in past seasons.
let teamAbbrs: Map<number, string> | null = null;
async function abbreviations(): Promise<Map<number, string>> {
  if (!teamAbbrs) {
    const data = await mlb('/teams?sportId=1&activeStatus=B');
    // deno-lint-ignore no-explicit-any
    teamAbbrs = new Map(data.teams.map((t: any) => [t.id, t.abbreviation]));
  }
  return teamAbbrs;
}

const cache = new Map<string, { at: number; stats: PlayerStats }>();

async function playerStats(playerId: number, season: number): Promise<PlayerStats> {
  const [peopleData, statsData, abbrs] = await Promise.all([
    mlb(`/people/${playerId}?hydrate=currentTeam`),
    mlb(`/people/${playerId}/stats?stats=season,gameLog,yearByYear&group=hitting&gameType=R&sportId=1&season=${season}`),
    abbreviations(),
  ]);
  const p = peopleData.people?.[0];
  if (!p) throw new UserError('Player not found.', 404);
  const abbr = (id: number | undefined) => (id && abbrs.get(id)) || '';

  // deno-lint-ignore no-explicit-any
  const splitsOf = (type: string): any[] =>
    // deno-lint-ignore no-explicit-any
    statsData.stats?.find((s: any) => s.type?.displayName === type)?.splits ?? [];

  // A traded player has a line per team, plus a combined line without a team.
  // deno-lint-ignore no-explicit-any
  const combined = (rows: any[]): Counts => {
    const total = rows.length === 1 ? rows[0] : rows.find((r) => !r.team);
    return total ? counts(total.stat) : sumCounts(rows.map((r) => counts(r.stat)));
  };
  const seasonSplits = splitsOf('season');
  const games: PlayerGame[] = splitsOf('gameLog')
    .map((s) => ({ ...counts(s.stat), g: 1, date: s.date, opponent: abbr(s.opponent?.id), home: !!s.isHome }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // deno-lint-ignore no-explicit-any
  const bySeason = new Map<number, any[]>();
  for (const s of splitsOf('yearByYear')) {
    const year = Number(s.season);
    if (year >= season) continue;
    bySeason.set(year, [...(bySeason.get(year) ?? []), s]);
  }
  const years: PlayerSeasonRow[] = [...bySeason.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, rows]) => ({
      ...combined(rows),
      season: year,
      team: rows.length === 1 ? abbr(rows[0].team?.id) : 'TOT',
    }));

  return {
    person: {
      id: p.id,
      name: p.fullName,
      position: p.primaryPosition?.abbreviation ?? null,
      team: abbr(p.currentTeam?.id) || null,
      age: p.currentAge ?? null,
      bats: p.batSide?.code ?? null,
    },
    season: seasonSplits.length ? combined(seasonSplits) : null,
    games,
    years,
  };
}

serve(async (req) => {
  await requireUser(req);
  const { playerId, season } = (await req.json()) as { playerId: unknown; season: unknown };
  if (!Number.isInteger(playerId) || !Number.isInteger(season)) throw new UserError('Bad request.');
  const key = `${playerId}:${season}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.stats);
  const stats = await playerStats(playerId as number, season as number);
  cache.set(key, { at: Date.now(), stats });
  return json(stats);
});
