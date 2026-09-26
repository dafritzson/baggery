// Filters on the player table's columns: keep rows whose value in a column is at least and/or at
// most some number. Pure, so tests/ can check it without React Native.

/** Bounds on one column; null is no bound. */
export interface Range {
  min: number | null;
  max: number | null;
}

/** A column's filter, with how to read its value from a row. */
export interface ColumnFilter<R> {
  value: (row: R) => number | null;
  range: Range;
}

/** Whether a value is in bounds. A missing value (no stats yet) never passes a filter. */
export function inRange(value: number | null, range: Range): boolean {
  if (range.min === null && range.max === null) return true;
  if (value === null) return false;
  return (range.min === null || value >= range.min) && (range.max === null || value <= range.max);
}

/** The rows that pass every filter. */
export function filterRows<R>(rows: R[], filters: ColumnFilter<R>[]): R[] {
  return filters.length ? rows.filter((r) => filters.every((f) => inRange(f.value(r), f.range))) : rows;
}

/**
 * Round numbers to offer as bounds for a column: evenly spaced (1, 2 or 5 × a power of ten) across
 * the middle 90% of its values, so a few 1-at-bat players don't stretch them. About 3 to 8 of them.
 */
export function thresholds(values: (number | null)[]): number[] {
  const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < 2) return [];
  const lo = sorted[Math.floor((sorted.length - 1) * 0.05)];
  const hi = sorted[Math.ceil((sorted.length - 1) * 0.95)];
  if (hi <= lo) return [];
  const rough = (hi - lo) / 8;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)!;
  const out: number[] = [];
  for (let i = Math.floor(lo / step) + 1; i * step < hi; i++) out.push(Number((i * step).toFixed(10)));
  return out;
}
