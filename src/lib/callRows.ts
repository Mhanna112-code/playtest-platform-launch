// (NEXT-UI 7) A call request is up to 3 time ROWS; each row is "Once" (default), "Daily" or "Weekly", and a repeating row
// has a number of calls (2-8) or "Forever" (count 0). The other side picks ONE row; a repeating pick books the whole set
// (Forever: the next 4 ahead, the daily job adds the next as each passes). Pure helpers, shared by the server and the pages.

export type RowRepeat = "once" | "daily" | "weekly";
export type CallRow = { startsAt: Date; repeat: RowRepeat; /** 1 = once; 2-8; 0 = Forever */ count: number };
export type RowJson = { startsAt: string; repeat: RowRepeat; count: number };

export const DAY_MS = 86_400_000;
/** A Forever set keeps this many calls booked ahead. */
export const FOREVER_AHEAD = 4;
export const MAX_ROWS = 3;

export const stepMs = (repeat: RowRepeat | string) => (repeat === "daily" ? 1 : 7) * DAY_MS;

/** The calls a row books now: one, the whole count, or (Forever) the next 4 ahead. */
export function occurrences(row: CallRow): Date[] {
  if (row.repeat === "once") return [row.startsAt];
  const n = row.count === 0 ? FOREVER_AHEAD : row.count;
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

export const toJson = (rows: CallRow[]): RowJson[] => rows.map((r) => ({ startsAt: r.startsAt.toISOString(), repeat: r.repeat, count: r.count }));
