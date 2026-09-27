import { describe, expect, it } from 'vitest';

import { boxscoreBatting, clipsForHits, highlightClips, linescoreLive, linescoreRuns, playHits, scheduleGames } from '../supabase/functions/poll-games/feed.ts';

const team = (id: number, score?: number) => ({ team: { id }, score });

function game(gamePk: number, overrides: object = {}) {
  return {
    gamePk,
    gameType: 'D',
    gameDate: '2025-10-04T22:08:00Z',
    officialDate: '2025-10-04',
    status: { abstractGameState: 'Final', detailedState: 'Final' },
    teams: { away: team(141, 3), home: team(119, 5) },
    seriesGameNumber: 1,
    gamesInSeries: 5,
    ...overrides,
  };
}

describe('schedule feed', () => {
  const known = new Set([141, 119, 147, 136]);

  it('maps postseason games to rows', () => {
    const [row] = scheduleGames({ dates: [{ games: [game(1)] }] }, 2025, known);
    expect(row).toEqual({
      game_pk: 1,
      season_year: 2025,
      game_type: 'D',
      start_time: '2025-10-04T22:08:00Z',
      start_time_tbd: false,
      official_date: '2025-10-04',
      status: 'Final',
      detailed_state: 'Final',
      home_team_id: 119,
      away_team_id: 141,
      home_score: 5,
      away_score: 3,
      series_game_number: 1,
      games_in_series: 5,
    });
  });

  it('flags games with no start time yet', () => {
    const [row] = scheduleGames(
      {
        dates: [
          {
            games: [
              game(4, {
                gameDate: '2025-09-30T07:33:00Z',
                officialDate: '2025-09-30',
                status: { abstractGameState: 'Preview', detailedState: 'Scheduled', startTimeTBD: true },
              }),
            ],
          },
        ],
      },
      2025,
      known,
    );
    expect(row).toMatchObject({ start_time_tbd: true, official_date: '2025-09-30' });
  });

  it('skips regular-season games and games with teams not set yet', () => {
    const rows = scheduleGames(
      { dates: [{ games: [game(1, { gameType: 'R' }), game(2, { teams: { away: team(0), home: team(119) } }), game(3)] }] },
      2025,
      known,
    );
    expect(rows.map((r) => r.game_pk)).toEqual([3]);
  });

  it('keeps the rescheduled listing of a postponed game', () => {
    const rows = scheduleGames(
      {
        dates: [
          { games: [game(7, { status: { abstractGameState: 'Final', detailedState: 'Postponed' } })] },
          { games: [game(7, { gameDate: '2025-10-05T20:08:00Z', status: { abstractGameState: 'Preview', detailedState: 'Scheduled' } })] },
        ],
      },
      2025,
      known,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ start_time: '2025-10-05T20:08:00Z', status: 'Preview' });
  });
});

describe('box score feed', () => {
  it('keeps everyone who batted, with their team', () => {
    const data = {
      teams: {
        away: {
          team: { id: 141 },
          players: {
            ID1: {
              person: { id: 1, fullName: 'Vladimir Guerrero Jr.' },
              stats: { batting: { plateAppearances: 5, atBats: 4, hits: 2, doubles: 1, homeRuns: 1, totalBases: 7, runs: 2, rbi: 3, baseOnBalls: 1 } },
            },
            ID2: { person: { id: 2, fullName: 'A Pitcher' }, stats: { batting: {}, pitching: { outs: 18 } } },
          },
        },
        home: {
          team: { id: 119 },
          players: { ID3: { person: { id: 3, fullName: 'Shohei Ohtani' }, stats: { batting: { plateAppearances: 7, atBats: 5, hitByPitch: 1, sacFlies: 1 } } } },
        },
      },
    };
    const { rows, players } = boxscoreBatting(99, data);
    expect(players).toEqual([
      { id: 1, full_name: 'Vladimir Guerrero Jr.' },
      { id: 3, full_name: 'Shohei Ohtani' },
    ]);
    expect(rows[0]).toEqual({
      game_pk: 99, mlb_player_id: 1, mlb_team_id: 141,
      pa: 5, ab: 4, h: 2, doubles: 1, triples: 0, hr: 1, bb: 1, hbp: 0, sf: 0, tb: 7, r: 2, rbi: 3,
    });
    expect(rows[1]).toMatchObject({ mlb_player_id: 3, mlb_team_id: 119, pa: 7, ab: 5, hbp: 1, sf: 1, tb: 0 });
  });
});

describe('linescore feed', () => {
  it('reads the runs so far', () => {
    expect(linescoreRuns({ teams: { home: { runs: 2 }, away: { runs: 3 } } })).toEqual({ home: 2, away: 3 });
    expect(linescoreRuns({ teams: { home: {}, away: {} } })).toBeNull();
  });

  it('reads the inning, count, runners and who is up', () => {
    const live = linescoreLive({
      currentInning: 7,
      inningState: 'Bottom',
      isTopInning: false,
      balls: 2,
      strikes: 1,
      outs: 1,
      offense: {
        batter: { id: 1, fullName: 'Shohei Ohtani' },
        onDeck: { id: 2, fullName: 'Mookie Betts' },
        inHole: { id: 3, fullName: 'Freddie Freeman' },
        second: { id: 4, fullName: 'Will Smith' },
        third: { id: 5, fullName: 'Max Muncy' },
      },
      defense: { batter: { id: 6, fullName: 'Kyle Schwarber' }, onDeck: { id: 7, fullName: 'Bryce Harper' } },
    });
    expect(live).toEqual({
      inning: 7,
      inningState: 'Bottom',
      battingSide: 'home',
      outs: 1,
      balls: 2,
      strikes: 1,
      bases: [false, true, true],
      batting: [
        { id: 1, name: 'Shohei Ohtani' },
        { id: 2, name: 'Mookie Betts' },
        { id: 3, name: 'Freddie Freeman' },
      ],
      dueUp: [{ id: 6, name: 'Kyle Schwarber' }, { id: 7, name: 'Bryce Harper' }, null],
    });
  });

  it('has nothing before the first pitch', () => {
    expect(linescoreLive({ innings: [], teams: {} })).toBeNull();
  });
});

