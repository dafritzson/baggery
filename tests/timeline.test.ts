import { describe, expect, it } from 'vitest';

import { roundStandings, type ScoreStat } from '../supabase/functions/_shared/core/scoreboard.ts';
import type { RosterSpell } from '../supabase/functions/_shared/core/scoring.ts';
import {
  buildTimeline,
  dayEnd,
  gameDay,
  nearestStop,
  nextPlayStop,
  type PlayLine,
  prevPlayStop,
  previousStop,
  roundLines,
  scoresAt,
  stopPosition,
  stopsFor,
  type TimelineGame,
  type TimelineHit,
  valueAt,
} from '../supabase/functions/_shared/core/timeline.ts';

// Two Wild Card game 1s on Sep 29 (1 PM and 7 PM ET), game 2 on Sep 30, a Division Series game on
// Oct 4, a Championship Series game on Oct 12, and one not played yet.
const games: TimelineGame[] = [
  { gamePk: 1, gameType: 'F', seriesGameNumber: 1, start: '2026-09-29T17:00:00Z', officialDate: '2026-09-29', status: 'Final', homeTeamId: 147, awayTeamId: 111 },
  { gamePk: 2, gameType: 'F', seriesGameNumber: 1, start: '2026-09-29T23:00:00Z', officialDate: '2026-09-29', status: 'Final', homeTeamId: 141, awayTeamId: 136 },
  { gamePk: 3, gameType: 'F', seriesGameNumber: 2, start: '2026-09-30T23:00:00Z', officialDate: '2026-09-30', status: 'Final', homeTeamId: 147, awayTeamId: 111 },
  { gamePk: 4, gameType: 'D', seriesGameNumber: 1, start: '2026-10-04T23:00:00Z', officialDate: '2026-10-04', status: 'Final', homeTeamId: 141, awayTeamId: 147 },
  { gamePk: 5, gameType: 'L', seriesGameNumber: 1, start: '2026-10-12T23:00:00Z', officialDate: '2026-10-12', status: 'Final', homeTeamId: 141, awayTeamId: 147 },
  { gamePk: 6, gameType: 'L', seriesGameNumber: 2, start: '2026-10-13T23:00:00Z', officialDate: '2026-10-13', status: 'Preview', homeTeamId: 141, awayTeamId: 147 },
];
const JUDGE = 1; // NYY, team A
const DEVERS = 2; // BOS, team B
const GUERRERO = 3; // TOR, team B
const RALEIGH = 4; // SEA, never drafted

const spells: RosterSpell[] = [
  { teamId: 'A', playerId: JUDGE, from: '2026-09-28T00:00:00Z', to: null },
  { teamId: 'B', playerId: DEVERS, from: '2026-09-28T00:00:00Z', to: null },
  { teamId: 'B', playerId: GUERRERO, from: '2026-09-28T00:00:00Z', to: null },
];
// Team B was knocked out after round 1.
const inRound = (teamId: string, round: number) => teamId === 'A' || round === 1;

