// The Almanac: the league's records across every finished season, and each manager's career.
// Built on the same scoring as the standings (teamRoundTotals, rankTeams), so the two can't
// disagree. Pure: the app loads the rows and calls almanac().

import { type PlayerGameStat, rankTeams, type RosterSpell, teamRoundTotals } from './scoring.ts';
import { type FantasyRound, type PlayerId, ROUND_FOR_GAME_TYPE, type TeamId } from './types.ts';

const ROUNDS: FantasyRound[] = [1, 2, 3];

export interface AlmanacSeason {
  id: string;
  year: number;
  /** Only finished seasons count toward the Almanac. */
  complete: boolean;
}

export interface AlmanacTeam {
  id: TeamId;
  seasonId: string;
  /** Who managed it: the same key every season (see AlmanacManager). */
  managerKey: string;
  /** Null for the champion. */
  eliminatedAfterRound: 1 | 2 | 3 | null;
}

export interface AlmanacManager {
  key: string;
  name: string;
}

export interface AlmanacSpell extends RosterSpell {
  seasonId: string;
}

export interface AlmanacStat extends PlayerGameStat {
  gamePk: number;
  seasonId: string;
  /** Game number within its series (WC2, DS4, ...). */
  seriesGameNumber: number | null;
}

/** A redraft pick: `add` joined the team and `drop` left it at `at`. */
export interface AlmanacRedraft {
  seasonId: string;
  teamId: TeamId;
  draftNumber: number;
  add: PlayerId;
  drop: PlayerId;
  at: string;
}

export interface AlmanacInput {
  seasons: AlmanacSeason[];
  teams: AlmanacTeam[];
  managers: AlmanacManager[];
  spells: AlmanacSpell[];
  stats: AlmanacStat[];
  redrafts: AlmanacRedraft[];
}

/** One team's season: where it finished and its bags in each round it played. */
export interface TeamSeason {
  teamId: TeamId;
  managerKey: string;
  year: number;
  /** 1 for the champion. Teams knocked out in the same round are placed by that round's ranking. */
  place: number;
  /** The rounds the team played, with its bags, rank, and the average of the teams in that round. */
  rounds: { round: FantasyRound; tb: number; rank: number; teams: number; average: number }[];
  bags: number;
}

export interface ManagerCareer {
  key: string;
  name: string;
  seasons: number;
  titles: number;
  runnerUps: number;
  bestFinish: number;
  averageFinish: number;
  /** Cuts made: a round-1 exit made none, a champion made all three. */
  roundsSurvived: number;
  roundsPlayed: number;
  bags: number;
  bagsPerRound: number;
}

export interface PlayerGameRecord {
  managerKey: string;
  year: number;
  playerId: PlayerId;
  tb: number;
  gameType: PlayerGameStat['gameType'];
  seriesGameNumber: number | null;
}

export interface PlayerSeasonRecord {
  managerKey: string;
  year: number;
  playerId: PlayerId;
  tb: number;
}

export interface RoundRecord {
  managerKey: string;
  year: number;
  round: FantasyRound;
  tb: number;
}

export interface CutRecord {
  year: number;
  round: FantasyRound;
  /** Last team through (the champion, in round 3) and first team out. */
  through: { managerKey: string; tb: number };
  out: { managerKey: string; tb: number };
  margin: number;
}

export interface RedraftMove {
  managerKey: string;
  year: number;
  draftNumber: number;
  add: PlayerId;
  drop: PlayerId;
  /** Bags the added player scored for the team, and the dropped one scored afterwards anyway. */
  addedTb: number;
  droppedTb: number;
}

export interface Almanac {
  /** Most recent first. */
  champions: { year: number; champion: TeamSeason; runnerUp: TeamSeason | null }[];
  /** Most titles first. */
  careers: ManagerCareer[];
  teamSeasons: TeamSeason[];
  bestRounds: Record<FantasyRound, RoundRecord[]>;
  bestPlayerGames: PlayerGameRecord[];
  bestPlayerSeasons: PlayerSeasonRecord[];
  closestCuts: CutRecord[];
  redrafts: RedraftMove[];
  /** Career bags by player for each manager, most first. */
  playersByManager: Map<string, { playerId: PlayerId; tb: number; years: number[] }[]>;
}

function inSpell(s: RosterSpell, start: string): boolean {
  const t = Date.parse(start);
  return Date.parse(s.from) <= t && (s.to === null || t < Date.parse(s.to));
}

