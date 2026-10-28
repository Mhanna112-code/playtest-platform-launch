// (Owner, Oct 30, batch 15 section 40) The app measures each call's length; nobody enters it. While the call page is open each person's page sends a heartbeat every
// ~10 seconds; the site keeps each person's stretches of presence. The measured length is the whole minutes both were there at the same time (a gap under 5 minutes, a
// reload or a brief drop, counts as still there), capped at 150% of the booked length. It's final when both have left, or 30 minutes after the latest allowed end.
import { money } from "./format";

export const HEARTBEAT_MS = 10_000;
/** A gap shorter than this between two heartbeats counts as still present. */
export const PRESENCE_GAP_MS = 5 * 60_000;
/** The measured length is capped at this share of the booked length. */
export const MEASURE_CAP = 1.5;
/** The measured length becomes final this long after the latest allowed end (the booked start + 150% of its length), unless both left before. */
export const MEASURE_FINAL_AFTER_MS = 30 * 60_000;
/** (Batch 15 sections 34 and 40) Calls not listed: at most $200 an hour for the measured length. */
export const UNLISTED_CALL_RATE_CENTS = 20_000;
/** (Batch 15 section 34) All of one tester's calls on a test, listed and unlisted together, extra pay counted: at most $1,000. */
export const CALLS_TOTAL_CENTS = 100_000;

export type Span = { startAt: Date; endAt: Date };

/** One person's stretches, sorted and merged (gaps under PRESENCE_GAP_MS join them). */
export function mergeSpans(spans: Span[], gapMs = PRESENCE_GAP_MS): [number, number][] {
  const s = spans.map((x) => [x.startAt.getTime(), x.endAt.getTime()] as [number, number]).filter(([a, b]) => b >= a).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a - last[1] < gapMs) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The latest allowed end of a call: its booked start + 150% of its booked length. */
export const latestAllowedEnd = (startsAt: Date, minutes: number) => new Date(startsAt.getTime() + Math.floor(minutes * MEASURE_CAP) * 60_000);
/** When the measured length is final at the latest. */
export const measureDeadline = (startsAt: Date, minutes: number) => new Date(latestAllowedEnd(startsAt, minutes).getTime() + MEASURE_FINAL_AFTER_MS);

/**
 * The measured length: the time both were there at once, in whole minutes (rounded), capped at 150% of the booked length; `from` / `to` are the first and last moment
 * both were there. No overlap at all: 0 minutes and no span.
 */
export function measureOverlap(dev: Span[], tester: Span[], bookedMinutes: number) {
  const a = mergeSpans(dev), b = mergeSpans(tester);
  let ms = 0, from: number | null = null, to: number | null = null;
  for (const [s1, e1] of a)
    for (const [s2, e2] of b) {
      const s = Math.max(s1, s2), e = Math.min(e1, e2);
      if (e <= s) continue;
      ms += e - s;
      from = from == null ? s : Math.min(from, s);
      to = to == null ? e : Math.max(to, e);
    }
  const minutes = Math.min(Math.round(ms / 60_000), Math.floor(bookedMinutes * MEASURE_CAP));
  return { minutes, ms, from: from == null ? null : new Date(from), to: to == null ? null : new Date(to) };
}

/** Whether the measured length is final now: both have left (each one's last heartbeat 5 minutes or more ago, both having joined), or the deadline passed. */
export function measureIsFinal(x: { startsAt: Date; minutes: number }, dev: Span[], tester: Span[], now: Date) {
  if (now.getTime() >= measureDeadline(x.startsAt, x.minutes).getTime()) return true;
  if (!dev.length || !tester.length) return false;
  const last = (s: Span[]) => Math.max(...s.map((p) => p.endAt.getTime()));
  return now.getTime() - last(dev) >= PRESENCE_GAP_MS && now.getTime() - last(tester) >= PRESENCE_GAP_MS;
}

/** The minutes a call is paid for: a lowered (or, from before measuring, logged) length, else the measured one; null while it's being measured. */
export const callMinutesOf = (x: { actualMinutes: number | null; measuredMinutes: number | null; measuredAt: Date | null }) =>
  x.actualMinutes ?? (x.measuredAt ? x.measuredMinutes : null);

/** "2:21–2:50 PM" (each time in the reader's own zone; the shared AM/PM written once). */
export function timeSpan(from: Date, to: Date, fmtTime: (d: Date) => string) {
  const a = fmtTime(from), b = fmtTime(to);
  const ma = a.match(/^(.*) ([AP]M)(.*)$/), mb = b.match(/^(.*) ([AP]M)(.*)$/);
  return ma && mb && ma[2] === mb[2] && ma[3] === mb[3] ? `${ma[1]}–${b}` : `${a}–${b}`;
}

export const MEASURING_LINE = "Call in progress / measuring";

/**
 * Wherever a call's length shows: "Length: 29 min (both in the call 2:21–2:50 PM)"; lowered: "Length: 20 min (lowered from 29 min)" with the reason shown beside it;
 * logged before measuring: "Length: 29 min". While it's measured: "Call in progress / measuring".
 */