const hit = (playId: string, gamePk: number, playerId: number, event: TimelineHit['event'], endedAt: string | null): TimelineHit => ({
  playId,
  gamePk,
  playerId,
  event,
  endedAt,
});
const hits: TimelineHit[] = [
  hit('h3', 2, GUERRERO, '2B', '2026-09-30T00:10:00Z'), // Sep 29, 8:10 PM ET
  hit('h1', 1, JUDGE, 'HR', '2026-09-29T17:30:00Z'),
  hit('h2', 1, DEVERS, '1B', '2026-09-29T18:00:00Z'),
  hit('hx', 2, RALEIGH, '1B', '2026-09-30T00:20:00Z'), // no fantasy team
  hit('h4', 3, JUDGE, '1B', '2026-10-01T00:00:00Z'),
  hit('h5', 3, DEVERS, '1B', null), // no end time: counts only at the day's end (box score)
  hit('h6', 4, GUERRERO, '3B', '2026-10-05T00:00:00Z'),
  hit('h7', 5, JUDGE, '2B', '2026-10-13T00:00:00Z'),
  hit('h8', 5, GUERRERO, 'HR', '2026-10-13T00:30:00Z'), // team B is out by the CS
];
// The box scores. Devers' second single on Sep 30 (h5) has no end time; Judge's Sep 30 line has a
// double the play-by-play missed.
const stats: ScoreStat[] = [
  { gamePk: 1, playerId: JUDGE, tb: 4, ab: 4, h: 1, hr: 1 },
  { gamePk: 1, playerId: DEVERS, tb: 1, ab: 3, h: 1 },
  { gamePk: 2, playerId: GUERRERO, tb: 2, ab: 4, h: 1 },
  { gamePk: 3, playerId: JUDGE, tb: 3, ab: 4, h: 2 },
  { gamePk: 3, playerId: DEVERS, tb: 1, ab: 4, h: 1 },
  { gamePk: 4, playerId: GUERRERO, tb: 3, ab: 4, h: 1 },
  { gamePk: 5, playerId: JUDGE, tb: 2, ab: 3, h: 1 },
  { gamePk: 5, playerId: GUERRERO, tb: 4, ab: 4, h: 1, hr: 1 },
];

const tl = buildTimeline(games, hits, spells, inRound);
const totals = (round: 1 | 2 | 3, s: { games: TimelineGame[]; stats: ScoreStat[] }) =>
  Object.fromEntries(roundStandings(round, ['A', 'B'], s.games, s.stats, spells).map((r) => [r.teamId, r.total]));

describe('buildTimeline', () => {
  it('has a day per date with a game that started, in order', () => {
    expect(tl.days.map((d) => [d.date, d.round, d.gamePks])).toEqual([
      ['2026-09-29', 1, [1, 2]],
      ['2026-09-30', 1, [3]],
      ['2026-10-04', 1, [4]],
      ['2026-10-12', 2, [5]],
    ]);
  });

  it("lists each day's bags in the order they happened, only those that counted for a team in the round", () => {
    expect(tl.days.map((d) => d.bags.map((b) => `${b.playId}:${b.teamId}:${b.bags}`))).toEqual([
      ['h1:A:4', 'h2:B:1', 'h3:B:2'],
      ['h4:A:1'],
      ['h6:B:3'],
      ['h7:A:2'],
    ]);
  });

  it("dates a game by MLB's date, else its start in Eastern time", () => {
    expect(gameDay({ ...games[1], officialDate: null })).toBe('2026-09-29');
  });
});

describe('stopsFor', () => {
  it('stops at the end of each day for the season', () => {
    expect(stopsFor(tl, 'season', { day: 0, bag: 0 })).toEqual([
      { day: 0, bag: 3 },
      { day: 1, bag: 1 },
      { day: 2, bag: 1 },
      { day: 3, bag: 1 },
    ]);
  });

  it("stops at every bag of the round's days when zoomed in on a round", () => {
    expect(stopsFor(tl, 'round', { day: 1, bag: 0 })).toEqual([
      { day: 0, bag: 1 },
      { day: 0, bag: 2 },
      { day: 0, bag: 3 },
      { day: 1, bag: 1 },
      { day: 2, bag: 1 },
    ]);
  });

  it("stops at a day's first pitch and each of its bags when zoomed in on a day", () => {
    expect(stopsFor(tl, 'day', { day: 0, bag: 3 })).toEqual([0, 1, 2, 3].map((bag) => ({ day: 0, bag })));
  });
});

