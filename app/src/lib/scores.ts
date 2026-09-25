import { useCallback, useEffect, useRef, useState } from 'react';

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
}

export interface Scores {
  games: GameInfo[];
  /** Box-score TB of players who have been on a fantasy roster this season. */
  stats: ScoreStat[];
}

/** Roster spells in the shared core's format. */
export function coreSpells(data: SeasonData): RosterSpell[] {
  return data.spells.map((s) => ({ teamId: s.fantasy_team_id, playerId: s.mlb_player_id, from: s.from_at, to: s.to_at }));
}

/** The season's postseason games and the rostered players' TB in them, kept live. */
export function useScores(data: SeasonData | null): { scores: Scores | null; refetch: () => Promise<void> } {
  const year = data?.season.year;
  // Refetch when the set of rostered players changes, not on every season reload.
  const playerKey = data ? [...new Set(data.spells.map((s) => s.mlb_player_id))].sort().join(',') : '';
  const [scores, setScores] = useState<Scores | null>(null);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    if (!year) return;
    const fetchId = ++latest.current;
    const { data: games } = await supabase
      .from('mlb_games')
      .select('game_pk, game_type, series_game_number, start_time, status, detailed_state, home_team_id, away_team_id, home_score, away_score')
      .eq('season_year', year);
    const gamePks = (games ?? []).map((g) => g.game_pk as number);
    const playerIds = playerKey ? playerKey.split(',').map(Number) : [];
    const { data: stats } =
      gamePks.length && playerIds.length
        ? await supabase.from('player_game_stats').select('game_pk, mlb_player_id, tb').in('game_pk', gamePks).in('mlb_player_id', playerIds)
        : { data: [] };
    if (fetchId !== latest.current) return;
    setScores({
      games: (games ?? [])
        .filter((g) => g.series_game_number !== null)
        .map((g) => ({
          gamePk: g.game_pk,
          gameType: g.game_type,
          seriesGameNumber: g.series_game_number,
          start: g.start_time,
          status: g.status,
          homeTeamId: g.home_team_id,
          awayTeamId: g.away_team_id,
          homeScore: g.home_score,
          awayScore: g.away_score,
          detailedState: g.detailed_state,
        })),
      stats: (stats ?? []).map((s) => ({ gamePk: s.game_pk, playerId: s.mlb_player_id, tb: s.tb })),
    });
  }, [year, playerKey]);

  useEffect(() => {
    const schedule = (delay = 300) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refetch, delay);
    };
    schedule(0);
    const channel = supabase
      .channel(`scores-${Date.now()}-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mlb_games' }, () => schedule())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_game_stats' }, () => schedule())
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  return { scores, refetch };
}
