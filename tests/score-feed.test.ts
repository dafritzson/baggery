import { describe, expect, it } from 'vitest';

import { type Row, type Scores, applyChanges, battingSpot, checkBroadcast, checkLoad, toGame } from '../supabase/functions/_shared/core/score-feed.ts';

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
  batting_order: 200,
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
      gamesInSeries: 5,
      finalSeenAt: null,
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
    // TB for rostered players in any game, with the rest of the line for tiebreakers; Harper
    // isn't on a roster.
    expect(next.stats.map((x) => [x.gamePk, x.playerId, x.tb])).toEqual([
      [1, OHTANI, 4],
      [2, OHTANI, 2],
    ]);
    expect(next.stats[0]).toMatchObject({ ab: 2, h: 1, hr: 1, bb: 0, hbp: 0, sf: 0, r: 1, rbi: 1 });
    // Lines for everyone who batted, but only in game 1, the live one.
    expect(next.lines.map((l) => [l.gamePk, l.playerId])).toEqual([[1, OHTANI], [1, HARPER]]);
    expect(next.lines[0]).toEqual({ gamePk: 1, playerId: OHTANI, ab: 2, h: 1, doubles: 0, triples: 0, hr: 1, bb: 0, spot: 2 });
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

describe('hits in the score feed', () => {
  const hitRow = (playId: string, gamePk: number, player: number, event = 'HR', hasVideo = false) => ({
    play_id: playId, game_pk: gamePk, mlb_player_id: player, event, ended_at: '2026-10-04T23:00:00Z', has_video: hasVideo,
  });

  it("folds rostered players' hits in this season's games into the scores", () => {
    const next = applyChanges(scores(), { hits: [hitRow('p1', 1, OHTANI), hitRow('p2', 1, HARPER), hitRow('p3', 99, OHTANI)] }, 2026, rostered);
    expect(next.hits).toEqual([
      { playId: 'p1', gamePk: 1, playerId: OHTANI, event: 'HR', endedAt: '2026-10-04T23:00:00Z', hasVideo: false, clip: null, savant: false },
    ]);
    // The same play again (say its type changed) replaces it.
    const again = applyChanges(next, { hits: [hitRow('p1', 1, OHTANI, '2B')] }, 2026, rostered);
    expect(again.hits!.map((h) => h.event)).toEqual(['2B']);
  });

  it('marks a hit once its video turns up, so the Games tab can show its ▶', () => {
    const next = applyChanges(scores(), { hits: [hitRow('p1', 1, OHTANI)] }, 2026, rostered);
    expect(next.hits!.map((h) => h.hasVideo)).toEqual([false]);
    const clipped = applyChanges(next, { hits: [hitRow('p1', 1, OHTANI, 'HR', true)] }, 2026, rostered);
    expect(clipped.hits!.map((h) => h.hasVideo)).toEqual([true]);
  });

  it("carries the hit's clip and Savant video as they turn up, for the Standings scrubber's links", () => {
    const next = applyChanges(scores(), { hits: [hitRow('p1', 1, OHTANI)] }, 2026, rostered);
    const clipped = applyChanges(next, { hits: [{ ...hitRow('p1', 1, OHTANI, 'HR', true), clip_slug: 'ohtani-homers' }] }, 2026, rostered);
    expect(clipped.hits!.map((h) => [h.clip, h.savant])).toEqual([['ohtani-homers', false]]);
    const savant = applyChanges(clipped, { hits: [{ ...hitRow('p1', 1, OHTANI, 'HR', true), clip_slug: 'ohtani-homers', savant_ready: true }] }, 2026, rostered);
    expect(savant.hits!.map((h) => [h.clip, h.savant])).toEqual([['ohtani-homers', true]]);
  });
});

describe('battingSpot', () => {
  it('reads the spot from MLB batting order, subs included', () => {
    expect(battingSpot(100)).toBe(1);
    expect(battingSpot(701)).toBe(7);
    expect(battingSpot(900)).toBe(9);
  });

  it('is null before the box score has him', () => {
    expect(battingSpot(null)).toBeNull();
    expect(battingSpot(undefined)).toBeNull();
    expect(battingSpot(7)).toBeNull();
  });
});

describe('broadcast numbers', () => {
  it('applies the next broadcast and moves on', () => {
    expect(checkBroadcast(41, 42)).toEqual({ apply: true, missed: false, last: 42 });
  });

  it('applies a broadcast after a gap and asks for a reload', () => {
    // 42 was lost (Realtime starting up): 43 arrives after 41.
    expect(checkBroadcast(41, 43)).toEqual({ apply: true, missed: true, last: 43 });
  });

  it('skips a broadcast the scores already include', () => {
    // The load returned 42, then broadcast 42 itself arrived.
    expect(checkBroadcast(42, 42)).toEqual({ apply: false, missed: false, last: 42 });
    expect(checkBroadcast(42, 40)).toEqual({ apply: false, missed: false, last: 42 });
  });

  it('takes the first number heard when none is known yet', () => {
    expect(checkBroadcast(null, 42)).toEqual({ apply: true, missed: false, last: 42 });
  });

  it('applies broadcasts without a number as before', () => {
    expect(checkBroadcast(41, undefined)).toEqual({ apply: true, missed: false, last: 41 });
    expect(checkBroadcast(null, undefined)).toEqual({ apply: true, missed: false, last: null });
  });

  it('loads again when a broadcast heard while loading is newer than the load', () => {
    // Broadcast 43 arrived while a load was on its way, but the load only includes up to 42.
    expect(checkLoad(43, 42)).toEqual({ missed: true, last: 42 });
  });

  it('takes the load as is when it includes everything heard', () => {
    expect(checkLoad(42, 42)).toEqual({ missed: false, last: 42 });
    expect(checkLoad(40, 42)).toEqual({ missed: false, last: 42 });
    expect(checkLoad(null, 42)).toEqual({ missed: false, last: 42 });
  });

  it('forgets the number when the load has none', () => {
    expect(checkLoad(42, null)).toEqual({ missed: false, last: null });
  });

  it('still catches a broadcast the second load also misses, on the next broadcast', () => {
    // 43 was overwritten by a load up to 42, and loading again stopped at 42 too: 44 shows the gap.
    const { last } = checkLoad(43, 42);
    expect(checkBroadcast(last, 44)).toEqual({ apply: true, missed: true, last: 44 });
  });
});