describe('playback', () => {
  it('plays bag by bag at every zoom, over the whole season when zoomed out', () => {
    expect(nextPlayStop(tl, 'season', { day: 0, bag: 1 })).toEqual({ day: 0, bag: 2 });
    expect(nextPlayStop(tl, 'season', { day: 0, bag: 3 })).toEqual({ day: 1, bag: 1 });
    expect(nextPlayStop(tl, 'season', { day: 2, bag: 1 })).toEqual({ day: 3, bag: 1 });
    expect(nextPlayStop(tl, 'season', { day: 3, bag: 1 })).toBeNull();
    // A round's playback ends with the round.
    expect(nextPlayStop(tl, 'round', { day: 2, bag: 1 })).toBeNull();
    expect(nextPlayStop(tl, 'day', { day: 0, bag: 0 })).toEqual({ day: 0, bag: 1 });
    expect(nextPlayStop(tl, 'day', { day: 0, bag: 3 })).toBeNull();
  });

  it('plays backwards bag by bag, stopping at the start of the season, round or day', () => {
    expect(prevPlayStop(tl, 'season', { day: 0, bag: 2 })).toEqual({ day: 0, bag: 1 });
    expect(prevPlayStop(tl, 'season', { day: 1, bag: 1 })).toEqual({ day: 0, bag: 3 });
    expect(prevPlayStop(tl, 'season', { day: 3, bag: 1 })).toEqual({ day: 2, bag: 1 });
    expect(prevPlayStop(tl, 'season', { day: 0, bag: 1 })).toBeNull();
    expect(prevPlayStop(tl, 'round', { day: 1, bag: 1 })).toEqual({ day: 0, bag: 3 });
    expect(prevPlayStop(tl, 'day', { day: 0, bag: 1 })).toEqual({ day: 0, bag: 0 });
    expect(prevPlayStop(tl, 'day', { day: 0, bag: 0 })).toBeNull();
  });

  it('compares a day with the day before on the season, else with the bag before', () => {
    expect(previousStop(tl, 'season', { day: 1, bag: 1 })).toEqual({ day: 0, bag: 3 });
    expect(previousStop(tl, 'season', { day: 0, bag: 2 })).toEqual({ day: 0, bag: 1 });
    expect(previousStop(tl, 'round', { day: 1, bag: 1 })).toEqual({ day: 0, bag: 3 });
    expect(previousStop(tl, 'day', { day: 0, bag: 1 })).toEqual({ day: 0, bag: 0 });
    expect(previousStop(tl, 'season', { day: 0, bag: 3 })).toBeNull();
  });
});

describe('scoresAt', () => {
  it('counts a day up to a bag: earlier games in full, games that had started from their hits', () => {
    // Sep 29 after Devers' single: game 1 under way, game 2 not started.
    const s = scoresAt(tl, games, stats, { day: 0, bag: 2 });
    expect(s.games.map((g) => g.status)).toEqual(['Live', 'Preview', 'Preview', 'Preview', 'Preview', 'Preview']);
    expect(totals(1, s)).toEqual({ A: 4, B: 1 });
    expect(s.stats.find((x) => x.playerId === JUDGE)).toMatchObject({ gamePk: 1, tb: 4, h: 1, hr: 1 });
  });

  it("rebuilds a game's lines at a moment from its plays, walks and runs included", () => {
    const play = (playerId: number, endedAt: string, line: Partial<PlayLine>): PlayLine => ({
      gamePk: 1, playerId, endedAt, ab: 0, h: 0, tb: 0, hr: 0, bb: 0, hbp: 0, sf: 0, r: 0, rbi: 0, ...line,
    });
    const plays = [
      play(DEVERS, '2026-09-29T17:10:00Z', { bb: 1 }),
      play(JUDGE, '2026-09-29T17:30:00Z', { ab: 1, h: 1, tb: 4, hr: 1, r: 1, rbi: 2 }),
      play(DEVERS, '2026-09-29T17:30:00Z', { r: 1 }),
      play(DEVERS, '2026-09-29T18:00:00Z', { ab: 1, h: 1, tb: 1 }),
    ];
    // Just after Judge's home run: Devers has walked and scored, but not singled yet.
    const s = scoresAt(tl, games, stats, { day: 0, bag: 1 }, plays);
    expect(s.stats.find((x) => x.playerId === JUDGE)).toMatchObject({ ab: 1, h: 1, tb: 4, hr: 1, r: 1, rbi: 2 });
    expect(s.stats.find((x) => x.playerId === DEVERS)).toMatchObject({ ab: 0, bb: 1, tb: 0, r: 1 });
    expect(totals(1, s)).toEqual({ A: 4, B: 0 });
  });

  it("counts nothing from a day before its first bag", () => {
    expect(totals(1, scoresAt(tl, games, stats, { day: 1, bag: 0 }))).toEqual({ A: 4, B: 3 });
  });

  it("uses the box scores at a day's end, hits the play-by-play doesn't have included", () => {
    const s = scoresAt(tl, games, stats, dayEnd(tl, 1));
    expect(s.games.slice(0, 3).map((g) => g.status)).toEqual(['Final', 'Final', 'Final']);
    expect(totals(1, s)).toEqual({ A: 7, B: 4 });
  });

  it('leaves the games after the stop unplayed', () => {
    const s = scoresAt(tl, games, stats, dayEnd(tl, 2));
    expect(s.games[4].status).toBe('Preview');
    expect(s.stats.some((x) => x.gamePk === 5)).toBe(false);
    expect(totals(1, s)).toEqual({ A: 7, B: 7 });
  });
});

