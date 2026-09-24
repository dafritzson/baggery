// Random team names for the dice button and for unclaimed spots. Pure data and logic, no
// imports, so the unit tests can check it. Every name must fit the 30-character limit on
// team names (enforced in the database).

/** Hand-written "bags" puns. */
export const TEAM_NAMES = [
  'Master Baggins', 'Tea Baggins', 'Douche Baggins', 'Bag to the Future', 'Bags Bunny',
  'Baggage Claim', "It's in the Bag", 'Sandbaggers', 'Carpetbaggers', 'Bag of Tricks',
  'Moneybags', 'Brown Bag Special', 'Bagel Bosses', 'Bagpipe Dreams', 'Scumbags of Summer',
  'Bags of Glory', 'Bag Daddies', 'Grand Slam Bags', 'Bagsy Malone', 'Doggie Baggers',
  'Baggy Pants Brigade', 'Dirtbag Dynasty', 'Sleazebags', 'Windbags', 'Gasbags',
  'Ratbags', 'Fleabags', 'Nutbags', 'Bag Boys', 'Bag Ladies',
  'Hot Bag Summer', 'Bagging Rights', 'Bragging Bags', 'Bags to Riches', 'Rags to Bags',
  'Punching Bags', 'Bean Bag Bandits', 'Sleeping Bags', 'Body Bag Bombers', 'Airbag Deployment',
  'Bag of Donuts', 'Paper or Plastic', 'Double Bagged', 'Triple Bagged', 'Bag It and Tag It',
  'Bags Over Easy', 'Bag Check', 'Carry-On Bags', 'Bag Drop', 'Diaper Bag Dads',
  'The Bag Men', 'Bagman Begins', 'The Dark Bagman', 'Bagatha Christie', 'Baguette About It',
  'Oh My Bag', 'Bag Attack', 'Bags on Bags', 'Bag Swag', 'Swag Bags',
  'Secure the Bag', 'Bag Secured', 'Chasing Bags', 'Bag Chasers', 'Fumble the Bag',
  'Bag Alert', 'Bag Goblins', 'Bag Gremlins', 'Bags Ahoy', 'Bagzilla',
  'Bagtastic Four', 'Bagnificent Seven', 'The Bagfather', 'Bag Street Boys', "Bagstreet's Back",
  'Bags in Black', 'Honey I Shrunk the Bags', 'Bag Minds Think Alike', 'Bag to Basics', 'Bag in Time',
  'Bag Day Afternoon', 'Bagpackers', 'Bagtender', 'Tote-ally Awesome', 'Tote Bag Terrors',
  'Tote Recall', "Bags N' Harmony", 'Duffel Trouble', 'Duffel Up', 'Satchel Paige Turners',
  'Satchel Slingers', 'Purse Snatchers', 'Clutch Purses', 'Man Purse Mafia', 'Fanny Pack Attack',
  'Knapsack Attack', 'Rucksack Rascals', 'Mailbag Maulers', 'Grab Bag Gang', 'Mixed Bag',
  'Bag of Bones', 'Bag of Hammers', 'Bag of Rocks', 'Dumber Than a Bag of Rocks', 'Hot Air Bags',
  'Old Bags', 'Saggy Bags', 'Baggy Eyes', 'Bags Under My Eyes', 'Teabag Tuesday',
  'Bagging Area', 'Unexpected Item in Bag Area', 'Please Bag Responsibly', 'Bag Holders', 'Left Holding the Bag',
  'Bag Bros', 'Bagsquatch', 'Bag Vader', 'May the Bags Be With You', 'Game of Bags',
  'Lord of the Bags', 'The Fellowship of the Bag', 'One Bag to Rule Them All', 'Bilbo Baggins Fan Club', 'Bag End Boys',
  'Precious Bags', 'Bags Life', 'Thug Bags', 'Big Bag Theory', 'Bagging Bad',
  'Better Call Bag', 'Breaking Bags', 'Bag Mirror', 'The Bag Lebowski', 'Bagnum P.I.',
  'Bag Runners', 'Sleepy Bags', 'Bag of Chips', 'Chip Bag Champs', 'Snack Bag Attack',
  'Bags of Sunflower Seeds', 'Seed Bag Spitters', 'Rosin Bags', 'Rosin Bag Rascals', 'Base Bags',
  'Bags Loaded', 'Bags Juiced', 'Juiced Bags', 'Stolen Bags', 'Bag Thieves',
  'Bag Swipers', 'Swipe the Bag', 'Take the Extra Bag', 'Four Bags', 'Four-Bag Fury',
  'Tater Bags', 'Dinger Bags', 'Moonshot Bags', 'Bags Deep', 'Deep Bags',
  'Walk-Off Bags', 'Bag Flip', 'Bat Flip Bags', 'Bags and Balls', 'Chin Music Bags',
  'Bags for Days', "Bags o' Plenty", 'Bagtholomew', 'Sir Bags-a-Lot', 'Bags McGee',
  'Baggy McBagface', 'Bag II Men', 'Bags Brothers', 'Baggage Handlers', 'Lost Baggage',
  'Emotional Baggage', 'Excess Baggage', 'Checked Baggage', 'Baggage Fees', 'Bag Fee Bandits',
  'Carry On My Wayward Bag', 'Bag Me Maybe', 'Ice Ice Bagby', 'Baggy Pop', "Guns N' Bags",
  'Bag Jovi', 'Bagsteen', 'Notorious B.A.G.', 'The Bagtles', 'Bag Floyd',
  'Bagsmith', 'AC/Bags', 'Bag Fight Club', 'First Rule of Bag Club', 'Bag Lightyear',
  'To Bag or Not to Bag', 'Bags Over Brews', 'Bag Sweats', 'Bag Nasty', 'Hefty Bags',
];

/** For "<adjective> Bags" and "<adjective> <adjective> Bags". At most 12 characters each. */
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

/**
 * A random name, equally likely to be one of the puns, "<adjective> Bags", or
 * "<adjective> <adjective> Bags" (two different adjectives).
 */
export function randomTeamName(random: () => number = Math.random): string {
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const style = Math.floor(random() * 3);
  if (style === 0) return pick(TEAM_NAMES);
  const first = pick(ADJECTIVES);
  if (style === 1) return `${first} Bags`;
  let second = pick(ADJECTIVES);
  while (second === first) second = pick(ADJECTIVES);
  return `${first} ${second} Bags`;
}
