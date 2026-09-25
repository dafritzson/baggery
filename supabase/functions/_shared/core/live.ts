// A game in progress, as the Games tab shows it. poll-games stores it as mlb_games.live.

export interface LivePlayer {
  id: number;
  name: string;
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
}

