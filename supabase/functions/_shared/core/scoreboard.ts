// Total bases per game, laid out like the league's old scoring sheets: one column per game of a
// series (WC1, WC2, DS1, ...), one row per fantasy team (standings) or per player (team view).

import { compareTeams, emptyTotals, type RosterSpell, STAT_KEYS, type StatLine } from './scoring.ts';
import { type FantasyRound, type GameType, type PlayerId, ROUND_FOR_GAME_TYPE, type TeamId } from './types.ts';

export interface ScoreGame {
  gamePk: number;
  gameType: GameType;
  /** Game number within its series (1 = game 1). */
  seriesGameNumber: number;
  /** ISO timestamp of the scheduled first pitch. */
  start: string;
  /** MLB abstractGameState: Preview | Live | Final. */
  status: string;
  homeTeamId: number;
  awayTeamId: number;
}

/**
 * A player's line in one game. Standings need TB; the rest is for tiebreakers (SLG, OBP, HR, R,
 * RBI) and counts as 0 when missing.
 */
export interface ScoreStat extends Partial<Omit<StatLine, 'tb'>> {
  gamePk: number;
  playerId: PlayerId;
  tb: number;
}

/** Series in play order, with the most games each can go. */
export const SERIES: { gameType: GameType; label: string; name: string; games: number }[] = [
  { gameType: 'F', label: 'WC', name: 'Wild Card', games: 3 },
  { gameType: 'D', label: 'DS', name: 'Division Series', games: 5 },
  { gameType: 'L', label: 'CS', name: 'Championship Series', games: 7 },
  { gameType: 'W', label: 'WS', name: 'World Series', games: 7 },
];

export interface ScoreColumn {
  gameType: GameType;
  /** 1-based game number in the series. */
  number: number;
  /** "WC1", "DS3", ... */
  label: string;
  /** Some game with this number has started (so blanks become zeros). */
  started: boolean;
  /** Some game with this number is being played right now. */
  live: boolean;
}

export function roundSeries(round: FantasyRound) {
  return SERIES.filter((s) => ROUND_FOR_GAME_TYPE[s.gameType] === round);
}

const hasStarted = (g: ScoreGame) => g.status === 'Live' || g.status === 'Final';

/** One column per possible game of each series in the round. */
export function roundColumns(round: FantasyRound, games: ScoreGame[]): ScoreColumn[] {
  return roundSeries(round).flatMap((s) =>
    Array.from({ length: s.games }, (_, i) => {
      const same = games.filter((g) => g.gameType === s.gameType && g.seriesGameNumber === i + 1);
      return {
        gameType: s.gameType,
        number: i + 1,
        label: `${s.label}${i + 1}`,
        started: same.some(hasStarted),
        live: same.some((g) => g.status === 'Live'),
      };
    }),
  );
}

const columnKey = (gameType: GameType, number: number) => `${gameType}${number}`;

/** The team whose roster had the player when the game started, if any. */
function ownerAt(spells: RosterSpell[], playerId: PlayerId, start: string): TeamId | undefined {
  const t = Date.parse(start);
  return spells.find(
    (s) => s.playerId === playerId && Date.parse(s.from) <= t && (s.to === null || t < Date.parse(s.to)),
  )?.teamId;
}

export interface StandingRow {
  teamId: TeamId;
  /** TB by column key ("F1", "D3", ...); null until a game with that number starts. */
  cells: Map<string, number | null>;
  total: number;
  /** The team's whole line for the round, for the tiebreakers. */
  totals: StatLine;
  /** 1-based, by the rules' ranking (TB, then SLG, OBP, HR, R, RBI); only full ties share one. */
  rank: number;
}

