import { describe, expect, it } from 'vitest';

import { type Row, type Scores, applyChanges, toGame } from '../supabase/functions/_shared/core/score-feed.ts';

// Rows as poll-games' broadcast sends them: whole table rows, extra columns and all.
const gameRow = (gamePk: number, over: Row = {}): Row => ({
  game_pk: gamePk,
  season_year: 2026,
  game_type: 'D',
  series_game_number: 1,
  games_in_series: 5,
  start_time: '2026-10-04T22:08:00+00:00',
  start_time_tbd: false,
  official_date: '2026-10-04',
  status: 'Live',
  detailed_state: 'In Progress',
  home_team_id: 119,
  away_team_id: 143,
  home_score: 1,
  away_score: 0,
  live: { inning: 3 },
  final_seen_at: null,
  updated_at: '2026-10-04T22:40:00+00:00',
  ...over,
});
const statRow = (gamePk: number, playerId: number, over: Row = {}): Row => ({
  game_pk: gamePk,
  mlb_player_id: playerId,
  mlb_team_id: 119,
  ab: 2,
  h: 1,
  doubles: 0,
  triples: 0,
  hr: 1,
  bb: 0,
  hbp: 0,
  sf: 0,
  tb: 4,
  r: 1,
  rbi: 1,
  ...over,
});

const OHTANI = 660271;
const HARPER = 547180;
const rostered = new Set([OHTANI]);

function scores(): Scores {
  return {
    games: [toGame(gameRow(1)), toGame(gameRow(2, { status: 'Final' }))],
    stats: [{ gamePk: 1, playerId: OHTANI, tb: 0 }],
    lines: [],
  };
}

describe('score feed', () => {
  it('turns a row into a game', () => {
    expect(toGame(gameRow(1))).toEqual({
      gamePk: 1,
      gameType: 'D',
      seriesGameNumber: 1,
      start: '2026-10-04T22:08:00+00:00',
      startTimeTbd: false,
      officialDate: '2026-10-04',
      status: 'Live',
      homeTeamId: 119,
      awayTeamId: 143,
      homeScore: 1,
      awayScore: 0,
      detailedState: 'In Progress',
      live: { inning: 3 },
    });
  });

  it('replaces changed games and adds new ones, in this season only', () => {
    const next = applyChanges(
      scores(),
      { games: [gameRow(1, { home_score: 2 }), gameRow(3, { status: 'Preview' }), gameRow(9, { season_year: 2025 })] },
      2026,
      rostered,
    );
    expect(next.games.map((g) => [g.gamePk, g.homeScore])).toEqual([[1, 2], [2, 1], [3, 1]]);
  });

  it('skips games not yet placed in a series', () => {
    const next = applyChanges(scores(), { games: [gameRow(4, { series_game_number: null })] }, 2026, rostered);
    expect(next.games).toHaveLength(2);
  });

  it("updates a rostered player's TB, and keeps batting lines for live games only", () => {
    const next = applyChanges(
      scores(),
      { stats: [statRow(1, OHTANI), statRow(1, HARPER, { tb: 1 }), statRow(2, OHTANI, { tb: 2 })] },
      2026,
      rostered,
    );
    // TB for rostered players in any game; Harper isn't on a roster.
    expect(next.stats).toEqual([
      { gamePk: 1, playerId: OHTANI, tb: 4 },
      { gamePk: 2, playerId: OHTANI, tb: 2 },
    ]);
    // Lines for everyone who batted, but only in game 1, the live one.
    expect(next.lines.map((l) => [l.gamePk, l.playerId])).toEqual([[1, OHTANI], [1, HARPER]]);
    expect(next.lines[0]).toEqual({ gamePk: 1, playerId: OHTANI, ab: 2, h: 1, doubles: 0, triples: 0, hr: 1, bb: 0 });
  });

  it('keeps lines for a game that went live in the same message', () => {
    const next = applyChanges(scores(), { games: [gameRow(2, { status: 'Live' })], stats: [statRow(2, HARPER)] }, 2026, rostered);
    expect(next.lines.map((l) => l.gamePk)).toEqual([2]);
  });

  it('leaves the scores it was given alone', () => {
    const before = scores();
    const copy = structuredClone(before);
    applyChanges(before, { games: [gameRow(1, { home_score: 5 })], stats: [statRow(1, OHTANI)] }, 2026, rostered);
    expect(before).toEqual(copy);
  });
});
