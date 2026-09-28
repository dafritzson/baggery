import { describe, expect, it } from 'vitest';

import { scheduleGames, scheduleProbables } from '../supabase/functions/poll-games/feed.ts';
import {
  absences,
  handSplitRows,
  hitterLineupGames,
  people,
  platoonRecord,
  starterIds,
  teamGames,
  teamRotation,
} from '../supabase/functions/sync-pool/lineups.ts';

const NYY = 147;
const BOS = 111;

/** A regular-season game as `/schedule?hydrate=lineups,probablePitcher` lists it. */
function game(pk: number, date: string, homeLineup: number[], awayLineup: number[], homeSp: number, awaySp: number, state = 'Final') {
  return {
    gamePk: pk,
    gameType: 'R',
    officialDate: date,
    gameDate: `${date}T23:05:00Z`,
    status: { abstractGameState: state, detailedState: state },
    teams: {
      home: { team: { id: NYY }, probablePitcher: { id: homeSp, fullName: `P${homeSp}` } },
      away: { team: { id: BOS }, probablePitcher: { id: awaySp, fullName: `P${awaySp}` } },
    },
    lineups: homeLineup.length
      ? { homePlayers: homeLineup.map((id) => ({ id })), awayPlayers: awayLineup.map((id) => ({ id })) }
      : undefined,
  };
}

const lineup = (first: number) => Array.from({ length: 9 }, (_, i) => first + i);

describe('teamGames', () => {
  it("reads each finished game's lineup and both starters, from either side", () => {
    const data = {
      dates: [
        { games: [game(1, '2026-09-01', [...lineup(10)], [...lineup(30)], 500, 600)] },
        // Postponed: no lineup, not final.
        { games: [game(2, '2026-09-02', [], [], 501, 601, 'Preview')] },
        { games: [game(3, '2026-09-03', [11, 10, ...lineup(12).slice(0, 7)], lineup(30), 502, 602)] },
      ],
    };
    const yankees = teamGames(data, NYY);
    expect(yankees.map((g) => g.gamePk)).toEqual([1, 3]);
    expect(yankees[0]).toMatchObject({ date: '2026-09-01', ownStarterId: 500, oppStarterId: 600 });
    expect(yankees[1].lineup.slice(0, 2)).toEqual([11, 10]);
    const redSox = teamGames(data, BOS);
    expect(redSox[0]).toMatchObject({ lineup: lineup(30), ownStarterId: 600, oppStarterId: 500 });
    expect(starterIds(yankees).sort()).toEqual([500, 502, 600, 602]);
  });
});

describe('a hitter from lineups and people', () => {
  const persons = people({
    people: [
      { id: 600, fullName: 'Lefty', pitchHand: { code: 'L' }, batSide: { code: 'L' } },
      { id: 602, fullName: 'Righty', pitchHand: { code: 'R' }, batSide: { code: 'R' } },
      { id: 500, fullName: 'Ace', pitchHand: { code: 'R' }, batSide: { code: 'R' } },
      { id: 502, fullName: 'Two', pitchHand: { code: 'L' }, batSide: { code: 'L' } },
      { id: 10, fullName: 'Hitter', pitchHand: { code: 'R' }, batSide: { code: 'S' } },
    ],
  });
  const games = teamGames(
    {
      dates: [
        { games: [game(1, '2026-09-01', lineup(10), lineup(30), 500, 600)] },
        { games: [game(3, '2026-09-03', [11, ...lineup(12).slice(0, 8)], lineup(30), 502, 602)] },
      ],
    },
    NYY,
  );

  it('knows hands and sides', () => {
    expect(persons.get(600)).toEqual({ name: 'Lefty', pitchHand: 'L', batSide: 'L' });
    expect(persons.get(10)?.batSide).toBe('S');
  });

  it('lists his games by the opposing starter, and the rotation from his own', () => {
    expect(hitterLineupGames(games, 10, persons)).toEqual([
      { date: '2026-09-01', starterHand: 'L', spot: 1 },
      { date: '2026-09-03', starterHand: 'R', spot: null },
    ]);
    expect(hitterLineupGames(games, 11, persons).map((g) => g.spot)).toEqual([2, 1]);
    expect(teamRotation(games, persons).map((p) => [p.name, p.hand])).toEqual([
      ['Ace', 'R'],
      ['Two', 'L'],
    ]);
  });

  it('keeps his starts, weighted splits and lines against each hand', () => {
    const line = { g: 1, pa: 4, ab: 4, r: 0, h: 1, doubles: 0, triples: 0, hr: 1, rbi: 1, bb: 0, so: 1, hbp: 0, sf: 0, tb: 4 };
    const record = platoonRecord(hitterLineupGames(games, 10, persons), { L: line }, () => 150)!;
    expect(record.L).toMatchObject({ games: 1, starts: 1, line, opsPlus: 150 });
    expect(record.R).toMatchObject({ games: 1, starts: 0, line: null, opsPlus: null });
    expect(record.L.weighted.spots[0]).toBeGreaterThan(0);
    expect(platoonRecord([], {}, () => null)).toBeNull();
  });

  it('groups split rows by hand, a traded player keeping every row', () => {
    const rows = handSplitRows([
      { split: { code: 'vl' }, team: { id: 1 }, stat: {} },
      { split: { code: 'vl' }, team: { id: 2 }, stat: {} },
      { split: { code: 'vl' }, stat: {} },
      { split: { code: 'vr' }, stat: {} },
      { split: { code: 'b1' }, stat: {} },
    ]);
    expect(rows.L).toHaveLength(3);
    expect(rows.R).toHaveLength(1);
  });
});

