// The shared rules: pure functions used by the server (and shown on pages). Every money rule, the stop-once rule,
// the Edit version check, the join check and contract snapshots live here so they are tested in one place.

import { money } from "./format";

// ---------- Money ----------

/** Testers get 80% of every charge; the platform keeps 20%. */
export const PLATFORM_FEE_PERCENT = 20;
/** The smallest card charge Stripe allows. */
export const MIN_CHARGE_CENTS = 50;

export const PRICE_LIMITS = {
  partMin: 100, // $1.00 for written answers or a recording (or free)
  partMax: 100_000, // $1000 per part
  rateMin: 1000, // $10.00 an hour for a live call (or free)
  rateMax: 20_000, // $200 an hour
};

/** Split a charge: the platform fee (20%) and what the tester gets (the rest). */
export function splitFee(amountCents: number) {
  const testerCents = Math.round((amountCents * (100 - PLATFORM_FEE_PERCENT)) / 100);
  return { amountCents, feeCents: amountCents - testerCents, testerCents };
}

/** What the tester earns from a price (shown to testers only). */
export const testerShare = (cents: number) => splitFee(cents).testerCents;

export type Check = { ok: true } | { ok: false; message: string };
const no = (message: string): Check => ({ ok: false, message });
const yes: Check = { ok: true };

/** A sanity cap on one Pay press. */
export const MAX_PAY_CENTS = 500_000;

/**
 * The one Pay box (owner update, Oct 22): any amount from $0 up. A reason is required when the amount is below the
 * listing amount (a part outside the contract has no listing amount: any amount, no reason needed). A non-zero amount is at least the
 * smallest card charge. The "charged now: $X" tick must name exactly this amount.
 */
export function checkPay(amountCents: number | null, listingCents: number | null, reason: string, tickedCents: number | null): Check {
  if (amountCents == null || !Number.isInteger(amountCents) || amountCents < 0) return no("Enter an amount like 7.50.");
  if (amountCents > MAX_PAY_CENTS) return no(`At most ${money(MAX_PAY_CENTS)} in one payment.`);
  if (listingCents != null && amountCents < listingCents && reason.trim().length < 5)
    return no(`Say why you're paying less than the listing's ${money(listingCents)} (the tester reads it).`);
  if (amountCents > 0 && amountCents < MIN_CHARGE_CENTS) return no(`The smallest card charge is ${money(MIN_CHARGE_CENTS)}: pay $0.00 or at least ${money(MIN_CHARGE_CENTS)}.`);
  if (tickedCents !== amountCents) return no(`Tick “charged now: ${money(amountCents)}” to pay.`);
  return yes;
}

/** The listing amount for a part from the tester's contract; null = not in the contract. */
export function listingAmount(c: { writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null }, kind: "written" | "recording" | "call", bookedMinutes = 0) {
  if (kind === "written") return c.writtenCents;
  if (kind === "recording") return c.recordingCents;
  return c.liveRateCents == null ? null : callCharge(c.liveRateCents, bookedMinutes);
}

/** Disputes: only parts in the contract paid below the listing amount; once per part. Outside the contract, the amount is final. */
export function canDispute(paidCents: number, listingCents: number | null, alreadyDisputed: boolean): Check {
  if (listingCents == null) return no("This wasn't in your contract, so the developer's amount is final.");
  if (alreadyDisputed) return no("You already disputed this payment. A part can be disputed once.");
  if (paidCents >= listingCents) return no("This part was paid the listing amount or more, so there's nothing to dispute.");
  return yes;
}

/** An admin's decision can only raise pay: from what was paid up to the listing amount. Returns the extra to charge. */
export function checkDisputeDecision(decidedCents: number | null, paidCents: number, listingCents: number): Check & { extraCents?: number } {
  if (decidedCents == null || !Number.isInteger(decidedCents)) return no("Enter the total pay, like 7.50.");
  if (decidedCents < paidCents) return no(`A decision can only raise pay: at least the ${money(paidCents)} already paid.`);
  if (decidedCents > listingCents) return no(`At most the listing's ${money(listingCents)}.`);
  const extra = decidedCents - paidCents;
  if (extra > 0 && extra < MIN_CHARGE_CENTS) return no(`The extra would be under the smallest card charge (${money(MIN_CHARGE_CENTS)}). Keep the pay as it is or raise it by at least ${money(MIN_CHARGE_CENTS)}.`);
  return { ok: true, extraCents: extra };
}

