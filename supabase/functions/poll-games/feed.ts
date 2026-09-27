// Turns MLB Stats API responses into rows for mlb_games and player_game_stats. Pure, so the
// unit tests can run it on sample responses.

import type { LivePlayer, LiveState } from '../_shared/core/live.ts';

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
    };
    const seen = games.get(row.game_pk);
    if (!seen || seen.detailed_state === 'Postponed') games.set(row.game_pk, row);
  }
  return [...games.values()];
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
      });
    }
  }
  return { rows, players };
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

/** The live state from `/game/{gamePk}/linescore`, or null before the game has an inning. */
// deno-lint-ignore no-explicit-any
export function linescoreLive(data: any): LiveState | null {
  if (!data?.currentInning) return null;
  const offense = data.offense ?? {};
  const defense = data.defense ?? {};
  return {
    inning: data.currentInning,
    inningState: data.inningState ?? data.inningHalf ?? 'Top',
    battingSide: data.isTopInning === false ? 'home' : 'away',
    outs: data.outs ?? 0,
    balls: data.balls ?? 0,
    strikes: data.strikes ?? 0,
    bases: [!!offense.first, !!offense.second, !!offense.third],
    batting: [livePlayer(offense.batter), livePlayer(offense.onDeck), livePlayer(offense.inHole)],
    dueUp: [livePlayer(defense.batter), livePlayer(defense.onDeck), livePlayer(defense.inHole)],
  };
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
