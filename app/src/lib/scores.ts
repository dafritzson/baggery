import { createContext, createElement, type ReactNode, use, useCallback, useEffect, useRef, useState } from 'react';

import { type Row, type ScoreChanges, type Scores, applyChanges, toGame, toHit, toLine, toStat } from '@core/score-feed.ts';
import type { ScoreGame, ScoreStat } from '@core/scoreboard.ts';
import type { RosterSpell } from '@core/scoring.ts';
import type { PlayLine } from '@core/timeline.ts';

import { type SeasonData, useSeason } from '@/lib/season';
import { supabase } from '@/lib/supabase';

export type { BattingLine, GameInfo, ScoreHit, Scores } from '@core/score-feed.ts';

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
    // Their hits one by one, so the Games tab can draw bags hit by hit.
    const { data: hits } =
      gamePks.length && playerIds.length
        ? await supabase
            .from('mlb_hits')
            .select('play_id, game_pk, mlb_player_id, event, ended_at, has_video')
            .in('game_pk', gamePks)
            .in('mlb_player_id', playerIds)
        : { data: [] };
    const livePks = (games ?? []).filter((g) => g.status === 'Live').map((g) => g.game_pk as number);
    const { data: lines } = livePks.length
      ? await supabase.from('player_game_stats').select('game_pk, mlb_player_id, ab, h, doubles, triples, hr, bb, batting_order').in('game_pk', livePks)
      : { data: [] };
    if (fetchId !== latest.current) return;
    setScores({
      games: (games ?? []).filter((g) => g.series_game_number !== null).map(toGame),
      stats: (stats ?? []).map(toStat),
      lines: (lines ?? []).map(toLine),
      hits: (hits ?? []).map(toHit),
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

/**
 * One player's postseason for the player popup: his MLB team's games this season and his TB in
 * them. Loaded each time the popup opens (a few KB), not kept live. Null while loading or if
 * loading failed.
 */
export function usePlayerScores(
  playerId: number,
  mlbTeamId: number | undefined,
  year: number | undefined,
): { games: ScoreGame[]; stats: ScoreStat[] } | null {
  const key = mlbTeamId && year ? `${playerId}:${mlbTeamId}:${year}` : null;
  const [result, setResult] = useState<{ key: string; games: ScoreGame[]; stats: ScoreStat[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.all([
      supabase
        .from('mlb_games')
        .select('game_pk, game_type, series_game_number, start_time, status, home_team_id, away_team_id')
        .eq('season_year', year!)
        .or(`home_team_id.eq.${mlbTeamId},away_team_id.eq.${mlbTeamId}`)
        .not('series_game_number', 'is', null),
      supabase
        .from('player_game_stats')
        .select('game_pk, tb, mlb_games!inner(season_year)')
        .eq('mlb_player_id', playerId)
        .eq('mlb_games.season_year', year!),
    ]).then(([games, stats]) => {
      if (cancelled || games.error || stats.error) return;
      setResult({
        key,
        games: games.data.map((g) => ({
          gamePk: g.game_pk,
          gameType: g.game_type,
          seriesGameNumber: g.series_game_number,
          start: g.start_time,
          status: g.status,
          homeTeamId: g.home_team_id,
          awayTeamId: g.away_team_id,
        })),
        stats: stats.data.map((s) => ({ gamePk: s.game_pk, playerId, tb: s.tb })),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key, playerId, mlbTeamId, year]);

  return result && result.key === key ? result : null;
}

const PLAY_COLUMNS = 'game_pk, at_bat, mlb_player_id, ended_at, ab, h, tb, hr, bb, hbp, sf, r, rbi';
const PAGE = 1000;

const toPlayLine = (row: Row): PlayLine => ({
  gamePk: row.game_pk,
  playerId: row.mlb_player_id,
  endedAt: row.ended_at,
  ab: row.ab,
  h: row.h,
  tb: row.tb,
  hr: row.hr,
  bb: row.bb,
  hbp: row.hbp,
  sf: row.sf,
  r: row.r,
  rbi: row.rbi,
});

/** Some games' lines for some players, a page at a time (the API returns at most 1,000 rows). */
async function loadPlayLines(gamePks: number[], playerIds: number[]): Promise<PlayLine[] | null> {
  const lines: PlayLine[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('mlb_play_lines')
      .select(PLAY_COLUMNS)
      .in('game_pk', gamePks)
      .in('mlb_player_id', playerIds)
      .order('game_pk')
      .order('at_bat')
      .order('mlb_player_id')
      .range(from, from + PAGE - 1);
    if (error || !data) return null;
    lines.push(...data.map(toPlayLine));
    if (data.length < PAGE) return lines;
  }
}

// The season's lines once loaded, by season and rostered players.
const seasonPlays = new Map<string, PlayLine[]>();

/**
 * The season's play-by-play batting lines (mlb_play_lines) for its rostered players, for the
 * Standings scrubber: with them the middle of a day is rebuilt exactly, tiebreakers included.
 * Loaded only once `wanted` (the scrubber is in the middle of a day, or playing), in one go (an
 * estimated 200–300 KB), and kept for the session. While a game is live, its lines are reloaded
 * once a minute for as long as they're wanted. Empty until loaded; those moments use the hits.
 */
export function useSeasonPlayLines(wanted: boolean): PlayLine[] {
  const { data } = useSeason();
  const { scores } = useScores();
  const [, setVersion] = useState(0);
  const playerKey = data ? [...new Set(data.spells.map((s) => s.mlb_player_id))].sort().join(',') : '';
  const key = data ? `${data.season.year}:${playerKey}` : '';
  const started = (scores?.games ?? []).filter((g) => g.status !== 'Preview');
  const gameKey = started.map((g) => g.gamePk).join(',');
  const liveKey = started.filter((g) => g.status === 'Live').map((g) => g.gamePk).join(',');
  useEffect(() => {
    if (!wanted || !key || !playerKey || !gameKey) return;
    let cancelled = false;
    const players = playerKey.split(',').map(Number);
    const load = async (pks: number[]) => {
      const lines = await loadPlayLines(pks, players);
      if (!lines || cancelled) return;
      seasonPlays.set(key, [...(seasonPlays.get(key) ?? []).filter((l) => !pks.includes(l.gamePk)), ...lines]);
      setVersion((v) => v + 1);
    };
    if (!seasonPlays.has(key)) load(gameKey.split(',').map(Number));
    const live = liveKey ? liveKey.split(',').map(Number) : [];
    const timer = live.length ? setInterval(() => load(live), 60_000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [wanted, key, playerKey, gameKey, liveKey]);
  return seasonPlays.get(key) ?? [];
}
