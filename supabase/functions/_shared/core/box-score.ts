// A game's box score for the Games tab: each team's hitters in batting order, subs under the
// hitter they replaced, the totals and the extra-base hits. Shared by poll-games (the line score's
// shape) and the app.

/**
 * Runs by inning, [away, home] (null for a half inning not played, like the home half of a ninth
 * the home team didn't need), and each team's runs, hits and errors.
 */
export interface Linescore {
  innings: [number | null, number | null][];
  away: [number, number, number];
  home: [number, number, number];
}

/** A hitter in a posted starting lineup. */
export interface LineupPlayer {
  id: number;
  name: string;
  pos: string | null;
}

/** A hitter's line in one game (player_game_stats). */
export interface BoxLine {
  playerId: number;
  teamId: number;
  name: string;
  /** "300" batted third; 301 replaced him. Null if he wasn't in the batting order. */
  order: number | null;
  /** "PH-3B". */
  position: string | null;
  ab: number;
  r: number;
  h: number;
  rbi: number;
  bb: number;
  so: number;
  tb: number;
  doubles: number;
  triples: number;
  hr: number;
}

export interface BoxRow {
  playerId: number;
  name: string;
  position: string | null;
  /** 1–9, or null for someone outside the batting order. */
  spot: number | null;
  /** Came off the bench into this spot. */
  sub: boolean;
  /** Null for a starter who hasn't come up yet. */
  line: BoxLine | null;
}

const spotOf = (order: number | null) => (order === null ? null : Math.floor(order / 100));

/**
 * One team's hitters in batting order, each sub right under the hitter he replaced. Starters from
 * the posted lineup who haven't batted yet (no line) fill their spots, unless someone else started
 * there after all.
 */
export function teamBox(lines: BoxLine[], lineup: LineupPlayer[] = []): BoxRow[] {
  const rows: (BoxRow & { order: number })[] = lines.map((l) => ({
    playerId: l.playerId,
    name: l.name,
    position: l.position,
    spot: spotOf(l.order),
    sub: l.order !== null && l.order % 100 !== 0,
    line: l,
    // Outside the order: after everyone else.
    order: l.order ?? 10_000,
  }));
  const batted = new Set(lines.map((l) => l.playerId));
  const started = new Set(lines.filter((l) => l.order !== null && l.order % 100 === 0).map((l) => spotOf(l.order)));
  lineup.forEach((p, i) => {
    const spot = i + 1;
    if (batted.has(p.id) || started.has(spot)) return;
    rows.push({ playerId: p.id, name: p.name, position: p.pos, spot, sub: false, line: null, order: spot * 100 });
  });
  return rows.sort((a, b) => a.order - b.order).map(({ order: _, ...row }) => row);
}

export type BoxTotals = Pick<BoxLine, 'ab' | 'r' | 'h' | 'rbi' | 'bb' | 'so' | 'tb'>;

export function boxTotals(lines: BoxLine[]): BoxTotals {
  const sum = (key: keyof BoxTotals) => lines.reduce((n, l) => n + l[key], 0);
  return { ab: sum('ab'), r: sum('r'), h: sum('h'), rbi: sum('rbi'), bb: sum('bb'), so: sum('so'), tb: sum('tb') };
}

/** "Ohtani" from "Shohei Ohtani"; "Guerrero Jr." from "Vladimir Guerrero Jr.". */
export function lastName(name: string): string {
  return name.split(' ').slice(1).join(' ') || name;
}

/**
 * The extra-base hits under a box score: "2B: Betts, Pages" and "HR: Ohtani (2)". Only the kinds
 * someone hit, in 2B, 3B, HR order.
 */
export function extraBaseHits(lines: BoxLine[]): { label: '2B' | '3B' | 'HR'; text: string }[] {
  const kinds = [
    { label: '2B' as const, key: 'doubles' as const },
    { label: '3B' as const, key: 'triples' as const },
    { label: 'HR' as const, key: 'hr' as const },
  ];
  return kinds.flatMap(({ label, key }) => {
    const hitters = lines.filter((l) => l[key] > 0);
    if (!hitters.length) return [];
    const text = hitters.map((l) => `${lastName(l.name)}${l[key] > 1 ? ` ${l[key]}` : ''}`).join(', ');
    return [{ label, text }];
  });
}
