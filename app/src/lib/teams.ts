import type { SeasonData, Team } from '@/lib/season';
import { randomTeamName } from '@/lib/team-name-list';

// Names for unclaimed spots (claimed teams always have a stored name): random on each page
// load, but stable within it.
const unclaimedNames = new Map<string, string>();

/** A random name (see team-name-list) that isn't in `avoid` (lowercase), if one turns up. */
function freshName(avoid: Set<string>): string {
  let name = randomTeamName();
  for (let tries = 0; tries < 20 && avoid.has(name.toLowerCase()); tries++) name = randomTeamName();
  return name;
}

/** A random name that no team in the season is using. */
export function suggestTeamName(data: SeasonData): string {
  return freshName(new Set(data.teams.map((t) => teamName(t).toLowerCase())));
}

/**
 * The team's name, or a random name for an unclaimed spot. Naming fields
 * start from this, so they match what the page already shows for the team.
 */
export function teamName(team: Team): string {
  if (team.name) return team.name;
  let name = unclaimedNames.get(team.id);
  if (!name) {
    name = freshName(new Set([...unclaimedNames.values()].map((n) => n.toLowerCase())));
    unclaimedNames.set(team.id, name);
  }
  return name;
}

/** First name of the person managing the team, if anyone has claimed it. */
export function ownerName(data: SeasonData, team: Team): string | null {
  return team.user_id ? data.owners.get(team.user_id) ?? null : null;
}

/**
 * What to show under a team's name: its manager, "Open spot" while it can still be claimed, or
 * nothing in a finished season (past teams are named after their manager already).
 */
export function ownerLine(data: SeasonData, team: Team): string | null {
  return ownerName(data, team) ?? (data.season.status === 'complete' ? null : 'Open spot');
}

/** "Big Bags (Kyle)", or just the name for an unclaimed spot. */
export function teamLabel(data: SeasonData, team: Team | undefined): string {
  if (!team) return '—';
  const owner = ownerName(data, team);
  return owner ? `${teamName(team)} (${owner})` : teamName(team);
}
