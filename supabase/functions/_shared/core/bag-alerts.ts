// The text of a bag alert, the push notification poll-games sends when a drafted hitter gets a
// bag. Pure, so the unit tests can run it without Supabase.

/** A bag as private.bag_events records it, and whose team it counts for. */
export interface Bag {
  player: string;
  /** Total bases gained. */
  bags: number;
  /** Hits gained since the last read. A scoring change can make one negative. */
  singles: number;
  doubles: number;
  triples: number;
  hr: number;
  /** The fantasy team the bag counts for, and its manager's first name. */
  team: string;
  manager: string | null;
  /** The team is the alert's recipient's own: named without its manager, who they know. */
  yours: boolean;
}

export interface Alert {
  title: string;
  body: string;
}

const HITS = [
  ['singles', '1B'],
  ['doubles', '2B'],
  ['triples', '3B'],
  ['hr', 'HR'],
] as const;

/**
 * "👜 Shohei Ohtani got a bag" / "HR for Bag Boys (Mike)", with a bag emoji per bag (up to 4). Your
 * own team is just its name: "HR for Hot Bag Summer".
 */
export function bagAlert(bag: Bag): Alert {
  const title = `${'👜'.repeat(Math.min(Math.max(bag.bags, 1), 4))} ${bag.player} got ${
    bag.bags === 1 ? 'a bag' : `${bag.bags} bags`
  }`;
  const team = !bag.yours && bag.manager && bag.manager !== bag.team ? `${bag.team} (${bag.manager})` : bag.team;
  return { title, body: `${capitalize(hitsText(bag))} for ${team}` };
}

/** "HR", "1B and 2B", "HR ×2"; "scoring change" when it wasn't a new hit. */
export function hitsText(bag: Pick<Bag, 'singles' | 'doubles' | 'triples' | 'hr'>): string {
  const counts = HITS.map(([key, name]) => [bag[key], name] as const);
  if (counts.some(([n]) => n < 0) || counts.every(([n]) => n === 0)) return 'scoring change';
  const parts = counts.filter(([n]) => n > 0).map(([n, name]) => (n === 1 ? name : `${name} ×${n}`));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The alert that confirms a device's alerts work (Settings → Send a test). */
export function testAlert(scope: 'mine' | 'league'): Alert {
  return {
    title: '👜 Bag alerts are on',
    body: scope === 'mine' ? "You'll get one when one of your hitters gets a bag." : "You'll get one when anyone's hitter gets a bag.",
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
