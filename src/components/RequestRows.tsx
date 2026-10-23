"use client";
import type { RowJson } from "@/lib/callRows";

// (NEXT-UI 7) The call request's time rows, the same on both sides: each row has its own "Once / Daily / Weekly" (Once by
// default) and, when it repeats, a calls drop-down: 2-8 and "Forever" at the bottom. Up to 3 rows; with more than one row
// the other side picks ONE.

export type RowState = { when: string; repeat: "once" | "daily" | "weekly"; count: string };
export const newRow = (): RowState => ({ when: "", repeat: "once", count: "4" });

/** The rows as the API wants them (empty rows left out). */
export function rowsPayload(rows: RowState[]): RowJson[] {
  return rows.filter((r) => r.when).map((r) => ({ startsAt: new Date(r.when).toISOString(), repeat: r.repeat, count: r.repeat === "once" ? 1 : r.count === "forever" ? 0 : Number(r.count) }));
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const short = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
const unit = (r: RowJson) => (r.repeat === "daily" ? "Daily" : "Weekly");

/** One row in words: "Thu, Nov 5, 3:00 PM" / "Weekly Thu 3:00 PM (4 calls)" / "Daily Thu 3:00 PM (Forever)". */
export const rowText = (r: RowJson) => (r.repeat === "once" ? fmt(r.startsAt) : `${unit(r)} ${short(r.startsAt)} (${r.count ? `${r.count} calls` : "Forever"})`);

/** A waiting request in words. */
export function describeRows(rows: RowJson[]) {
  if (rows.length === 1) {
    const r = rows[0];
    return r.repeat === "once" ? fmt(r.startsAt) : `${unit(r).toLowerCase()} calls: ${short(r.startsAt)} · ${r.count ? `${r.count} calls from ${fmt(r.startsAt)}` : `Forever, from ${fmt(r.startsAt)}`}`;
  }
  return `one of: ${rows.map(rowText).join(" · ")}`;
}

/** The Accept button(s) of a waiting request: one per row when there is a choice, else one. */
export function acceptChoices(rows: RowJson[]): { label: string; time?: string }[] {
  if (rows.length === 1) {
    const r = rows[0];
    return [{ label: r.repeat !== "once" && r.count ? `Accept all ${r.count}` : "Accept" }];
  }
  return rows.map((r) => ({ label: `Accept ${r.repeat === "once" ? short(r.startsAt) : rowText(r)}`, time: r.startsAt }));
}

export function RequestRows({ rows, setRows, minNow }: { rows: RowState[]; setRows: (r: RowState[]) => void; minNow: string }) {
  const set = (i: number, patch: Partial<RowState>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2" data-request-row="">
          <input type="datetime-local" min={minNow} data-msg="Pick a time in the future." aria-label={`Requested time ${i + 1}`} className="input max-w-xs" value={r.when} onChange={(e) => set(i, { when: e.target.value })} />
          <select aria-label={`Repeat ${i + 1}`} className="input w-auto" value={r.repeat} onChange={(e) => set(i, { repeat: e.target.value as RowState["repeat"] })}>
            <option value="once">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          {r.repeat !== "once" && (
            <select aria-label={`How many calls ${i + 1}`} className="input w-auto" value={r.count} onChange={(e) => set(i, { count: e.target.value })}>
              {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={String(n)}>{n} calls</option>)}
              <option value="forever">Forever</option>
            </select>
          )}
          {rows.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      {rows.length < 3 && <button type="button" className="btn-ghost" onClick={() => setRows([...rows, newRow()])}>+ Another time</button>}
      {rows.length > 1 && <p className="note">They pick one of these.</p>}
    </div>
  );
}
