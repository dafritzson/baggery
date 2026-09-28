// The text of a draft alert, the push notification the draft function sends a manager when their
// team comes on the clock. Pure, so the unit tests can run it without Supabase.

import type { Alert } from './bag-alerts.ts';
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
