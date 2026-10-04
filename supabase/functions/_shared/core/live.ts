// A game in progress, as the Games tab shows it. poll-games stores it as mlb_games.live.

export interface LivePlayer {
  id: number;
  name: string;
}

/** The last finished at-bat, as the Games cards show it: "Judge flyout to CF · 1 run". */
export interface LastPlay {
  /** MLB's atBatIndex, counting every at-bat of the game from 0. */
  atBat: number;
  batterId: number;
  /** The batter's name without his first name: "Judge", "Guerrero Jr.". */
  batter: string;
  /** What happened, and where for a ball in play: "flyout to CF", "strikeout". */
  play: string;
  /** Runs that scored on the play itself (not on a wild pitch earlier in the at-bat). */
  runs: number;
}

export interface LiveState {
  inning: number;
  /** Top | Middle | Bottom | End */
  inningState: string;
  /** Which team is (or was last) batting. */
  battingSide: 'away' | 'home';
  outs: number;
  balls: number;
  strikes: number;
  /** Runners on first, second and third. */
  bases: [boolean, boolean, boolean];
  /** The batting team's batter, on deck and in the hole. */
  batting: (LivePlayer | null)[];
  /** The fielding team's next three due up. */
  dueUp: (LivePlayer | null)[];
  /** The last finished at-bat, once the game has one. */
  lastPlay?: LastPlay | null;
  /**
   * Which at-bat (inning, half and batter) lastPlay is up to date for. poll-games reads the
   * play-by-play only when this changes, not on every poll.
   */
  playsAsOf?: string;
}