const byDesc = <T>(f: (x: T) => number) => (a: T, b: T) => f(b) - f(a);

export function almanac(input: AlmanacInput, top = 10): Almanac {
  const seasons = input.seasons.filter((s) => s.complete).sort((a, b) => b.year - a.year);
  const managerName = new Map(input.managers.map((m) => [m.key, m.name]));
  const teamById = new Map(input.teams.map((t) => [t.id, t]));

  const teamSeasons: TeamSeason[] = [];
  const bestRounds: Record<FantasyRound, RoundRecord[]> = { 1: [], 2: [], 3: [] };
  const closestCuts: CutRecord[] = [];
  const owned: (AlmanacStat & { teamId: TeamId })[] = [];

  for (const season of seasons) {
    const teams = input.teams.filter((t) => t.seasonId === season.id);
    const spells = input.spells.filter((s) => s.seasonId === season.id);
    const stats = input.stats.filter((s) => s.seasonId === season.id);

    // Which fantasy team each stat line counted for, if any: the player was on its roster and the
    // team was still alive in that game's round.
    const spellsByPlayer = new Map<PlayerId, AlmanacSpell[]>();
    for (const s of spells) spellsByPlayer.set(s.playerId, [...(spellsByPlayer.get(s.playerId) ?? []), s]);
    for (const stat of stats) {
      const spell = spellsByPlayer.get(stat.playerId)?.find((s) => inSpell(s, stat.gameStart));
      const out = spell && teamById.get(spell.teamId)?.eliminatedAfterRound;
      if (spell && (out == null || out >= ROUND_FOR_GAME_TYPE[stat.gameType])) owned.push({ ...stat, teamId: spell.teamId });
    }

    const rounds = new Map<TeamId, TeamSeason['rounds']>(teams.map((t) => [t.id, []]));
    const rankIn = new Map<string, number>();
    for (const round of ROUNDS) {
      const alive = teams.filter((t) => t.eliminatedAfterRound === null || t.eliminatedAfterRound >= round);
      if (!alive.length) continue;
      const ranked = rankTeams(teamRoundTotals(round, alive.map((t) => t.id), spells, stats));
      const average = ranked.reduce((sum, t) => sum + t.tb, 0) / ranked.length;
      for (const r of ranked) {
        rounds.get(r.teamId)!.push({ round, tb: r.tb, rank: r.rank, teams: ranked.length, average });
        rankIn.set(`${r.teamId}:${round}`, r.rank);
        bestRounds[round].push({ managerKey: teamById.get(r.teamId)!.managerKey, year: season.year, round, tb: r.tb });
      }
      // The cut: last team through against first team out (in round 3, champion against runner-up).
      const through = alive.filter((t) => t.eliminatedAfterRound === null || t.eliminatedAfterRound > round);
      const out = alive.filter((t) => t.eliminatedAfterRound === round);
      const tbOf = (id: TeamId) => ranked.find((r) => r.teamId === id)!.tb;
      const lastThrough = [...through].sort((a, b) => tbOf(a.id) - tbOf(b.id))[0];
      const firstOut = [...out].sort((a, b) => tbOf(b.id) - tbOf(a.id))[0];
      if (lastThrough && firstOut) {
        closestCuts.push({
          year: season.year,
          round,
          through: { managerKey: lastThrough.managerKey, tb: tbOf(lastThrough.id) },
          out: { managerKey: firstOut.managerKey, tb: tbOf(firstOut.id) },
          margin: tbOf(lastThrough.id) - tbOf(firstOut.id),
        });
      }
    }

    // Final places: later exits first; teams out in the same round by that round's rank.
    const exit = (t: AlmanacTeam) => t.eliminatedAfterRound ?? 4;
    const order = (t: AlmanacTeam) => [-exit(t), rankIn.get(`${t.id}:${Math.min(exit(t), 3)}`) ?? 99];
    const better = (a: AlmanacTeam, b: AlmanacTeam) => {
      const [x, y] = [order(a), order(b)];
      return x[0] - y[0] || x[1] - y[1];
    };
    for (const t of teams) {
      const r = rounds.get(t.id)!;
      teamSeasons.push({
        teamId: t.id,
        managerKey: t.managerKey,
        year: season.year,
        place: 1 + teams.filter((o) => better(o, t) < 0).length,
        rounds: r,
        bags: r.reduce((sum, x) => sum + x.tb, 0),
      });
    }
  }

  const champions = seasons.flatMap((s) => {
    const inSeason = teamSeasons.filter((t) => t.year === s.year).sort((a, b) => a.place - b.place);
    const champion = inSeason.find((t) => teamById.get(t.teamId)!.eliminatedAfterRound === null);
    return champion ? [{ year: s.year, champion, runnerUp: inSeason.find((t) => t !== champion && t.place === 2) ?? null }] : [];
  });

  const careers: ManagerCareer[] = [...new Set(teamSeasons.map((t) => t.managerKey))].map((key) => {
    const mine = teamSeasons.filter((t) => t.managerKey === key);
    const roundsPlayed = mine.reduce((sum, t) => sum + t.rounds.length, 0);
    const bags = mine.reduce((sum, t) => sum + t.bags, 0);
    return {
      key,
      name: managerName.get(key) ?? key,
      seasons: mine.length,
      titles: mine.filter((t) => t.place === 1).length,
      runnerUps: mine.filter((t) => t.place === 2).length,
      bestFinish: Math.min(...mine.map((t) => t.place)),
      averageFinish: mine.reduce((sum, t) => sum + t.place, 0) / mine.length,
      roundsSurvived: mine.reduce((sum, t) => sum + (t.place === 1 ? 3 : t.rounds.length - 1), 0),
      roundsPlayed,
      bags,
      bagsPerRound: roundsPlayed ? bags / roundsPlayed : 0,
    };
  });
  careers.sort((a, b) => b.titles - a.titles || a.averageFinish - b.averageFinish || b.bags - a.bags);

  const yearOf = new Map(input.seasons.map((s) => [s.id, s.year]));
  const managerOf = (teamId: TeamId) => teamById.get(teamId)!.managerKey;
  const bestPlayerGames = owned
    .filter((s) => s.tb > 0)
    .sort(byDesc((s) => s.tb))
    .slice(0, top)
    .map((s) => ({
      managerKey: managerOf(s.teamId),
      year: yearOf.get(s.seasonId)!,
      playerId: s.playerId,
      tb: s.tb,
      gameType: s.gameType,
      seriesGameNumber: s.seriesGameNumber,
    }));

  // A player's bags for one team in one season, and for one manager across seasons.
  const playerSeason = new Map<string, PlayerSeasonRecord>();
  for (const s of owned) {
    const k = `${s.teamId}:${s.playerId}`;
    const rec = playerSeason.get(k) ?? { managerKey: managerOf(s.teamId), year: yearOf.get(s.seasonId)!, playerId: s.playerId, tb: 0 };
    rec.tb += s.tb;
    playerSeason.set(k, rec);
  }
  const bestPlayerSeasons = [...playerSeason.values()].sort(byDesc((r) => r.tb)).slice(0, top);
  const playersByManager = new Map<string, { playerId: PlayerId; tb: number; years: number[] }[]>();
  for (const rec of playerSeason.values()) {
    const list = playersByManager.get(rec.managerKey) ?? [];
    const found = list.find((p) => p.playerId === rec.playerId);
    if (found) {
      found.tb += rec.tb;
      found.years.push(rec.year);
    } else {
      list.push({ playerId: rec.playerId, tb: rec.tb, years: [rec.year] });
    }
    playersByManager.set(rec.managerKey, list);
  }
  for (const list of playersByManager.values()) {
    list.sort(byDesc((p) => p.tb));
    for (const p of list) p.years.sort();
  }

  const complete = new Set(seasons.map((s) => s.id));
  const redrafts = input.redrafts
    .filter((r) => complete.has(r.seasonId))
    .map((r) => ({
      managerKey: managerOf(r.teamId),
      year: yearOf.get(r.seasonId)!,
      draftNumber: r.draftNumber,
      add: r.add,
      drop: r.drop,
      addedTb: owned
        .filter((s) => s.teamId === r.teamId && s.playerId === r.add)
        .reduce((sum, s) => sum + s.tb, 0),
      droppedTb: input.stats
        .filter((s) => s.seasonId === r.seasonId && s.playerId === r.drop && Date.parse(s.gameStart) >= Date.parse(r.at))
        .reduce((sum, s) => sum + s.tb, 0),
    }));

  for (const round of ROUNDS) bestRounds[round] = bestRounds[round].sort(byDesc((r) => r.tb)).slice(0, top);
  return {
    champions,
    careers,
    teamSeasons,
    bestRounds,
    bestPlayerGames,
    bestPlayerSeasons,
    closestCuts: closestCuts.sort((a, b) => a.margin - b.margin || b.year - a.year).slice(0, top),
    redrafts,
    playersByManager,
  };
}
