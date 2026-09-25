import { describe, expect, it } from 'vitest';

import { boxscoreBatting, linescoreLive, scheduleGames } from '../supabase/functions/poll-games/feed.ts';

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
              stats: { batting: { atBats: 4, hits: 2, doubles: 1, homeRuns: 1, totalBases: 7, runs: 2, rbi: 3, baseOnBalls: 1 } },
            },
            ID2: { person: { id: 2, fullName: 'A Pitcher' }, stats: { batting: {}, pitching: { outs: 18 } } },
          },
        },
        home: {
          team: { id: 119 },
          players: { ID3: { person: { id: 3, fullName: 'Shohei Ohtani' }, stats: { batting: { atBats: 5, hitByPitch: 1, sacFlies: 1 } } } },
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
      ab: 4, h: 2, doubles: 1, triples: 0, hr: 1, bb: 1, hbp: 0, sf: 0, tb: 7, r: 2, rbi: 3,
    });
    expect(rows[1]).toMatchObject({ mlb_player_id: 3, mlb_team_id: 119, ab: 5, hbp: 1, sf: 1, tb: 0 });
  });
});

describe('linescore feed', () => {
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
