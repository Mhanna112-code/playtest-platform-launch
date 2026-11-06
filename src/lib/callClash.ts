// (Owner, Oct 28, batch 16 section 33) Clash checks for Request a time, shown while the form is filled (both sides) and re-checked by the server on press.
// Pure: the page passes what it shows (calls and waiting requests between the two people, the requester's other calls, the limits) and a time formatter.
import type { RowJson } from "@/lib/callRows";

export type Slot = { start: string; minutes: number; /** (Batch 20 section 7) the call's id, so a press never clashes with the call it booked */ id?: string };
export type ClashReq = { id?: string; rows: RowJson[]; minutes: number; mine: boolean };
export type ClashTarget = {
  /** The other person's name ("fbbb"). */
  name: string;
  /** Booked calls between the two of you (still ahead or running). */
  calls: Slot[];
  /** Waiting requests between the two of you, both directions. */
  requests: ClashReq[];
  /**
   * Waiting requests with them now (both sides) and booked times ahead. (Owner, Nov 6, §280) No longer what's left of the $1,000: booking is never checked against
   * it (the call room ends a call at it instead).
   */
  pending?: number; booked?: number;
  /**
   * (Owner, Nov 6, §292) The times this person already has booked with SOMEONE ELSE (another tester or developer, this test or any other): bare time ranges, never
   * who the call is with (another person's private booking). A request overlapping one is refused: "fbbb already has a call booked at Wed, Nov 11, 12:00 PM: pick
   * another time."
   */
  busy?: Slot[];
};
export type ClashLine = { tone: "red" | "blue"; text: string };
export type Fmt = { range: (start: Date, minutes: number) => string; times: (start: Date, minutes: number) => string; day: (d: Date) => string; /** (§292) "Wed, Nov 11, 12:00 PM" */ at: (d: Date) => string };
/**
 * (Owner, Nov 6, §292) The refusal (and the form's red line) for a time overlapping a call the OTHER person already has booked with someone else: it names the
 * time, never who that call is with. "fbbb already has a call booked at Wed, Nov 11, 12:00 PM: pick another time."
 */
export const busyLine = (name: string, at: string) => `${name} already has a call booked at ${at}: pick another time.`;

/**
 * (Owner, Nov 4, §185) The limit per developer–tester pair on a test: booked times and waiting requests (both sides) together, at most 3. A daily / weekly set (and a
 * Forever set while it runs) is one booked time; an older "one of" request is one request; (§208) each time of a press is its own request. It replaces "up to 3
 * booked + up to 3 requests". The same for both sides.
 */
export const MAX_CALLS = 3;
/** (§185) The refusal (and the form's red line), naming the pair's other person: "You already have 3 calls booked or requested with Nina Park. …". */
/**
 * (Owner, Nov 4, §185) And each side SENDS at most 3 call requests a day to the same person on a test, counted on the sender's calendar day in their saved zone:
 * every request sent counts (later withdrawn, declined, dropped or closed too; an auto-match that books directly is one); withdrawing never counts.
 */
export const MAX_SENT_PER_DAY = 3;
/** (§185) "You've sent 3 call requests to Nina Park today. You can send more tomorrow." */
export const sentTodayLine = (name: string) => `You've sent ${MAX_SENT_PER_DAY} call requests to ${name} today. You can send more tomorrow.`;
export const callLimitLine = (name: string) => `You already have ${MAX_CALLS} calls booked or requested with ${name}. Wait until one is answered, over or cancelled, or withdraw a request.`;
/**
 * (Owner, Nov 5, §208) "+ Another time" sends each time as its OWN request, so one press can make up to 3. A press that would pass a limit is refused as a whole,
 * saying how many more can be sent: "You already have 2 calls or requests with Ana Silva: you can send 1 more." (none left: callLimitLine as before).
 */
export const callRoomLine = (name: string, taken: number) =>
  taken >= MAX_CALLS ? callLimitLine(name) : `You already have ${taken} ${taken === 1 ? "call or request" : "calls or requests"} with ${name}: you can send ${MAX_CALLS - taken} more.`;
/** (§208) "You can send 1 more request to Ana Silva today." (none left: sentTodayLine as before). */
export const sentRoomLine = (name: string, sent: number) =>
  sent >= MAX_SENT_PER_DAY ? sentTodayLine(name) : `You can send ${MAX_SENT_PER_DAY - sent} more request${MAX_SENT_PER_DAY - sent === 1 ? "" : "s"} to ${name} today.`;
