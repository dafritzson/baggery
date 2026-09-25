import { useCallback, useEffect, useRef, useState } from 'react';

import type { LiveState } from '@core/live.ts';
import type { ScoreGame, ScoreStat } from '@core/scoreboard.ts';
import type { RosterSpell } from '@core/scoring.ts';

import type { SeasonData } from '@/lib/season';
import { supabase } from '@/lib/supabase';

/** A game with what the Games tab shows beyond scoring. */
export interface GameInfo extends ScoreGame {
  homeScore: number | null;
  awayScore: number | null;
  /** MLB detailedState: "Scheduled", "In Progress", "Final", "Postponed", ... */
  detailedState: string | null;
  /** No start time set yet (`start` is MLB's 3:33 AM ET placeholder). */
  startTimeTbd: boolean;
  /** The game's date as MLB lists it, e.g. "2026-09-29". */
  officialDate: string | null;
  /** Inning, count, runners and who's up, while live (and the final state after). */
  live: LiveState | null;
}

/** A batter's line in one game, for the at bat / due up lists of live games. */
export interface BattingLine {
  gamePk: number;
  playerId: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  bb: number;
}

export interface Scores {
  games: GameInfo[];
  /** Box-score TB of players who have been on a fantasy roster this season. */
  stats: ScoreStat[];
  /** Every batter's line in the games being played now. */
  lines: BattingLine[];
}

/** Roster spells in the shared core's format. */
export function coreSpells(data: SeasonData): RosterSpell[] {
  return data.spells.map((s) => ({ teamId: s.fantasy_team_id, playerId: s.mlb_player_id, from: s.from_at, to: s.to_at }));
}

const GAME_COLUMNS =
  'game_pk, game_type, series_game_number, start_time, start_time_tbd, official_date, status, detailed_state, home_team_id, away_team_id, home_score, away_score, live';

/** A table row as realtime and the API send it. */
type Row = Record<string, any>;

function toGame(g: Row): GameInfo {
  return {
    gamePk: g.game_pk,
    gameType: g.game_type,
    seriesGameNumber: g.series_game_number,
    start: g.start_time,
    startTimeTbd: g.start_time_tbd,
    officialDate: g.official_date,
    status: g.status,
    homeTeamId: g.home_team_id,
    awayTeamId: g.away_team_id,
    homeScore: g.home_score,
    awayScore: g.away_score,
    detailedState: g.detailed_state,
    live: g.live,
  };
}

function toLine(l: Row): BattingLine {
  return { gamePk: l.game_pk, playerId: l.mlb_player_id, ab: l.ab, h: l.h, doubles: l.doubles, triples: l.triples, hr: l.hr, bb: l.bb };
}

/** Replaces the item with the same key, or adds it. */
function upsert<T>(list: T[], item: T, same: (a: T) => boolean): T[] {
  const i = list.findIndex(same);
  return i === -1 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
}

/** Folds one realtime change into the scores, from the row it carries, so it costs no refetch. */
function applyChange(scores: Scores, table: string, row: Row, rostered: Set<number>): Scores {
  if (table === 'mlb_games') {
    if (row.series_game_number === null) return scores;
    return { ...scores, games: upsert(scores.games, toGame(row), (g) => g.gamePk === row.game_pk) };
  }
  let next = scores;
  if (rostered.has(row.mlb_player_id)) {
    const stat = { gamePk: row.game_pk, playerId: row.mlb_player_id, tb: row.tb };
    next = { ...next, stats: upsert(next.stats, stat, (s) => s.gamePk === stat.gamePk && s.playerId === stat.playerId) };
  }
  if (scores.games.some((g) => g.gamePk === row.game_pk && g.status === 'Live')) {
    const line = toLine(row);
    next = { ...next, lines: upsert(next.lines, line, (l) => l.gamePk === line.gamePk && l.playerId === line.playerId) };
  }
  return next;
}

/**
 * The season's postseason games and the rostered players' TB in them, kept live. The whole
 * season loads once (and again after a reconnect, or when the rostered players change); after
 * that, each realtime change is applied from the row it carries instead of reloading everything,
 * which keeps a live game from costing a full reload per open app every few seconds.
 */
export function useScores(data: SeasonData | null): { scores: Scores | null; refetch: () => Promise<void> } {
  const year = data?.season.year;
  // Reload when the set of rostered players changes, not on every season reload.
  const playerKey = data ? [...new Set(data.spells.map((s) => s.mlb_player_id))].sort().join(',') : '';
  const [scores, setScores] = useState<Scores | null>(null);
  const latest = useRef(0);
  // For the realtime handler, which outlives renders.
  const current = useRef<Scores | null>(null);
  useEffect(() => {
    current.current = scores;
  }, [scores]);

  const refetch = useCallback(async () => {
    if (!year) return;
    const fetchId = ++latest.current;
    const { data: games } = await supabase.from('mlb_games').select(GAME_COLUMNS).eq('season_year', year);
    const gamePks = (games ?? []).map((g) => g.game_pk as number);
    const playerIds = playerKey ? playerKey.split(',').map(Number) : [];
    const { data: stats } =
      gamePks.length && playerIds.length
        ? await supabase.from('player_game_stats').select('game_pk, mlb_player_id, tb').in('game_pk', gamePks).in('mlb_player_id', playerIds)
        : { data: [] };
    const livePks = (games ?? []).filter((g) => g.status === 'Live').map((g) => g.game_pk as number);
    const { data: lines } = livePks.length
      ? await supabase.from('player_game_stats').select('game_pk, mlb_player_id, ab, h, doubles, triples, hr, bb').in('game_pk', livePks)
      : { data: [] };
    if (fetchId !== latest.current) return;
    setScores({
      games: (games ?? []).filter((g) => g.series_game_number !== null).map(toGame),
      stats: (stats ?? []).map((s) => ({ gamePk: s.game_pk, playerId: s.mlb_player_id, tb: s.tb })),
      lines: (lines ?? []).map(toLine),
    });
  }, [year, playerKey]);

  useEffect(() => {
    if (!year) return;
    const rostered = new Set(playerKey ? playerKey.split(',').map(Number) : []);
    let reload: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (reload) clearTimeout(reload);
      reload = setTimeout(refetch, 300);
    };
    const onChange = (table: string) => (payload: { eventType: string; new: Row }) => {
      // A deleted row doesn't say enough to apply; rare, so reload.
      if (payload.eventType === 'DELETE') return scheduleReload();
      const row = payload.new;
      if (row.season_year !== undefined && row.season_year !== year) return;
      // A game that just started: reload once for the lines of anyone who batted before this app heard.
      const started =
        table === 'mlb_games' && row.status === 'Live' && current.current?.games.find((g) => g.gamePk === row.game_pk)?.status !== 'Live';
      setScores((s) => (s ? applyChange(s, table, row, rostered) : s));
      if (started) scheduleReload();
    };
    refetch();
    let subscribed = false;
    const channel = supabase
      .channel(`scores-${Date.now()}-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mlb_games' }, onChange('mlb_games'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_game_stats' }, onChange('player_game_stats'))
      // After a reconnect, reload everything: changes made while disconnected weren't sent.
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (subscribed) scheduleReload();
        subscribed = true;
      });
    return () => {
      if (reload) clearTimeout(reload);
      supabase.removeChannel(channel);
    };
  }, [year, playerKey, refetch]);

  return { scores, refetch };
}
