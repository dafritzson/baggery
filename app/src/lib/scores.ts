import { createContext, createElement, type ReactNode, use, useCallback, useEffect, useRef, useState } from 'react';

import { type ScoreChanges, type Scores, applyChanges, toGame, toLine, toStat } from '@core/score-feed.ts';
import type { RosterSpell } from '@core/scoring.ts';

import { type SeasonData, useSeason } from '@/lib/season';
import { supabase } from '@/lib/supabase';

export type { BattingLine, GameInfo, Scores } from '@core/score-feed.ts';

/** Roster spells in the shared core's format. */
export function coreSpells(data: SeasonData): RosterSpell[] {
  return data.spells.map((s) => ({ teamId: s.fantasy_team_id, playerId: s.mlb_player_id, from: s.from_at, to: s.to_at }));
}

const GAME_COLUMNS =
  'game_pk, game_type, series_game_number, start_time, start_time_tbd, official_date, status, detailed_state, home_team_id, away_team_id, home_score, away_score, live, games_in_series, final_seen_at';

/**
 * One subscription to the "scores" broadcast, shared by every useScores (Games and Standings can
 * both be mounted, and a second channel on the same topic would replace the first). Listeners
 * get each poll's changes, and { reload: true } after a reconnect, when changes may have been
 * missed.
 */
const scoreListeners = new Set<(changes: ScoreChanges) => void>();
let scoreChannel: ReturnType<typeof supabase.channel> | null = null;

function listenForScores(listener: (changes: ScoreChanges) => void): () => void {
  scoreListeners.add(listener);
  if (!scoreChannel) {
    let subscribed = false;
    scoreChannel = supabase
      // Private: only signed-in users may listen (a policy on realtime.messages).
      .channel('scores', { config: { private: true } })
      .on('broadcast', { event: 'changes' }, ({ payload }) => {
        for (const l of scoreListeners) l(payload as ScoreChanges);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (subscribed) for (const l of scoreListeners) l({ reload: true });
        subscribed = true;
      });
  }
  return () => {
    scoreListeners.delete(listener);
    if (scoreListeners.size === 0 && scoreChannel) {
      supabase.removeChannel(scoreChannel);
      scoreChannel = null;
    }
  };
}

interface ScoresState {
  scores: Scores | null;
  refetch: () => Promise<void>;
}

const ScoresContext = createContext<ScoresState>({ scores: null, refetch: async () => {} });

/** Called with each poll's changes and the scores from before they were applied. */
type ChangeListener = (before: Scores, changes: ScoreChanges) => void;
const changeListeners = new Set<ChangeListener>();

/**
 * Loads the selected season's scores once for the whole app (Games, Standings and bag
 * celebrations share them) and keeps them live.
 */
export function ScoresProvider({ children }: { children: ReactNode }) {
  const { data } = useSeason();
  return createElement(ScoresContext, { value: useLiveScores(data) }, children);
}

export function useScores(): ScoresState {
  return use(ScoresContext);
}

/** Hears each poll's changes as they arrive, with the scores from just before. */
export function useScoreChanges(listener: ChangeListener) {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  }, [listener]);
  useEffect(() => {
    const l: ChangeListener = (before, changes) => latest.current(before, changes);
    changeListeners.add(l);
    return () => {
      changeListeners.delete(l);
    };
  }, []);
}

/**
 * The season's postseason games and the rostered players' TB in them, kept live. The whole
 * season loads once (and again after a reconnect, or when the rostered players change); after
 * that, poll-games broadcasts each poll's changed rows in one message, which is applied as is.
 */
function useLiveScores(data: SeasonData | null): ScoresState {
  const year = data?.season.year;
  // Reload when the set of rostered players changes, not on every season reload.
  const playerKey = data ? [...new Set(data.spells.map((s) => s.mlb_player_id))].sort().join(',') : '';
  const [scores, setScores] = useState<Scores | null>(null);
  const latest = useRef(0);
  // For the broadcast listener, which outlives renders.
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
        ? await supabase
            .from('player_game_stats')
            .select('game_pk, mlb_player_id, tb, ab, h, bb, hbp, sf, hr, r, rbi')
            .in('game_pk', gamePks)
            .in('mlb_player_id', playerIds)
        : { data: [] };
    const livePks = (games ?? []).filter((g) => g.status === 'Live').map((g) => g.game_pk as number);
    const { data: lines } = livePks.length
      ? await supabase.from('player_game_stats').select('game_pk, mlb_player_id, ab, h, doubles, triples, hr, bb').in('game_pk', livePks)
      : { data: [] };
    if (fetchId !== latest.current) return;
    setScores({
      games: (games ?? []).filter((g) => g.series_game_number !== null).map(toGame),
      stats: (stats ?? []).map(toStat),
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
    refetch();
    const stop = listenForScores((changes) => {
      if (changes.reload) return scheduleReload();
      // A game that just started: reload once for the lines of anyone who batted before this app heard.
      const started = (changes.games ?? []).some(
        (row) => row.status === 'Live' && current.current?.games.find((g) => g.gamePk === row.game_pk)?.status !== 'Live',
      );
      const before = current.current;
      if (before) for (const l of changeListeners) l(before, changes);
      setScores((s) => (s ? applyChanges(s, changes, year, rostered) : s));
      if (started) scheduleReload();
    });
    return () => {
      if (reload) clearTimeout(reload);
      stop();
    };
  }, [year, playerKey, refetch]);

  return { scores, refetch };
}
