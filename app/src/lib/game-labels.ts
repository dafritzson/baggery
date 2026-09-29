import type { LiveState } from '@core/live.ts';
import { SERIES } from '@core/scoreboard.ts';

import type { GameInfo } from '@/lib/scores';
import type { SeasonData } from '@/lib/season';

/** "Wild Card · Game 2", or "Division Series · Game 3". */
export function seriesLabel(game: GameInfo): string {
  const series = SERIES.find((s) => s.gameType === game.gameType);
  return `${series?.name ?? ''} · Game ${game.seriesGameNumber}`;
}

export function statusLine(game: GameInfo): string {
  if (game.status === 'Preview' && game.detailedState !== 'Postponed') {
    if (game.startTimeTbd) return 'Time TBD';
    // In the device's own time zone: "3:00 PM PT".
    return new Date(game.start).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'shortGeneric',
    });
  }
  // "F/10" for extra innings (or a shortened game), like a box score.
  if (game.status === 'Final' && game.detailedState === 'Final' && game.live && game.live.inning !== 9) {
    return `F/${game.live.inning}`;
  }
  return game.detailedState ?? game.status;
}

/** "▲7", "▼7", "Mid 7", "End 7". */
export function inningLabel(live: LiveState): string {
  if (live.inningState === 'Top') return `▲${live.inning}`;
  if (live.inningState === 'Bottom') return `▼${live.inning}`;
  return `${live.inningState === 'Middle' ? 'Mid' : 'End'} ${live.inning}`;
}

/** Who owned the player when the game started (or owns him now, before it starts). */
export function ownerOf(data: SeasonData, playerId: number, game: GameInfo): string | undefined {
  const t = Date.parse(game.start);
  const started = game.status !== 'Preview';
  return data.spells.find(
    (s) =>
      s.mlb_player_id === playerId &&
      (started ? Date.parse(s.from_at) <= t && (s.to_at === null || t < Date.parse(s.to_at)) : s.to_at === null),
  )?.fantasy_team_id;
}

/** Two-word club names; every other club's nickname is its last word ("Atlanta Braves" → "Braves"). */
const TWO_WORD = ['Red Sox', 'White Sox', 'Blue Jays'];

/** A club's nickname, short enough for two to sit side by side on a phone. */
export function nickname(name: string): string {
  return TWO_WORD.find((n) => name.endsWith(` ${n}`)) ?? name.split(' ').pop() ?? name;
}
