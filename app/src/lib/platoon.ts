import { useEffect, useState } from 'react';

import { playableFrom } from '@core/injured-list.ts';
import { type MatchupSeries, type NamedPitcher, expectedGames, roundMatchups } from '@core/matchups.ts';
import type { OddsTeam, TeamOdds } from '@core/odds.ts';
import {
  type Hand,
  type PlatoonRecord,
  type Sidelined,
  expectedGamesAvailable,
  expectedPaOver,
  expectedStartsOver,
  paPerStart,
  platoonSide,
  recordSplits,
  usualSpot,
} from '@core/platoon.ts';
import { type Series, postseasonSeries } from '@core/schedule.ts';
import type { GameInfo } from '@core/score-feed.ts';
import { regressedSlg } from '@core/stats.ts';

import type { PoolEntry, SeasonData } from '@/lib/season';
import { supabase } from '@/lib/supabase';

/** Platoons and batting order (supabase/migrations/…_platoons.sql), loaded apart from the season. */
export interface PlatoonData {
  players: Map<number, { batSide: 'L' | 'R' | 'S' | null; record: PlatoonRecord }>;
  /** Each team's likely rotation, by MLB team id. */
  rotations: Map<number, NamedPitcher[]>;
  /** Announced starters, by "gamePk:teamId". */
  probables: Map<string, NamedPitcher>;
}

// One load per season per app open: the draft table, Research and the popup share it.
const loads = new Map<string, Promise<PlatoonData | null>>();

async function load(seasonId: string, year: number): Promise<PlatoonData | null> {
  const [pool, teams, probables] = await Promise.all([
    supabase.from('season_player_pool').select('mlb_player_id, bat_side, platoon').eq('season_id', seasonId).not('platoon', 'is', null),
    supabase.from('season_mlb_teams').select('mlb_team_id, rotation').eq('season_id', seasonId).not('rotation', 'is', null),
    supabase
      .from('mlb_probables')
      .select('game_pk, mlb_team_id, pitcher_id, pitcher_name, hand, mlb_games!inner(season_year)')
      .eq('mlb_games.season_year', year),
  ]);
  if (pool.error || teams.error || probables.error) return null;
  return {
    players: new Map(pool.data.map((r) => [r.mlb_player_id, { batSide: r.bat_side, record: r.platoon as PlatoonRecord }])),
    rotations: new Map(teams.data.map((r) => [r.mlb_team_id, r.rotation as NamedPitcher[]])),
    probables: new Map(
      probables.data
        .filter((r) => r.hand === 'L' || r.hand === 'R')
        .map((r) => [`${r.game_pk}:${r.mlb_team_id}`, { pitcherId: r.pitcher_id, name: r.pitcher_name, hand: r.hand as Hand }]),
    ),
  };
}

/** The season's platoon data, loaded once (null while loading, or if the pool has none). */
export function usePlatoons(data: SeasonData): PlatoonData | null {
  const key = data.season.id;
  const [result, setResult] = useState<{ key: string; value: PlatoonData | null } | null>(null);
  useEffect(() => {
    let stale = false;
    let promise = loads.get(key);
    if (!promise) {
      promise = load(key, data.season.year);
      loads.set(key, promise);
    }
    promise.then((value) => {
      // A failed load is tried again next time.
      if (!value) loads.delete(key);
      if (!stale) setResult({ key, value });
    });
    return () => {
      stale = true;
    };
  }, [key, data.season.year]);
  return result?.key === key ? result.value : null;
}

/** The postseason teams as core/odds.ts takes them; empty until the pool sync has seeds. */
export function oddsField(data: SeasonData): OddsTeam[] {
  return [...data.mlbTeams.values()].flatMap((t) =>
    t.seed !== null && t.league !== null && t.wins !== null ? [{ teamId: t.id, league: t.league, seed: t.seed, wins: t.wins }] : [],
  );
}

/** What the draft table and popup show of a hitter's platoon and lineup spot. */
export interface PlayerPlatoon {
  batSide: 'L' | 'R' | 'S' | null;
  record: PlatoonRecord;
  /** The hand he mostly plays against, if he's a platoon hitter. */
  side: Hand | null;
  /** The hand he starts against more: the one whose spot the table shows first. */
  primary: Hand;
  /** Usual lineup spot against each hand (null without starts against it). */
  spots: Record<Hand, number | null>;
  /** "2", or "2 · 7" when he bats elsewhere against the other hand. */
  spotLabel: string | null;
  /** His team's games this round from here, with the opposing starters. */
  matchups: MatchupSeries[];
  /** Over the rest of the postseason: expected starts, team games and xBags; null without odds. */
  starts: number | null;
  teamGames: number | null;
  xBags: number | null;
  /** xBags if he started every game at his usual spot. */
  everyDayXBags: number | null;
}

