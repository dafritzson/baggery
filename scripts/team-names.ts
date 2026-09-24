// Encodes and decodes the pun team names in app/src/lib/team-name-list.ts, which are stored
// scrambled so they aren't readable in the source (no spoilers when browsing the code).
// The plain list lives in team-names.txt at the repo root, which git ignores.
//
//   npx tsx scripts/team-names.ts decode   # writes team-names.txt from the app's list
//   npx tsx scripts/team-names.ts encode   # prints the scrambled blob for team-names.txt;
//                                          # paste it into ENCODED_TEAM_NAMES
import { readFileSync, writeFileSync } from 'node:fs';

import { ENCODED_TEAM_NAMES, NAME_KEY, decodeTeamNames } from '../app/src/lib/team-name-list.ts';

const FILE = 'team-names.txt';

function encode(names: string[]): string {
  const text = names.join('\n');
  let bytes = '';
  for (let i = 0; i < text.length; i++) {
    bytes += String.fromCharCode(text.charCodeAt(i) ^ NAME_KEY.charCodeAt(i % NAME_KEY.length));
  }
  return btoa(bytes);
}

const command = process.argv[2];
if (command === 'decode') {
  writeFileSync(FILE, decodeTeamNames(ENCODED_TEAM_NAMES).join('\n') + '\n');
  console.log(`Wrote ${FILE}.`);
} else if (command === 'encode') {
  const names = readFileSync(FILE, 'utf8')
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
  const bad = names.filter((n) => n.length > 30 || /[^\x20-\x7e]/.test(n));
  if (bad.length) throw new Error(`Names must be plain ASCII, at most 30 characters: ${bad.join(', ')}`);
  const blob = encode(names);
  // Wrapped so the source stays readable.
  console.log(blob.match(/.{1,96}/g)!.map((line) => `  '${line}' +`).join('\n'));
  console.log(`// ${names.length} names`);
} else {
  console.log('Usage: npx tsx scripts/team-names.ts decode | encode');
}