/** Live calls: reference = rate × booked length, rounded to the cent; a non-zero amount is at least the smallest card charge. */
export function callCharge(rateCents: number, minutes: number) {
  if (rateCents <= 0 || minutes <= 0) return 0;
  const c = Math.round((rateCents * minutes) / 60);
  return Math.max(c, MIN_CHARGE_CENTS);
}

/** Late work is allowed (marked on both sides). */
export const isLate = (dueAt: Date, at: Date) => at.getTime() > dueAt.getTime();
export const lateLabel = (dueAt: Date, fmt: (d: Date) => string) => `Sent late (deadline was ${fmt(dueAt)})`;

/**
 * Why a tester's press (send work, book or cancel a call) can't happen, or "". Late is fine; after Open until, after the
 * developer stopped the test or ended this tester early, or after they left, it's refused with the reason.
 */
export function testerRefusal(
  c: { status: string; endKind: string; endedAt: Date | null },
  test: { openUntil: Date | null },
  devName: string,
  fmt: (d: Date) => string,
  now: Date,
) {
  if (c.status === "left") return "You left this test.";
  if (c.status === "ended") return endedLine(c, devName, fmt);
  if (test.openUntil && test.openUntil.getTime() < now.getTime()) return `This test closed on ${fmt(test.openUntil)}.`;
  return "";
}

/** Cancelling a booked call: only 24 hours or more ahead. */
export const CANCEL_HOURS = 24;
export function canCancelCall(startsAt: Date, now: Date): Check {
  if (startsAt.getTime() - now.getTime() < CANCEL_HOURS * 3_600_000) return no("Calls can only be cancelled 24 hours or more ahead.");
  return yes;
}

// ---------- Listing ----------

export type Listing = {
  title: string;
  description: string;
  buildUrl: string;
  category: string;
  devices: string[];
  languages: string[];
  spots: number;
  writtenCents: number | null;
  recordingCents: number | null;
  liveRateCents: number | null;
  liveMinutes: number | null;
  deadlineDays: number;
  questions: string[];
  /** After this date (ISO): no new joiners, no sending, no booking. null = no end date */
  openUntil: string | null;
};

export const LISTING_FIELDS = [
  "title", "description", "buildUrl", "category", "devices", "languages", "spots",
  "writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "deadlineDays", "questions", "openUntil",
] as const satisfies readonly (keyof Listing)[];

/** Fields whose change alters the terms new testers join on (checked by Join). Spots only changes availability. */
export const TERM_FIELDS = LISTING_FIELDS.filter((f) => f !== "spots");

export const MAX_SPOTS = 50;

/** Check a listing's values. Returns every problem, each in a plain sentence. */
export function checkListing(l: Listing, testersIn = 0, now = new Date()): string[] {
  const errs: string[] = [];
  if (l.openUntil != null) {
    const d = new Date(l.openUntil);
    if (isNaN(d.getTime())) errs.push("Enter the Open until date like 2026-12-01.");
    else if (d.getTime() <= now.getTime()) errs.push("Open until must be a date in the future.");
    else if (d.getTime() > now.getTime() + 366 * 86_400_000) errs.push("Open until can be at most a year ahead.");
  }
  if (!l.title.trim()) errs.push("Give the test a title.");
  if (l.title.length > 120) errs.push("Keep the title under 120 characters.");
  if (!Number.isInteger(l.spots) || l.spots < 1 || l.spots > MAX_SPOTS) errs.push(`Spots must be a whole number from 1 to ${MAX_SPOTS}.`);
  else if (l.spots < testersIn) errs.push(`Spots can't go below the ${testersIn} tester${testersIn === 1 ? "" : "s"} already in.`);
  if (!Number.isInteger(l.deadlineDays) || l.deadlineDays < 1 || l.deadlineDays > 90) errs.push("Testers' deadline must be from 1 to 90 days after they join.");
  if (l.writtenCents == null && l.recordingCents == null && l.liveRateCents == null) errs.push("Choose at least one kind of feedback.");
  const part = (c: number | null, name: string) => {
    if (c == null || c === 0) return;
    if (c < PRICE_LIMITS.partMin) errs.push(`The ${name} price must be at least ${money(PRICE_LIMITS.partMin)} (or free).`);
    if (c > PRICE_LIMITS.partMax) errs.push(`The ${name} price can be at most ${money(PRICE_LIMITS.partMax)}.`);
  };
  part(l.writtenCents, "written answers");
  part(l.recordingCents, "recording");
  if (l.liveRateCents != null) {
    if (l.liveRateCents !== 0 && l.liveRateCents < PRICE_LIMITS.rateMin) errs.push(`The live call rate must be at least ${money(PRICE_LIMITS.rateMin)} an hour (or free).`);
    if (l.liveRateCents > PRICE_LIMITS.rateMax) errs.push(`The live call rate can be at most ${money(PRICE_LIMITS.rateMax)} an hour.`);
    if (!l.liveMinutes || l.liveMinutes < 10 || l.liveMinutes > 180) errs.push("A live call lasts from 10 to 180 minutes.");
  }
  if (l.writtenCents != null && l.questions.filter((q) => q.trim()).length === 0) errs.push("Add at least one question for the written answers.");
  if (l.questions.length > 20) errs.push("At most 20 questions.");
  return errs;
}

