// Reads a season's league workbook (one Google Sheet per year, downloaded as .xlsx) into a
// normalized season. The layout is described in .claude/skills/import-season/SKILL.md.
// Everything is found by its labels (WC1, DS1, "Round", "Daily Total", ...), never by fixed
// columns, because columns shift between years (2021 had a one-game Wild Card).

import { basename } from 'node:path';

import { type Cell, type Grid, readWorkbook } from './xlsx.ts';

export type GameType = 'F' | 'D' | 'L' | 'W';

/** The workbook's column prefix for each MLB series, and the fantasy round it scores in. */
export const STAGES: { prefix: string; type: GameType; round: 1 | 2 | 3 }[] = [
  { prefix: 'WC', type: 'F', round: 1 },
  { prefix: 'DS', type: 'D', round: 1 },
  { prefix: 'CS', type: 'L', round: 2 },
  { prefix: 'WS', type: 'W', round: 3 },
];

export interface DraftRow {
  manager: string;
  /** Null for a yield ("-", "--", "none" or blank). */
  add: string | null;
  drop: string | null;
  /** 1-based spreadsheet row, for error messages. */
  row: number;
}

export interface SheetDraft {
  number: number;
  /** In the order the sheet lists them, which is the order they were made. */
  rows: DraftRow[];
}

/** A manager's four players for one MLB series, with the bags the sheet recorded per game. */
export interface Lineup {
  manager: string;
  type: GameType;
  players: { name: string; bags: (number | null)[] }[];
}

export interface SheetSeason {
  year: number;
  file: string;
  /** Round 1 managers, in the order Live Scores lists them. */
  managers: string[];
  drafts: SheetDraft[];
  lineups: Lineup[];
  /** Round totals from Live Scores; a round lists only the managers still alive in it. */
  rounds: { round: number; totals: { manager: string; bags: number }[] }[];
}

const YIELD = new Set(['', '-', '--', '---', 'none', 'n/a', 'yield']);

function text(c: Cell | undefined): string {
  return c === null || c === undefined ? '' : String(c).trim().replace(/\s+/g, ' ');
}

function num(c: Cell | undefined): number | null {
  if (c === null || c === undefined || c === '') return null;
  const n = typeof c === 'number' ? c : Number(String(c).trim());
  return Number.isFinite(n) ? n : null;
}

/** Row and column of the first cell whose text matches. */
function find(grid: Grid, match: (s: string) => boolean): [number, number] | null {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) if (match(text(row[c]))) return [r, c];
  }
  return null;
}

/** Game columns (header "WC1", "DS2", ...) for one series prefix, in game order. */
function gameColumns(header: Cell[], prefix: string): { col: number; game: number }[] {
  const cols: { col: number; game: number }[] = [];
  header.forEach((c, col) => {
    const m = new RegExp(`^${prefix}\\s?(\\d)$`, 'i').exec(text(c));
    if (m) cols.push({ col, game: Number(m[1]) });
  });
  return cols.sort((a, b) => a.game - b.game);
}

function yearOf(file: string): number {
  const m = /(20\d\d)/.exec(basename(file));
  if (!m) throw new Error(`No year in the file name: ${file}`);
  return Number(m[1]);
}

function parseLiveScores(grid: Grid): SheetSeason['rounds'] {
  const at = find(grid, (s) => /^WC\s?1$/i.test(s));
  if (!at) throw new Error('Live Scores: no WC1 header');
  const [hr] = at;
  const header = grid[hr];
  const rounds: SheetSeason['rounds'] = [];
  const firstCol = { 1: 'WC', 2: 'CS', 3: 'WS' } as const;
  for (const round of [1, 2, 3] as const) {
    const first = gameColumns(header, firstCol[round])[0];
    const totalCol = header.findIndex((c) => new RegExp(`^RD\\s?${round}$`, 'i').test(text(c)));
    if (!first || totalCol < 0) throw new Error(`Live Scores: no columns for round ${round}`);
    const totals: { manager: string; bags: number }[] = [];
    for (let r = hr + 1; text(grid[r]?.[first.col - 1]); r++) {
      totals.push({ manager: text(grid[r][first.col - 1]), bags: num(grid[r][totalCol]) ?? 0 });
    }
    rounds.push({ round, totals });
  }
  return rounds;
}

function parseDraft(grid: Grid, number: number): SheetDraft {
  const at = find(grid, (s) => s === 'Round');
  if (!at) throw new Error(`Draft ${number}: no "Round" header`);
  const [hr] = at;
  const header = grid[hr].map(text);
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const roundCol = col(/^Round$/);
  const teamCol = col(/^Fantasy Team$/);
  const addCol = col(/^(Drafted )?Player$/);
  const dropCol = col(/^Dropped Player$/);
  if (teamCol < 0 || addCol < 0) throw new Error(`Draft ${number}: missing Fantasy Team or Player column`);
  const rows: DraftRow[] = [];
  for (let r = hr + 1; num(grid[r]?.[roundCol]) !== null; r++) {
    const manager = text(grid[r][teamCol]);
    if (!manager) continue;
    const add = text(grid[r][addCol]);
    const drop = dropCol < 0 ? '' : text(grid[r][dropCol]);
    const isYield = YIELD.has(add.toLowerCase());
    rows.push({
      manager,
      add: isYield ? null : add,
      drop: isYield || YIELD.has(drop.toLowerCase()) ? null : drop,
      row: r + 1,
    });
  }
  return { number, rows };
}

function parseManager(grid: Grid, manager: string): Lineup[] {
  const at = find(grid, (s) => /^WC\s?1$/i.test(s));
  if (!at) throw new Error(`${manager}: no WC1 header`);
  const [hr] = at;
  const lineups: Lineup[] = [];
  for (const stage of STAGES) {
    const cols = gameColumns(grid[hr], stage.prefix);
    // Tabs of managers knocked out early can stop before the later series' columns.
    if (!cols.length) continue;
    const nameCol = cols[0].col - 1;
    const players: Lineup['players'] = [];
    for (let r = hr + 1; r < hr + 8; r++) {
      const name = text(grid[r]?.[nameCol]);
      if (/^Daily Total$/i.test(name)) break;
      if (!name) continue;
      // bags[g - 1] is game g of the series, so a one-game Wild Card still indexes from 0.
      const bags: (number | null)[] = [];
      for (const c of cols) bags[c.game - 1] = num(grid[r][c.col]);
      players.push({ name, bags: Array.from(bags, (b) => b ?? null) });
    }
    if (players.length) lineups.push({ manager, type: stage.type, players });
  }
  return lineups;
}

export function readSeason(file: string): SheetSeason {
  const sheets = readWorkbook(file);
  const get = (name: string) => {
    const grid = [...sheets].find(([n]) => n.trim().toLowerCase() === name.toLowerCase())?.[1];
    if (!grid) throw new Error(`${basename(file)}: no "${name}" sheet`);
    return grid;
  };
  const rounds = parseLiveScores(get('Live Scores'));
  const managers = rounds[0].totals.map((t) => t.manager);
  return {
    year: yearOf(file),
    file,
    managers,
    drafts: [1, 2, 3, 4].map((n) => parseDraft(get(`Draft ${n}`), n)),
    lineups: managers.flatMap((m) => parseManager(get(m), m)),
    rounds,
  };
}
