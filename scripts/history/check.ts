// Reads past seasons' workbooks, matches them to MLB data and reports anything that doesn't add
// up, then writes each season as history/<year>.json for the import.
//
//   npx tsx scripts/history/check.ts                 every workbook in history/
//   npx tsx scripts/history/check.ts 2021 2022       just those years
//
// Checks: every name matches one MLB player; each draft, replayed, gives the lineup the
// manager's tab shows; every per-game bag in the sheet equals the MLB box score; and the app's
// own scoring and ranking, run on the imported rosters, advance the teams that advanced.
// Only a season without errors gets a file. Import it in the app: Settings → Past seasons.

import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type DraftAction, type DraftConfig, nextTurn } from '../../supabase/functions/_shared/core/draft.ts';
import { type SeasonImport, validateSeasonImport } from '../../supabase/functions/_shared/core/season-import.ts';
import {
  eliminations,
  type PlayerGameStat,
  rankTeams,
  type RosterSpell,
  teamRoundTotals,
} from '../../supabase/functions/_shared/core/scoring.ts';
import type { FantasyRound } from '../../supabase/functions/_shared/core/types.ts';
import { loadPostseason, type Postseason } from './mlb.ts';
import { matchName } from './names.ts';
import { type GameType, readSeason, type SheetSeason, STAGES } from './workbook.ts';

const maxBy = (totals: { manager: string; bags: number }[]) => [...totals].sort((a, b) => b.bags - a.bags)[0];

const HISTORY = join(import.meta.dirname, '../../history');
const DRAFT_BEFORE: GameType[] = ['F', 'D', 'L', 'W'];

interface Report {
  /** Must be fixed (in the sheet or the name aliases) before importing. */
  errors: string[];
  /** Sheet typos and missed games. The import uses MLB's numbers, so these are just reported. */
  differences: string[];
  notes: string[];
}