describe('absences', () => {
  const DAY = 86_400_000;
  const t = (typeCode: string, day: string, description: string, extra: object = {}) => ({
    typeCode,
    date: day,
    effectiveDate: day,
    description,
    person: { id: 10 },
    ...extra,
  });

  it('keeps his stints on the injured list and in the minors, and leaves out other players', () => {
    const moves = [
      t('SC', '2026-05-01', 'New York Yankees placed CF X on the 10-day injured list retroactive to April 29, 2026.', { effectiveDate: '2026-04-29' }),
      t('SC', '2026-05-10', 'New York Yankees sent CF X on a rehab assignment to Scranton.'),
      t('SC', '2026-05-12', 'New York Yankees transferred CF X from the 10-day injured list to the 60-day injured list.'),
      t('SC', '2026-06-30', 'New York Yankees activated CF X from the 60-day injured list.'),
      t('OPT', '2026-07-05', 'New York Yankees optioned CF X to Scranton.'),
      t('CU', '2026-07-20', 'New York Yankees recalled CF X from Scranton.'),
      t('SC', '2026-09-20', 'New York Yankees placed CF X on the 10-day injured list.'),
      { ...t('SC', '2026-06-01', 'New York Yankees placed SS Y on the 10-day injured list.'), person: { id: 11 } },
    ];
    expect(absences(moves, 10, NYY)).toEqual([
      { from: '2026-04-29', to: '2026-06-30' },
      { from: '2026-07-05', to: '2026-07-20' },
      { from: '2026-09-20', to: null },
    ]);
  });

  it('counts him out from the start when his first move brings him back', () => {
    expect(absences([t('SC', '2026-05-15', 'New York Yankees activated RF X from the 60-day injured list.')], 10, NYY)).toEqual([
      { from: '0000-00-00', to: '2026-05-15' },
    ]);
    expect(absences([t('TR', '2026-07-30', 'Boston Red Sox traded RF X to New York Yankees.', { fromTeam: { id: BOS }, toTeam: { id: NYY } })], 10, NYY)).toEqual([
      { from: '0000-00-00', to: '2026-07-30' },
    ]);
    expect(absences([], 10, NYY)).toEqual([]);
  });

  it("leaves the games he couldn't play out of his lineup games, so they don't count as sitting", () => {
    const persons = people({ people: [{ id: 600, fullName: 'Righty', pitchHand: { code: 'R' } }] });
    // 20 team games; he starts the 10 he's healthy for and is hurt for the other 10.
    const data = {
      dates: Array.from({ length: 20 }, (_, i) => {
        const date = new Date(Date.parse('2026-08-01') + i * DAY).toISOString().slice(0, 10);
        return { games: [game(i + 1, date, i < 10 ? lineup(10) : lineup(20), lineup(30), 500, 600)] };
      }),
    };
    const list = teamGames(data, NYY);
    const hurt = absences([t('SC', '2026-08-11', 'New York Yankees placed CF X on the 10-day injured list.')], 10, NYY);
    expect(hitterLineupGames(list, 10, persons)).toHaveLength(20);
    const healthy = hitterLineupGames(list, 10, persons, hurt);
    expect(healthy).toHaveLength(10);
    expect(healthy.every((g) => g.spot === 1)).toBe(true);
    // Back in the lineup while the transactions say he's out: he was there.
    expect(hitterLineupGames(list, 10, persons, [{ from: '2026-08-05', to: null }])).toHaveLength(10);
  });
});

describe('scheduleProbables', () => {
  it("keeps each team's announced starter with his hand, for the games kept", () => {
    const data = {
      dates: [
        {
          games: [
            {
              gamePk: 9,
              gameType: 'F',
              gameDate: '2026-09-29T18:00:00Z',
              seriesGameNumber: 1,
              gamesInSeries: 3,
              status: { abstractGameState: 'Preview', detailedState: 'Scheduled' },
              teams: {
                home: { team: { id: NYY }, probablePitcher: { id: 608331, fullName: 'Max Fried', pitchHand: { code: 'L' } } },
                away: { team: { id: BOS } },
              },
            },
          ],
        },
      ],
    };
    const games = scheduleGames(data, 2026, new Set([NYY, BOS]));
    expect(scheduleProbables(data, games)).toEqual([
      { game_pk: 9, mlb_team_id: NYY, pitcher_id: 608331, pitcher_name: 'Max Fried', hand: 'L' },
    ]);
    expect(scheduleProbables(data, [])).toEqual([]);
  });
});
