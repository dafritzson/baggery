// Turns MLB Stats API responses into rows for mlb_games and player_game_stats. Pure, so the
// unit tests can run it on sample responses.

import type { Linescore, LineupPlayer, PitcherStats } from '../_shared/core/box-score.ts';
import type { LastPlay, LivePlayer, LiveState } from '../_shared/core/live.ts';

export type GameType = 'F' | 'D' | 'L' | 'W';
const GAME_TYPES = new Set<string>(['F', 'D', 'L', 'W']);

export interface GameRow {
  game_pk: number;
  season_year: number;
  game_type: GameType;
  start_time: string;
  /** No start time set yet; start_time is MLB's 3:33 AM ET placeholder. */
  start_time_tbd: boolean;
  /** The game's date (YYYY-MM-DD) as MLB lists it, whatever the start time. */
  official_date: string | null;
  /** MLB abstractGameState: Preview | Live | Final. */
  status: string;
  detailed_state: string | null;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  series_game_number: number | null;
  games_in_series: number | null;
  /** "Truist Park · Atlanta", for the Games tab's cards of games to come. */
  venue: string | null;
}

export interface BattingRow {
  game_pk: number;
  mlb_player_id: number;
  mlb_team_id: number;
  /** Plate appearances. */
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  bb: number;
  hbp: number;
  sf: number;
  tb: number;
  r: number;
  rbi: number;
  so: number;
  /** His spot and who took it: "300" batted third, 301 replaced him. Null if he wasn't in the order. */
  batting_order: number | null;
  /** The positions he played, as a box score lists them: "PH-3B". */
  position: string | null;
}

/**
 * Postseason games from `/schedule?gameType=F,D,L,W`. A postponed game is listed on both its
 * original and its new date under one gamePk; the listing that isn't "Postponed" wins. Games
 * whose teams aren't known yet (bracket not set) are skipped.
 */
// deno-lint-ignore no-explicit-any
export function scheduleGames(data: any, year: number, knownTeamIds: Set<number>): GameRow[] {
  const games = new Map<number, GameRow>();
  // deno-lint-ignore no-explicit-any
  for (const g of (data?.dates ?? []).flatMap((d: any) => d.games ?? [])) {
    if (!GAME_TYPES.has(g.gameType)) continue;
    const home = g.teams?.home;
    const away = g.teams?.away;
    if (!knownTeamIds.has(home?.team?.id) || !knownTeamIds.has(away?.team?.id)) continue;
    const row: GameRow = {
      game_pk: g.gamePk,
      season_year: year,
      game_type: g.gameType,
      start_time: g.gameDate,
      start_time_tbd: g.status?.startTimeTBD === true,
      official_date: g.officialDate ?? null,
      status: g.status?.abstractGameState ?? 'Preview',
      detailed_state: g.status?.detailedState ?? null,
      home_team_id: home.team.id,
      away_team_id: away.team.id,
      home_score: home.score ?? null,
      away_score: away.score ?? null,
      series_game_number: g.seriesGameNumber ?? null,
      games_in_series: g.gamesInSeries ?? null,
      venue: venueLabel(g.venue),
    };
    const seen = games.get(row.game_pk);
    if (!seen || seen.detailed_state === 'Postponed') games.set(row.game_pk, row);
  }
  return [...games.values()];
}

/**
 * A ballpark and its city from the schedule's `hydrate=venue(location)`: "Truist Park · Atlanta",
 * or the park alone if MLB leaves out the city or the name already has it.
 */
// deno-lint-ignore no-explicit-any
export function venueLabel(venue: any): string | null {
  const name: string | undefined = venue?.name;
  if (!name) return null;
  const city: string | undefined = venue.location?.city;
  return city && !name.includes(city) ? `${name} · ${city}` : name;
}

/**
 * His season line from `/people/{id}/stats?stats=season&group=pitching`: a traded pitcher has a
 * line per team plus a combined one without a team, which is the one wanted.
 */
// deno-lint-ignore no-explicit-any
function seasonLine(data: any): any | null {
  // deno-lint-ignore no-explicit-any
  const rows: any[] = data?.stats?.find((s: any) => s.type?.displayName === 'season')?.splits ?? [];
  return (rows.length === 1 ? rows[0] : rows.find((r) => !r.team))?.stat ?? null;
}

