// (Owner, Oct 28, batch 16 section 33) Clash checks for Request a time, shown while the form is filled (both sides) and re-checked by the server on press.
// Pure: the page passes what it shows (calls and waiting requests between the two people, the requester's other calls, the limits) and a time formatter.
import type { RowJson } from "@/lib/callRows";
import { callsCeilingLine, UNLISTED_CALL_RATE_CENTS } from "@/lib/callMeasure";
import { callCharge } from "@/lib/rules";

export type Slot = { start: string; minutes: number };
export type ClashReq = { id?: string; rows: RowJson[]; minutes: number; mine: boolean };
export type ClashTarget = {
  /** The other person's name ("fbbb"). */
  name: string;
  /** Booked calls between the two of you (still ahead or running). */
  calls: Slot[];
  /** Waiting requests between the two of you, both directions. */
  requests: ClashReq[];
  /** Waiting requests with them now (both sides), booked times ahead, and what's left of the $1,000 (null: not known). */
  pending?: number; booked?: number; leftCents?: number | null; rateCents?: number | null;
};
export type ClashLine = { tone: "red" | "blue"; text: string };
export type Fmt = { range: (start: Date, minutes: number) => string; times: (start: Date, minutes: number) => string; day: (d: Date) => string };

export const MAX_WAITING = 3;
export const MAX_BOOKED_TIMES = 3;
const DAY = 86_400_000;
/** The starts a row covers for the checks: one; a set's calls; Forever: its first 8. */
export const rowStarts = (r: RowJson) => {
  const n = r.repeat === "once" ? 1 : r.count === 0 ? 8 : r.count;
  const step = (r.repeat === "daily" ? 1 : 7) * DAY;
  const s = new Date(r.startsAt).getTime();
  return Array.from({ length: n }, (_, k) => new Date(s + k * step));
};
/** How many calls accepting the request books (Forever: the next 4), as the server counts for the $1,000. */
const callsIfAccepted = (rows: RowJson[]) => Math.max(1, ...rows.map((r) => (r.repeat === "once" ? 1 : r.count === 0 ? 4 : r.count)));
const overlap = (a: Date, am: number, b: Date, bm: number) => a.getTime() < b.getTime() + bm * 60_000 && b.getTime() < a.getTime() + am * 60_000;
const ORD = ["1st", "2nd", "3rd"];
const ord = (n: number) => ORD[n - 1] ?? `${n}th`;

/** "The 3rd call (Thu, Nov 12) overlaps …" / "The 3rd call (Thu, Nov 12): you have a call …". */
function inSet(k: number, at: Date, text: string, f: Fmt) {
  if (k === 0) return text;
  const head = `The ${ord(k + 1)} call (${f.day(at)})`;
  return text.startsWith("Overlaps ") ? `${head} overlaps ${text.slice("Overlaps ".length)}` : `${head}: ${text[0].toLowerCase()}${text.slice(1)}`;
}

/**
 * Per row of the form: its lines (at most one red, the first clash found; blue "<name> asked for exactly this: Request a time books it." for an exact match with the
 * other side's waiting request); and the limit lines (today's wording). Nothing is checked until the length is known.
 */
export function clashNotes(p: { rows: RowJson[]; minutes: number | null; side: "developer" | "tester"; targets: ClashTarget[]; elsewhere: (Slot & { name: string })[]; fmt: Fmt }) {
  const rows: ClashLine[][] = p.rows.map(() => []);
  const limits: string[] = [];
  const m = p.minutes;
  if (!m || !Number.isFinite(m) || m <= 0) return { rows, limits };
  p.rows.forEach((row, i) => {
    let red = "";
    const starts = rowStarts(row);
    for (const t of p.targets) {
      // Exact match with their waiting request (a single time, the same length): not a clash; the press books it.
      const exact = row.repeat === "once" ? t.requests.find((q) => !q.mine && q.minutes === m && q.rows.some((x) => x.repeat === "once" && new Date(x.startsAt).getTime() === new Date(row.startsAt).getTime())) : undefined;
      if (exact) rows[i].push({ tone: "blue", text: `${t.name} asked for exactly this: Request a time books it.` });
      if (red) continue;
      starts.forEach((at, k) => {
        if (red) return;
        const call = t.calls.find((c) => overlap(at, m, new Date(c.start), c.minutes));
        if (call) { red = inSet(k, at, `Overlaps your call with ${t.name} on ${p.fmt.range(new Date(call.start), call.minutes)}.`, p.fmt); return; }
        for (const q of t.requests) {
          if (q === exact) continue;
          const hit = q.rows.flatMap(rowStarts).find((s) => overlap(at, m, s, q.minutes));
          if (hit) { red = inSet(k, at, q.mine ? `Overlaps your request to ${t.name} for ${p.fmt.range(hit, q.minutes)}.` : `Overlaps ${t.name}'s request for ${p.fmt.range(hit, q.minutes)}.`, p.fmt); return; }
        }
      });
    }
    // The requester's other calls (another person, any test).
    if (!red) starts.forEach((at, k) => {
      if (red) return;
      const o = p.elsewhere.find((c) => overlap(at, m, new Date(c.start), c.minutes));
      if (o) red = inSet(k, at, `You have a call with ${o.name} then (${p.fmt.times(new Date(o.start), o.minutes)}).`, p.fmt);
    });
    // Two times in this form overlapping each other: red on the later one.
    if (!red) starts.forEach((at, k) => {
      if (red) return;
      for (let j = 0; j < i; j++) {
        const hit = rowStarts(p.rows[j]).find((s) => overlap(at, m, s, m));
        if (hit) { red = inSet(k, at, `Overlaps time ${j + 1} in this request (${p.fmt.range(hit, m)}).`, p.fmt); return; }
      }
    });
    if (red) rows[i].unshift({ tone: "red", text: red });
  });
  for (const t of p.targets) {
    if ((t.pending ?? 0) >= MAX_WAITING) limits.push(`You already have ${MAX_WAITING} requests waiting with ${t.name}. Withdraw one or wait for an answer.`);
    else if ((t.booked ?? 0) >= MAX_BOOKED_TIMES) limits.push(p.side === "developer" ? `${t.name} already has ${MAX_BOOKED_TIMES} booked times with you. Wait until one is over or cancel one.` : `You already have ${MAX_BOOKED_TIMES} booked times in this test.`);
    else if (t.leftCents != null && p.rows.length) {
      const one = t.rateCents == null ? Math.round((UNLISTED_CALL_RATE_CENTS * m) / 60) : callCharge(t.rateCents, m);
      if (one * callsIfAccepted(p.rows) > t.leftCents) limits.push(callsCeilingLine(t.name, t.leftCents));
    }
  }
  return { rows, limits };
}

/** The page's own time formats (the viewer's zone): "Mon, Nov 2, 1:38–1:48 PM", "1:30–2:00 PM", "Thu, Nov 12". */
export function localFmt(zone?: string): Fmt {
  const o = zone ? { timeZone: zone } : {};
  const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...o });
  const span = (s: Date, mins: number) => {
    const e = new Date(s.getTime() + mins * 60_000);
    const [a, b] = [time(s), time(e)];
    const [ah, ap] = a.split(" "), [bh, bp] = b.split(" ");
    return ap === bp ? `${ah}–${bh} ${bp}` : `${a}–${b}`;
  };
  const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...o });
  return { range: (s, m) => `${day(s)}, ${span(s, m)}`, times: span, day };
}