/** Each team's TB per game of the round, ranked by the round total (TB only for now). */
export function roundStandings(
  round: FantasyRound,
  teamIds: TeamId[],
  games: ScoreGame[],
  stats: ScoreStat[],
  spells: RosterSpell[],
): StandingRow[] {
  const columns = roundColumns(round, games);
  const gamesByPk = new Map(games.map((g) => [g.gamePk, g]));
  const rows = new Map<TeamId, StandingRow>(
    teamIds.map((id) => [
      id,
      {
        teamId: id,
        cells: new Map(columns.map((c) => [columnKey(c.gameType, c.number), c.started ? 0 : null])),
        total: 0,
        totals: emptyTotals(id),
        rank: 0,
      },
    ]),
  );
  for (const stat of stats) {
    const game = gamesByPk.get(stat.gamePk);
    if (!game || ROUND_FOR_GAME_TYPE[game.gameType] !== round) continue;
    const teamId = ownerAt(spells, stat.playerId, game.start);
    const row = teamId && rows.get(teamId);
    if (!row) continue;
    const key = columnKey(game.gameType, game.seriesGameNumber);
    row.cells.set(key, (row.cells.get(key) ?? 0) + stat.tb);
    row.total += stat.tb;
    for (const k of STAT_KEYS) row.totals[k] += stat[k] ?? 0;
  }
  const sorted = [...rows.values()].sort((a, b) => compareTeams(a.totals, b.totals));
  sorted.forEach((r, i) => {
    r.rank = i > 0 && compareTeams(sorted[i - 1].totals, r.totals) === 0 ? sorted[i - 1].rank : i + 1;
  });
  return sorted;
}

export interface PlayerSeriesRow {
  playerId: PlayerId;
  /** TB by game number: a number when his MLB team played that game while he was on the
   *  fantasy team, null otherwise (not played yet, his team didn't play, or not on the roster). */
  games: (number | null)[];
  total: number;
}

export interface SeriesBlock {
  gameType: GameType;
  label: string;
  name: string;
  columns: ScoreColumn[];
  players: PlayerSeriesRow[];
  /** Team TB by game number; null until that game number starts. */
  teamGames: (number | null)[];
  total: number;
}

/**
 * One fantasy team's TB by player and game, a block per series. A block lists everyone who was
 * on the team during that series (dropped players keep what they earned), or the current
 * roster for a series that hasn't started.
 */
export function teamSeriesBlocks(
  teamId: TeamId,
  games: ScoreGame[],
  stats: ScoreStat[],
  spells: RosterSpell[],
  /** Each player's MLB team, to tell "his team didn't play" from "went hitless". */
  mlbTeamOf: (playerId: PlayerId) => number | undefined,
): SeriesBlock[] {
  const teamSpells = spells.filter((s) => s.teamId === teamId);
  const tbByGamePlayer = new Map(stats.map((s) => [`${s.gamePk}:${s.playerId}`, s.tb]));
  const blocks: SeriesBlock[] = [];
  for (const series of SERIES) {
    const round = ROUND_FOR_GAME_TYPE[series.gameType];
    const columns = roundColumns(round, games).filter((c) => c.gameType === series.gameType);
    const seriesGames = games.filter((g) => g.gameType === series.gameType);
    const started = seriesGames.filter(hasStarted);
    const times = seriesGames.map((g) => Date.parse(g.start));
    const first = Math.min(...times);
    const last = Math.max(...times);
    // Everyone on the roster at some point during the series; the current roster before it.
    const onTeam = teamSpells.filter((s) =>
      seriesGames.length ? Date.parse(s.from) <= last && (s.to === null || Date.parse(s.to) > first) : s.to === null,
    );
    const playerIds = [...new Set(onTeam.map((s) => s.playerId))];

    const players = playerIds.map((playerId): PlayerSeriesRow => {
      const mlbTeam = mlbTeamOf(playerId);
      const row = columns.map((c) => {
        const game = started.find(
          (g) => g.seriesGameNumber === c.number && (g.homeTeamId === mlbTeam || g.awayTeamId === mlbTeam),
        );
        if (!game || ownerAt(teamSpells, playerId, game.start) !== teamId) return null;
        return tbByGamePlayer.get(`${game.gamePk}:${playerId}`) ?? 0;
      });
      return { playerId, games: row, total: row.reduce<number>((a, b) => a + (b ?? 0), 0) };
    });
    const teamGames = columns.map((c, i) =>
      c.started ? players.reduce((sum, p) => sum + (p.games[i] ?? 0), 0) : null,
    );
    blocks.push({
      gameType: series.gameType,
      label: series.label,
      name: series.name,
      columns,
      players,
      teamGames,
      total: players.reduce((a, p) => a + p.total, 0),
    });
  }
  return blocks;
}