export function callLengthLine(x: { actualMinutes: number | null; measuredMinutes: number | null; measuredAt: Date | null; measuredFrom: Date | null; measuredTo: Date | null }, fmtTime: (d: Date) => string) {
  if (!x.measuredAt && x.actualMinutes == null) return MEASURING_LINE;
  const both = x.measuredFrom && x.measuredTo ? `both in the call ${timeSpan(x.measuredFrom, x.measuredTo, fmtTime)}` : "";
  if (x.actualMinutes != null && x.measuredMinutes != null && x.actualMinutes < x.measuredMinutes && x.measuredFrom)
    return `Length: ${x.actualMinutes} min (lowered from ${x.measuredMinutes} min${both ? `; ${both}` : ""})`;
  const m = x.actualMinutes ?? x.measuredMinutes ?? 0;
  return `Length: ${m} min${both ? ` (${both})` : ""}`;
}

// ---------- Rate and Amount fill each other (the call Pay box) ----------
/** Typing a rate fills Amount = rate × length. */
export const amountFromRate = (rateCents: number, minutes: number) => Math.round((rateCents * minutes) / 60);
/** Typing an amount fills Rate = amount ÷ length × 60, to the cent per hour. */
export const rateFromAmount = (amountCents: number, minutes: number) => (minutes > 0 ? Math.round((amountCents * 60) / minutes) : 0);

// ---------- (Batch 15 section 34) The $1,000 for all of a tester's calls ----------
const dollars = (c: number) => money(c).replace(/\.00$/, "");
/** Refused booking (a request, an offer, an Accept), on both sides. `who` is the other person. */
export const callsCeilingLine = (who: string, leftCents: number) => `Calls with ${who} on this test can come to at most ${dollars(CALLS_TOTAL_CENTS)}; ${money(leftCents)} is left, so this call can't be booked.`;
/** The small warning when what's left is under one hour at the tester's listed rate (or under $200 when their calls aren't listed). */
export function callsLeftWarning(leftCents: number, rateCents: number | null, side: "developer" | "tester", testerName: string) {
  const hour = rateCents ?? UNLISTED_CALL_RATE_CENTS;
  if (leftCents >= hour) return "";
  return side === "developer" ? `${money(leftCents)} left of the ${dollars(CALLS_TOTAL_CENTS)} for calls with ${testerName} on this test.` : `${money(leftCents)} left of the ${dollars(CALLS_TOTAL_CENTS)} for your calls on this test.`;
}
/** A listed call's Charge cut by the ceiling. */
export const chargeCappedLine = (cents: number) => `Charge ${money(cents)} (the ${dollars(CALLS_TOTAL_CENTS)} limit for calls on this test)`;
/** A call payment over what's left of the ceiling. */
export const overCeilingLine = (roomCents: number) => `This is more than you can pay for this call (up to ${money(roomCents)}: what's left of the ${dollars(CALLS_TOTAL_CENTS)} for calls on this test).`;

// ---------- (Batch 15 section 42) A call that's over: its outcome badge ----------
type OverCall = { status: string; cancelledBy: string | null; cancelledAt: Date | null; cancelNote: string; review: { amountCents: number; rejected: boolean; reason: string } | null };
/**
 * One call that's over, in the tester row's "Calls (N)" fold and the tester's Call history: "Took place · 29 min · paid $14.50", "Cancelled by Ana · 3:05 PM" (the reason
 * shown under it), "Nobody joined", "Missed: the site was down" and so on.
 */
export function callOverBadge(x: OverCall, who: { developer: string; tester: string }, side: "developer" | "tester", fmtTime: (d: Date) => string, paidCents: number, minutes: number | null) {
  type Tone = "grey" | "amber" | "green" | "rose";
  if (x.status === "cancelled") {
    const note = x.cancelNote.trim();
    if (x.cancelledBy === "developer" || x.cancelledBy === "tester") {
      const by = x.cancelledBy === side ? "you" : who[x.cancelledBy];
      return { label: `Cancelled by ${by}${x.cancelledAt ? ` · ${fmtTime(x.cancelledAt)}` : ""}`, tone: "grey" as Tone, reason: note || undefined };
    }
    if (/^Nobody joined/.test(note)) return { label: "Nobody joined", tone: "grey" as Tone };
    if (/site was down/.test(note)) return { label: "Missed: the site was down", tone: "amber" as Tone };
    if (/paused/i.test(note)) return { label: "Missed: the test was paused", tone: "amber" as Tone };
    return { label: note ? `Cancelled: ${note.replace(/[.\s]+$/, "")}` : "Cancelled", tone: "grey" as Tone };
  }
  const len = minutes != null ? ` · ${minutes} min` : "";
  if (!x.review) return { label: `Took place${len} · not paid yet`, tone: "amber" as Tone };
  if (x.review.rejected) return { label: `Took place${len} · Rejected`, tone: "rose" as Tone, reason: x.review.reason || undefined };
  if (/^Let go by the tester/.test(x.review.reason)) return { label: `Took place${len} · let go`, tone: "grey" as Tone };
  if (paidCents === 0 && x.review.amountCents === 0) return { label: `Took place${len} · Paid $0`, tone: "green" as Tone, reason: x.review.reason || undefined };
  return { label: `Took place${len} · paid ${money(paidCents)}`, tone: "green" as Tone };
}
/** Whether a call is over (it moves from the Live session to the tester row / Call history): cancelled, or its length is final. */
export const callIsOver = (x: { status: string; measuredAt: Date | null; actualMinutes: number | null }) => x.status === "cancelled" || x.measuredAt != null || x.actualMinutes != null;
