import { useCallback, useEffect, useRef, useState } from 'react';

import type { BoxLine, Linescore, LineupPlayer } from '@core/box-score.ts';
import type { Row } from '@core/score-feed.ts';

import { type GameInfo, useScoreChanges } from '@/lib/scores';
import { supabase } from '@/lib/supabase';

export interface Probable {
  name: string;
  hand: 'L' | 'R' | null;
}

export interface BoxScore {
  /** Everyone who has batted, both teams. */
  lines: BoxLine[];
  /** Each team's posted starting lineup, by MLB team. */
  lineups: Map<number, LineupPlayer[]>;
  linescore: Linescore | null;
  /** Each team's announced starter, by MLB team. */
  probables: Map<number, Probable>;
}

const STAT_COLUMNS = 'mlb_player_id, mlb_team_id, batting_order, position, ab, r, h, rbi, bb, so, tb, doubles, triples, hr';

function toBoxLine(row: Row, name: string): BoxLine {
  return {
    playerId: row.mlb_player_id,
    teamId: row.mlb_team_id,
    name,
    order: row.batting_order ?? null,
    position: row.position ?? null,
    ab: row.ab ?? 0,
    r: row.r ?? 0,
    h: row.h ?? 0,
    rbi: row.rbi ?? 0,
    bb: row.bb ?? 0,
    so: row.so ?? 0,
    tb: row.tb ?? 0,
    doubles: row.doubles ?? 0,
    triples: row.triples ?? 0,
    hr: row.hr ?? 0,
  };
}

/** One request per table, ~3–5 KB in all. Null if any failed. */
async function loadBoxScore(gamePk: number): Promise<BoxScore | null> {
  const [stats, game, lineups, probables] = await Promise.all([
    supabase.from('player_game_stats').select(`${STAT_COLUMNS}, player:mlb_players(full_name)`).eq('game_pk', gamePk),
    supabase.from('mlb_games').select('linescore').eq('game_pk', gamePk).maybeSingle(),
    supabase.from('mlb_lineups').select('mlb_team_id, players').eq('game_pk', gamePk),
    supabase.from('mlb_probables').select('mlb_team_id, pitcher_name, hand').eq('game_pk', gamePk),
  ]);
  if (stats.error || game.error || lineups.error || probables.error) return null;
  return {
    lines: stats.data.map((row: Row) => toBoxLine(row, row.player?.full_name ?? `Player ${row.mlb_player_id}`)),
    lineups: new Map(lineups.data.map((l: Row) => [l.mlb_team_id as number, l.players as LineupPlayer[]])),
    linescore: (game.data?.linescore as Linescore | null) ?? null,
    probables: new Map(probables.data.map((p: Row) => [p.mlb_team_id as number, { name: p.pitcher_name, hand: p.hand }])),
  };
}

// A finished game's box score doesn't change (much: a scoring change can still come in), so the
// first one loaded after the final out is kept for the session.
const finished = new Map<number, BoxScore>();

/**
 * A game's box score, loaded when it's opened (and again when the game ends). A live game's then
 * follows the scores broadcast the app already gets (each poll's changed batting lines and game
 * row), so it costs nothing more while it's open. Null while loading; `failed` if the load failed.
 */
export function useBoxScore(game: GameInfo): { box: BoxScore | null; failed: boolean } {
  const { gamePk, status } = game;
  const [state, setState] = useState<{ gamePk: number; box: BoxScore | null; failed: boolean } | null>(null);
  const loadId = useRef(0);
  const cached = finished.get(gamePk);
  // What's on show, for the broadcast listener, which outlives renders.
  const shown = useRef<BoxScore | null>(null);
  useEffect(() => {
    shown.current = state?.gamePk === gamePk ? state.box : null;
  }, [state, gamePk]);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    const box = await loadBoxScore(gamePk);
    if (id !== loadId.current) return;
    if (box && status === 'Final') finished.set(gamePk, box);
    setState({ gamePk, box, failed: !box });
  }, [gamePk, status]);

  useEffect(() => {
    if (!finished.has(gamePk)) load();
  }, [gamePk, load]);

  useScoreChanges((_, changes) => {
    if (finished.has(gamePk)) return;
    if (changes.reload) {
      load();
      return;
    }
    const stats = (changes.stats ?? []).filter((row) => row.game_pk === gamePk);
    const row = (changes.games ?? []).find((g) => g.game_pk === gamePk);
    if (!stats.length && !row?.linescore) return;
    const box = shown.current;
    if (!box) return;
    const names = new Map(box.lines.map((l) => [l.playerId, l.name]));
    for (const players of box.lineups.values()) for (const p of players) if (!names.has(p.id)) names.set(p.id, p.name);
    let unknown = false;
    let lines = box.lines;
    for (const stat of stats) {
      const name = names.get(stat.mlb_player_id);
      // A sub not in the lineup who just batted: his name comes with a reload.
      if (!name) unknown = true;
      const line = toBoxLine(stat, name ?? `Player ${stat.mlb_player_id}`);
      lines = [...lines.filter((l) => l.playerId !== line.playerId), line];
    }
    setState({ gamePk, box: { ...box, lines, linescore: (row?.linescore as Linescore | undefined) ?? box.linescore }, failed: false });
    if (unknown) load();
  });

  if (cached) return { box: cached, failed: false };
  return state?.gamePk === gamePk ? { box: state.box, failed: state.failed } : { box: null, failed: false };
}