/** A team's TB for each fantasy round, from its series blocks. */
export function roundTotals(blocks: SeriesBlock[]): Record<FantasyRound, number> {
  const totals: Record<FantasyRound, number> = { 1: 0, 2: 0, 3: 0 };
  for (const b of blocks) totals[ROUND_FOR_GAME_TYPE[b.gameType]] += b.total;
  return totals;
}

/** The round being played: the latest one with a game that has started (round 1 before any). */
export function currentRound(games: ScoreGame[]): FantasyRound {
  let round: FantasyRound = 1;
  for (const g of games) if (hasStarted(g) && ROUND_FOR_GAME_TYPE[g.gameType] > round) round = ROUND_FOR_GAME_TYPE[g.gameType];
  return round;
}

/** A game with what's needed to tell whether its series has a winner. */
export interface SeriesGame extends Pick<ScoreGame, 'gameType' | 'homeTeamId' | 'awayTeamId' | 'status'> {
  homeScore: number | null;
  awayScore: number | null;
  /** Most games the series can go (3, 5, 7; 1 for 2021's one-game Wild Card). */
  gamesInSeries: number | null;
}

/** The MLB round that ends each fantasy round, and how many series it has. */
const LAST_SERIES: Record<FantasyRound, { gameType: GameType; count: number }> = {
  1: { gameType: 'D', count: 4 },
  2: { gameType: 'L', count: 2 },
  3: { gameType: 'W', count: 1 },
};
const DEFAULT_LENGTH: Record<GameType, number> = { F: 3, D: 5, L: 7, W: 7 };

/**
 * Whether every MLB series in a fantasy round has a winner: someone has won enough games (2 of
 * 3, 3 of 5, 4 of 7), and the round's last series type is all there (4 Division Series, 2
 * Championship Series, the World Series), so an unset bracket doesn't look finished. Leftover
 * "if necessary" games on the schedule don't matter.
 */
export function roundDecided(round: FantasyRound, games: SeriesGame[]): boolean {
  const types = roundSeries(round).map((s) => s.gameType);
  const inRound = games.filter((g) => types.includes(g.gameType));
  if (inRound.some((g) => g.status === 'Live')) return false;
  const series = new Map<string, SeriesGame[]>();
  for (const g of inRound) {
    const key = `${g.gameType}:${[g.homeTeamId, g.awayTeamId].sort((a, b) => a - b).join('-')}`;
    series.set(key, [...(series.get(key) ?? []), g]);
  }
  const decided = [...series.values()].every((list) => {
    const needed = Math.ceil((list.find((g) => g.gamesInSeries)?.gamesInSeries ?? DEFAULT_LENGTH[list[0].gameType]) / 2);
    const wins = new Map<number, number>();
    for (const g of list) {
      if (g.status !== 'Final' || g.homeScore === null || g.awayScore === null || g.homeScore === g.awayScore) continue;
      const winner = g.homeScore > g.awayScore ? g.homeTeamId : g.awayTeamId;
      wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }
    return Math.max(0, ...wins.values()) >= needed;
  });
  const last = LAST_SERIES[round];
  const lastCount = [...series.keys()].filter((k) => k.startsWith(`${last.gameType}:`)).length;
  return decided && lastCount >= last.count;
}
