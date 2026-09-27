// The text of poll-games' other push notifications, next to bag alerts (bag-alerts.ts): sub alerts
// (a drafted hitter came off the bench or was replaced) and cut alerts (a team crossed the round's
// cut line). Pure, so the unit tests can run it without Supabase.

import { type Alert, type Owner, teamLabel } from './bag-alerts.ts';
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
