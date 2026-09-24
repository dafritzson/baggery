// Shared game types. This folder must stay dependency-free: it is imported by both
// Deno Edge Functions and the Expo app, so imports use explicit `.ts` extensions.

/** MLB Stats API postseason game types: Wild Card, Division, League Championship, World Series. */
export type GameType = 'F' | 'D' | 'L' | 'W';

export type FantasyRound = 1 | 2 | 3;

export const ROUND_FOR_GAME_TYPE: Record<GameType, FantasyRound> = {
  F: 1,
  D: 1,
  L: 2,
  W: 3,
};

export type TeamId = string;
export type PlayerId = number; // MLB person id