/** A starter's numbers from his regular-season (gameType=R) and postseason (gameType=P) lines. */
// deno-lint-ignore no-explicit-any
export function pitcherStats(regular: any, postseason: any): PitcherStats {
  const season = seasonLine(regular);
  const post = seasonLine(postseason);
  return {
    era: season?.era ?? null,
    post: post
      ? { w: post.wins ?? 0, l: post.losses ?? 0, era: post.era ?? '-.--', ip: post.inningsPitched ?? '0.0', k: post.strikeOuts ?? 0 }
      : null,
  };
}

export interface ProbableRow {
  game_pk: number;
  mlb_team_id: number;
  pitcher_id: number;
  pitcher_name: string;
  hand: 'L' | 'R' | null;
}

/**
 * Each team's announced starter in the games scheduleGames keeps, from the same schedule read with
 * `hydrate=probablePitcher,person` (the person part brings the hand). After a game, MLB keeps the
 * one who started.
 */
// deno-lint-ignore no-explicit-any
export function scheduleProbables(data: any, games: GameRow[]): ProbableRow[] {
  const kept = new Set(games.map((g) => g.game_pk));
  const rows = new Map<string, ProbableRow>();
  // deno-lint-ignore no-explicit-any
  for (const g of (data?.dates ?? []).flatMap((d: any) => d.games ?? [])) {
    if (!kept.has(g.gamePk) || g.status?.detailedState === 'Postponed') continue;
    for (const side of ['home', 'away'] as const) {
      const team = g.teams?.[side];
      const p = team?.probablePitcher;
      if (!team?.team?.id || !p?.id) continue;
      const hand = p.pitchHand?.code;
      rows.set(`${g.gamePk}:${team.team.id}`, {
        game_pk: g.gamePk,
        mlb_team_id: team.team.id,
        pitcher_id: p.id,
        pitcher_name: p.fullName ?? `Pitcher ${p.id}`,
        hand: hand === 'L' || hand === 'R' ? hand : null,
      });
    }
  }
  return [...rows.values()];
}

/** A team's posted starting lineup for a game: player ids, leadoff first. */
export interface LineupRow {
  game_pk: number;
  mlb_team_id: number;
  player_ids: number[];
  /** The same hitters with their names and positions, for the box score's lineups. */
  players: LineupPlayer[];
}


/**
 * The starting lineups posted for the games scheduleGames keeps, from the same schedule read with
 * `hydrate=lineups`. A team's is missing until it's posted (usually 2–4 hours before first pitch).
 */
