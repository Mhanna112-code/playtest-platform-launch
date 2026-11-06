"use client";
import { useEffect, useState } from "react";
import { rowCalls, type RowJson } from "@/lib/callRows";
import { clashNotes, localFmt, type ClashLine, type ClashTarget, type Slot } from "@/lib/callClash";
import { beforeEndLine, leadLine, repeatChoices, repeatOffLine, untilEndWords, windowShut, windowShutLine, type CallEnd } from "@/lib/callWindow";
import { useLocalMax } from "@/components/FieldChecks";
import { lockPick, lockText } from "@/lib/sendLock";

// (NEXT-UI 7) The call request's time rows, the same on both sides: each row has its own "Once / Daily / Weekly" (Once by
// default) and, when it repeats, a calls drop-down: 2-8 and "Forever" at the bottom. Up to 3 rows; (owner, Nov 5, §208) each row is sent as its OWN request
// (it was one "choose one" request: the other side picked one).
// (Owner, Nov 2, batch 35 §132) The form offers only what can be booked: the time box takes times from the server's lead ahead (24 hours on the live site) to when
// testers' work on the test ends (the end, passed down from the server); the calls drop-down lists only the counts that fit before the end, and "Forever" reads
// "Until testers' work ends (Dec 3)"; a repeat with fewer than 2 calls before the end isn't offered (a short line says why). The rows keep what was typed: a count or
// repeat that doesn't fit is shown and sent as the most that does (fitRow), and comes back if the time moves earlier.

export type RowState = { when: string; repeat: "once" | "daily" | "weekly"; count: string };
export const newRow = (): RowState => ({ when: "", repeat: "once", count: "4" });

const endDate = (end: CallEnd | undefined) => (end ? new Date(end.at) : null);

/**
 * (Batch 35 §132) A row as the form offers it at its time: a count that doesn't fit before the end becomes the most that does; a Daily / Weekly with fewer than 2 calls
 * before it is Once. A time after the end stays as typed (its box is red).
 */
export function fitRow(r: RowState, end: Date | null): RowState {
  if (!end || !r.when || r.repeat === "once") return r;
  const when = new Date(r.when);
  if (isNaN(when.getTime()) || when.getTime() > end.getTime()) return r;
  const c = repeatChoices(when, r.repeat, end);
  if (!c.ok) return { ...r, repeat: "once" };
  // (Owner, Nov 3) No "until testers' work ends" choice any more: an older "forever" row becomes the most calls that fit.
  return r.count === "forever" || Number(r.count) > c.fit ? { ...r, count: String(c.fit) } : r;
}

