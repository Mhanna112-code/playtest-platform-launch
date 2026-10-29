// (Owner, Oct 30, batch 15 section 40) The app measures each call's length; nobody enters it. (Batch 21 section 3) In the built-in call room each browser reports
// while it is actually connected to the other (WebRTC "connected"); the site keeps each person's connected stretches. The measured length is the whole minutes both were
// connected at the same time (a gap under 5 minutes, a reload or a brief drop, still counts as connected), capped at 150% of the booked length. It's final when the
// server ends the call, when both have left, or 30 minutes after the latest allowed end.
import { money } from "./format";
import { CALL_MAX_MINUTES, CALL_MIN_MINUTES, callCharge } from "./rules";

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

/** Whether the measured length is final now: both have left (each one's last sign of being in the room 5 minutes or more ago, both having joined), or the deadline passed. */
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
    if (/^It couldn't connect/.test(note)) return { label: "Couldn't connect", tone: "grey" as Tone }; // (batch 21 section 4)
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

// ---------- (Owner, Oct 28 evening, batch 18 section 3) A call ends when its pay would pass the $1,000 for that tester's calls ----------
// The 150% cap on the measured length stays. While a call is on, the app works out when its pay at the call's rate (the contract rate for a listed call, $200/h for an
// unlisted one) would reach what's left of the $1,000 for that tester's calls on the test, and the call ends then for both sides: the call page says so, measuring stops
// (the length is final, capped at that point) and Join is refused. (Batch 21) The room is the app's own, so it really hangs up then for both.

/** A call's pay for `minutes` at its rate (null: not listed, $200 an hour): what the $1,000 counts for it. */
export const callPayCents = (rateCents: number | null, minutes: number) => (rateCents == null ? Math.round((UNLISTED_CALL_RATE_CENTS * minutes) / 60) : callCharge(rateCents, minutes));
/** The most whole minutes whose pay fits in `leftCents`; null for a free call (its pay never reaches it). */
export function capMinutesFor(rateCents: number | null, leftCents: number) {
  const rate = rateCents ?? UNLISTED_CALL_RATE_CENTS;
  if (rate <= 0) return null;
  let m = Math.max(0, Math.floor((leftCents * 60) / rate));
  while (m > 0 && callPayCents(rateCents, m) > leftCents) m--;
  while (callPayCents(rateCents, m + 1) <= leftCents) m++;
  return m;
}
/** Both people count as still in the call while each one's last heartbeat is this recent. */
const HERE_MS = 3 * HEARTBEAT_MS;
/**
 * When a call's time together reaches `capMinutes`: reached once the measured time together has, or both are still here and the projected moment has come. `endsAt` is
 * that moment: projected from the latest moment both were there while they still are, otherwise from now (it moves on while they aren't together).
 */
export function capEnd(dev: Span[], tester: Span[], capMinutes: number, now: Date) {
  const m = measureOverlap(dev, tester, Number.POSITIVE_INFINITY);
  const capMs = capMinutes * 60_000;
  const last = (s: Span[]) => (s.length ? Math.max(...s.map((p) => p.endAt.getTime())) : Number.NEGATIVE_INFINITY);
  const here = now.getTime() - last(dev) <= HERE_MS && now.getTime() - last(tester) <= HERE_MS;
  if (m.to && m.ms >= capMs) return { reached: true, endsAt: new Date(m.to.getTime() - (m.ms - capMs)), together: here };
  const endsAt = new Date((here && m.to ? m.to.getTime() : now.getTime()) + capMs - m.ms);
  return { reached: here && endsAt.getTime() <= now.getTime(), endsAt, together: here };
}
/** (Batch 21 section 2) The room's short warning, 2 minutes before a planned end (150% of the booked length or the $1,000): "This call ends at 3:42 PM." */
export const END_WARN_MS = 2 * 60_000;
export const endWarnLine = (time: string) => `This call ends at ${time}.`;
/** (Batch 21 section 2) The call room once the server ended it at the $1,000 (both pages hang up; it can't be rejoined). `who`: the other person in the call. */
export const capEndedLine = (who: string) => `Call ended: the ${dollars(CALLS_TOTAL_CENTS)} for calls with ${who} on this test is reached.`;
/** (Batch 21 section 2) Ended at 150% of the booked length. */
export const LENGTH_ENDED_LINE = "Call ended: it reached 150% of the booked time.";
/** Ended by what closed it (a block, a pause, a stop, a leave, End early): "Call ended: the test is paused." (neutral: made from the closed-to-joins line). */
export const closedEndedLine = (closedLine: string) => `Call ended: ${closedLine.replace(/^This test /, "the test ").replace(/^./, (c) => c.toLowerCase())}`;
/** (Batch 21 section 1) Anyone who isn't the call's booked tester or developer, anyone more than 10 minutes before the start, and anyone after it ended. */
export const CALL_NOT_AVAILABLE = "This call isn't available.";
/** (Batch 21 section 4) The two browsers couldn't reach each other directly (no TURN relay, a strict network). Nothing is measured. */
export const STRICT_NETWORK_LINE = "Couldn't connect directly (a strict network?). Try another network, or reschedule.";
/** Join on a call that ended at the $1,000. */
export const CALL_OVER_LINE = "This call is over.";

// ---------- (Owner, Oct 28, batch 18 section 6) Booking: the Length is capped by what's left of the $1,000 ----------
// In Request a time (both sides) and Accept, the longest call is the smaller of 180 minutes and the whole minutes left of the $1,000 for that tester's calls on this test at
// the call's rate (the contract rate for a listed call, $200/h unlisted). Shown in the Length hint, red at the box, refused on the server; with several testers ticked the
// smallest applies, named. Under 10 minutes nothing can be booked: the existing "can't be booked" line says so.

/** The longest call that can be booked with what's left. */
export function bookableMinutes(rateCents: number | null, leftCents: number) {
  const cap = capMinutesFor(rateCents, leftCents);
  return cap == null ? CALL_MAX_MINUTES : Math.min(CALL_MAX_MINUTES, cap);
}
/** The Length hint: "10–95 min (the $1,000 for calls with Ana)". */
export const lengthCapHint = (max: number, who: string) => `${CALL_MIN_MINUTES}–${max} min (the ${dollars(CALLS_TOTAL_CENTS)} for calls with ${who})`;
/** Red at the Length box, and the server's refusal: "At most 95 minutes: the $1,000 for calls with Ana on this test." */
export const lengthCapLine = (max: number, who: string) => `At most ${max} minutes: the ${dollars(CALLS_TOTAL_CENTS)} for calls with ${who} on this test.`;
/**
 * The Length box's cap over the testers it books with (the smallest applies, named): null when the $1,000 doesn't bring it under 180 minutes. `line` is the message for
 * a longer length (under 10 minutes left: the "can't be booked" line).
 */
export function lengthCap(targets: { name: string; leftCents?: number | null; rateCents?: number | null }[]) {
  let best: { max: number; name: string; left: number } | null = null;
  for (const t of targets) {
    if (t.leftCents == null) continue;
    const max = bookableMinutes(t.rateCents ?? null, t.leftCents);
    if (max < CALL_MAX_MINUTES && (!best || max < best.max)) best = { max, name: t.name, left: t.leftCents };
  }
  if (!best) return null;
  return best.max >= CALL_MIN_MINUTES
    ? { max: best.max, hint: lengthCapHint(best.max, best.name), line: lengthCapLine(best.max, best.name) }
    : { max: best.max, hint: `${CALL_MIN_MINUTES}–${CALL_MAX_MINUTES}`, line: callsCeilingLine(best.name, best.left) };
}