// deno-lint-ignore no-explicit-any
export function scheduleLineups(data: any, games: GameRow[]): LineupRow[] {
  const kept = new Set(games.map((g) => g.game_pk));
  const rows = new Map<string, LineupRow>();
  // deno-lint-ignore no-explicit-any
  for (const g of (data?.dates ?? []).flatMap((d: any) => d.games ?? [])) {
    if (!kept.has(g.gamePk) || g.status?.detailedState === 'Postponed') continue;
    for (const side of ['home', 'away'] as const) {
      const teamId: number | undefined = g.teams?.[side]?.team?.id;
      // deno-lint-ignore no-explicit-any
      const players: LineupPlayer[] = (g.lineups?.[`${side}Players`] ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((p: any) => p?.id)
        // deno-lint-ignore no-explicit-any
        .map((p: any) => ({ id: p.id, name: p.fullName ?? `Player ${p.id}`, pos: p.primaryPosition?.abbreviation ?? null }));
      if (!teamId || !players.length) continue;
      rows.set(`${g.gamePk}:${teamId}`, { game_pk: g.gamePk, mlb_team_id: teamId, player_ids: players.map((p) => p.id), players });
    }
  }
  return [...rows.values()];
}

/** Every player who batted in a game, from `/game/{gamePk}/boxscore`. */
// deno-lint-ignore no-explicit-any
export function boxscoreBatting(gamePk: number, data: any): { rows: BattingRow[]; players: { id: number; full_name: string }[] } {
  const rows: BattingRow[] = [];
  const players: { id: number; full_name: string }[] = [];
  for (const side of ['away', 'home'] as const) {
    const team = data?.teams?.[side];
    const teamId: number | undefined = team?.team?.id;
    if (!teamId) continue;
    // deno-lint-ignore no-explicit-any
    for (const p of Object.values(team.players ?? {}) as any[]) {
      const b = p?.stats?.batting;
      // Pitchers and bench players who didn't bat have an empty batting object.
      if (!p?.person?.id || !b || Object.keys(b).length === 0) continue;
      players.push({ id: p.person.id, full_name: p.person.fullName ?? `Player ${p.person.id}` });
      rows.push({
        game_pk: gamePk,
        mlb_player_id: p.person.id,
        mlb_team_id: teamId,
        pa: b.plateAppearances ?? 0,
        ab: b.atBats ?? 0,
        h: b.hits ?? 0,
        doubles: b.doubles ?? 0,
        triples: b.triples ?? 0,
        hr: b.homeRuns ?? 0,
        bb: b.baseOnBalls ?? 0,
        hbp: b.hitByPitch ?? 0,
        sf: b.sacFlies ?? 0,
        tb: b.totalBases ?? 0,
        r: b.runs ?? 0,
        rbi: b.rbi ?? 0,
        so: b.strikeOuts ?? 0,
        batting_order: battingOrder(p),
        // deno-lint-ignore no-explicit-any
        position: (p.allPositions ?? []).map((pos: any) => pos?.abbreviation).filter(Boolean).join('-') || p.position?.abbreviation || null,
      });
    }
  }
  return { rows, players };
}

// deno-lint-ignore no-explicit-any
function battingOrder(p: any): number | null {
  const order = Number(p?.battingOrder);
  return Number.isInteger(order) && order >= 100 ? order : null;
}

/** A lineup change for sub alerts: a player who came off the bench, or one who was replaced. */
export interface LineupChange {
  mlb_player_id: number;
  full_name: string;
  kind: 'in' | 'out';
  /** 'in': the position he came in at (PH, PR, SS, ...). 'out': his replacement's. */
  position: string | null;
  /** 'out': who replaced him. */
  replacement: string | null;
}

/**
 * The lineup changes so far in a box score. Each player in the game has a `battingOrder` like
 * "300": the hundreds are his lineup spot, and the rest counts who took it (300 started there, 301
 * replaced him, 302 replaced 301). So anyone not at 00 came off the bench, and anyone with a
 * higher number in his spot was replaced.
 */
// deno-lint-ignore no-explicit-any
export function boxscoreSubs(data: any): LineupChange[] {
  const changes: LineupChange[] = [];
  for (const side of ['away', 'home'] as const) {
    const spots = new Map<number, { order: number; id: number; name: string; position: string | null }[]>();
    // deno-lint-ignore no-explicit-any
    for (const p of Object.values(data?.teams?.[side]?.players ?? {}) as any[]) {
      const order = Number(p?.battingOrder);
      if (!p?.person?.id || !Number.isInteger(order) || order < 100) continue;
      const spot = Math.floor(order / 100);
      spots.set(spot, [
        ...(spots.get(spot) ?? []),
        {
          order,
          id: p.person.id,
          name: p.person.fullName ?? `Player ${p.person.id}`,
          // The first position he played is how he came in (PH, then 1B, say).
          position: p.allPositions?.[0]?.abbreviation ?? p.position?.abbreviation ?? null,
        },
      ]);
    }
    for (const players of spots.values()) {
      players.sort((a, b) => a.order - b.order);
      players.forEach((p, i) => {
        if (p.order % 100 !== 0) {
          changes.push({ mlb_player_id: p.id, full_name: p.name, kind: 'in', position: p.position, replacement: null });
        }
        const next = players[i + 1];
        if (next) {
          changes.push({ mlb_player_id: p.id, full_name: p.name, kind: 'out', position: next.position, replacement: next.name });
        }
      });
    }
  }
  return changes;
}

// deno-lint-ignore no-explicit-any
function livePlayer(p: any): LivePlayer | null {
  return p?.id ? { id: p.id, name: p.fullName ?? `Player ${p.id}` } : null;
}

/** The runs so far from `/game/{gamePk}/linescore`, or null before the game has any. */
// deno-lint-ignore no-explicit-any
export function linescoreRuns(data: any): { home: number; away: number } | null {
  const home = data?.teams?.home?.runs;
  const away = data?.teams?.away?.runs;
  return typeof home === 'number' && typeof away === 'number' ? { home, away } : null;
}

/**
 * The line score for the box score, from `/game/{gamePk}/linescore`: runs by inning and each
 * team's runs, hits and errors. Null before the game has an inning.
 */
// deno-lint-ignore no-explicit-any
export function linescoreTable(data: any): Linescore | null {
  // deno-lint-ignore no-explicit-any
  const innings: any[] = data?.innings ?? [];
  if (!innings.length) return null;
  const runs = (half: unknown) => (typeof half === 'number' ? half : null);
  // deno-lint-ignore no-explicit-any
  const rhe = (t: any): [number, number, number] => [t?.runs ?? 0, t?.hits ?? 0, t?.errors ?? 0];
  return {
    innings: innings.map((i) => [runs(i?.away?.runs), runs(i?.home?.runs)]),
    away: rhe(data?.teams?.away),
    home: rhe(data?.teams?.home),
  };
}

/**
 * The live state from `/game/{gamePk}/linescore`, or null before the game has an inning.
 * `homeTeamId` says which side the offense is: at an inning break MLB switches `offense` and
 * `defense` to the next half before (or after) it flips `isTopInning`, so going by the offense's
 * team keeps the batters and due-up lists under the right team.
 */
// deno-lint-ignore no-explicit-any
export function linescoreLive(data: any, homeTeamId?: number): LiveState | null {
  if (!data?.currentInning) return null;
  const offense = data.offense ?? {};
  const defense = data.defense ?? {};
  const offenseTeam: number | undefined = offense.team?.id;
  return {
    inning: data.currentInning,
    inningState: data.inningState ?? data.inningHalf ?? 'Top',
    battingSide:
      offenseTeam && homeTeamId ? (offenseTeam === homeTeamId ? 'home' : 'away') : data.isTopInning === false ? 'home' : 'away',
    outs: data.outs ?? 0,
    balls: data.balls ?? 0,
    strikes: data.strikes ?? 0,
    bases: [!!offense.first, !!offense.second, !!offense.third],
    batting: [livePlayer(offense.batter), livePlayer(offense.onDeck), livePlayer(offense.inHole)],
    dueUp: [livePlayer(defense.batter), livePlayer(defense.onDeck), livePlayer(defense.inHole)],
  };
}

/**
 * What `/game/{gamePk}/playByPlay` needs to send for `nextLastPlay`: the event, batter, where the
 * ball went and who scored, for every at-bat. ~80 KB for a whole game (~4 KB gzipped) where the
 * unfiltered play-by-play is ~0.7 MB.
 */
export const LAST_PLAY_FIELDS =
  'allPlays,currentPlay,result,event,about,isComplete,atBatIndex,matchup,batter,id,fullName,playEvents,hitData,location,runners,movement,end,details,playIndex';

/** The at-bat a live state is at, as `LiveState.playsAsOf` keeps it. */
export function playsKey(live: LiveState): string {
  return `${live.inning}|${live.inningState}|${live.batting[0]?.id ?? ''}`;
}

const FIELDERS: Record<string, string> = { 1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF' };
// MLB's event names that don't read well lowercased. The rest are lowercased word by word,
// keeping words like "DP" and "2B": "Grounded Into DP" is "grounded into DP".
const PLAY_WORDS: Record<string, string> = {
  'Home Run': 'homer',
  'Intent Walk': 'intentional walk',
  'Field Error': 'reached on error',
  'Fielders Choice': "fielder's choice",
  'Fielders Choice Out': "fielder's choice out",
  'Catcher Interference': "catcher's interference",
};

// deno-lint-ignore no-explicit-any
function readPlay(play: any): LastPlay | null {
  const batterId = play?.matchup?.batter?.id;
  const event: string | undefined = play?.result?.event;
  if (typeof play?.about?.atBatIndex !== 'number' || !batterId || !event) return null;
  const fullName: string = play.matchup.batter.fullName ?? '';
  // deno-lint-ignore no-explicit-any
  const events: any[] = play.playEvents ?? [];
  const location = [...events].reverse().find((e) => e?.hitData?.location)?.hitData.location;
  const words = PLAY_WORDS[event] ?? event.split(' ').map((w) => (/[A-Z]{2}|\d/.test(w) ? w : w.toLowerCase())).join(' ');
  return {
    atBat: play.about.atBatIndex,
    batterId,
    batter: fullName.split(' ').slice(1).join(' ') || fullName,
    play: FIELDERS[location] ? `${words} to ${FIELDERS[location]}` : words,
    // deno-lint-ignore no-explicit-any
    runs: (play.runners ?? []).filter((r: any) => r?.movement?.end === 'score' && r?.details?.playIndex === events.length - 1).length,
  };
}

/**
 * A live game's last play, from its play-by-play, read when the at-bat in `live` (from the line
 * score) isn't the one `before` was read for. MLB's play-by-play can lag its line score by a few
 * seconds, so it only counts once it has caught up: it has a newer finished at-bat than `before`,
 * or its at-bat in progress is the line score's batter. Otherwise `before` stays as it was, and
 * the next poll reads the play-by-play again.
 */
export function nextLastPlay(
  live: LiveState,
  before: Pick<LiveState, 'lastPlay' | 'playsAsOf'> | null,
  // deno-lint-ignore no-explicit-any
  data: any,
): Pick<LiveState, 'lastPlay' | 'playsAsOf'> {
  const kept = { lastPlay: before?.lastPlay ?? null, playsAsOf: before?.playsAsOf };
  // deno-lint-ignore no-explicit-any
  const plays: any[] = data?.allPlays ?? [];
  const last = readPlay([...plays].reverse().find((p) => p?.about?.isComplete));
  const current = data?.currentPlay;
  const newer = !!last && last.atBat > (before?.lastPlay?.atBat ?? -1);
  const atBat = current?.about?.isComplete === false && current?.matchup?.batter?.id === live.batting[0]?.id;
  if (!newer && !atBat) return kept;
  return { lastPlay: newer ? last : kept.lastPlay, playsAsOf: playsKey(live) };
}

/** A hit's play, as mlb_hits keeps it. */
export interface HitRow {
  play_id: string;
  game_pk: number;
  mlb_player_id: number;
  event: '1B' | '2B' | '3B' | 'HR';
  inning: number;
  top_inning: boolean;
  ended_at: string | null;
}

const HIT_EVENTS: Record<string, HitRow['event']> = { single: '1B', double: '2B', triple: '3B', home_run: 'HR' };

/**
 * Every hit in `/game/{gamePk}/playByPlay`, with the play ID of the pitch that was put in play
 * (the last pitch of the at-bat): the ID Savant's videos and MLB's clips go by.
 */
// deno-lint-ignore no-explicit-any
export function playHits(gamePk: number, data: any): HitRow[] {
  const rows: HitRow[] = [];
  // deno-lint-ignore no-explicit-any
  for (const play of (data?.allPlays ?? []) as any[]) {
    const event = HIT_EVENTS[play?.result?.eventType];
    const batter = play?.matchup?.batter?.id;
    // deno-lint-ignore no-explicit-any
    const pitch = [...((play?.playEvents ?? []) as any[])].reverse().find((e) => e?.isPitch && e?.playId);
    if (!event || !batter || !pitch) continue;
    rows.push({
      play_id: pitch.playId,
      game_pk: gamePk,
      mlb_player_id: batter,
      event,
      inning: play.about?.inning ?? 0,
      top_inning: play.about?.isTopInning ?? play.about?.halfInning === 'top',
      ended_at: play.about?.endTime ?? null,
    });
  }
  return rows;
}

/**
 * What one play added to one player's batting line (mlb_play_lines): the batter's plate
 * appearance, and a run for each runner who scored on it (the batter too, on a home run).
 */
export interface PlayLineRow {
  game_pk: number;
  /** The play's index in the game (MLB's atBatIndex). */
  at_bat: number;
  mlb_player_id: number;
  ended_at: string | null;
  pa: number;
  ab: number;
  h: number;
  tb: number;
  hr: number;
  bb: number;
  hbp: number;
  sf: number;
  r: number;
  rbi: number;
}

// How each play-ending event counts for the batter, as the box score counts it. Events not listed
// (a runner caught stealing or picked off to end an inning, say) aren't a plate appearance.
const AT_BAT_EVENTS = new Set([
  'single', 'double', 'triple', 'home_run', 'field_out', 'strikeout', 'strikeout_double_play', 'strikeout_triple_play',
  'grounded_into_double_play', 'grounded_into_triple_play', 'double_play', 'triple_play', 'force_out', 'fielders_choice',
  'fielders_choice_out', 'field_error',
]);
const OTHER_PA_EVENTS: Record<string, Partial<Pick<PlayLineRow, 'bb' | 'hbp' | 'sf'>>> = {
  walk: { bb: 1 },
  intent_walk: { bb: 1 },
  hit_by_pitch: { hbp: 1 },
  sac_fly: { sf: 1 },
  sac_fly_double_play: { sf: 1 },
  sac_bunt: {},
  sac_bunt_double_play: {},
  catcher_interf: {},
};
const TB: Record<string, number> = { single: 1, double: 2, triple: 3, home_run: 4 };

/**
 * Every player's line, play by play, from `/game/{gamePk}/playByPlay`: what the Standings need to
 * rebuild the box score as it stood at any moment of a game (tiebreakers included). A run counts
 * at the end of the play it scored on.
 */
// deno-lint-ignore no-explicit-any
export function playLines(gamePk: number, data: any): PlayLineRow[] {
  const rows = new Map<string, PlayLineRow>();
  const line = (atBat: number, playerId: number, endedAt: string | null) => {
    const key = `${atBat}:${playerId}`;
    let row = rows.get(key);
    if (!row) {
      row = { game_pk: gamePk, at_bat: atBat, mlb_player_id: playerId, ended_at: endedAt, pa: 0, ab: 0, h: 0, tb: 0, hr: 0, bb: 0, hbp: 0, sf: 0, r: 0, rbi: 0 };
      rows.set(key, row);
    }
    return row;
  };
  // deno-lint-ignore no-explicit-any
  for (const play of (data?.allPlays ?? []) as any[]) {
    const atBat = play?.about?.atBatIndex;
    const batter = play?.matchup?.batter?.id;
    const event: string | undefined = play?.result?.eventType;
    if (typeof atBat !== 'number' || !batter || !event || play?.about?.isComplete === false) continue;
    const endedAt = play.about.endTime ?? null;
    const other = OTHER_PA_EVENTS[event];
    if (AT_BAT_EVENTS.has(event) || other) {
      const row = line(atBat, batter, endedAt);
      row.pa = 1;
      row.ab = AT_BAT_EVENTS.has(event) ? 1 : 0;
      row.tb = TB[event] ?? 0;
      row.h = row.tb ? 1 : 0;
      row.hr = event === 'home_run' ? 1 : 0;
      Object.assign(row, other ?? {});
      row.rbi = play.result.rbi ?? 0;
    }
    // deno-lint-ignore no-explicit-any
    for (const runner of (play.runners ?? []) as any[]) {
      const id = runner?.details?.runner?.id;
      if (id && runner?.movement?.end === 'score' && !runner?.movement?.isOut) line(atBat, id, endedAt).r += 1;
    }
  }
  return [...rows.values()];
}

/** An official highlight clip that's of one play. */
export interface Clip {
  playId: string;
  slug: string;
  headline: string;
  playerIds: number[];
}

/** The clips in `/game/{gamePk}/content` tied to a play (their guid is its play ID). */
// deno-lint-ignore no-explicit-any
export function highlightClips(data: any): Clip[] {
  // deno-lint-ignore no-explicit-any
  return ((data?.highlights?.highlights?.items ?? []) as any[]).flatMap((item): Clip[] => {
    const slug = item?.slug ?? item?.id;
    if (!item?.guid || !slug) return [];
    const playerIds = ((item.keywordsAll ?? []) as { type?: string; value?: string }[])
      .filter((k) => k.type === 'player_id')
      .map((k) => Number(k.value));
    return [{ playId: item.guid, slug, headline: item.headline ?? '', playerIds }];
  });
}

/**
 * The clip for each hit that has one: of that play, preferring one tagged with the batter (a
 * play's clip can be about the defense, e.g. a runner thrown out on the same hit).
 */
export function clipsForHits(hits: Pick<HitRow, 'play_id' | 'mlb_player_id'>[], clips: Clip[]): Map<string, Clip> {
  const out = new Map<string, Clip>();
  for (const hit of hits) {
    const ofPlay = clips.filter((c) => c.playId === hit.play_id);
    const clip = ofPlay.find((c) => c.playerIds.includes(hit.mlb_player_id)) ?? ofPlay[0];
    if (clip) out.set(hit.play_id, clip);
  }
  return out;
}

/** Savant's play page (`sporty-videos?playId=…`) has the video: the page links its mp4. */
export function savantHasVideo(html: string): boolean {
  return /https:\/\/sporty-clips\.mlb\.com\/[^"'\s<>]+\.mp4/.test(html);
}