/** The rows as the API wants them (empty rows left out); (batch 35 §132) each as the form offers it (fitRow). */
export function rowsPayload(rows: RowState[], end?: CallEnd): RowJson[] {
  return rows.filter((r) => r.when).map((r0) => {
    const r = fitRow(r0, endDate(end));
    return { startsAt: new Date(r.when).toISOString(), repeat: r.repeat, count: r.repeat === "once" ? 1 : r.count === "forever" ? 0 : Number(r.count) };
  });
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const short = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
const unit = (r: RowJson) => (r.repeat === "daily" ? "Daily" : "Weekly");
const callsWord = (n: number) => `${n} call${n === 1 ? "" : "s"}`;
/** (Batch 35 §132) How many calls a repeating row covers (a Forever row with the end: every call up to it; with no end, null). */
const countOf = (r: RowJson) => rowCalls(r) ?? (r.count || null);

/**
 * One row in words: "Thu, Nov 5, 3:00 PM" / "Weekly Thu 3:00 PM (4 calls)" / "Daily Thu 3:00 PM (Forever)"; (batch 35 §132) a Forever row with the end says how many
 * calls it covers: "Weekly Thu 3:00 PM (5 calls, until testers' work ends on Dec 3)".
 */
export const rowText = (r: RowJson) => {
  if (r.repeat === "once") return fmt(r.startsAt);
  const n = countOf(r);
  return `${unit(r)} ${short(r.startsAt)} (${n == null ? "Forever" : r.count === 0 && r.untilDay ? `${callsWord(n)}, until testers' work ends on ${r.untilDay}` : callsWord(n)})`;
};

/** A waiting request in words; (batch 35 §132) a Forever row with the end: "weekly calls: Thu 3:00 PM · 5 calls from Thu, Nov 5, 3:00 PM until testers' work ends (Dec 3)". */
export function describeRows(rows: RowJson[]) {
  if (rows.length === 1) {
    const r = rows[0];
    if (r.repeat === "once") return fmt(r.startsAt);
    const n = countOf(r);
    const from = n == null ? `Forever, from ${fmt(r.startsAt)}` : `${callsWord(n)} from ${fmt(r.startsAt)}${r.count === 0 && r.untilDay ? ` ${untilEndWords(r.untilDay)}` : ""}`;
    return `${unit(r).toLowerCase()} calls: ${short(r.startsAt)} · ${from}`;
  }
  // (Owner, Nov 4, §187) No "one of:" any more: the boxes show one row per time (CallRequestsPanel's timeRows); several rows in one line are just listed.
  return rows.map(rowText).join(" · ");
}

/** The Accept button(s) of a waiting request: one per row when there is a choice, else one. (Batch 35 §132) "Accept all N" counts the calls it books (up to the end). */
export function acceptChoices(rows: RowJson[]): { label: string; time?: string }[] {
  if (rows.length === 1) {
    const r = rows[0];
    const n = r.repeat !== "once" && r.count ? countOf(r) : null;
    return [{ label: n && n > 1 ? `Accept all ${n}` : "Accept" }];
  }
  // (Owner, Nov 4, §187) A label that names a time names its date too ("Accept Thu 4:22 PM" twice, for two Thursdays, was the bug).
  return rows.map((r) => ({ label: `Accept ${r.repeat === "once" ? fmt(r.startsAt) : rowText(r)}`, time: r.startsAt }));
}

/**
 * (Owner, Oct 28, batch 16 section 33) Each row's clash lines, aligned with the rows: under the row as it's typed; a red one also marks the row's time red
 * (data-red-msg: listed under the button, and the press waits until it's fixed), a blue one is information only. (Batch 35 §132) Each row as the form offers it, its
 * calls stopping at the end.
 */
export function alignedClash(rows: RowState[], minutes: string, side: "developer" | "tester", targets: ClashTarget[], elsewhere: (Slot & { name: string })[], end?: CallEnd) {
  const idx: number[] = [];
  const filled: RowJson[] = [];
  rows.forEach((r0, i) => {
    if (!r0.when) return;
    const d = new Date(r0.when);
    if (isNaN(d.getTime())) return;
    const r = fitRow(r0, endDate(end));
    idx.push(i);
    filled.push({ startsAt: d.toISOString(), repeat: r.repeat, count: r.repeat === "once" ? 1 : r.count === "forever" ? 0 : Number(r.count), ...(end ? { until: end.at } : {}) });
  });
  const n = clashNotes({ rows: filled, minutes: minutes.trim() ? Number(minutes) : null, side, targets, elsewhere, fmt: localFmt() });
  const notes: ClashLine[][] = rows.map(() => []);
  idx.forEach((i, k) => (notes[i] = n.rows[k]));
  return { notes, limits: n.limits };
}

/** (Owner, Nov 5, §208) The form's note under its rows once there are 2 or 3. */
export const SEPARATE_TIMES_NOTE = "Each time is sent as its own request.";
/** (§208) The line once a press went through: "Request sent." / "3 requests sent." (one per time). */
export const sentLine = (r: unknown) => {
  const n = madeBy(r).requestIds.length;
  return n > 1 ? `${n} requests sent.` : "Request sent.";
};

/**
 * (Batch 20 section 7) What a Request a time press made: its new waiting requests and, when it matched the other side's request, the booked call. (§208) A press
 * can make several of each (one request per time; each auto-match a booked call).
 */
export type PressMade = { requestIds: string[]; callIds: string[] };
export function madeBy(r: unknown): PressMade {
  const o = (r ?? {}) as { ids?: unknown; id?: unknown; callId?: unknown; callIds?: unknown };
  const requestIds = Array.isArray(o.ids) ? o.ids.map(String) : typeof o.id === "string" ? [o.id] : [];
  return { requestIds, callIds: Array.isArray(o.callIds) ? o.callIds.map(String) : typeof o.callId === "string" ? [o.callId] : [] };
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

/**
 * (Batch 35 §132) The forms' line once no time is left in the window (the end less than the lead away, checked every half minute while the page is open): the
 * form goes and the line says why. "" while times can be picked.
 */
export function useWindowShutLine(end: CallEnd | undefined, leadMinutes: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return end && windowShut(end.at, leadMinutes, now) ? windowShutLine(end.text, leadMinutes) : "";
}

/** (Batch 35 §132) Where the time box sends the server's lines about the window ("Pick a time at least 24 hours from now.", "Pick a time before …"), and the clash lines. */
export const TIME_MATCH = "in the future|from now|work on this test ends|up to 3 times|exactly one time|overlaps|you have a call";

/**
 * (Batch 35 §132) What a row's drop-downs offer at its time: which repeats fit (at least 2 calls before the end), the counts that fit, the last choice's words
 * ("Until testers' work ends (Dec 3)", or "Forever" with no end) and, when a repeat can't be offered, the short line why.
 */
export function rowOffer(r: RowState, end: CallEnd | undefined) {
  const at = endDate(end);
  const when = r.when ? new Date(r.when) : null;
  const usable = when && !isNaN(when.getTime()) && (!at || when.getTime() <= at.getTime()) ? when : null;
  const daily = repeatChoices(usable, "daily", at), weekly = repeatChoices(usable, "weekly", at);
  const shown = fitRow(r, at);
  const off: ("daily" | "weekly")[] = [];
  if (!daily.ok) off.push("daily");
  if (!weekly.ok) off.push("weekly");
  const last = end ? untilEndWords(end.day) : "Forever";
  return {
    shown,
    daily: daily.ok,
    weekly: weekly.ok,
    counts: (shown.repeat === "daily" ? daily : weekly).counts,
    last: last[0].toUpperCase() + last.slice(1),
    offLine: usable && end ? repeatOffLine(off, end.day) : "",
  };
}

/** (Owner, Nov 3) A count's words: "2 days (to Nov 5)" for Daily, "3 weeks (to Nov 19)" for Weekly (the last call's day). */
export function countLabel(n: number, r: RowState) {
  const unit = r.repeat === "daily" ? "day" : "week";
  const start = r.when ? new Date(r.when) : null;
  const last = start && !isNaN(start.getTime()) ? new Date(start.getTime() + (n - 1) * (r.repeat === "daily" ? 1 : 7) * 86_400_000) : null;
  return `${n} ${unit}s${last ? ` (to ${last.toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : ""}`;
}

export function RequestRows({ rows, setRows, minNow, notes, leadMinutes, end, locked = false }: { rows: RowState[]; setRows: (r: RowState[]) => void; minNow: string; notes?: ClashLine[][];
  /** (Owner, Nov 5, §261) Request a time is going through: the times are read-only, the repeat choices, Remove and + Another time disabled */ locked?: boolean;
  /** (Batch 35 §132) The server's lead (the time box's red line) and when testers' work ends (its latest time; the calls drop-down). */
  leadMinutes?: number; end?: CallEnd }) {
  const set = (i: number, patch: Partial<RowState>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const maxNow = useLocalMax(end?.at);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const o = rowOffer(r, end);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2" data-request-row="">
            <input type="datetime-local" min={minNow} max={maxNow || undefined} data-end={end?.at} data-msg={leadLine(leadMinutes ?? 0)} data-max-msg={end ? beforeEndLine(end.text) : undefined} data-match={TIME_MATCH} data-red-msg={notes?.[i]?.find((x) => x.tone === "red")?.text || undefined} aria-label={`Requested time ${i + 1}`} className="input max-w-xs" value={r.when} onChange={(e) => set(i, { when: e.target.value })} {...lockText(locked)} />
            <select aria-label={`Repeat ${i + 1}`} className="input w-auto" {...lockPick(locked)} value={o.shown.repeat} onChange={(e) => set(i, { repeat: e.target.value as RowState["repeat"] })}>
              <option value="once">Once</option>
              <option value="daily" disabled={!o.daily}>Daily</option>
              <option value="weekly" disabled={!o.weekly}>Weekly</option>
            </select>
            {o.shown.repeat !== "once" && (
              <select aria-label={`How many calls ${i + 1}`} className="input w-auto" data-match="repeat 2 to 8|repeat at least 2" {...lockPick(locked)} value={o.shown.count} onChange={(e) => set(i, { count: e.target.value })}>
                {/* (Owner, Nov 3) Every count that fits, named by days or weeks with the last call's day; "Forever" only when nothing ends the test's work. */}
                {o.counts.map((n) => <option key={n} value={String(n)}>{countLabel(n, o.shown)}</option>)}
                {!end && <option value="forever">{o.last}</option>}
              </select>
            )}
            {rows.length > 1 && <button type="button" className="btn-ghost text-xs" {...lockPick(locked)} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
            {o.offLine && <p className="basis-full text-xs text-slate-400" data-repeat-off="">{o.offLine}</p>}
            {(notes?.[i] ?? []).map((x) => <p key={x.text} className={`basis-full text-sm ${x.tone === "red" ? "err-field" : "text-sky-200"}`} data-clash={x.tone}>{x.text}</p>)}
          </div>
        );
      })}
      {rows.length < 3 && <button type="button" className="btn-ghost" {...lockPick(locked)} onClick={() => setRows([...rows, newRow()])}>+ Another time</button>}
      {/* (Owner, Nov 5, §208) Each row is its own request (was "They pick one of these."). */}
      {rows.length > 1 && <p className="note" data-separate-times="">{SEPARATE_TIMES_NOTE}</p>}
    </div>
  );
}