function checkSeason(sheet: SheetSeason, ps: Postseason): { season: SeasonImport; report: Report } {
  const report: Report = { errors: [], differences: [], notes: [] };
  const err = (s: string) => report.errors.push(s);
  const hitters = [...ps.hitters.values()];

  // Names → ids, reporting anything that wasn't an exact match.
  const ids = new Map<string, number>();
  const resolve = (name: string, where: string): number | null => {
    if (ids.has(name)) return ids.get(name)!;
    const m = matchName(name, hitters);
    if (m.id === null) {
      err(`${where}: "${name}" → ${m.how}${m.candidates.length ? `: ${m.candidates.join(', ')}` : ''}`);
      return null;
    }
    if (m.how !== 'exact') report.notes.push(`"${name}" → ${ps.hitters.get(m.id)!.fullName} (${m.how})`);
    ids.set(name, m.id);
    return m.id;
  };
  const who = (id: number | null) => (id === null ? '?' : (ps.hitters.get(id)?.fullName ?? String(id)));

  // Draft lock times: first pitch of the series each draft was before.
  const firstPitch = (t: GameType) =>
    ps.games.filter((g) => g.game_type === t).map((g) => g.start_time).sort()[0];

  // Who was alive in each fantasy round: the managers Live Scores lists for it.
  const alive = (r: number) => new Set(sheet.rounds[r - 1]?.totals.map((t) => t.manager) ?? []);

  // Replay the drafts, checking each against the lineup the manager's tab shows.
  const rosters = new Map(sheet.managers.map((m) => [m, new Set<number>()]));
  const everDrafted = new Set<number>();
  const drafts: SeasonImport['drafts'] = [];
  const spells: (RosterSpell & { manager: string })[] = [];
  for (const d of sheet.drafts) {
    const type = DRAFT_BEFORE[d.number - 1];
    const locksAt = firstPitch(type);
    // Drafts 1–2 are before round 1; 3 and 4 only include round 2's and round 3's survivors.
    const participants = alive(Math.max(1, d.number - 1));
    const picks = new Map([...participants].map((m) => [m, [] as { add: number; drop: number | null }[]]));
    for (const row of d.rows) {
      const where = `Draft ${d.number} row ${row.row} (${row.manager})`;
      const roster = rosters.get(row.manager);
      if (!roster || !participants.has(row.manager)) {
        err(`${where}: ${roster ? 'was already eliminated' : 'unknown manager'}`);
        continue;
      }
      if (row.add === null) continue;
      const add = resolve(row.add, where);
      const drop = row.drop === null ? null : resolve(row.drop, where);
      if (d.number > 1 && row.drop === null) err(`${where}: drafted ${row.add} without dropping anyone`);
      if (add !== null && everDrafted.has(add)) err(`${where}: ${who(add)} was already drafted this season`);
      if (drop !== null && !roster.has(drop)) err(`${where}: dropped ${who(drop)}, who isn't on the roster`);
      if (drop !== null) {
        roster.delete(drop);
        const spell = spells.find((s) => s.playerId === drop && s.to === null);
        if (spell) spell.to = locksAt;
      }
      if (add !== null) {
        roster.add(add);
        everDrafted.add(add);
        spells.push({ manager: row.manager, teamId: row.manager, playerId: add, from: locksAt, to: null });
        picks.get(row.manager)!.push({ add, drop });
      }
    }

    // The app's draft model: a snake in pick order, where a yield sits a team out for the rest of
    // the draft. The sheets list turns loosely (2025's Draft 4 skips rows), so rebuild the draft
    // as that snake: each team makes its picks in the sheet's order, then yields. Rosters come out
    // the same, and the draft room can replay it.
    const pickOrder = [...new Set([...d.rows.map((r) => r.manager).filter((m) => participants.has(m)), ...participants])];
    const config: DraftConfig = { kind: d.number === 1 ? 'initial' : 'redraft', order: pickOrder, rounds: 4 };
    const actions: SeasonImport['drafts'][number]['actions'] = [];
    const replayed: DraftAction[] = [];
    for (let turn = nextTurn(config, replayed); turn; turn = nextTurn(config, replayed)) {
      const pick = picks.get(turn.teamId)!.shift();
      if (pick) {
        actions.push({ manager: turn.teamId, type: 'pick', add: pick.add, drop: pick.drop });
        replayed.push({ type: 'pick', teamId: turn.teamId, addPlayerId: pick.add, dropPlayerId: pick.drop ?? undefined });
      } else if (config.kind === 'initial') {
        err(`Draft 1: ${turn.teamId} has fewer than 4 picks`);
        break;
      } else {
        actions.push({ manager: turn.teamId, type: 'yield', add: null, drop: null });
        replayed.push({ type: 'yield', teamId: turn.teamId });
      }
    }
    for (const [m, left] of picks) if (left.length) err(`Draft ${d.number}: ${m} has more picks than turns`);
    drafts.push({ number: d.number, locksAt, pickOrder, actions });

    for (const lineup of sheet.lineups.filter((l) => l.type === type)) {
      const shown = new Set(lineup.players.map((p) => resolve(p.name, `${lineup.manager} tab, ${type}`)));
      const roster = rosters.get(lineup.manager)!;
      const missing = [...roster].filter((id) => !shown.has(id));
      const extra = [...shown].filter((id) => id !== null && !roster.has(id));
      if (missing.length || extra.length) {
        err(
          `After Draft ${d.number}, ${lineup.manager}'s tab shows ${extra.map(who).join(', ') || 'nobody extra'}` +
            ` but the drafts give ${missing.map(who).join(', ') || 'nobody extra'}`,
        );
      }
    }
  }

  // Every per-game bag against the box score.
  const gamesOf = (teamId: number, type: GameType) =>
    ps.games.filter((g) => g.game_type === type && (g.home_team_id === teamId || g.away_team_id === teamId));
  for (const lineup of sheet.lineups) {
    for (const p of lineup.players) {
      const id = ids.get(p.name);
      if (id === undefined) continue;
      const rows = ps.batting.filter((b) => b.mlb_player_id === id);
      const teamId =
        rows.find((b) => ps.games.find((g) => g.game_pk === b.game_pk)?.game_type === lineup.type)?.mlb_team_id ??
        ps.hitters.get(id)!.teamIds.find((t) => gamesOf(t, lineup.type).length);
      const games = teamId ? gamesOf(teamId, lineup.type) : [];
      const n = Math.max(p.bags.length, ...games.map((g) => g.series_game_number ?? 0));
      for (let i = 0; i < n; i++) {
        const game = games.find((g) => g.series_game_number === i + 1);
        const box = game ? (rows.find((b) => b.game_pk === game.game_pk)?.tb ?? null) : null;
        const cell = p.bags[i] ?? null;
        if ((cell ?? 0) !== (box ?? 0)) {
          report.differences.push(`${lineup.manager}, ${who(id)}, ${STAGES.find((s) => s.type === lineup.type)!.prefix}${i + 1}: sheet ${cell ?? 'blank'}, box score ${box ?? (game ? 'did not bat' : 'no game')}`);
        }
      }
    }
  }

  // The app's scoring on these rosters against Live Scores.
  const stats: PlayerGameStat[] = ps.batting.map((b) => {
    const g = ps.games.find((x) => x.game_pk === b.game_pk)!;
    return { ...b, playerId: b.mlb_player_id, gameType: g.game_type, gameStart: g.start_time };
  });
  for (const { round, totals } of sheet.rounds) {
    const computed = teamRoundTotals(round as FantasyRound, sheet.managers, spells, stats);
    for (const t of totals) {
      const tb = computed.find((c) => c.teamId === t.manager)?.tb;
      if (tb !== t.bags) report.differences.push(`Round ${round}, ${t.manager}: Live Scores ${t.bags}, MLB ${tb}`);
    }
    // Would MLB's numbers, ranked by the app's rules, have sent the same teams through?
    const standing = computed.filter((c) => totals.some((t) => t.manager === c.teamId));
    const next = round < 3 ? alive(round + 1) : new Set([maxBy(totals).manager]);
    const result = eliminations(rankTeams(standing), next.size);
    const same = result.advancing.length === next.size - (result.drinkOff?.spots ?? 0) &&
      result.advancing.every((m) => next.has(m)) &&
      (result.drinkOff?.teamIds.filter((m) => next.has(m)).length ?? 0) === (result.drinkOff?.spots ?? 0);
    if (!same) {
      err(`Round ${round}: the app's ranking of MLB's numbers advances ${result.advancing.join(', ')}` +
        `${result.drinkOff ? ` (drink-off: ${result.drinkOff.teamIds.join(', ')})` : ''}, but ${[...next].join(', ')} advanced`);
    } else if (result.drinkOff) {
      report.notes.push(`Round ${round}: ${result.drinkOff.teamIds.join(', ')} fully tied at the cut (drink-off)`);
    }
  }

  // Eliminations: whoever isn't listed in the next round; the round 3 leader is champion.
  const final = [...sheet.rounds[2].totals].sort((a, b) => b.bags - a.bags);
  const champion = final[0]?.manager;
  if (final[1] && final[0].bags === final[1].bags) err(`Round 3 is tied at the top: ${final[0].manager} and ${final[1].manager}`);
  const managers = sheet.managers.map((name) => {
    const lastRound = [3, 2, 1].find((r) => alive(r).has(name)) as 1 | 2 | 3;
    return { name, eliminatedAfterRound: name === champion ? null : lastRound };
  });
  report.notes.push(`Survivors: ${[1, 2, 3].map((r) => alive(r).size).join(' → ')} → 1 (${champion ?? '?'} champion)`);

  // MLB's champion: the team that won 4 World Series games.
  const wsWins = new Map<number, number>();
  for (const g of ps.games.filter((x) => x.game_type === 'W' && x.home_score !== null && x.away_score !== null)) {
    const winner = g.home_score! > g.away_score! ? g.home_team_id : g.away_team_id;
    wsWins.set(winner, (wsWins.get(winner) ?? 0) + 1);
  }
  const mlbChampion = [...wsWins].find(([, w]) => w === 4)?.[0];
  if (!mlbChampion) err('No team won 4 World Series games');

  const players = [...everDrafted].map((id) => {
    const played = ps.batting.find((b) => b.mlb_player_id === id);
    const h = ps.hitters.get(id)!;
    return { id, fullName: h.fullName, teamId: played?.mlb_team_id ?? h.teamIds.at(-1)! };
  });
  const mlbTeams = ps.teams.map((t) => ({ ...t, eliminated: t.id !== mlbChampion }));
  const season: SeasonImport = { year: sheet.year, managers, drafts, players, mlbTeams };
  // The same check the import runs, so a file that passes here imports.
  const invalid = report.errors.length ? null : validateSeasonImport(season);
  if (invalid) err(`Import check: ${invalid}`);
  return { season, report };
}

