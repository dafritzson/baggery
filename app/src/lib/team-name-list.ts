// Random team names for the dice button and for unclaimed spots. Pure data and logic, no
// imports, so the unit tests can check it. Every name must fit the 30-character limit on
// team names (enforced in the database).

/**
 * Hand-written "bags" puns, stored scrambled (XOR with NAME_KEY, then base64) so they aren't
 * readable in the source. To see or edit them, use scripts/team-names.ts.
 */
export const ENCODED_TEAM_NAMES =
  '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';

export const NAME_KEY = 'baggery';

/** Unscrambles ENCODED_TEAM_NAMES into the list of names. The names are plain ASCII. */
export function decodeTeamNames(encoded: string): string[] {
  const bytes = atob(encoded);
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    text += String.fromCharCode(bytes.charCodeAt(i) ^ NAME_KEY.charCodeAt(i % NAME_KEY.length));
  }
  return text.split('\n');
}

let decoded: string[] | null = null;

/** The pun names, decoded on first use. */
export function teamNames(): string[] {
  decoded ??= decodeTeamNames(ENCODED_TEAM_NAMES);
  return decoded;
}

/** For "<adjective> Bagger". */
export const ADJECTIVES = [
  'Notorious', 'Blue', 'Mighty', 'Rowdy', 'Golden', 'Sneaky', 'Electric', 'Dusty', 'Clutch', 'Lucky',
  'Fearless', 'Crafty', 'Scrappy', 'Grand', 'Salty', 'Swift', 'Loud', 'Hungry', 'Rally', 'Bold',
  'Cosmic', 'Wild', 'Smooth', 'Gritty', 'Heavy', 'Silent', 'Crimson', 'Jolly', 'Frosty', 'Big',
  'Legendary', 'Humble', 'Midnight', 'Thunder', 'Fancy', 'Dapper', 'Spicy', 'Rusty', 'Nimble', 'Sultry',
  'Mysterious', 'Glorious', 'Reckless', 'Steady', 'Burly', 'Wily', 'Zesty', 'Grumpy', 'Majestic', 'Unstoppable',
  'Saucy', 'Sloppy', 'Soggy', 'Crusty', 'Greasy', 'Filthy', 'Nasty', 'Sweaty', 'Stinky', 'Shady',
  'Sketchy', 'Feral', 'Unhinged', 'Cursed', 'Juicy', 'Chunky', 'Hefty', 'Loaded', 'Stacked', 'Moist',
  'Grimy', 'Janky', 'Wonky', 'Rogue', 'Savage', 'Petty', 'Bougie', 'Chaotic', 'Illegal', 'Suspicious',
  'Questionable', 'Smelly', 'Dank', 'Shifty', 'Brazen',
];

/** A random name, equally likely to be one of the puns or "<adjective> Bagger". */
export function randomTeamName(random: () => number = Math.random): string {
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  return random() < 0.5 ? pick(teamNames()) : `${pick(ADJECTIVES)} Bagger`;
}
