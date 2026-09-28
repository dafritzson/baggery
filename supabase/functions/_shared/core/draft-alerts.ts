// The text of draft alerts, the push notifications the draft function sends: on the clock, draft
// started, autodraft picked for you and draft done. Pure, so the unit tests can run it without Supabase.

import type { Alert } from './bag-alerts.ts';
import { ordinal } from './bag-celebration.ts';
import type { DraftKind } from './draft.ts';

export interface OnTheClock {
  draftNumber: number;
  kind: DraftKind;
  /** The snake round of the turn. */
  round: number;
  /** On a ghost turn, the name of the ghost team the manager picks for, and whether it's filling an empty spot. */
  ghost?: { team: string; kind: 'add' | 'redraft' };
}

/**
 * "⏰ You're on the clock" / "Draft 2, round 3: pick a hitter or pass". On a ghost turn, the
 * manager picks for the ghost: "Draft 3: pick a hitter for 👻 Ghost".
 */
export function onTheClockAlert(turn: OnTheClock): Alert {
  const title = '⏰ You’re on the clock';
  if (turn.ghost) {
    const pass = turn.ghost.kind === 'redraft' ? ', or pass' : '';
    return { title, body: `Draft ${turn.draftNumber}: pick a hitter for ${turn.ghost.team}${pass}` };
  }
  const pass = turn.kind === 'redraft' ? ' or pass' : '';
  return { title, body: `Draft ${turn.draftNumber}, round ${turn.round}: pick a hitter${pass}` };
}

/**
 * "📣 Draft 2 is live" / "You pick 5th in round 1", to every league member when the commissioner
 * starts a draft. `slot` is the member's team's place in round 1, if it has one.
 */
export function draftStartedAlert(draftNumber: number, slot: number | null): Alert {
  return {
    title: `📣 Draft ${draftNumber} is live`,
    body: slot ? `You pick ${ordinal(slot)} in round 1` : 'Follow the picks in the draft room',
  };
}

export interface Autopick {
  draftNumber: number;
  round: number;
  /** The hitter taken and the one dropped for him, or neither for a pass. */
  player: string | null;
  dropped: string | null;
  /** On a ghost turn, the ghost team the pick was for. */
  ghost?: string;
}

/**
 * "🤖 Autodraft took Juan Soto" / "Draft 2, round 3, dropping Aaron Judge", to the manager whose
 * team autodraft picked for (off unless turned on). A pass: "🤖 Autodraft passed for you".
 */
export function autopickAlert(pick: Autopick): Alert {
  const where = `Draft ${pick.draftNumber}, round ${pick.round}`;
  const forGhost = pick.ghost ? ` for ${pick.ghost}` : '';
  if (!pick.player) return { title: `🤖 Autodraft passed${forGhost || ' for you'}`, body: where };
  const dropping = pick.dropped ? `, dropping ${pick.dropped}` : '';
  return { title: `🤖 Autodraft took ${pick.player}${forGhost}`, body: `${where}${dropping}` };
}

/** "✅ Draft 2 is done", to every league member when its last pick is made. */
export function draftDoneAlert(draftNumber: number): Alert {
  return { title: `✅ Draft ${draftNumber} is done`, body: 'See every team’s hitters in the draft room' };
}