const years = process.argv.slice(2).map(Number);
const files = readdirSync(HISTORY)
  .filter((f) => f.endsWith('.xlsx'))
  .map((f) => join(HISTORY, f))
  .filter((f) => !years.length || years.some((y) => f.includes(String(y))))
  .sort();

let failed = false;
for (const file of files) {
  const sheet = readSeason(file);
  const ps = await loadPostseason(sheet.year);
  const { season, report } = checkSeason(sheet, ps);
  console.log(`\n## ${sheet.year}: ${ps.games.length} games, ${season.players.length} rostered players`);
  for (const n of report.notes) console.log(`   ${n}`);
  for (const d of report.differences) console.log(` ≠ ${d}`);
  for (const e of report.errors) console.log(` ✗ ${e}`);
  if (!report.errors.length) {
    console.log(report.differences.length ? ' ✓ importable: MLB numbers used, same teams advance' : ' ✓ everything matches');
  }
  failed ||= report.errors.length > 0;
  // Only a clean season gets a file, so nothing half-matched can be imported.
  const out = join(HISTORY, `${sheet.year}.json`);
  if (report.errors.length) rmSync(out, { force: true });
  else writeFileSync(out, `${JSON.stringify(season, null, 2)}\n`);
}
process.exitCode = failed ? 1 : 0;
