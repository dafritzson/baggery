import type { SeasonData, Team } from '@/lib/season';

const ADJECTIVES = [
  'Notorious', 'Blue', 'Mighty', 'Rowdy', 'Golden', 'Sneaky', 'Electric', 'Dusty', 'Clutch', 'Lucky',
  'Fearless', 'Crafty', 'Scrappy', 'Grand', 'Salty', 'Swift', 'Loud', 'Hungry', 'Rally', 'Bold',
  'Cosmic', 'Wild', 'Smooth', 'Gritty', 'Heavy', 'Silent', 'Crimson', 'Jolly', 'Frosty', 'Big',
  'Legendary', 'Humble', 'Midnight', 'Thunder', 'Fancy', 'Dapper', 'Spicy', 'Rusty', 'Nimble', 'Sultry',
  'Mysterious', 'Glorious', 'Reckless', 'Steady', 'Burly', 'Wily', 'Zesty', 'Grumpy', 'Majestic', 'Unstoppable',
];

// Names for unclaimed, unnamed spots: random on each page load, but stable within it.
const unclaimedNames = new Map<string, string>();

function randomAdjective(avoid: Set<string>): string {
  const free = ADJECTIVES.filter((a) => !avoid.has(`${a} Bagger`.toLowerCase()));
  const pool = free.length ? free : ADJECTIVES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** A random "<adjective> Bagger" that no team in the season is using. */
export function suggestTeamName(data: SeasonData): string {
  const taken = new Set(data.teams.map((t) => teamName(t).toLowerCase()));
  return `${randomAdjective(taken)} Bagger`;
}

/** The team's name, or a random "<adjective> Bagger" for a spot nobody has named. */
export function teamName(team: Team): string {
  if (team.name) return team.name;
  let name = unclaimedNames.get(team.id);
  if (!name) {
    const used = new Set([...unclaimedNames.values()].map((n) => n.toLowerCase()));
    name = `${randomAdjective(used)} Bagger`;
    unclaimedNames.set(team.id, name);
  }
  return name;
}

/** First name of the person managing the team, if anyone has claimed it. */
export function ownerName(data: SeasonData, team: Team): string | null {
  return team.user_id ? data.owners.get(team.user_id) ?? null : null;
}

/** "Big Bags (Kyle)", or just the name for an unclaimed spot. */
export function teamLabel(data: SeasonData, team: Team | undefined): string {
  if (!team) return '—';
  const owner = ownerName(data, team);
  return owner ? `${teamName(team)} (${owner})` : teamName(team);
}