/** Starts against the other hand it takes for its spot to show too: a few, not a one-off. */
const SPOT_MIN_STARTS = 5;

/**
 * A hitter on the injured list, as xBags takes it: no games until the day he can come off it, and
 * every game after, as if he'd never been hurt. Null when he isn't on it. `now` is the time the
 * odds are from (a finished draft's lock, or now).
 */
export function sidelined(entry: PoolEntry, now: number): Sidelined | null {
  const from = playableFrom(entry.injured_list, entry.injury_return, now);
  return from === null || from <= now ? null : { from, now };
}

/**
 * Expected team games a hitter is there for over the rest of the postseason: his team's expected
 * games, less the ones before he's back from the injured list. Null without odds.
 */
export function availableGames(entry: PoolEntry, matchups: MatchupSeries[], odds: TeamOdds | undefined, now = Date.now()): number | null {
  return odds ? expectedGamesAvailable(expectedGames(matchups, now), odds.games, sidelined(entry, now)) : null;
}

/**
 * A hitter's platoon view, or null without platoon data. xBags as core/stats.ts expectedBags has
 * it (RDSLG × at-bats × games), but with his plate appearances from his starts and lineup spot
 * against each hand's starters, and the hands his team will likely face. A hitter on the injured
 * list gets nothing from the games before he can come off it.
 */
export function playerPlatoon(
  entry: PoolEntry,
  platoons: PlatoonData | null,
  matchups: MatchupSeries[],
  odds: TeamOdds | undefined,
  now = Date.now(),
): PlayerPlatoon | null {
  const found = platoons?.players.get(entry.mlb_player_id);
  if (!found) return null;
  const { record, batSide } = found;
  const splits = recordSplits(record);
  const side = platoonSide(splits);
  const primary: Hand = side ?? (record.R.weighted.starts >= record.L.weighted.starts ? 'R' : 'L');
  const other: Hand = primary === 'L' ? 'R' : 'L';
  const spots = { L: usualSpot(record.L.weighted), R: usualSpot(record.R.weighted) };
  const first = spots[primary] ?? spots[other];
  const second = record[other].starts >= SPOT_MIN_STARTS && spots[primary] !== null ? spots[other] : null;
  const spotLabel = first === null ? null : second !== null && second !== first ? `${first} · ${second}` : String(first);

  const ab = entry.at_bats;
  const pa = entry.plate_appearances;
  const perPa = ab && pa ? (regressedSlg(entry.regular_season_tb, ab) * ab) / pa : null;
  const known = expectedGames(matchups, now);
  const teamGames = odds ? odds.games : null;
  const out = sidelined(entry, now);
  return {
    batSide,
    record,
    side,
    primary,
    spots,
    spotLabel,
    matchups,
    starts: teamGames === null ? null : expectedStartsOver(splits, known, teamGames, out),
    teamGames,
    xBags: teamGames === null || perPa === null ? null : perPa * expectedPaOver(splits, known, teamGames, out),
    everyDayXBags:
      teamGames === null || perPa === null ? null : perPa * paPerStart(splits, primary) * expectedGamesAvailable(known, teamGames, out),
  };
}

/** Each team's round matchups, for the teams on the board. */
export function matchupsByTeam(
  data: SeasonData,
  platoons: PlatoonData | null,
  games: GameInfo[] | null,
  before?: string | null,
): Map<number, MatchupSeries[]> {
  const result = new Map<number, MatchupSeries[]>();
  const field = oddsField(data);
  if (!platoons || !games || !field.length) return result;
  const cut = before ? Date.parse(before) : Infinity;
  const series = postseasonSeries(games.filter((g) => Date.parse(g.start) < cut)) as Series[];
  for (const t of field) {
    result.set(t.teamId, roundMatchups(t.teamId, { field, series, rotations: platoons.rotations, probables: platoons.probables }));
  }
  return result;
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
export const ordinal = (spot: number | null) => (spot === null ? '—' : ORDINALS[spot - 1]);
