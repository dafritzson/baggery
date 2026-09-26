import { useEffect, useState } from 'react';

import { type Almanac, type AlmanacInput, type AlmanacStat, almanac } from '@core/almanac.ts';

import { useSeason } from '@/lib/season';
import { supabase } from '@/lib/supabase';

export interface AlmanacData {
  almanac: Almanac;
  /** Manager names by key. */
  managers: Map<string, string>;
  /** Player names by MLB id. */
  players: Map<number, string>;
}

/** URL slug for a manager: their name, lowercased. */
export const managerSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const PAGE = 1000;

/** Every row of a query, a page at a time (the API returns at most 1,000 rows per request). */
async function everyRow<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

/** Loads every season of the league and computes the Almanac. */
async function loadAlmanac(leagueId: string, owners: Map<string, string>): Promise<AlmanacData> {
  const { data: seasons } = await supabase.from('seasons').select('id, year, status').eq('league_id', leagueId);
  const seasonIds = (seasons ?? []).map((s) => s.id as string);
  const [teams, managers, spells, drafts] = await Promise.all([
    everyRow((a, b) =>
      supabase.from('fantasy_teams').select('id, season_id, user_id, manager_id, eliminated_after_round').in('season_id', seasonIds).order('id').range(a, b),
    ),
    everyRow((a, b) => supabase.from('league_managers').select('id, name').eq('league_id', leagueId).order('id').range(a, b)),
    everyRow((a, b) =>
      supabase.from('roster_spells').select('season_id, fantasy_team_id, mlb_player_id, from_at, to_at').in('season_id', seasonIds).order('id').range(a, b),
    ),
    everyRow((a, b) => supabase.from('drafts').select('id, season_id, number, locks_at').in('season_id', seasonIds).order('id').range(a, b)),
  ]);
  const redraftIds = drafts.filter((d) => d.number > 1).map((d) => d.id as string);
  const picks = redraftIds.length
    ? await everyRow((a, b) =>
        supabase
          .from('draft_actions')
          .select('draft_id, fantasy_team_id, add_player_id, drop_player_id')
          .in('draft_id', redraftIds)
          .eq('type', 'pick')
          .order('id')
          .range(a, b),
      )
    : [];

  // Box scores of rostered players, a season at a time to keep each request small.
  const stats: AlmanacStat[] = [];
  for (const season of seasons ?? []) {
    const playerIds = [...new Set(spells.filter((s) => s.season_id === season.id).map((s) => s.mlb_player_id as number))];
    if (!playerIds.length) continue;
    const games = await everyRow((a, b) =>
      supabase.from('mlb_games').select('game_pk, game_type, start_time, series_game_number').eq('season_year', season.year).order('game_pk').range(a, b),
    );
    const gameByPk = new Map(games.map((g) => [g.game_pk as number, g]));
    if (!games.length) continue;
    const lines = await everyRow((a, b) =>
      supabase
        .from('player_game_stats')
        .select('game_pk, mlb_player_id, ab, h, bb, hbp, sf, tb, hr, r, rbi')
        .in('game_pk', [...gameByPk.keys()])
        .in('mlb_player_id', playerIds)
        .order('game_pk')
        .order('mlb_player_id')
        .range(a, b),
    );
    for (const l of lines) {
      const g = gameByPk.get(l.game_pk)!;
      stats.push({
        ...l,
        gamePk: l.game_pk,
        seasonId: season.id,
        playerId: l.mlb_player_id,
        gameType: g.game_type,
        gameStart: g.start_time,
        seriesGameNumber: g.series_game_number,
      });
    }
  }

  // A team counts for its manager; an app-played team whose account isn't linked to a manager
  // yet counts for the account.
  const managerNames = new Map(managers.map((m) => [m.id as string, m.name as string]));
  const keyOf = (t: { id: string; manager_id: string | null; user_id: string | null }) =>
    t.manager_id ?? (t.user_id ? `user:${t.user_id}` : `team:${t.id}`);
  for (const t of teams) {
    const key = keyOf(t);
    if (!managerNames.has(key)) managerNames.set(key, t.user_id ? (owners.get(t.user_id) ?? 'Someone') : 'Open spot');
  }

  const draftById = new Map(drafts.map((d) => [d.id as string, d]));
  const input: AlmanacInput = {
    seasons: (seasons ?? []).map((s) => ({ id: s.id, year: s.year, complete: s.status === 'complete' })),
    teams: teams.map((t) => ({ id: t.id, seasonId: t.season_id, managerKey: keyOf(t), eliminatedAfterRound: t.eliminated_after_round })),
    managers: [...managerNames].map(([key, name]) => ({ key, name })),
    spells: spells.map((s) => ({ seasonId: s.season_id, teamId: s.fantasy_team_id, playerId: s.mlb_player_id, from: s.from_at, to: s.to_at })),
    stats,
    redrafts: picks
      .filter((p) => p.drop_player_id !== null)
      .map((p) => {
        const d = draftById.get(p.draft_id)!;
        return { seasonId: d.season_id, teamId: p.fantasy_team_id, draftNumber: d.number, add: p.add_player_id, drop: p.drop_player_id, at: d.locks_at };
      }),
  };

  const playerIds = [...new Set([...spells.map((s) => s.mlb_player_id as number), ...picks.flatMap((p) => [p.add_player_id, p.drop_player_id])])].filter(
    (id): id is number => id !== null,
  );
  const players = new Map<number, string>();
  for (const ids of chunks(playerIds, 200)) {
    const { data } = await supabase.from('mlb_players').select('id, full_name').in('id', ids);
    for (const p of data ?? []) players.set(p.id, p.full_name);
  }
  return { almanac: almanac(input), managers: managerNames, players };
}

// Kept for a few minutes, so moving between Almanac pages doesn't reload every season.
let cache: { leagueId: string; at: number; promise: Promise<AlmanacData> } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/** The league's Almanac, loaded once and shared by the Almanac pages. */
export function useAlmanac(): { data: AlmanacData | null; error: string | null } {
  const { data: season } = useSeason();
  const leagueId = season?.season.league_id;
  const owners = season?.owners;
  const [data, setData] = useState<AlmanacData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId || !owners) return;
    if (!cache || cache.leagueId !== leagueId || Date.now() - cache.at > CACHE_MS) {
      cache = { leagueId, at: Date.now(), promise: loadAlmanac(leagueId, owners) };
    }
    let stale = false;
    cache.promise.then(
      (d) => !stale && setData(d),
      (e) => {
        cache = null;
        if (!stale) setError(e instanceof Error ? e.message : 'Couldn’t load the Almanac.');
      },
    );
    return () => {
      stale = true;
    };
  }, [leagueId, owners]);

  return { data, error };
}
