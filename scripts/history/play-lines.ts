// Writes a migration that loads postseasons' play-by-play batting lines into mlb_play_lines, so
// the Standings can rebuild any moment of those seasons exactly (tiebreakers included).
// poll-games saves them for games it reads from now on.
//
//   npx tsx scripts/history/play-lines.ts 2020 2021 2022 2023 2024 2025
//
// Every game's lines, summed per player, are checked against its box score first. A mismatch in
// bags, hits, homers, walks, hit-by-pitches, sac flies, runs or RBI stops the script. At-bat
// mismatches are only listed: a pinch hitter who comes in mid-count leaves the strikeout (or walk)
// on the first batter in the box score, which the play-by-play doesn't say.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { boxscoreBatting, type PlayLineRow, playLines, scheduleGames } from '../../supabase/functions/poll-games/feed.ts';
import { mlb, pool } from './mlb.ts';

const years = process.argv.slice(2).map(Number);
if (!years.length || years.some((y) => !Number.isInteger(y))) {
  console.error('Usage: npx tsx scripts/history/play-lines.ts <year> [year …]');
  process.exit(1);
}

const STRICT = ['tb', 'h', 'hr', 'bb', 'hbp', 'sf', 'r', 'rbi'] as const;
const all: PlayLineRow[] = [];
const problems: string[] = [];
const notes: string[] = [];
for (const year of years) {
  const teams = await mlb(`/teams?sportId=1&season=${year}`);
  const schedule = await mlb(`/schedule?sportId=1&season=${year}&gameType=F,D,L,W`);
  const games = scheduleGames(schedule, year, new Set(teams.teams.map((t: { id: number }) => t.id))).filter((g) => g.status === 'Final');
  const loaded = await pool(games, 6, async (g) => ({
    gamePk: g.game_pk,
    lines: playLines(g.game_pk, await mlb(`/game/${g.game_pk}/playByPlay`)),
    box: boxscoreBatting(g.game_pk, await mlb(`/game/${g.game_pk}/boxscore`)).rows,
  }));
  let count = 0;
  for (const { gamePk, lines, box } of loaded) {
    for (const b of box) {
      const mine = lines.filter((l) => l.mlb_player_id === b.mlb_player_id);
      const sum = (k: keyof PlayLineRow) => mine.reduce((a, l) => a + (l[k] as number), 0);
      for (const k of STRICT) if (sum(k) !== b[k]) problems.push(`${year} game ${gamePk}, player ${b.mlb_player_id}: ${k} box ${b[k]}, play-by-play ${sum(k)}`);
      if (sum('ab') !== b.ab || sum('pa') !== b.pa) notes.push(`${year} game ${gamePk}, player ${b.mlb_player_id}: AB/PA box ${b.ab}/${b.pa}, play-by-play ${sum('ab')}/${sum('pa')}`);
    }
    const missingTime = lines.filter((l) => !l.ended_at).length;
    if (missingTime) problems.push(`${year} game ${gamePk}: ${missingTime} lines without an end time`);
    all.push(...lines);
    count += lines.length;
  }
  console.log(`${year}: ${games.length} games, ${count} lines`);
}
if (notes.length) console.log(`\nAt-bat differences (mid-count pinch hitters), left as MLB's play-by-play has them:\n${notes.join('\n')}`);
if (problems.length) {
  console.error(`\n${problems.length} problems, no migration written:\n${problems.join('\n')}`);
  process.exit(1);
}

const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const values = all
  .map((l) => `  (${l.game_pk},${l.at_bat},${l.mlb_player_id},${q(l.ended_at)},${l.pa},${l.ab},${l.h},${l.tb},${l.hr},${l.bb},${l.hbp},${l.sf},${l.r},${l.rbi})`)
  .join(',\n');
const span = years.length > 1 ? `${Math.min(...years)}–${Math.max(...years)}` : String(years[0]);
const sql = `-- ${span} postseason batting lines, play by play (${all.length} rows), from MLB's play-by-play.
-- Written by scripts/history/play-lines.ts, which checked every game against its box score. Only
-- games this database has get their lines, and lines already here stay as they are.

insert into public.mlb_play_lines (game_pk, at_bat, mlb_player_id, ended_at, pa, ab, h, tb, hr, bb, hbp, sf, r, rbi)
select v.game_pk, v.at_bat, v.mlb_player_id, v.ended_at::timestamptz, v.pa, v.ab, v.h, v.tb, v.hr, v.bb, v.hbp, v.sf, v.r, v.rbi
from (values
${values}
) as v (game_pk, at_bat, mlb_player_id, ended_at, pa, ab, h, tb, hr, bb, hbp, sf, r, rbi)
where exists (select 1 from public.mlb_games g where g.game_pk = v.game_pk)
on conflict do nothing;
`;
const file = join(import.meta.dirname, '../../supabase/migrations/20261013000100_past_play_lines.sql');
writeFileSync(file, sql);
console.log(`\nWrote ${all.length} lines to ${file}`);