describe('playHits', () => {
  // Shaped like /game/{gamePk}/playByPlay: 2025 World Series Game 3.
  const pitch = (playId: string) => ({ isPitch: true, playId });
  const data = {
    allPlays: [
      {
        result: { eventType: 'double' },
        matchup: { batter: { id: 660271 } },
        about: { inning: 1, isTopInning: false, endTime: '2025-10-28T00:15:02.000Z' },
        playEvents: [pitch('aaaa0000-0000-0000-0000-000000000001'), { isPitch: false }, pitch('2dcfd28d-b1e1-35b2-bb39-bbb69e540cb0')],
      },
      { result: { eventType: 'strikeout' }, matchup: { batter: { id: 5 } }, about: { inning: 1 }, playEvents: [pitch('x')] },
      {
        result: { eventType: 'home_run' },
        matchup: { batter: { id: 518692 } },
        about: { inning: 18, halfInning: 'bottom', endTime: '2025-10-28T06:50:35.827Z' },
        playEvents: [pitch('1b148aed-a2b7-3b9c-a0c4-6bb88a732ec8'), { isPitch: false, type: 'action' }],
      },
      // No pitch with a play ID: skipped rather than guessed.
      { result: { eventType: 'single' }, matchup: { batter: { id: 7 } }, about: { inning: 2 }, playEvents: [{ isPitch: false }] },
    ],
  };

  it("takes each hit's batter, type, inning and the play ID of the pitch put in play", () => {
    expect(playHits(813032, data)).toEqual([
      {
        play_id: '2dcfd28d-b1e1-35b2-bb39-bbb69e540cb0', game_pk: 813032, mlb_player_id: 660271, event: '2B',
        inning: 1, top_inning: false, ended_at: '2025-10-28T00:15:02.000Z',
      },
      {
        play_id: '1b148aed-a2b7-3b9c-a0c4-6bb88a732ec8', game_pk: 813032, mlb_player_id: 518692, event: 'HR',
        inning: 18, top_inning: false, ended_at: '2025-10-28T06:50:35.827Z',
      },
    ]);
    expect(playHits(1, {})).toEqual([]);
  });
});

describe('highlight clips', () => {
  // Shaped like /game/{gamePk}/content.
  const item = (guid: string | undefined, slug: string, headline: string, players: number[]) => ({
    guid,
    slug,
    headline,
    keywordsAll: [{ type: 'game_pk', value: '813032' }, ...players.map((p) => ({ type: 'player_id', value: String(p) }))],
  });
  const data = {
    highlights: {
      highlights: {
        items: [
          item('1b148aed-a2b7-3b9c-a0c4-6bb88a732ec8', 'freddie-freeman-s-walk-off-home-run', "Freddie Freeman's walk-off home run", [518692]),
          item(undefined, 'field-view-freeman-walk-off', 'Field View: Freeman walk-off', [518692]),
          // A single where a runner was thrown out: the defense's clip, then the batter's.
          item('1006b1fa-38cf-3e3b-9a42-b49cb9dd5d3e', 'addison-barger-cuts-down-freddie-freeman', 'Addison Barger cuts down Freddie Freeman at the plate', [676391, 518692]),
          item('1006b1fa-38cf-3e3b-9a42-b49cb9dd5d3e', 'will-smith-s-single', "Will Smith's single", [669257]),
        ],
      },
    },
  };

  it('keeps clips of a play (with a guid) and their players', () => {
    const clips = highlightClips(data);
    expect(clips.map((c) => c.slug)).toEqual(['freddie-freeman-s-walk-off-home-run', 'addison-barger-cuts-down-freddie-freeman', 'will-smith-s-single']);
    expect(clips[0]).toEqual({
      playId: '1b148aed-a2b7-3b9c-a0c4-6bb88a732ec8',
      slug: 'freddie-freeman-s-walk-off-home-run',
      headline: "Freddie Freeman's walk-off home run",
      playerIds: [518692],
    });
  });

  it("matches each hit to its play's clip, preferring one of the batter", () => {
    const matched = clipsForHits(
      [
        { play_id: '1b148aed-a2b7-3b9c-a0c4-6bb88a732ec8', mlb_player_id: 518692 },
        { play_id: '1006b1fa-38cf-3e3b-9a42-b49cb9dd5d3e', mlb_player_id: 669257 },
        { play_id: 'no-clip', mlb_player_id: 1 },
      ],
      highlightClips(data),
    );
    expect(matched.get('1b148aed-a2b7-3b9c-a0c4-6bb88a732ec8')?.slug).toBe('freddie-freeman-s-walk-off-home-run');
    expect(matched.get('1006b1fa-38cf-3e3b-9a42-b49cb9dd5d3e')?.slug).toBe('will-smith-s-single');
    expect(matched.has('no-clip')).toBe(false);
  });
});
