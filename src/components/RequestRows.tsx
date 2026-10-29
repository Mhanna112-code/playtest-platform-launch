"use client";
import type { RowJson } from "@/lib/callRows";
import { clashNotes, localFmt, type ClashLine, type ClashTarget, type Slot } from "@/lib/callClash";

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

/**
 * (Owner, Oct 28, batch 16 section 33) Each row's clash lines, aligned with the rows: under the row as it's typed; a red one also marks the row's time red
 * (data-red-msg: listed under the button, and the press waits until it's fixed), a blue one is information only.
 */
export function alignedClash(rows: RowState[], minutes: string, side: "developer" | "tester", targets: ClashTarget[], elsewhere: (Slot & { name: string })[]) {
  const idx: number[] = [];
  const filled: RowJson[] = [];
  rows.forEach((r, i) => {
    if (!r.when) return;
    const d = new Date(r.when);
    if (isNaN(d.getTime())) return;
    idx.push(i);
    filled.push({ startsAt: d.toISOString(), repeat: r.repeat, count: r.repeat === "once" ? 1 : r.count === "forever" ? 0 : Number(r.count) });
  });
  const n = clashNotes({ rows: filled, minutes: minutes.trim() ? Number(minutes) : null, side, targets, elsewhere, fmt: localFmt() });
  const notes: ClashLine[][] = rows.map(() => []);
  idx.forEach((i, k) => (notes[i] = n.rows[k]));
  return { notes, limits: n.limits };
}

/** (Batch 20 section 7) What a Request a time press made: its new waiting requests and, when it matched the other side's request, the booked call. */
export type PressMade = { requestIds: string[]; callIds: string[] };
export function madeBy(r: unknown): PressMade {
  const o = (r ?? {}) as { ids?: unknown; id?: unknown; callId?: unknown };
  const requestIds = Array.isArray(o.ids) ? o.ids.map(String) : typeof o.id === "string" ? [o.id] : [];
  return { requestIds, callIds: typeof o.callId === "string" ? [o.callId] : [] };
}

/**
 * (Batch 20 section 7, bug found by the owner) The clash checks' inputs while a Request a time press is on its way and after it went through. The page's data can
 * refresh in between (its 20-second poll sees the new request and refreshes before the reload lands), and the form still held the times it just sent, so its
 * own new request showed as "Overlaps your request to …" for a moment. Now: from the press until the reload, the checks use the data as it was when it was
 * pressed (`frozen`), never anything the press made (`made`), and the form clears as soon as the press succeeds.
 */
export function formClashInputs<T extends { requests: { id?: string }[]; calls: { id?: string }[] }>(live: T[], frozen: T[] | null, made: PressMade | null): T[] {
  const base = frozen ?? live;
  if (!made) return base;
  const req = new Set(made.requestIds), call = new Set(made.callIds);
  return base.map((t) => ({ ...t, requests: t.requests.filter((q) => !q.id || !req.has(q.id)), calls: t.calls.filter((c) => !c.id || !call.has(c.id)) }));
}

export function RequestRows({ rows, setRows, minNow, notes }: { rows: RowState[]; setRows: (r: RowState[]) => void; minNow: string; notes?: ClashLine[][] }) {
  const set = (i: number, patch: Partial<RowState>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2" data-request-row="">
          <input type="datetime-local" min={minNow} data-msg="Pick a time in the future." data-match="in the future|up to 3 times|exactly one time|overlaps|you have a call" data-red-msg={notes?.[i]?.find((x) => x.tone === "red")?.text || undefined} aria-label={`Requested time ${i + 1}`} className="input max-w-xs" value={r.when} onChange={(e) => set(i, { when: e.target.value })} />
          <select aria-label={`Repeat ${i + 1}`} className="input w-auto" value={r.repeat} onChange={(e) => set(i, { repeat: e.target.value as RowState["repeat"] })}>
            <option value="once">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          {r.repeat !== "once" && (
            <select aria-label={`How many calls ${i + 1}`} className="input w-auto" data-match="repeat 2 to 8" value={r.count} onChange={(e) => set(i, { count: e.target.value })}>
              {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={String(n)}>{n} calls</option>)}
              <option value="forever">Forever</option>
            </select>
          )}
          {rows.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
          {(notes?.[i] ?? []).map((x) => <p key={x.text} className={`basis-full text-sm ${x.tone === "red" ? "err-field" : "text-sky-200"}`} data-clash={x.tone}>{x.text}</p>)}
        </div>
      ))}
      {rows.length < 3 && <button type="button" className="btn-ghost" onClick={() => setRows([...rows, newRow()])}>+ Another time</button>}
      {rows.length > 1 && <p className="note">They pick one of these.</p>}
    </div>
  );
}