/** The contract: every term copied from the listing at join. Edits later never touch it. */
export function contractSnapshot(test: Listing & { listingVersion: number }, joinedAt: Date, keepPrivate: boolean) {
  return {
    listingVersion: test.listingVersion,
    title: test.title,
    description: test.description,
    buildUrl: test.buildUrl,
    writtenCents: test.writtenCents,
    recordingCents: test.recordingCents,
    liveRateCents: test.liveRateCents,
    liveMinutes: test.liveRateCents == null ? null : test.liveMinutes,
    deadlineDays: test.deadlineDays,
    questions: [...test.questions],
    keepPrivate,
    joinedAt,
    dueAt: new Date(joinedAt.getTime() + test.deadlineDays * 86_400_000),
  };
}

/** One-line summary of terms: "Written $7.50 · Recording $12.00 · Live call $30.00/h (30 min) · 7 days". */
export function termsLine(t: Pick<Listing, "writtenCents" | "recordingCents" | "liveRateCents" | "liveMinutes" | "deadlineDays">, forTester = false) {
  // Testers see what they get (80% of each price); the developer's side never shows the tester's share.
  const p = (c: number) => (c === 0 ? "free" : money(forTester ? testerShare(c) : c));
  const parts: string[] = [];
  if (t.writtenCents != null) parts.push(`Written ${p(t.writtenCents)}`);
  if (t.recordingCents != null) parts.push(`Recording ${p(t.recordingCents)}`);
  if (t.liveRateCents != null) parts.push(`Live call ${t.liveRateCents === 0 ? "free" : p(t.liveRateCents) + "/h"} (${t.liveMinutes} min)`);
  parts.push(`${t.deadlineDays} day${t.deadlineDays === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

// ---------- Stop once ----------

/**
 * What makes a panel's press stop once (owner rule 4, updated Oct 22): a tester joined, left or sent work; a live call
 * was booked, confirmed or cancelled (either side); call times were offered or removed.
 * Developer: top-panel buttons (box under the top title panel) and live-call panel buttons (box under that panel).
 * Tester: Book / Cancel in their live-call panel, for call changes they can see (box under that panel).
 */
export const STOP_ONCE_KINDS = ["joined", "left", "sent", "booked", "confirmed", "cancelled", "offered", "removed"] as const;
export const CALL_KINDS = ["booked", "confirmed", "cancelled", "offered", "removed"] as const;
export type TestEventLike = { kind: string; text: string; createdAt: Date; version?: number | null };

/** Events since the page's "seen" marker that stop a press once, oldest first. */
export function stopOnceChanges(events: TestEventLike[], seenAt: Date, kinds: readonly string[] = STOP_ONCE_KINDS) {
  return events
    .filter((e) => kinds.includes(e.kind) && e.createdAt.getTime() > seenAt.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** The first press stops if anything changed since the page loaded; the second press (confirmed) goes ahead. */
export function stopOnce(events: TestEventLike[], seenAt: Date, confirmed: boolean, kinds: readonly string[] = STOP_ONCE_KINDS): { go: true } | { go: false; changes: TestEventLike[] } {
  if (confirmed) return { go: true };
  const changes = stopOnceChanges(events, seenAt, kinds);
  return changes.length ? { go: false, changes } : { go: true };
}

/**
 * (Owner, Oct 22, latest) One set of reasons for ALL the developer's stop-once buttons: the top panel (Stop, End early,
 * Next round), the live-call panel (offer/remove times, cancel a call) and Pay / Reject on each piece. Test-wide.
 */
export const DEV_STOP_KINDS = [...STOP_ONCE_KINDS, "paid", "rejected", "chargeback", "choice"] as const;
export function devStopOnce(events: TestEventLike[], seenAt: Date, confirmed: boolean) {
  return stopOnce(events, seenAt, confirmed, DEV_STOP_KINDS);
}

/** Reject: nothing is charged; a reason is required. */
export function checkReject(reason: string): Check {
  return reason.trim().length < 5 ? no("Say why you're rejecting it (the tester reads it).") : yes;
}

/** The one line a tester reads (and every later press is refused with) once their work was ended by the developer. */
export function endedLine(c: { status: string; endKind: string; endedAt: Date | null }, devName: string, fmt: (d: Date) => string) {
  if (c.status !== "ended" || !c.endedAt) return "";
  if (c.endKind === "stopped") return `${devName} stopped the test on ${fmt(c.endedAt)}. Work you sent is still reviewed.`;
  return `${devName} ended your session early on ${fmt(c.endedAt)}. Work you sent is still reviewed.`;
}


// ---------- Edit version check ----------

/** Save sends the version it loaded. If the test changed since, the first Save stops and lists what changed. */
export function editCheck(loadedVersion: number, currentVersion: number, events: TestEventLike[], confirmed: boolean): { go: true } | { go: false; changes: TestEventLike[] } {
  if (loadedVersion === currentVersion || confirmed) return { go: true };
  const changes = events.filter((e) => e.version != null && e.version > loadedVersion).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { go: false, changes };
}

/** The second Save: the typed (touched) fields go on top of the newest values; untouched fields keep the newer values. */
export function mergeEdit(current: Listing, touched: Partial<Listing>): Listing {
  const out: Listing = { ...current };
  for (const k of LISTING_FIELDS) if (k in touched && touched[k] !== undefined) (out as Record<string, unknown>)[k] = touched[k];
  return out;
}

/** Which term fields differ between two listings (to decide whether the listing version moves on). */
export function changedTerms(a: Listing, b: Listing) {
  return TERM_FIELDS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

// ---------- Join ----------

export type JoinState = { status: string; listingVersion: number; spots: number; testersIn: number; openUntil?: Date | null };

/**
 * Join sends the listing version the tester saw. Closed/stopped/full tests refuse for good; a changed listing stops once
 * (the page shows the new terms); the second press joins on the new terms.
 */
export function joinCheck(t: JoinState, seenListingVersion: number, confirmed: boolean, now = new Date()): { result: "go" } | { result: "refused"; message: string } | { result: "changed" } {
  if (t.status === "stopped") return { result: "refused", message: "This test was stopped." };
  if (t.openUntil && t.openUntil.getTime() < now.getTime()) return { result: "refused", message: "This test isn't taking new testers any more." };
  if (t.status !== "open") return { result: "refused", message: "This test isn't taking new testers any more." };
  if (t.testersIn >= t.spots) return { result: "refused", message: "This test is full." };
  if (seenListingVersion !== t.listingVersion && !confirmed) return { result: "changed" };
  return { result: "go" };
}

// ---------- Payment hold, auto-pay, Open until, invites (owner, Oct 22, newest) ----------

export const REVIEW_DAYS = 14; // unpaid sent work is paid automatically after this
export const OWED_DAYS = 3; // a failed charge unpaid this long starts a payment hold
export const HOLD_ALERT_DAYS = 30; // the admin is alerted to close the tests
const DAY = 86_400_000;

/** What gets paid automatically after 14 days: the listing amount (older rule; see autoPayFor). */
export const autoPayAmount = (listingCents: number | null) => listingCents ?? 0;
export const payByFrom = (sentAt: Date) => new Date(sentAt.getTime() + REVIEW_DAYS * DAY);
export const owedUntilFrom = (failedAt: Date) => new Date(failedAt.getTime() + OWED_DAYS * DAY);

/** When a hold lifts, deadlines, Open until and review clocks move on by the length of the pause. */
export function shiftForHold<T extends Date | null>(d: T, holdStartedAt: Date, liftedAt: Date): T {
  if (!d) return d;
  return new Date(d.getTime() + Math.max(0, liftedAt.getTime() - holdStartedAt.getTime())) as T;
}

export const PAUSED_FOR_TESTERS = "This test is paused. Payment for your work may be delayed.";
export const PAY_WAITS = "Pay what you owe first.";

/** Open until can be moved only before it passes; once passed, it can't be extended. */
export function checkOpenUntilChange(current: Date | null, next: Date | null, now: Date, fmt: (d: Date) => string): Check {
  const same = (current?.getTime() ?? null) === (next?.getTime() ?? null);
  if (same) return yes;
  if (current && current.getTime() < now.getTime()) return no(`Joining closed on ${fmt(current)} (Open until), so it can't be extended.`);
  return yes;
}

/** Which Open until heads-up is due now (3 days, then 1 day before), if any. */
export function headsUpDue(openUntil: Date | null, now: Date, sent3d: boolean, sent1d: boolean): "3d" | "1d" | null {
  if (!openUntil || openUntil.getTime() <= now.getTime()) return null;
  const left = openUntil.getTime() - now.getTime();
  if (left <= DAY) return sent1d ? null : "1d";
  if (left <= 3 * DAY && !sent3d) return "3d";
  return null;
}
export const headsUpLine = (title: string, openUntil: Date, fmt: (d: Date) => string) => `${title} closes on ${fmt(openUntil)}: send your work before then.`;

/** Invite: reasons the whole press is refused for good. */
export function inviteTestRefusal(
  t: { status: string; spots: number; testersIn: number; openUntil: Date | null; stoppedAt: Date | null; paused: boolean },
  now: Date,
  fmt: (d: Date) => string,
) {
  if (t.status === "stopped") return `This test was stopped${t.stoppedAt ? ` on ${fmt(t.stoppedAt)}` : ""}, so nobody can be invited.`;
  if (t.openUntil && t.openUntil.getTime() < now.getTime()) return `Joining closed on ${fmt(t.openUntil)} (Open until), so nobody can be invited.`;
  if (t.paused) return "This test is paused until you pay what you owe, so nobody can be invited.";
  if (t.status !== "open") return "This test isn't taking new testers, so nobody can be invited.";
  if (t.testersIn >= t.spots) return `This test is full (${t.testersIn} of ${t.spots} spots), so nobody can be invited. Add spots in Edit to invite more.`;
  return "";
}

export const MAX_ACTIVE_TESTS = 10;
/** Invite: per-tester refusals. Never reveals a block or a suspension. */
export function inviteTesterRefusal(name: string, x: { suspended: boolean; blocked: boolean; deleted: boolean; activeTests: number }) {
  if (x.deleted) return `${name}'s account was closed, so they can't be invited.`;
  if (x.suspended || x.blocked) return `${name} can't be invited right now.`;
  if (x.activeTests >= MAX_ACTIVE_TESTS) return `${name} can't join more tests right now.`;
  return "";
}

/** "Ana Silva", "Ana Silva and Dee Moss", "Ana, Ben and Dee". */
export const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// ---------- Latest batch (owner, Oct 22): calls, payment problems, email settings ----------

const callDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const CANCEL_WHY = { paused: "the test is paused", stopped: "the test was stopped", closed: "the test was closed", ended: "your session was ended" } as const;

/** What a tester reads when a booked call is cancelled for them (never any fault). */
export const callCancelledLine = (startsAt: Date, why: keyof typeof CANCEL_WHY) => `Your call on ${callDay(startsAt)} was cancelled because ${CANCEL_WHY[why]}.`;

/** The Pay box reference for a call: the listing rate × the entered length (or the booked length). */
export function callReference(rateCents: number | null, minutes: number) {
  if (rateCents == null) return { cents: null as number | null, text: "Not in the listing" };
  const cents = callCharge(rateCents, minutes);
  return { cents, text: `Listing: ${money(rateCents).replace(/\.00$/, "")}/h × ${minutes} min = ${money(cents)}` };
}

/** "How long was the call?": whole minutes, 1 to 3 times the booked length. */
export function checkActualMinutes(minutes: number | null, booked: number): Check {
  if (minutes == null || !Number.isInteger(minutes) || minutes < 1) return no("Enter the call's length in whole minutes.");
  if (minutes > booked * 3) return no(`At most ${booked * 3} minutes (3 times the ${booked} booked).`);
  return yes;
}

/** A declined Pay, shown under that Pay button. */
export const declinedLine = (name: string, cents: number, label: string) =>
  `Your card was declined, so ${name} wasn't paid ${money(cents)} for the ${label === "live call" ? "call" : label}. Update your card in Payments, then press Pay again.`;
export const DELAYED_CALL_LINE = "Payment for this call may be delayed.";

/** Email settings: each update / one daily summary / none. Sign-in links and payment receipts always send. */
export function emailDecision(pref: string, always: boolean): "send" | "summary" | "skip" {
  if (always || pref === "each" || !pref) return "send";
  if (pref === "off" || pref === "none") return "skip";
  return "summary"; // daily / weekly / monthly
}

// ---------- Newest owner rules (Oct 22): asked amounts, cancelling, summaries, heads-up line ----------

/** The Pay box starts at the asked amount if there is one, else the listing amount (else empty). */
export const payStart = (listingCents: number | null, askedCents: number | null) => askedCents ?? listingCents;

/** Auto-pay at 14 days: contract parts only, the listing amount or the asked amount if lower; null = never auto-paid. */
export const autoPayFor = (listingCents: number | null, askedCents: number | null) =>
  listingCents == null ? null : Math.min(listingCents, askedCents ?? listingCents);
export const REMIND_DAYS = 3;

/** "Ask $___ for this": optional; any amount from $0 up to the one-payment cap. */
export function checkAsk(cents: number | null): Check {
  if (cents == null) return yes;
  if (!Number.isInteger(cents) || cents < 0) return no("Enter the amount you ask like 7.50, or leave it empty.");
  if (cents > MAX_PAY_CENTS) return no(`Ask at most ${money(MAX_PAY_CENTS)}.`);
  return yes;
}

/** Cancel a call any time; within 24 hours of it a reason is required (the other side sees it). */
export const cancelNeedsReason = (startsAt: Date, now: Date) => startsAt.getTime() - now.getTime() < CANCEL_HOURS * 3_600_000;
export function checkCancel(startsAt: Date, now: Date, reason: string): Check {
  if (cancelNeedsReason(startsAt, now) && reason.trim().length < 3) return no("The call is less than 24 hours away: say why you're cancelling (the other side sees it).");
  return yes;
}
const whenLong = (d: Date) =>
  `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
export const cancelLine = (name: string, startsAt: Date, reason: string) => `${name} cancelled the call on ${whenLong(startsAt)}${reason.trim() ? `: ${reason.trim()}` : "."}`;

/** "⏱ Harbor Run closes in 2 days 4 hours: send your work before then." */
export function closesInLine(title: string, openUntil: Date, now: Date) {
  const mins = Math.max(0, Math.floor((openUntil.getTime() - now.getTime()) / 60_000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const left = d > 0 ? [pl(d, "day"), h ? pl(h, "hour") : ""].filter(Boolean).join(" ") : h > 0 ? [pl(h, "hour"), m ? pl(m, "minute") : ""].filter(Boolean).join(" ") : pl(Math.max(m, 1), "minute");
  return `⏱ ${title} closes in ${left}: send your work before then.`;
}

/** Summary emails: daily, weekly or monthly since the last one. */
export function summaryDue(pref: string, last: Date | null, now: Date) {
  const days = pref === "daily" ? 1 : pref === "weekly" ? 7 : pref === "monthly" ? 30 : 0;
  if (!days) return false;
  return !last || now.getTime() - last.getTime() >= days * 86_400_000 - 3_600_000;
}

/** One line per failed payment in the hold box. */
export const failedLine = (what: string, cents: number, failedAt: Date) =>
  `${what} ${money(cents)} · card declined ${failedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

/** "Paid so far: written answers $10.00 · recording $0.00 · live calls $12.50 (25 min)" for one tester on a test. */
export function paidByKind(parts: { kind: "written" | "recording" | "call"; amountCents: number; minutes?: number | null }[]) {
  const sum = (k: string) => parts.filter((p) => p.kind === k).reduce((a, p) => a + p.amountCents, 0);
  const mins = parts.filter((p) => p.kind === "call").reduce((a, p) => a + (p.minutes ?? 0), 0);
  return `Paid so far: written answers ${money(sum("written"))} · recording ${money(sum("recording"))} · live calls ${money(sum("call"))} (${mins} min)`;
}

/** The developer adds their side to a dispute once. */
export function checkDevSide(text: string, already: boolean): Check {
  if (already) return no("You already added your side to this dispute.");
  if (text.trim().length < 5) return no("Write your side in a sentence or two.");
  return yes;
}

/** Day 14 on an unreviewed contract part: the tester chooses. */
export const choiceLine = (devName: string, kind: string, cents: number) =>
  `${devName} didn't review your ${kind === "recording" ? "recording" : "written answers"} in 14 days: charge ${money(cents)} or let it go`;
export const CHARGED_BY_TESTER = "Charged by the tester after 14 days without a review.";
export const LET_GO_BY_TESTER = "Let go by the tester: nothing charged.";
export const CHARGED_AUTOMATICALLY = "Charged automatically: no choice within 14 more days.";
