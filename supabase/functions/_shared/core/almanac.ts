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
  playersByManager: Map<string, ManagerPlayer[]>;
}

/** A player's career bags for one manager, and the years they had him. */
export interface ManagerPlayer {
  playerId: PlayerId;
  tb: number;
  years: number[];
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
  const playersByManager = new Map<string, ManagerPlayer[]>();
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

/** One round both managers played: their bags, and who scored more. */
export interface RoundDuel {
  year: number;
  round: FantasyRound;
  a: number;
  b: number;
  /** 'a', 'b', or null for a tie. */
  winner: 'a' | 'b' | null;
}

/** Two managers compared. There are no direct matchups in the format, so they meet two ways. */
export interface HeadToHead {
  a: ManagerCareer;
  b: ManagerCareer;
  /** Seasons both played: who finished higher. */
  seasons: { year: number; a: TeamSeason; b: TeamSeason; winner: 'a' | 'b' | null }[];
  /** Rounds both were alive in: who scored more. */
  rounds: RoundDuel[];
  record: { seasons: { a: number; b: number }; rounds: { a: number; b: number; ties: number } };
  /** Players both have rostered, with the bags each got from them, the most combined first. */
  sharedPlayers: { playerId: PlayerId; a: number; b: number; aYears: number[]; bYears: number[] }[];
}

export function headToHead(al: Almanac, aKey: string, bKey: string): HeadToHead | null {
  const a = al.careers.find((c) => c.key === aKey);
  const b = al.careers.find((c) => c.key === bKey);
  if (!a || !b || aKey === bKey) return null;
  const pick = (x: number, y: number, lowerWins: boolean): 'a' | 'b' | null =>
    x === y ? null : (x < y) === lowerWins ? 'a' : 'b';

  const seasons: HeadToHead['seasons'] = [];
  const rounds: RoundDuel[] = [];
  for (const ta of al.teamSeasons.filter((t) => t.managerKey === aKey)) {
    const tb = al.teamSeasons.find((t) => t.managerKey === bKey && t.year === ta.year);
    if (!tb) continue;
    seasons.push({ year: ta.year, a: ta, b: tb, winner: pick(ta.place, tb.place, true) });
    for (const ra of ta.rounds) {
      const rb = tb.rounds.find((r) => r.round === ra.round);
      if (rb) rounds.push({ year: ta.year, round: ra.round, a: ra.tb, b: rb.tb, winner: pick(ra.tb, rb.tb, false) });
    }
  }
  seasons.sort((x, y) => x.year - y.year);
  rounds.sort((x, y) => x.year - y.year || x.round - y.round);

  const pa = al.playersByManager.get(aKey) ?? [];
  const pb = al.playersByManager.get(bKey) ?? [];
  const sharedPlayers = pa
    .flatMap((x) => {
      const y = pb.find((p) => p.playerId === x.playerId);
      return y ? [{ playerId: x.playerId, a: x.tb, b: y.tb, aYears: x.years, bYears: y.years }] : [];
    })
    .sort((x, y) => y.a + y.b - (x.a + x.b));

  const count = (list: { winner: 'a' | 'b' | null }[], w: 'a' | 'b' | null) => list.filter((x) => x.winner === w).length;
  return {
    a,
    b,
    seasons,
    rounds,
    record: {
      seasons: { a: count(seasons, 'a'), b: count(seasons, 'b') },
      rounds: { a: count(rounds, 'a'), b: count(rounds, 'b'), ties: count(rounds, null) },
    },
    sharedPlayers,
  };
}

/** A draft action, for the scouting stats. Draft 1 has only picks, in snake order. */
export interface AlmanacPick {
  seasonId: string;
  teamId: TeamId;
  draftNumber: number;
  /** 0-based order within its draft. */
  actionNumber: number;
  type: 'pick' | 'yield';
  add: PlayerId | null;
  drop: PlayerId | null;
}

/** What the scouting stats need beyond the Almanac's input. */
export interface ScoutingInput {
  picks: AlmanacPick[];
  /** Each rostered player's MLB team that year. */
  players: { seasonId: string; playerId: PlayerId; mlbTeamId: number }[];
  /** MLB teams that played each series type, by season. */
  seriesTeams: { seasonId: string; gameType: PlayerGameStat['gameType']; mlbTeamIds: number[] }[];
}

/**
 * How a manager plays the game, over every finished season. Null when there's nothing to measure
 * (e.g. never swapped a player).
 */
export interface ManagerScouting {
  key: string;
  seasons: number;
  /** Average bags from their round-1 picks in Draft 1. */
  firstRoundBags: number | null;
  /** Average bags from their round-3 and -4 picks in Draft 1. */
  lateRoundBags: number | null;
  /** Average bags per Draft 1 pick above what that pick number has produced across the league. */
  draftValue: number | null;
  /** Share of Draft 1 picks whose MLB team reached the Championship Series. */
  crystalBall: number | null;
  /** Redraft swaps per season. */
  swapsPerSeason: number;
  /** Share of swaps where the added player scored more for them than the dropped one did after. */
  swapWinRate: number | null;
  /** Share of their bags that came from home runs. */
  powerShare: number | null;
  /** Team on-base percentage. */
  obp: number | null;
  /** Average share of a season's bags from their best player that season. */
  topHeavy: number | null;
  /** Rounds 2 and 3: average bags above or below the round's average. */
  bigStage: number | null;
  /** Cuts made by 3 bags or fewer, and missed by 3 or fewer. */
  closeEscapes: number;
  heartbreaks: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function scouting(input: AlmanacInput, scout: ScoutingInput, al: Almanac): ManagerScouting[] {
  const complete = new Set(input.seasons.filter((s) => s.complete).map((s) => s.id));
  const teamById = new Map(input.teams.map((t) => [t.id, t]));
  const managerOf = (teamId: TeamId) => teamById.get(teamId)?.managerKey;

  // Stat lines that counted for a fantasy team: on its roster, and the team still alive.
  const spellsByKey = new Map<string, AlmanacSpell[]>();
  for (const s of input.spells) spellsByKey.set(`${s.seasonId}:${s.playerId}`, [...(spellsByKey.get(`${s.seasonId}:${s.playerId}`) ?? []), s]);
  const owned: (AlmanacStat & { teamId: TeamId })[] = [];
  for (const stat of input.stats) {
    if (!complete.has(stat.seasonId)) continue;
    const spell = spellsByKey.get(`${stat.seasonId}:${stat.playerId}`)?.find((s) => inSpell(s, stat.gameStart));
    const out = spell && teamById.get(spell.teamId)?.eliminatedAfterRound;
    if (spell && (out == null || out >= ROUND_FOR_GAME_TYPE[stat.gameType])) owned.push({ ...stat, teamId: spell.teamId });
  }
  const bagsFor = new Map<string, number>();
  for (const s of owned) bagsFor.set(`${s.teamId}:${s.playerId}`, (bagsFor.get(`${s.teamId}:${s.playerId}`) ?? 0) + s.tb);
  const bags = (teamId: TeamId, playerId: PlayerId) => bagsFor.get(`${teamId}:${playerId}`) ?? 0;

  const picks = scout.picks.filter((p) => complete.has(p.seasonId));
  const draft1 = picks.filter((p) => p.draftNumber === 1 && p.type === 'pick' && p.add !== null);
  const teamsInSeason = new Map<string, number>();
  for (const t of input.teams) teamsInSeason.set(t.seasonId, (teamsInSeason.get(t.seasonId) ?? 0) + 1);
  const snakeRound = (p: AlmanacPick) => Math.floor(p.actionNumber / (teamsInSeason.get(p.seasonId) ?? 1)) + 1;
  const bySlot = new Map<number, number[]>();
  for (const p of draft1) bySlot.set(p.actionNumber, [...(bySlot.get(p.actionNumber) ?? []), bags(p.teamId, p.add!)]);
  const slotAverage = new Map([...bySlot].map(([slot, v]) => [slot, mean(v)!]));

  const mlbTeam = new Map(scout.players.map((p) => [`${p.seasonId}:${p.playerId}`, p.mlbTeamId]));
  const lcsTeams = new Map(scout.seriesTeams.filter((s) => s.gameType === 'L').map((s) => [s.seasonId, new Set(s.mlbTeamIds)]));

  // Cut margins: each team's bags against the line it had to clear (or that beat it).
  const cutMargins: { managerKey: string; made: boolean; margin: number }[] = [];
  for (const year of new Set(al.teamSeasons.map((t) => t.year))) {
    for (const round of ROUNDS) {
      const inRound = al.teamSeasons.filter((t) => t.year === year && t.rounds.some((r) => r.round === round));
      const tb = (t: TeamSeason) => t.rounds.find((r) => r.round === round)!.tb;
      const through = inRound.filter((t) => t.place === 1 || t.rounds.some((r) => r.round === round + 1));
      const out = inRound.filter((t) => !through.includes(t));
      if (!through.length || !out.length) continue;
      const lastIn = Math.min(...through.map(tb));
      const firstOut = Math.max(...out.map(tb));
      for (const t of inRound) {
        const made = through.includes(t);
        cutMargins.push({ managerKey: t.managerKey, made, margin: made ? tb(t) - firstOut : lastIn - tb(t) });
      }
    }
  }

  return al.careers.map((c) => {
    const mine = (teamId: TeamId) => managerOf(teamId) === c.key;
    const d1 = draft1.filter((p) => mine(p.teamId));
    const seasons = al.teamSeasons.filter((t) => t.managerKey === c.key);
    const swaps = picks.filter((p) => p.draftNumber > 1 && p.type === 'pick' && p.drop !== null && mine(p.teamId));
    const lines = owned.filter((s) => mine(s.teamId));
    const tb = lines.reduce((sum, s) => sum + s.tb, 0);
    const onBase = lines.reduce((sum, s) => sum + s.h + s.bb + s.hbp, 0);
    const pa = lines.reduce((sum, s) => sum + s.ab + s.bb + s.hbp + s.sf, 0);
    return {
      key: c.key,
      seasons: c.seasons,
      firstRoundBags: mean(d1.filter((p) => snakeRound(p) === 1).map((p) => bags(p.teamId, p.add!))),
      lateRoundBags: mean(d1.filter((p) => snakeRound(p) >= 3).map((p) => bags(p.teamId, p.add!))),
      draftValue: mean(d1.map((p) => bags(p.teamId, p.add!) - slotAverage.get(p.actionNumber)!)),
      crystalBall: mean(d1.map((p) => (lcsTeams.get(p.seasonId)?.has(mlbTeam.get(`${p.seasonId}:${p.add}`) ?? -1) ? 1 : 0))),
      swapsPerSeason: swaps.length / Math.max(c.seasons, 1),
      swapWinRate: mean(
        al.redrafts
          .filter((m) => m.managerKey === c.key)
          .map((m) => (m.addedTb > m.droppedTb ? 1 : 0)),
      ),
      powerShare: tb ? lines.reduce((sum, s) => sum + 4 * s.hr, 0) / tb : null,
      obp: pa ? onBase / pa : null,
      topHeavy: mean(
        seasons.map((t) => {
          const byPlayer = new Map<PlayerId, number>();
          for (const s of lines.filter((l) => l.teamId === t.teamId)) byPlayer.set(s.playerId, (byPlayer.get(s.playerId) ?? 0) + s.tb);
          const total = [...byPlayer.values()].reduce((a, b) => a + b, 0);
          return total ? Math.max(...byPlayer.values()) / total : 0;
        }),
      ),
      bigStage: mean(seasons.flatMap((t) => t.rounds.filter((r) => r.round > 1).map((r) => r.tb - r.average))),
      closeEscapes: cutMargins.filter((m) => m.managerKey === c.key && m.made && m.margin <= 3).length,
      heartbreaks: cutMargins.filter((m) => m.managerKey === c.key && !m.made && m.margin <= 3).length,
    };
  });
}

export interface Badge {
  emoji: string;
  name: string;
  /** Why they earned it, e.g. "Most bags from round-1 picks". */
  reason: string;
}

const BADGES: { emoji: string; name: string; reason: string; value: (s: ManagerScouting) => number | null; lowest?: boolean }[] = [
  { emoji: '🎯', name: 'First-round ace', reason: 'Most bags from round-1 picks', value: (s) => s.firstRoundBags },
  { emoji: '🕵️', name: 'Late-round wizard', reason: 'Most bags from round-3 and -4 picks', value: (s) => s.lateRoundBags },
  { emoji: '🔮', name: 'Crystal ball', reason: 'Most Draft 1 picks on teams that reached the Championship Series', value: (s) => s.crystalBall },
  { emoji: '🔧', name: 'Tinkerer', reason: 'Most redraft swaps a season', value: (s) => s.swapsPerSeason },
  { emoji: '🧘', name: 'Set and forget', reason: 'Fewest redraft swaps a season', value: (s) => s.swapsPerSeason, lowest: true },
  { emoji: '✅', name: 'Swap master', reason: 'Best share of swaps that paid off', value: (s) => s.swapWinRate },
  { emoji: '💪', name: 'Long-ball lover', reason: 'Most bags from home runs', value: (s) => s.powerShare },
  { emoji: '👀', name: 'On-base machine', reason: 'Best team on-base percentage', value: (s) => s.obp },
  { emoji: '🌟', name: 'Stars and scrubs', reason: 'Most bags from one star', value: (s) => s.topHeavy },
  { emoji: '🧱', name: 'Deep roster', reason: 'Bags spread most evenly across the roster', value: (s) => s.topHeavy, lowest: true },
  { emoji: '🧊', name: 'The closer', reason: 'Best against the average in rounds 2 and 3', value: (s) => s.bigStage },
  { emoji: '😅', name: 'Escape artist', reason: 'Most cuts made by 3 bags or fewer', value: (s) => s.closeEscapes || null },
  { emoji: '💔', name: 'Heartbreak kid', reason: 'Most cuts missed by 3 bags or fewer', value: (s) => s.heartbreaks || null },
];

/** Each manager's badges: a stat where they lead the league (ties share it). Needs `minSeasons`. */
export function badges(all: ManagerScouting[], minSeasons = 3): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>(all.map((s) => [s.key, []]));
  const qualified = all.filter((s) => s.seasons >= minSeasons);
  for (const b of BADGES) {
    const scored = qualified.flatMap((s) => {
      const v = b.value(s);
      return v === null ? [] : [{ key: s.key, v }];
    });
    if (scored.length < 2) continue;
    const best = b.lowest ? Math.min(...scored.map((s) => s.v)) : Math.max(...scored.map((s) => s.v));
    for (const s of scored) if (s.v === best) out.get(s.key)!.push({ emoji: b.emoji, name: b.name, reason: b.reason });
  }
  return out;
}

/** Everything the Almanac pages show: the Almanac, names, scouting and badges. */
export interface AlmanacData {
  almanac: Almanac;
  /** Manager names by key. */
  managers: Map<string, string>;
  /** Player names by MLB id. */
  players: Map<number, string>;
  /** How each manager plays the game, and the badges they've earned. */
  scouting: ManagerScouting[];
  badges: Map<string, Badge[]>;
}

/** AlmanacData as JSON, which has no Maps: each Map is its entries. The almanac function sends it. */
export interface AlmanacJson {
  almanac: Omit<Almanac, 'playersByManager'> & { playersByManager: [string, ManagerPlayer[]][] };
  managers: [string, string][];
  players: [number, string][];
  scouting: ManagerScouting[];
  badges: [string, Badge[]][];
}

export function almanacToJson(d: AlmanacData): AlmanacJson {
  return {
    almanac: { ...d.almanac, playersByManager: [...d.almanac.playersByManager] },
    managers: [...d.managers],
    players: [...d.players],
    scouting: d.scouting,
    badges: [...d.badges],
  };
}

export function almanacFromJson(j: AlmanacJson): AlmanacData {
  return {
    almanac: { ...j.almanac, playersByManager: new Map(j.almanac.playersByManager) },
    managers: new Map(j.managers),
    players: new Map(j.players),
    scouting: j.scouting,
    badges: new Map(j.badges),
  };
}
