// The text of poll-games' other push notifications, next to bag alerts (bag-alerts.ts): sub alerts
// (a drafted hitter came off the bench or was replaced), cut alerts (a team crossed the round's cut
// line), lineup alerts (a team posted its starting lineup, or dropped a drafted hitter from it) and
// stat correction alerts (the official scorer changed a drafted hitter's total bases).
// Pure, so the unit tests can run it without Supabase.

import { type Alert, type Bag, type Owner, teamLabel } from './bag-alerts.ts';
import { ordinal } from './bag-celebration.ts';
import { type RankedTeam, eliminations } from './scoring.ts';
import type { TeamId } from './types.ts';

/** A drafted hitter's lineup change, as poll-games reads it from the box score (feed.ts). */
export interface Sub extends Owner {
  player: string;
  /** 'in': came off the bench. 'out': was replaced. */
  kind: 'in' | 'out';
  /** 'in': the position he came in at (PH, PR, SS, ...). 'out': his replacement's. */
  position: string | null;
  /** 'out': who replaced him. */
  replacement: string | null;
}

/**
 * "👀 Kiké Hernández is in the game" / "Pinch-hitting · Bag Boys (Mike)", and "😠 Mookie Betts is
 * out of the game" / "Replaced by pinch-hitter Kiké Hernández · Bag Boys (Mike)".
 */
export function subAlert(sub: Sub): Alert {
  const pos = sub.position?.toUpperCase() ?? null;
  if (sub.kind === 'in') {
    const how = pos === 'PH' ? 'Pinch-hitting' : pos === 'PR' ? 'Pinch-running' : pos ? `Subbed in at ${pos}` : 'Off the bench';
    return { title: `👀 ${sub.player} is in the game`, body: `${how} · ${teamLabel(sub)}` };
  }
  const by = !sub.replacement
    ? 'Out of the lineup'
    : `Replaced by ${pos === 'PH' ? 'pinch-hitter ' : pos === 'PR' ? 'pinch-runner ' : ''}${sub.replacement}`;
  return { title: `😠 ${sub.player} is out of the game`, body: `${by} · ${teamLabel(sub)}` };
}

/** A team's side of the cut line: `danger` below it, or tied across it (a drink-off if it ends so). */
export interface CutSpot {
  teamId: TeamId;
  danger: boolean;
  rank: number;
  /** Shares its rank with another team. */
  tied: boolean;
}

/** Each team's side of the cut, `survivors` going through (the standings' cut line). */
export function cutSpots(ranked: RankedTeam[], survivors: number): CutSpot[] {
  const { advancing } = eliminations(ranked, Math.min(survivors, ranked.length));
  return ranked.map((t) => ({
    teamId: t.teamId,
    danger: !advancing.includes(t.teamId),
    rank: t.rank,
    tied: ranked.some((o) => o.teamId !== t.teamId && o.rank === t.rank),
  }));
}

/**
 * The teams whose side of the cut changed since the last check. A team with no previous side (the
 * round's first check) has nothing to compare, so it isn't one.
 */
export function cutFlips(previous: Map<TeamId, boolean>, spots: CutSpot[]): CutSpot[] {
  return spots.filter((s) => previous.has(s.teamId) && previous.get(s.teamId) !== s.danger);
}

/**
 * "🥵 You're on the hot seat" / "Down to 6th. The top 5 go through." and "😮‍💨 Off the chopping
 * block" / "Up to 5th. ...". Someone else's team is named: "🥵 Bag Boys (Mike) is on the hot seat".
 */
export function cutAlert(spot: CutSpot & Owner & { survivors: number }): Alert {
  const title = spot.danger
    ? spot.yours ? "🥵 You're on the hot seat" : `🥵 ${teamLabel(spot)} is on the hot seat`
    : spot.yours ? '😮‍💨 Off the chopping block' : `😮‍💨 ${teamLabel(spot)} is off the chopping block`;
  const place = ordinal(spot.rank);
  const cut = spot.survivors === 1 ? 'Only 1st wins it all.' : `The top ${spot.survivors} go through.`;
  const body = spot.tied
    ? spot.danger ? `Tied for ${place} at the cut: a drink-off if it ends this way.` : `Tied for ${place}. ${cut}`
    : `${spot.danger ? 'Down' : 'Up'} to ${place}. ${cut}`;
  return { title, body };
}

/**
 * What a team's starting lineup says that's new: `posted` the first time it's seen, and after that
 * who was in it and no longer is (`scratched`). `before` is the lineup as last seen, if any.
 */
