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
 * listing amount (extra work has no listing amount: any amount, no reason needed). A non-zero amount is at least the
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

/** The listing amount for a part from the tester's contract; null = not in the listing (extra work). */
export function listingAmount(c: { writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null }, kind: "written" | "recording" | "call", bookedMinutes = 0) {
  if (kind === "written") return c.writtenCents;
  if (kind === "recording") return c.recordingCents;
  return c.liveRateCents == null ? null : callCharge(c.liveRateCents, bookedMinutes);
}

/** Disputes: only parts in the contract paid below the listing amount; once per part. Extra work's amount is final. */
export function canDispute(paidCents: number, listingCents: number | null, alreadyDisputed: boolean): Check {
  if (listingCents == null) return no("This was extra work (not in the listing): the developer's amount is final.");
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
// ("paid" only stops the Pay box, below.)
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

/** What stops the Pay press once: that tester sent new/updated work, left, booked or cancelled a call, or was paid (other tab). */
export const PAY_KINDS = ["sent", "left", "booked", "cancelled", "paid"] as const;
export function payStopOnce(events: (TestEventLike & { contractId?: string | null })[], seenAt: Date, confirmed: boolean, contractId: string) {
  return stopOnce(events.filter((e) => e.contractId === contractId), seenAt, confirmed, PAY_KINDS);
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
