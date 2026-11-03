// (NEXT-UI 7) A call request is up to 3 time ROWS; each row is "Once" (default), "Daily" or "Weekly", and a repeating row
// has a number of calls (2-8) or "Forever" (count 0). The other side picks ONE row; a repeating pick books the whole set
// (Forever: the next 4 ahead, the daily job adds the next as each passes). Pure helpers, shared by the server and the pages.
// (Owner, Nov 2, batch 35 §132) No call of a row is after testers' work on the test ends (the END): a counted row keeps the calls up to it (one left: a single call),
// and Forever runs until it ("until testers' work ends").

export type RowRepeat = "once" | "daily" | "weekly";
export type CallRow = { startsAt: Date; repeat: RowRepeat; /** 1 = once; 2-8; 0 = Forever */ count: number };
/** (Batch 35 §132) `until` / `untilDay`: the end, and its day as the reader reads it ("Dec 3"), added for the pages (never stored): a repeating row stops there. */
export type RowJson = { startsAt: string; repeat: RowRepeat; count: number; until?: string; untilDay?: string };

export const DAY_MS = 86_400_000;
/** A Forever set keeps this many calls booked ahead. */
export const FOREVER_AHEAD = 4;
export const MAX_ROWS = 3;

export const stepMs = (repeat: RowRepeat | string) => (repeat === "daily" ? 1 : 7) * DAY_MS;

/** (Batch 35 §132) How many calls of a row starting at `startsAt` (one a day / a week) are no later than `end`, at most `cap`; 0 when the first is already after it. */
export function callsUntil(startsAt: Date, repeat: RowRepeat | string, end: Date | null | undefined, cap = Number.POSITIVE_INFINITY) {
  if (!end) return cap;
  if (startsAt.getTime() > end.getTime()) return 0;
  return Math.min(cap, Math.floor((end.getTime() - startsAt.getTime()) / stepMs(repeat)) + 1);
}

/**
 * (Batch 35 §132) A row cut at the end: the calls after it are dropped (not refused). A Daily / Weekly row needs at least 2 calls before the end: with only its first
 * one left it's a single call. Forever stays Forever (its calls stop at the end). null when even the first time is after the end (refused, never dropped).
 */
export function cutRow(row: CallRow, end: Date | null | undefined): CallRow | null {
  if (end && row.startsAt.getTime() > end.getTime()) return null;
  if (row.repeat === "once") return row;
  const n = callsUntil(row.startsAt, row.repeat, end, row.count === 0 ? Number.POSITIVE_INFINITY : row.count);
  if (n < 2) return { startsAt: row.startsAt, repeat: "once", count: 1 };
  return row.count === 0 ? row : { ...row, count: n };
}

/** The calls a row books now: one, the whole count, or (Forever) the next 4 ahead; (batch 35 §132) none after the end. */
export function occurrences(row: CallRow, end?: Date | null): Date[] {
  if (row.repeat === "once") return end && row.startsAt.getTime() > end.getTime() ? [] : [row.startsAt];
  const n = Math.min(row.count === 0 ? FOREVER_AHEAD : row.count, callsUntil(row.startsAt, row.repeat, end));
  return Array.from({ length: n }, (_, k) => new Date(row.startsAt.getTime() + k * stepMs(row.repeat)));
}

/** A stored request's rows: its `rows` JSON, or (older requests) its times / weeks / repeat. */
export function rowsOf(r: { rows?: unknown; times: Date[]; startsAt: Date; weeks: number; repeat?: string }): CallRow[] {
  if (Array.isArray(r.rows) && r.rows.length) {
    return (r.rows as RowJson[]).map((x) => ({ startsAt: new Date(x.startsAt), repeat: x.repeat, count: x.count }));
  }
  if (r.weeks > 0) return [{ startsAt: r.startsAt, repeat: r.repeat === "daily" ? "daily" : "weekly", count: r.weeks }];
  return (r.times.length ? r.times : [r.startsAt]).map((d) => ({ startsAt: d, repeat: "once" as const, count: 1 }));
}

/** The rows as JSON (as they're stored). (Batch 35 §132) For a page, `end` adds the end to each repeating row (`until`, and its day as the reader reads it). */
export const toJson = (rows: CallRow[], end?: { at: Date; day: string } | null): RowJson[] =>
  rows.map((r) => ({ startsAt: r.startsAt.toISOString(), repeat: r.repeat, count: r.count, ...(end && r.repeat !== "once" ? { until: end.at.toISOString(), untilDay: end.day } : {}) }));

/** (Batch 35 §132) How many calls a row covers: once 1; a counted row its count, up to the end; Forever every call up to the end (null: no end, so no number). */
export function rowCalls(r: RowJson): number | null {
  if (r.repeat === "once") return 1;
  const n = callsUntil(new Date(r.startsAt), r.repeat, r.until ? new Date(r.until) : null, r.count === 0 ? Number.POSITIVE_INFINITY : r.count);
  return Number.isFinite(n) ? n : null;
}