describe('roundLines', () => {
  const lines = roundLines(tl, games, stats, spells, 1, ['A', 'B'], 1)!;

  it("steps each team's line up bag by bag and settles each day on the box scores", () => {
    expect(lines.from).toBe(0);
    expect(lines.to).toBe(3);
    // Judge's HR is Sep 29's first of 3 bags; on Sep 30 his single, then the double only the box has.
    expect(lines.teams.get('A')).toEqual([[0, 0], [1 / 3, 0], [1 / 3, 4], [2, 4], [2, 5], [2, 5], [2, 7], [3, 7]]);
    expect(valueAt(lines.teams.get('B')!, 1)).toBe(3);
    expect(valueAt(lines.teams.get('B')!, 2)).toBe(4);
    expect(valueAt(lines.teams.get('B')!, 3)).toBe(7);
  });

  it('draws the cut as the last team through', () => {
    // One team goes through: the cut is the leader's total.
    expect(valueAt(lines.cut, 0.5)).toBe(4);
    expect(valueAt(lines.cut, 3)).toBe(7);
  });

  it('draws the cut from only the teams facing it', () => {
    // B leads the whole way; counting only A, the cut is A's total.
    const onlyA = roundLines(tl, games, stats, spells, 1, ['A', 'B'], 1, ['A'])!;
    expect(valueAt(onlyA.cut, 3)).toBe(valueAt(onlyA.teams.get('A')!, 3));
    expect(valueAt(onlyA.cut, 1)).toBe(valueAt(onlyA.teams.get('A')!, 1));
  });

  it('is null for a round with no games yet', () => {
    expect(roundLines(tl, games, stats, spells, 3, ['A'], 1)).toBeNull();
  });
});

describe('positions', () => {
  it("places a stop by its day and how far through the day's bags it is", () => {
    expect(stopPosition(tl, { day: 0, bag: 0 })).toBe(0);
    expect(stopPosition(tl, { day: 0, bag: 3 })).toBe(1);
    expect(stopPosition(tl, { day: 1, bag: 1 })).toBe(2);
  });

  it('snaps to the nearest stop', () => {
    const list = stopsFor(tl, 'season', { day: 0, bag: 0 });
    expect(nearestStop(tl, list, 2.4)).toEqual({ day: 1, bag: 1 });
    expect(nearestStop(tl, stopsFor(tl, 'round', { day: 0, bag: 1 }), 0.6)).toEqual({ day: 0, bag: 2 });
  });
});
