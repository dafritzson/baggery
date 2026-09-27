// Writes a migration that loads past postseasons' hits into mlb_hits, from MLB's play-by-play, so
// the Standings can replay those seasons bag by bag. poll-games reads each game's hits as it's
// played; seasons imported from the old sheets never had theirs read.
//
//   npx tsx scripts/history/hits.ts 2020 2021 2022 2023 2024
//
// Each game's hits are checked against its box score (hits per batter) first; any mismatch stops
// the script. The migration only inserts hits of games the database has (a fresh local database
// has none of these seasons), and leaves hits already there alone.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { boxscoreBatting, type HitRow, playHits, scheduleGames } from '../../supabase/functions/poll-games/feed.ts';
import { mlb, pool } from './mlb.ts';

const years = process.argv.slice(2).map(Number);
if (!years.length || years.some((y) => !Number.isInteger(y))) {
  console.error('Usage: npx tsx scripts/history/hits.ts <year> [year …]');
  process.exit(1);
}

const all: HitRow[] = [];
const problems: string[] = [];
for (const year of years) {
  const teams = await mlb(`/teams?sportId=1&season=${year}`);
  const schedule = await mlb(`/schedule?sportId=1&season=${year}&gameType=F,D,L,W`);
  const games = scheduleGames(schedule, year, new Set(teams.teams.map((t: { id: number }) => t.id))).filter((g) => g.status === 'Final');
  const loaded = await pool(games, 6, async (g) => ({
    gamePk: g.game_pk,
    hits: playHits(g.game_pk, await mlb(`/game/${g.game_pk}/playByPlay`)),
    box: boxscoreBatting(g.game_pk, await mlb(`/game/${g.game_pk}/boxscore`)).rows,
  }));
  let count = 0;
  for (const { gamePk, hits, box } of loaded) {
    for (const b of box) {
      const found = hits.filter((h) => h.mlb_player_id === b.mlb_player_id);
      const tb = found.reduce((a, h) => a + { '1B': 1, '2B': 2, '3B': 3, HR: 4 }[h.event], 0);
      if (found.length !== b.h || tb !== b.tb) {
        problems.push(`${year} game ${gamePk}, player ${b.mlb_player_id}: box score ${b.h} H / ${b.tb} TB, play-by-play ${found.length} H / ${tb} TB`);
      }
    }
    const missingTime = hits.filter((h) => !h.ended_at).length;
    if (missingTime) problems.push(`${year} game ${gamePk}: ${missingTime} hits without an end time`);
    all.push(...hits);
    count += hits.length;
  }
  console.log(`${year}: ${games.length} games, ${count} hits`);
}
if (problems.length) {
  console.error(`\n${problems.length} problems, no migration written:\n${problems.join('\n')}`);
  process.exit(1);
}

const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const values = all
  .map((h) => `  (${q(h.play_id)}, ${h.game_pk}, ${h.mlb_player_id}, ${q(h.event)}, ${h.inning}, ${h.top_inning}, ${q(h.ended_at)})`)
  .join(',\n');
const span = years.length > 1 ? `${Math.min(...years)}–${Math.max(...years)}` : String(years[0]);
const sql = `-- ${span} postseason hits (${all.length}), from MLB's play-by-play, so the Standings can replay those
-- seasons bag by bag. Written by scripts/history/hits.ts, which checked every game's hits against
-- its box score. Only games this database has get their hits, and hits already here stay as they are.

insert into public.mlb_hits (play_id, game_pk, mlb_player_id, event, inning, top_inning, ended_at)
select v.play_id::uuid, v.game_pk, v.mlb_player_id, v.event, v.inning, v.top_inning, v.ended_at::timestamptz
from (values
${values}
) as v (play_id, game_pk, mlb_player_id, event, inning, top_inning, ended_at)
where exists (select 1 from public.mlb_games g where g.game_pk = v.game_pk)
on conflict (play_id) do nothing;

-- The trigger queued each new hit for the live scores broadcast; past seasons' hits aren't news.
delete from private.score_changes
where tbl = 'mlb_hits'
  and (row ->> 'game_pk')::integer in (
    select game_pk from public.mlb_games where season_year between ${Math.min(...years)} and ${Math.max(...years)});
`;
const file = join(import.meta.dirname, '../../supabase/migrations/20261012000000_past_season_hits.sql');
writeFileSync(file, sql);
console.log(`\nWrote ${all.length} hits to ${file}`);