const DAY = 86_400_000;
/** The starts a row covers for the checks: one; a set's calls; Forever: its first 8; (batch 35 §132) none after the end (`until`) but the first. */
export const rowStarts = (r: RowJson) => {
  const n = r.repeat === "once" ? 1 : r.count === 0 ? 8 : r.count;
  const step = (r.repeat === "daily" ? 1 : 7) * DAY;
  const s = new Date(r.startsAt).getTime();
  const until = r.until ? new Date(r.until).getTime() : Number.POSITIVE_INFINITY;
  return Array.from({ length: n }, (_, k) => new Date(s + k * step)).filter((d, k) => k === 0 || d.getTime() <= until);
};
const overlap = (a: Date, am: number, b: Date, bm: number) => a.getTime() < b.getTime() + bm * 60_000 && b.getTime() < a.getTime() + am * 60_000;
const ORD = ["1st", "2nd", "3rd"];
const ord = (n: number) => ORD[n - 1] ?? `${n}th`;

/** "The 3rd call (Thu, Nov 12) overlaps …" / "The 3rd call (Thu, Nov 12): you have a call …". */
function inSet(k: number, at: Date, text: string, f: Fmt) {
  if (k === 0) return text;
  const head = `The ${ord(k + 1)} call (${f.day(at)})`;
  // (§292) A line starting with a person's name keeps its capital ("The 3rd call (Thu, Nov 12): Dee Moss already has a call booked at …").
  return text.startsWith("Overlaps ") ? `${head} overlaps ${text.slice("Overlaps ".length)}` : `${head}: ${text.startsWith("You ") ? `${text[0].toLowerCase()}${text.slice(1)}` : text}`;
}

/**
 * Per row of the form: its lines (at most one red, the first clash found; blue "<name> asked for exactly this: Request a time books it." for an exact match with the
 * other side's waiting request); and the limit lines (today's wording). Nothing is checked until the length is known.
 */
export function clashNotes(p: { rows: RowJson[]; minutes: number | null; side: "developer" | "tester"; targets: ClashTarget[]; elsewhere: (Slot & { name: string })[]; fmt: Fmt }) {
  const rows: ClashLine[][] = p.rows.map(() => []);
  const limits: string[] = [];
  // (§185) The rows that match a person exactly (their waiting request at that very time): the press books it, so it adds nothing toward their limit. (§208) Every
  // other row is a new request of its own.
  const exactWith = new Map<string, Set<number>>();
  const m = p.minutes;
  if (!m || !Number.isFinite(m) || m <= 0) return { rows, limits };
  p.rows.forEach((row, i) => {
    let red = "";
    const starts = rowStarts(row);
    for (const t of p.targets) {
      // Exact match with their waiting request (a single time, the same length): not a clash; the press books it.
      const exact = row.repeat === "once" ? t.requests.find((q) => !q.mine && q.minutes === m && q.rows.some((x) => x.repeat === "once" && new Date(x.startsAt).getTime() === new Date(row.startsAt).getTime())) : undefined;
      if (exact) {
        rows[i].push({ tone: "blue", text: `${t.name} asked for exactly this: Request a time books it.` });
        exactWith.set(t.name, (exactWith.get(t.name) ?? new Set<number>()).add(i));
      }
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
        // (Owner, Nov 6, §292) A call they already have booked with someone else, any test: the time only, never with whom.
        const busy = (t.busy ?? []).find((c) => overlap(at, m, new Date(c.start), c.minutes));
        if (busy) red = inSet(k, at, busyLine(t.name, p.fmt.at(new Date(busy.start))), p.fmt);
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
        // (§208) Each time is its own request now: "in this form", not "in this request".
        if (hit) { red = inSet(k, at, `Overlaps time ${j + 1} in this form (${p.fmt.range(hit, m)}).`, p.fmt); return; }
      }
    });
    if (red) rows[i].unshift({ tone: "red", text: red });
  });
  for (const t of p.targets) {
    // (Owner, Nov 4, §185) Booked times and waiting requests together, at most 3 (an exact match books their request instead: nothing new). (§208) Each other
    // row is a request of its own: 2 taken and 2 new rows read "You already have 2 calls or requests with Ana Silva: you can send 1 more." (No row filled yet:
    // the line shows only once nothing more can be sent, as before.)
    const taken = (t.pending ?? 0) + (t.booked ?? 0);
    const adds = p.rows.length ? p.rows.length - (exactWith.get(t.name)?.size ?? 0) : 1;
    if (adds > 0 && taken + adds > MAX_CALLS) limits.push(callRoomLine(t.name, taken));
    // (Owner, Nov 6, §280) No red line for the $1,000 for this tester's calls any more: a request, a set or an Accept is never refused for it.
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
  return { range: (s, m) => `${day(s)}, ${span(s, m)}`, times: span, day, at: (d) => `${day(d)}, ${time(d)}` };
}