export function lineupNews(before: number[] | undefined, lineup: number[]): { posted: boolean; scratched: number[] } {
  if (!before) return { posted: true, scratched: [] };
  return { posted: false, scratched: before.filter((id) => !lineup.includes(id)) };
}

/** A drafted hitter in a posted lineup (`spot` 1–9) or not in it (`spot` null). */
export interface LineupHitter {
  player: string;
  spot: number | null;
  /** On the injured list, as of the draft pool: out of the lineup for that, not on the bench. */
  injured: boolean;
  /** Whose hitter, for someone else's: "Mike". Null for the recipient's own. */
  owner: string | null;
}

/**
 * "📋 Los Angeles Dodgers lineup is in" / "Mookie Betts leading off, Freddie Freeman batting 3rd ·
 * Will Smith on the bench 🪑". Someone else's hitters get their manager: "Freddie Freeman (Mike)
 * batting 3rd". A hitter out of it who's on the injured list is "on the injured list 🩹".
 */
export function lineupAlert(mlbTeam: string, hitters: LineupHitter[]): Alert {
  const name = (h: LineupHitter) => (h.owner ? `${h.player} (${h.owner})` : h.player);
  const starting = hitters
    .filter((h) => h.spot !== null)
    .sort((a, b) => a.spot! - b.spot!)
    .map((h) => `${name(h)} ${h.spot === 1 ? 'leading off' : `batting ${ordinal(h.spot!)}`}`);
  const bench = hitters.filter((h) => h.spot === null && !h.injured).map(name);
  const injured = hitters.filter((h) => h.spot === null && h.injured).map(name);
  const parts = [
    ...(starting.length ? [starting.join(', ')] : []),
    ...(bench.length ? [`${listText(bench)} on the bench 🪑`] : []),
    ...(injured.length ? [`${listText(injured)} on the injured list 🩹`] : []),
  ];
  return { title: `📋 ${mlbTeam} lineup is in`, body: parts.join(' · ') };
}

/** "🪑 Freddie Freeman is out of the lineup" / "A late change for the Los Angeles Dodgers · Bag Boys (Mike)". */
export function scratchAlert(player: string, mlbTeam: string, owner: Owner): Alert {
  return { title: `🪑 ${player} is out of the lineup`, body: `A late change for the ${mlbTeam} · ${teamLabel(owner)}` };
}

/** "A", "A and B", "A, B and C". */
function listText(items: string[]): string {
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A batting line's hits, singles apart. */
export type Hits = Pick<Bag, 'singles' | 'doubles' | 'triples' | 'hr'>;

/** A drafted hitter's hits before and after an official scoring change to his total bases. */
export interface Correction extends Owner {
  player: string;
  before: Hits;
  after: Hits;
}

const HIT_WORDS = [
  ['singles', 'single'],
  ['doubles', 'double'],
  ['triples', 'triple'],
  ['hr', 'home run'],
] as const;

/** Total bases of `hits`. */
function totalBases(hits: Hits): number {
  return hits.singles + 2 * hits.doubles + 3 * hits.triples + 4 * hits.hr;
}

/** "a single", "2 doubles"; `start` for the start of a sentence: "Single", "2 doubles". */
function hitsPhrase(counts: [number, string][], start = false): string {
  const parts = counts.map(([n, word], i) =>
    n === 1 ? (start && i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : `a ${word}`) : `${n} ${word}s`,
  );
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * "✏️ Stat correction for Mookie Betts" / "Double changed to a single: −1 bag for Bag Boys (Mike)".
 * A hit taken away: "Single taken away: −1 bag"; one given (an error scored a hit): "Credited
 * with a double: +2 bags".
 */
export function correctionAlert(c: Correction): Alert {
  const lost: [number, string][] = [];
  const gained: [number, string][] = [];
  for (const [key, word] of HIT_WORDS) {
    const n = c.after[key] - c.before[key];
    if (n < 0) lost.push([-n, word]);
    if (n > 0) gained.push([n, word]);
  }
  const what =
    lost.length && gained.length
      ? `${hitsPhrase(lost, true)} changed to ${hitsPhrase(gained)}`
      : lost.length
        ? `${hitsPhrase(lost, true)} taken away`
        : `Credited with ${hitsPhrase(gained)}`;
  const bags = totalBases(c.after) - totalBases(c.before);
  const change = `${bags < 0 ? '−' : '+'}${Math.abs(bags)} ${Math.abs(bags) === 1 ? 'bag' : 'bags'}`;
  return { title: `✏️ Stat correction for ${c.player}`, body: `${what}: ${change} for ${teamLabel(c)}` };
}
