// A minimal .xlsx reader: each sheet's cell values (cached formula results, not formulas) as a
// grid. Enough for the league workbooks without a spreadsheet dependency. An .xlsx is a zip of
// XML files; this reads the zip's central directory and inflates the few entries it needs.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export type Cell = string | number | boolean | null;
/** grid[row][col], both 0-based (A1 is grid[0][0]). Missing cells are undefined. */
export type Grid = Cell[][];

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: the last 0x06054b50 signature.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]!;
  });
}

/** Concatenated text of every <t> element (plain and rich-text runs). */
function texts(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): Grid {
  const grid: Grid = [];
  const cell = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  for (const [, col, row, attrs, body] of xml.matchAll(cell)) {
    if (!body) continue;
    const type = /\st="([^"]+)"/.exec(attrs)?.[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let value: Cell;
    if (type === 's') value = v === undefined ? null : shared[Number(v)];
    else if (type === 'inlineStr') value = texts(body);
    else if (type === 'str') value = v === undefined ? null : decode(v);
    else if (type === 'b') value = v === '1';
    else if (type === 'e') value = null;
    else value = v === undefined ? null : Number(v);
    const r = Number(row) - 1;
    (grid[r] ??= [])[colIndex(col)] = value;
  }
  return grid;
}

/** Every sheet of the workbook at `path`, by sheet name. */
export function readWorkbook(path: string): Map<string, Grid> {
  const files = unzip(readFileSync(path));
  const xml = (name: string) => files.get(name)?.toString('utf8') ?? '';
  const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const targets = new Map(
    [...xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map(
      ([, id, target]) => [id, target.startsWith('/') ? target.slice(1) : `xl/${target}`],
    ),
  );
  const sheets = new Map<string, Grid>();
  for (const [, attrs] of xml('xl/workbook.xml').matchAll(/<sheet\s([^>]*?)\/>/g)) {
    const name = decode(/name="([^"]*)"/.exec(attrs)![1]);
    const rid = /r:id="([^"]+)"/.exec(attrs)![1];
    sheets.set(name, parseSheet(xml(targets.get(rid)!), shared));
  }
  return sheets;
}
