import { withoutAttachmentMarkers } from "./answerAttachments";
// The shared rules: pure functions used by the server (and shown on pages). Every money rule, the stop-once rule,
// the Edit version check, the join check and contract snapshots live here so they are tested in one place.

import type { Prisma } from "@prisma/client";
import { money } from "./format";
import { LIMITS } from "./limits";
import { qText } from "./questions";
import { T, safeZone } from "./tz";

// ---------- Money ----------

/** Testers get 80% of every charge; the platform keeps 20%. */
export const PLATFORM_FEE_PERCENT = 20;
/** The smallest card charge Stripe allows. */
export const MIN_CHARGE_CENTS = 50;

export const PRICE_LIMITS = {
  partMin: 100, // $1.00 for written answers or a recording (or free)
  partMax: 100_000, // (Owner, Oct 27) $1,000 for written answers or a recording
  rateMin: 1000, // $10.00 an hour for a live call (or free)
  rateMax: 20_000, // (Owner, Oct 27) $200 an hour for a live call
};
/** A part price over this needs the tick "I confirm this part pays more than $200." (when it is created over it, or raised from at most it to over it). */
export const HIGH_PART_CENTS = 20_000;
export const HIGH_PART_TICK = "I confirm this part pays more than $200.";
/**
 * (Owner, Oct 28, batch 19 section 7) The required tick above Post the test (and posting a draft), and above Save on Edit while Save is enabled: "How payments work"
 * after it links to the Terms' payments section (a new tab). An unticked press is refused with PAY_RULES_TICK_MISSING, red at the tick.
 */
// (Owner, Oct 29, batch 28 §21) It covers the automatic charge of listed calls too.
// (Batch 30 §3) Charge applies to listed work sent by the tester's deadline.
export const PAY_RULES_TICK = "I understand that a tester can charge my card, up to the listing price, for work they sent by their own deadline that I haven't paid once 7 days have passed since they sent it and that deadline has passed, and listed calls 7 days after they take place.";
export const PAY_RULES_LINK = "How payments work";
export const PAY_RULES_TICK_MISSING = "Tick to confirm you understand how payments work.";
/** The Terms' payments section (section 4, How payments work). */
export const PAYMENTS_TERMS_ID = "how-payments-work";
export const PAYMENTS_TERMS_HREF = `/terms#${PAYMENTS_TERMS_ID}`;
/** Whether a Post / Save press carries the tick. */
export const payRulesTicked = (body: Record<string, unknown>) => body.payRulesOk === true;
/**
 * (Owner, Oct 28 night, batch 9) EVERY Pay and Extra pay above $0 has the tick "I understand this payment of $X can't be refunded and is charged now." (it names the exact
 * amount; a changed amount unticks it). Over PAY_TICK_CENTS ($200) a second tick is needed too: "I confirm this payment is over $200." Paying $0 needs no tick.
 */
export const PAY_TICK_CENTS = 20_000;
/**
 * (Owner, Oct 28, batch 16 section 39) The tester's Charge needs no tick for ordinary amounts (its button names the amount); above $200, the same line as the developer's
 * Pay, the tick stays and must name the typed amount: "Charge Nora Lane $250.00 now (over $200)".
 */
export const CHARGE_TICK_CENTS = PAY_TICK_CENTS;
export const chargeTickLabel = (devName: string, cents: number) => `Charge ${devName} ${money(cents)} now (over $200)`;
export const chargeTickLine = (devName: string, cents: number) => `Tick “${chargeTickLabel(devName, cents)}” to charge.`;
/**
 * (Owner, Oct 30, batch 35 §1) An admin's Decide that raises a dispute's pay needs a tick naming what it charges, for any amount (not only over $200):
 * "Charge Dana Reyes $6.00 more ($10.00 in all for this piece)". A changed amount unticks it; keeping the pay needs no tick.
 */
export const decideTickLabel = (devName: string, extraCents: number, totalCents: number) => `Charge ${devName} ${money(extraCents)} more (${money(totalCents)} in all for this piece)`;
export const decideTickLine = (devName: string, extraCents: number, totalCents: number) => `Tick “${decideTickLabel(devName, extraCents, totalCents)}” to decide.`;
/** (Owner, Oct 30, batch 32 §13) The tick next to Let it go (no pop-up): the button stays disabled until it's ticked. */
export const letGoTickLabel = (devName: string) => `Let it go won't charge ${devName}, and you won't be paid for this`;
export const PAY_TICK_LINE = (cents: number) => `I understand this payment of ${money(cents)} can't be refunded and is charged now.`;
export const OVER_PAY_TICK_LINE = "I confirm this payment is over $200.";

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

/**
 * (Owner) No upper cap on money. The one limit is Stripe's own: a card charge can't be more than about $999,999.99, so an
 * amount above it is refused in red with that reason.
 */
export const STRIPE_MAX_CENTS = 99_999_999;
export const MAX_PAY_CENTS = STRIPE_MAX_CENTS;
export const STRIPE_MAX_LINE = `Stripe can't take more than ${"$999,999.99"} in one charge.`;

/**
 * The one Pay box (owner update, Oct 22): any amount from $0 up. A note is required when the amount is below the listing amount (a part outside the contract has no
 * listing amount: any amount, the note optional). A non-zero amount is at least the smallest card charge. (Batch 9) Above $0 the tick naming exactly this amount is
 * needed, and over $200 the second tick too; $0 needs none.
 */
export function checkPay(amountCents: number | null, listingCents: number | null, reason: string, tickedCents: number | null, over200 = false): Check {
  if (amountCents == null || !Number.isInteger(amountCents) || amountCents < 0) return no("Enter an amount like 7.50.");
  if (amountCents > STRIPE_MAX_CENTS) return no(STRIPE_MAX_LINE);
  // (Owner, Oct 30, batch 15 section 30) $0 always needs a reason, listed or not.
  if (amountCents === 0 && reason.trim().length < 5) return no(ZERO_PAY_REASON);
  if (REASON_WHEN_UNDER_LISTING && listingCents != null && amountCents < listingCents && reason.trim().length < 5)
    return no(`Say why you're paying less than the listing's ${money(listingCents)} (the tester reads it).`);
  if (amountCents > 0 && amountCents < MIN_CHARGE_CENTS) return no(`The smallest card charge is ${money(MIN_CHARGE_CENTS)}: pay $0.00 or at least ${money(MIN_CHARGE_CENTS)}.`);
  return payTicks(amountCents, tickedCents, over200);
}

/**
 * (Owner, Oct 30, batch 15 section 30; owner update the same day) Paying LESS than the listing (above $0) still needs a reason. One switch, so it can be flipped back.
 */
export const REASON_WHEN_UNDER_LISTING = true;
export const ZERO_PAY_REASON = "Say why you're paying $0 (the tester reads it).";
/** (Batch 15 section 30) A $0 payment, on both sides: Paid $0: “<reason>”. */
export const paidZeroLine = (reason: string) => `Paid $0: “${reason}”`;
/** (Batch 15 section 30) The line under every Pay button. */
export const payUnderLine = (name: string, listed: boolean) => (listed ? `${name} can dispute the amount once.` : `This part isn't listed: pay any amount, $0 included. ${name} can dispute the amount once.`);

/** (Batch 9) The ticks on every Pay and Extra pay: the amount's own tick above $0, and the over-$200 tick above $200. */
export function payTicks(amountCents: number, tickedCents: number | null, over200: boolean): Check {
  if (amountCents === 0) return yes;
  if (tickedCents !== amountCents) return no(`Tick “${PAY_TICK_LINE(amountCents)}” to pay.`);
  if (amountCents > PAY_TICK_CENTS && !over200) return no(`Tick “${OVER_PAY_TICK_LINE}” to pay.`);
  return yes;
}

/** The listing amount for a part from the tester's contract; null = not in the contract. */
export function listingAmount(c: { writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null }, kind: "written" | "recording" | "call", bookedMinutes = 0) {
  if (kind === "written") return c.writtenCents;
  if (kind === "recording") return c.recordingCents;
  return c.liveRateCents == null ? null : callCharge(c.liveRateCents, bookedMinutes);
}

/**
 * (Owner, Oct 29, batch 10) Every part the developer reviewed can be disputed, once: a Pay (any amount, $0 included) or a Reject on a listed part, and a Pay (any amount,
 * $0 included) on an unlisted part. The tester's own Charge or Let it go isn't the developer's decision, so it can't be disputed. (`paidCents` and `listingCents` are kept for
 * the callers' signatures: no amount refuses a dispute any more.)
 */
export function canDispute(paidCents: number, listingCents: number | null, alreadyDisputed: boolean, testerChose = false, /** (Batch 20 section 15) what a decision could still add (disputeBounds' max minus min) */ roomCents: number | null = null): Check {
  void paidCents;
  void listingCents;
  if (testerChose) return no(TESTER_CHOSE_LINE);
  if (alreadyDisputed) return no("You already disputed this payment. A part can be disputed once.");
  if (roomCents != null && roomCents <= 0) return no(NOTHING_TO_DISPUTE);
  return yes;
}
/**
 * (Owner, Oct 28, batch 20 section 15; batch 28 §15) Already paid the most this piece can be paid (its cap, the admin form's own max): the Dispute button is disabled
 * with this line.
 */
export const NOTHING_TO_DISPUTE = "Already paid the most this piece can be paid, so there's nothing to dispute.";
/** (Batch 10) A dispute pressed on a part the tester settled themselves (their Charge or Let it go). */
export const TESTER_CHOSE_LINE = "You settled this part yourself (Charge or Let it go), so there's no developer decision to dispute.";
/**
 * (Batch 28 §15) How far a decision can raise the pay, for the dispute form's note and the developer's notice: "up to $20.00 more" (what's left of the piece's cap, the same
 * cap Pay and Pay more have).
 */
export const disputeLimitText = (roomCents: number) => `up to ${money(Math.max(0, roomCents))} more`;
/** (Batch 28 §15) The admin form's range: "$20.00 paid · can raise up to $20.00 more". */
export const disputeRangeLine = (paidCents: number, roomCents: number) => `${money(paidCents)} paid · can raise up to ${money(Math.max(0, roomCents))} more`;

/**
 * An admin's decision can only raise pay. (Owner, Oct 29, batch 28 §15) The total for the piece runs from what it was already paid (`paidCents`, its Pay and every Pay
 * more) up to its cap (`maxCents`: the same cap Pay + Pay more have; a call also within what's left of the $1,000 for that tester's calls, `poolBinds`). Returns the
 * extra to charge.
 */
export function checkDisputeDecision(decidedCents: number | null, paidCents: number, maxCents: number, poolBinds = false): Check & { extraCents?: number } {
  if (decidedCents == null || !Number.isInteger(decidedCents)) return no("Enter the total pay, like 7.50.");
  if (decidedCents < paidCents) return no(`A decision can only raise pay: at least the ${money(paidCents)} paid for this piece.`);
  const max = Math.max(paidCents, maxCents);
  if (decidedCents > max) return no(`At most ${money(max)}: ${poolBinds ? "what's left of the $1,000 for this tester's calls" : "the most this piece can be paid"}.`);
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
  c: StopCtx & { status: string },
  test: { openUntil: Date | null; adminStoppedAt?: Date | null },
  devName: string,
  fmt: (d: Date) => string,
  now: Date,
) {
  if (c.status === "left") return c.endKind === "rated" ? "You rated this test, so your part is finished." : "You left this test.";
  if (c.status === "ended") return endedLine({ ...c, test: c.test ?? test }, devName, fmt);
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
  /** (Design doc 4) The game, website, app or other product; `title` is this test's own name */
  productName: string;
  title: string;
  description: string;
  /** Mature (18+) and why (required when ticked) */
  mature: boolean;
  matureWhy: string;
  /** Optional NDA text testers accept before joining ("" = none) */
  ndaText: string;
  buildUrl: string;
  categories: string[];
  devices: string[];
  languages: string[];
  spots: number;
  writtenCents: number | null;
  recordingCents: number | null;
  liveRateCents: number | null;
  liveMinutes: number | null;
  /** (NEWEST+10) "Required" on each part: a label only (part of the terms) */
  writtenRequired?: boolean;
  recordingRequired?: boolean;
  liveRequired?: boolean;
  deadlineDays: number;
  questions: string[];
  /** After this date (ISO): no new joiners, no sending, no booking. null = no end date */
  openUntil: string | null;
  /** Who can join: "anyone" | "apply" | "invite" */
  joinMode: string;
};

export const LISTING_FIELDS = [
  "productName", "title", "description", "mature", "matureWhy", "ndaText", "buildUrl", "categories", "devices", "languages", "spots",
  "writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired", "deadlineDays", "questions", "openUntil", "joinMode",
] as const satisfies readonly (keyof Listing)[];

/** Fields whose change alters the terms new testers join on (checked by Join). Spots only changes availability. */
export const TERM_FIELDS = LISTING_FIELDS.filter((f) => f !== "spots");

export const MAX_SPOTS = LIMITS.spots.max;
/** (Owner, Oct 29, batch 31) Every test takes at most 10 testers: the line beside the spots field, and the refusal above it. */
export const SPOTS_MAX_LINE = `At most ${MAX_SPOTS} testers per test.`;
/** (Batch 31) A test that already has more than 10 spots keeps them: Edit can lower them, never raise them. */
export const spotsKeptLine = (saved: number) => `${SPOTS_MAX_LINE} This test keeps its ${saved} spots: you can lower them, not raise them.`;
/** (Batch 31) The most spots a test can have: 10, or what an older test already has (Edit). */
export const spotsCap = (saved?: number | null) => Math.max(MAX_SPOTS, saved ?? 0);

/** (Batch 15 section 32) The red messages at the field on Post and Edit. */
export const QUESTION_TOO_LONG = `Keep each question to ${LIMITS.question.toLocaleString("en-US")} characters.`;
/** (Owner, Oct 30, batch 35 §13) Each question once: the same text twice (ignoring case and spaces) is refused, named. */
export const sameQuestion = (q: string) => qText(q).trim().replace(/\s+/g, " ").toLowerCase();
export function duplicateQuestion(questions: string[]) {
  const seen = new Set<string>();
  for (const q of questions) {
    const k = sameQuestion(q);
    if (!k) continue;
    if (seen.has(k)) return qText(q).trim();
    seen.add(k);
  }
  return "";
}
export const duplicateQuestionLine = (q: string) => `“${q.length > 80 ? q.slice(0, 80) + "…" : q}” is in the list twice: each question can be there once.`;
/** (Owner, Oct 28, batch 16 section 9) The Mature (18+) "why": required, at least 5 characters; the same two lines at the field and from the server. */
export const MATURE_WHY_MIN = 5;
export const MATURE_WHY_REQUIRED = "Say why this test is mature (18+): it's required for mature content.";
export const MATURE_WHY_SHORT = `Say a little more: at least ${MATURE_WHY_MIN} characters.`;
export const NDA_TOO_LONG = `Keep the NDA to ${LIMITS.nda.toLocaleString("en-US")} characters.`;
/** (Batch 15 section 20) The red line at any reason or note box over the limit (never cut silently). */
export const reasonTooLong = (max: number = LIMITS.reason) => `Keep it to ${max.toLocaleString("en-US")} characters.`;
/** "N / 1,000": the live counter under every reason box. */
export const counterText = (n: number, max: number) => `${n.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}`;

/** (Batch 12 section 6; batch 15 section 18) Open until's range on Post. */
export const OPEN_UNTIL_RANGE = "Set Open until (the last day to join) 3 to 30 days from today.";
/** Post: at most 30 days from today. */
export const OPEN_UNTIL_MAX_LINE = "Open until can be at most 30 days from today.";
/**
 * (Owner, Oct 28, batch 16 section 16) The cap on Edit: Open until can be at most 30 days after the test (or its current Next round) OPENED, in the developer's
 * own date (the same moment tester days count from), so tester days never pass 30. Pause and outage shifts may still move it past the cap.
 */
export const openUntilCapDay = (openedAt: Date, tz?: string | null) => new Date(openedAt.getTime() + 30 * 86_400_000).toLocaleDateString("en-CA", { timeZone: safeZone(tz) });
const capLabel = (capDay: string) => new Date(`${capDay}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "Open until can be at most 30 days after the test opened (Dec 6)." (the field's red line and the server's message) */
export const openUntilCapLine = (capDay: string) => `Open until can be at most 30 days after the test opened (${capLabel(capDay)}).`;
/** Edit's hint next to Open until: "only later, up to Dec 6 (30 days after the test opened)". */
export const openUntilCapHint = (capDay: string) => `only later, up to ${capLabel(capDay)} (30 days after the test opened)`;
/** Edit's live hint: what each tester gets after the change: "Each tester gets 19 days from when they join (14 now + 5)." */
/**
 * (Owner, Oct 28, batch 19 section 8, replacing the batch 15 section 18 and batch 16 section 16 hints) The live line under Open until on Post and Edit: work can arrive
 * after Open until. `openUntil` is the field's date (YYYY-MM-DD); `days` the days per tester (Post: today to that date; Edit: the days now + the extension). The latest
 * possible deadline is Open until + those days. "Testers can join until this date. Each gets 14 days from when they join, so someone joining on Nov 20 has until Dec 4
 * to send work. You pay each piece within 7 days of it arriving or by that tester's deadline, whichever is later, or the tester can charge you."
 */
export function openUntilLine(openUntil: string, days: number) {
  const day = (iso: string, plus = 0) => new Date(Date.parse(`${iso}T00:00:00Z`) + plus * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Testers can join until this date. Each gets ${days} day${days === 1 ? "" : "s"} from when they join, so someone joining on ${day(openUntil)} has until ${day(openUntil, days)} to send work. You pay each piece within ${REVIEW_DAYS} days of it arriving or by that tester's deadline, whichever is later, or the tester can charge you.`;
}

// ---------- (Owner, Oct 30, batch 15 section 18) Every tester gets the same number of days; Open until is the last day to JOIN ----------

/** A moment's date (YYYY-MM-DD) in a time zone (batch 15 section 32: the developer's own; unknown = UTC). */
export const dayIn = (d: Date, tz?: string | null) => d.toLocaleDateString("en-CA", { timeZone: safeZone(tz) });
/** Whole days from one date (YYYY-MM-DD) to another. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
/** Open until is stored as the end of its chosen day: "2026-11-20T23:59:59.000Z". This is that day. */
export const openUntilDay = (openUntil: Date | string) => new Date(openUntil).toISOString().slice(0, 10);
/** Tester days: from the day the test opened (posted, or a Next round opened) to Open until, in whole days. Posted Nov 6 with Open until Nov 20: 14. */
export const testerDaysOf = (openedAt: Date, openUntil: Date | string, tz?: string | null) => Math.max(1, daysBetween(dayIn(openedAt, tz), openUntilDay(openUntil)));
/** A tester's deadline: the end of the day they join + tester days. Joining Nov 6 with 14 days: Nov 20; joining Nov 19: Dec 3. */
export function dueFromJoin(joinedAt: Date, testerDays: number, tz?: string | null) {
  const start = Date.parse(`${dayIn(joinedAt, tz)}T23:59:59.000Z`);
  return new Date(start + testerDays * DAY);
}
/** Joining has closed (Open until passed): the test takes no new testers. */
export const joiningClosed = (t: { openUntil: Date | null }, now = new Date()) => !!t.openUntil && t.openUntil.getTime() < now.getTime();
/** "This test closed to new testers on Nov 20." */
export const closedToNewLine = (openUntil: Date, fmt: (d: Date) => string) => `This test closed to new testers on ${fmt(openUntil)}.`;
/** (Batch 30 §6) The bell line when Open until passes: it stacks across tests in "Applications and invites", so it names the test. */
export const testClosedToNewLine = (title: string, openUntil: Date, fmt: (d: Date) => string) => `“${title}” closed to new testers on ${fmt(openUntil)}.`;
/** The developer's card and test page after Open until: "Joining closed · testers working until Dec 3" ("" when nobody is still working). */
export const joiningClosedLine = (latestDue: Date | null, fmt: (d: Date) => string) => (latestDue ? `Joining closed · testers working until ${fmt(latestDue)}` : "Joining closed · every tester's time is up");
/** (Owner, Oct 28, batch 16 section 3) The days a new tester gets: the number in the card's "N days per tester" (null without Open until). */
export const daysPerTester = (t: { testerDays: number | null; createdAt: Date; openUntil: Date | null }) => (t.openUntil ? t.testerDays ?? testerDaysOf(t.createdAt, t.openUntil) : null);
/** Find's "Most time to finish": the most days per tester first; ties: the later Open until first (more time left to join); tests without Open until last. */
export const byMostTimeToFinish = (a: { testerDays: number | null; createdAt: Date; openUntil: Date | null }, b: { testerDays: number | null; createdAt: Date; openUntil: Date | null }) =>
  (daysPerTester(b) ?? -1) - (daysPerTester(a) ?? -1) || (b.openUntil?.getTime() ?? 0) - (a.openUntil?.getTime() ?? 0);
/** Find cards and the listing: "14 days per tester · join by Nov 20". */
export const perTesterLine = (days: number, openUntil: Date, fmt: (d: Date) => string) => `${days} day${days === 1 ? "" : "s"} per tester · join by ${fmt(openUntil)}`;
/** The join page: "Your deadline: Dec 3 (14 days from joining)". */
export const yourDeadlineLine = (due: Date, days: number, fmt: (d: Date) => string) => `Your deadline: ${fmt(due)} (${days} day${days === 1 ? "" : "s"} from joining)`;
/** Post and Edit's live hint: "Each tester gets the same time from when they join: today to this date (14 days)." */
/** The day a deadline needs Open until to reach: the test's opening + the deadline's days + the buffer (11.5: "must leave 3 days inside Open until"). */
export function openUntilNeeded(openedAt: Date, deadlineDays: number) {
  return new Date(openedAt.getTime() + (deadlineDays + LIMITS.deadlineBufferDays) * 86_400_000);
}


export type ListingCtx = {
  /** Edit: only the fields that changed get the newer rules (older tests keep working); Post: everything. */
  changed?: ReadonlySet<string>;
  /** When the test opened (Post: now). The deadline must leave 3 days inside Open until, counted from here. */
  openedAt?: Date;
  /** Edit: the wording says Extend rather than Set. */
  edit?: boolean;
  /** (Batch 15 section 32) The developer's time zone: "today" and the 3 to 30 days are counted in it (unknown: UTC). */
  tz?: string | null;
  /** (Owner, Oct 27) The parts whose "I confirm this part pays more than $200." tick was ticked ("written" | "recording"). */
  confirmedHigh?: readonly string[];
  /** Edit: the prices now saved (a saved price over $200 that is unchanged needs no tick). */
  saved?: { writtenCents: number | null; recordingCents: number | null };
  /** (Batch 31) Edit: the spots now saved (a test above 10 keeps them; it can't go higher). */
  savedSpots?: number;
};

/** Check a listing's values. Returns every problem, each in a plain sentence. */
/** (Batch 16 section 10) The price lines, the same at the field (the client check) and from the server. */
export const partLowLine = (name: string) => `The ${name} price must be at least ${money(PRICE_LIMITS.partMin)} (or free).`;
export const partHighLine = (name: string) => `The ${name} price can be at most ${money(PRICE_LIMITS.partMax)}.`;
export const rateLowLine = () => `The live call rate must be at least ${money(PRICE_LIMITS.rateMin)} an hour (or free).`;
export const rateHighLine = () => `The live call rate can be at most ${money(PRICE_LIMITS.rateMax)} an hour.`;
export const DESCRIPTION_REQUIRED = "Say what testers should do (What to do).";
/** (Owner, Oct 29, batch 30 §18) "Name of this test" and "What should testers do?" are at least 10 characters (trimmed) on Post, Edit and posting a draft. */
export const LISTING_MIN_CHARS = 10;
/**
 * The minimum the server checks: LISTING_MIN_CHARS, except where the LISTING_MIN_CHARS setting says otherwise. Only the test suite sets it (to 1, since the tests written
 * before batch 30 post short titles such as "Run"; the batch 30 tests set it back to 10). Production never sets it.
 */
export function listingMin() {
  const v = typeof process !== "undefined" ? Number(process.env?.LISTING_MIN_CHARS) : NaN;
  return Number.isInteger(v) && v >= 1 ? v : LISTING_MIN_CHARS;
}
/** "Name of this test: at least 10 characters (6 so far)." / "What should testers do: at least 10 characters (6 so far)." (the field's red line, the server's refusal) */
export const minCharsLine = (field: string, n: number) => `${field}: at least ${LISTING_MIN_CHARS} characters (${n} so far).`;
export const TITLE_FIELD = "Name of this test";
export const STEPS_FIELD = "What should testers do";
/** The counter while a field is under its minimum: "6 / 10 minimum". */
export const minCounter = (n: number) => `${n} / ${LISTING_MIN_CHARS} minimum`;

export function checkListing(l: Listing, testersIn = 0, now = new Date(), ctx: ListingCtx = {}): string[] {
  const errs: string[] = [];
  const isNew = (f: string) => !ctx.changed || ctx.changed.has(f);
  if (!["anyone", "apply", "invite"].includes(l.joinMode ?? "anyone")) errs.push("Choose who can join: anyone, apply, or invite only.");
  // (Owner, Oct 29, batch 12 section 6) Open until is required and is every tester's deadline: on Post 3 to 30 days after today; Edit moves it only later, within 30 days of
  // today (a pause lifting can still push it further). Old tests are only checked when Edit touches it.
  if (isNew("openUntil")) {
    const d = l.openUntil != null ? new Date(l.openUntil) : null;
    // (Batch 15 section 32) Days are counted from the developer's own date, so an evening in Chicago gives the same earliest date as the date picker.
    const day = (n: number) => dayIn(new Date(now.getTime() + n * 86_400_000), ctx.tz);
    if (!d) errs.push(OPEN_UNTIL_RANGE);
    else if (isNaN(d.getTime())) errs.push("Enter the Open until date like 2026-12-01.");
    else if (d.toISOString().slice(0, 10) <= day(0)) errs.push("Open until must be a date in the future.");
    // (Batch 16 section 16) Edit: at most 30 days after the test opened (a test already past it keeps its date; it just can't move later). Post: 30 days from today.
    else if (ctx.edit && ctx.openedAt && d.toISOString().slice(0, 10) > openUntilCapDay(ctx.openedAt, ctx.tz)) errs.push(openUntilCapLine(openUntilCapDay(ctx.openedAt, ctx.tz)));
    else if (!(ctx.edit && ctx.openedAt) && d.toISOString().slice(0, 10) > day(LIMITS.openUntilMaxDays)) errs.push(OPEN_UNTIL_MAX_LINE);
    else if (!ctx.edit && d.toISOString().slice(0, 10) < day(LIMITS.openUntilMinDays)) errs.push(OPEN_UNTIL_RANGE);
  }
  // (4) Product name and the test's own name: 60 characters each; the instructions 1,000, required.
  if (!l.productName?.trim()) { if (isNew("productName")) errs.push("Enter the product name."); }
  else if (l.productName.length > LIMITS.productName && isNew("productName")) errs.push(`Keep the product name to ${LIMITS.productName} characters.`);
  if (!l.title.trim()) errs.push("Give the test a title.");
  else if (l.title.length > LIMITS.testName && isNew("title")) errs.push(`Keep the title to ${LIMITS.testName} characters.`);
  // (Batch 30 §18) At least 10 characters; an older test's shorter title or steps stay until that field is edited.
  else if (l.title.trim().length < listingMin() && isNew("title")) errs.push(minCharsLine(TITLE_FIELD, l.title.trim().length));
  if (!l.description?.trim()) { if (isNew("description")) errs.push(DESCRIPTION_REQUIRED); }
  else if (l.description.length > LIMITS.whatToDo && isNew("description")) errs.push(`Keep What to do to ${LIMITS.whatToDo.toLocaleString("en-US")} characters.`);
  else if (l.description.trim().length < listingMin() && isNew("description")) errs.push(minCharsLine(STEPS_FIELD, l.description.trim().length));
  if (l.mature && (l.matureWhy ?? "").trim().length < MATURE_WHY_MIN && (isNew("mature") || isNew("matureWhy"))) errs.push((l.matureWhy ?? "").trim() ? MATURE_WHY_SHORT : MATURE_WHY_REQUIRED);
  if ((l.ndaText ?? "").length > LIMITS.nda && isNew("ndaText")) errs.push(NDA_TOO_LONG);
  if (!l.categories?.length) errs.push("Tick at least one category.");
  // (Owner, Oct 29, batch 31) At most 10 testers per test; an older test above 10 keeps its spots (Edit lowers them, never raises them).
  const maxSpots = spotsCap(ctx.savedSpots);
  if (!Number.isInteger(l.spots) || l.spots < LIMITS.spots.min) errs.push(`Spots must be a whole number from 1 to ${maxSpots}.`);
  else if (l.spots > maxSpots) errs.push(maxSpots > MAX_SPOTS ? spotsKeptLine(maxSpots) : SPOTS_MAX_LINE);
  else if (l.spots < testersIn) errs.push(`Spots can't go below the ${testersIn} tester${testersIn === 1 ? "" : "s"} already in.`);
  if (l.writtenCents == null && l.recordingCents == null && l.liveRateCents == null) errs.push("Choose at least one kind of feedback.");
  const part = (c: number | null, name: string, field: "writtenCents" | "recordingCents", key: "written" | "recording") => {
    if (c == null || c === 0) return;
    if (c < PRICE_LIMITS.partMin) errs.push(partLowLine(name));
    else if (c > PRICE_LIMITS.partMax) {
      if (isNew(field)) errs.push(partHighLine(name));
    } else if (c > HIGH_PART_CENTS && isNew(field) && ctx.saved?.[field] !== c && !ctx.confirmedHigh?.includes(key)) errs.push(`Tick “${HIGH_PART_TICK}” for the ${name} price.`);
  };
  part(l.writtenCents, "written answers", "writtenCents", "written");
  part(l.recordingCents, "recording", "recordingCents", "recording");
  if (l.liveRateCents != null) {
    if (l.liveRateCents !== 0 && l.liveRateCents < PRICE_LIMITS.rateMin) errs.push(rateLowLine());
    else if (l.liveRateCents > PRICE_LIMITS.rateMax && isNew("liveRateCents")) errs.push(rateHighLine());
  }
  if (l.writtenCents != null && l.questions.filter((q) => q.trim()).length === 0) errs.push("Add at least one question for the written answers.");
  if (l.questions.length > LIMITS.questions.max) errs.push(`At most ${LIMITS.questions.max} questions.`);
  // (Owner, Oct 30, batch 15 section 3) At most 20,000 characters per question (checked when the questions are saved).
  if (isNew("questions") && l.questions.some((q) => qText(q).length > LIMITS.question)) errs.push(QUESTION_TOO_LONG);
  if (isNew("questions") && duplicateQuestion(l.questions)) errs.push(duplicateQuestionLine(duplicateQuestion(l.questions)));
  return errs;
}

/** The contract: every term copied from the listing at join. Edits later never touch it. */
export function contractSnapshot(test: Listing & { listingVersion: number; testerDays?: number | null; tz?: string | null }, joinedAt: Date, keepPrivate: boolean, ndaAcceptedAt: Date | null = null) {
  return {
    // (4) The NDA the tester accepted (text and time) is part of their terms.
    ndaText: test.ndaText ?? "",
    ndaAcceptedAt: test.ndaText ? ndaAcceptedAt ?? joinedAt : null,
    listingVersion: test.listingVersion,
    title: test.title,
    description: test.description,
    buildUrl: test.buildUrl,
    writtenCents: test.writtenCents,
    recordingCents: test.recordingCents,
    liveRateCents: test.liveRateCents,
    liveMinutes: null, // (NEWEST+8) each call request sets its own length
    writtenRequired: !!test.writtenRequired,
    recordingRequired: !!test.recordingRequired,
    liveRequired: !!test.liveRequired,
    deadlineDays: test.deadlineDays,
    questions: [...test.questions],
    keepPrivate,
    joinedAt,
    // (Owner, Oct 30, batch 15 section 18) Every tester gets the same number of days from when THEY join (tester days); an older test without them keeps Open until
    // as the deadline, and one with no Open until its own days.
    dueAt: test.testerDays ? dueFromJoin(joinedAt, test.testerDays, test.tz) : test.openUntil ? new Date(test.openUntil) : new Date(joinedAt.getTime() + test.deadlineDays * 86_400_000),
  };
}

/** One-line summary of terms: "Written $7.50 · Recording $12.00 · Live call $30.00/h (30 min) · 7 days". */
export function termsLine(t: Pick<Listing, "writtenCents" | "recordingCents" | "liveRateCents" | "liveMinutes"> & { deadlineDays?: number; testerDays?: number | null }, forTester = false) {
  // Testers see what they get (80% of each price); the developer's side never shows the tester's share.
  const p = (c: number) => (c === 0 ? "free" : money(forTester ? testerShare(c) : c));
  const parts: string[] = [];
  if (t.writtenCents != null) parts.push(`Written ${p(t.writtenCents)}`);
  if (t.recordingCents != null) parts.push(`Recording ${p(t.recordingCents)}`);
  if (t.liveRateCents != null) parts.push(`Live call ${t.liveRateCents === 0 ? "free" : p(t.liveRateCents) + "/h"}`);
  // (Batch 12 section 6) No "N days" from the old field. (Batch 15 section 18) Every tester gets the same days from when they join: "14 days".
  if (t.testerDays) parts.push(`${t.testerDays} day${t.testerDays === 1 ? "" : "s"}`);
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
export type TestEventLike = { kind: string; text: string; createdAt: Date; version?: number | null; /** (Batch 20 section 4) one line per thing in a stop box */ key?: string; /** (Batch 30 §10) the line says its own time ("… edited the listing at 6:55 PM: …") */ timed?: boolean; /** (Batch 30 §12) the join page's NDA changed: its tick clears */ nda?: boolean; /** (Batch 34 §14) the developer's listing change: See it jumps to the test page's Listing panel */ listing?: boolean; /** (Batch 35 §3) the listing Save that line is about (its record's time): See it marks that Save's fields only */ saveAt?: Date };

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
export const DEV_STOP_KINDS = [
  ...STOP_ONCE_KINDS, "paid", "rejected", "chargeback", "choice", "requested", "withdrew_req", "declined_req",
  // (NEWEST+3) the full set: applications, disputes, invite answers, admin decisions, listing info (F). (Batch 14 section 4: a tester's Switch / Keep no longer stops.)
  "applied", "dispute", "invite", "admin", "info", "full",
  // (Batch 8) "Your subscription ended." (or the free launch ended): a page open at that moment stops once.
  "subscription",
  // (Batch 11) A payments-kind line on the developer's own pages ("Your bank's chargeback of $X was reversed: ..."); Alerts can ignore it under Payments.
  "payment",
] as const;

/** (Owner, Oct 29, batch 14) Kinds the developer's live box shows quietly (never a stop-once reason, never in the under-button notice, no bell). */
// (Owner, Oct 28, batch 20 section 24) "rated": a tester whose part had ended rated you: a live-box line only, never a stop.
// (Batch 30 §2) "sentpaid": a tester sent an updated version of a piece already paid the most it can be: a quiet line only (nothing more can be paid).
export const DEV_QUIET_KINDS = ["terms", "key", "rated", "sentpaid"] as const;
/** "Ana switched to the new terms"; several in a day stack: "3 testers switched to the new terms". */
export const switchedLine = (n: number, name = "") => (n === 1 ? `${name} switched to the new terms` : `${n} testers switched to the new terms`);

/**
 * Every event kind the app records that does NOT stop the developer, and why. (Their own actions in another tab still
 * stop them, as reason E, through the action log; events written as "You ..." are their own and come only that way.)
 */
export const DEV_EXEMPT_KINDS: Record<string, string> = {
  renamed: "info only (owner, correction 2): a top-box line; a press goes through with a note, never stops",
  spot_open: "follows a tester leaving / being ended or the developer's own spots edit: those lines show instead",
  edited: "the developer's own edit (reason E from another tab; F for listing info)",
  edited_spots: "the developer's own edit of spots (reason E from another tab)",
  listing_save: "(batch 30 section 10) the testers' one line per listing save; the developer's own save is reason E from another tab (with its edited / info lines)",
  opened: "the developer's own Open (reason E from another tab)",
  auto_joined: "(Task 2) a waiting application accepted while switching to instant joins; the developer sees the single accepted-applications line",
  stopped: "the developer's own Stop (reason E from another tab)",
  ended: "the developer's own End early (reason E from another tab)",
  next_round: "the developer's own Next round (reason E from another tab)",
  invited: "the developer's own invites (reason E from another tab)",
  rated: "(batch 20 section 24) a tester whose part had ended rated you: one quiet line in the live box (DEV_QUIET_KINDS) with your own window, never a stop (a working tester who rates leaves: \"left\")",
  key: "(batch 14 section 6) an access key reported as not working: one quiet line in the live box (DEV_QUIET_KINDS), never a stop, no bell",
  terms: "(batch 14 section 4) a tester switched to the new terms: one quiet line in the live box (DEV_QUIET_KINDS), stacked per day; work already sent keeps its price, so nothing a press could change",
  paused: "a payment hold: every paused button refuses for good, and the page shows the hold",
  resumed: "the hold lifted because the developer paid (their own action, reason E)",
  lowered: "(batch 15 section 40) the developer's own Lower the length (reason E from another tab)",
  sentpaid: "(batch 30 §2) a tester updated a piece already paid the most it can be: one quiet line in the live box (DEV_QUIET_KINDS), never a stop; nothing more can be paid",
};

/** (Owner, NEWEST+3) A declined manual Pay, as the tester reads it (never "failed", "declined" or "card"). */
export const delayedPayLine = (devName: string, label: string, cents: number, title = "") =>
  `${devName}'s payment for your ${label}${title ? ` on ${title}` : ""} (${"$" + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100))}) is delayed. You'll be told when it arrives.`;

/**
 * (Owner, NEWEST+4 correction 2) A title change is INFO ONLY everywhere: a top-box line, never a stop. A press that the
 * page hadn't shown it before goes through with this note under the button; a stop for other reasons lists it too.
 */
export const RENAMED = "renamed";
// (Batch 15 section 24) renamedNote is gone: a rename never leaves a note under a press; it is recorded in the contract changes.

/** The test events a tester's page reads directly; their other reasons come from their own contract's records. */
export const TESTER_EVENT_KINDS = ["info", "renamed", "full", "spot_open", "listing_save"] as const;
/** Every other recorded event kind, and why a tester never sees it as such (or sees it another way). */
export const TESTER_EXEMPT_KINDS: Record<string, string> = {
  payment: "the developer's own payments (batch 11: a chargeback reversed in their favour) are never shown to testers",
  joined: "another tester's activity is never shown to a tester",
  auto_joined: "the tester is told they joined through the usual joined notification, not a session event",
  left: "another tester's activity (their own Leave is reason E)",
  rated: "(batch 20 section 24) the tester's own rating (another tester's is never shown to a tester)",
  sent: "the tester's own work (reason E from another tab)",
  booked: "read from their own call requests (reason C), never other testers' calls",
  cancelled: "read from their own calls (reason C)",
  requested: "read from their own call requests (reason C)",
  withdrew_req: "read from their own call requests (reason C)",
  declined_req: "read from their own call requests (reason C)",
  paid: "read from the developer's review of their own work (reason B)",
  rejected: "read from the developer's review of their own work (reason B)",
  choice: "their own Charge / Let it go offer: shown on the page itself",
  chargeback: "chargebacks are never shown to testers",
  applied: "applications are the developer's; their own Apply is reason E",
  terms: "their own Switch / Keep (reason E); new terms are read from the offer (reason A)",
  dispute: "their own dispute (reason E); the decision is read from the dispute itself",
  invite: "their own invite answer (reason E)",
  admin: "the team's decision on their dispute is read from the dispute; other admin actions end the session (final refusal)",
  edited: "terms changes come as an offer (reason A); listing info as F",
  edited_spots: "spots never stop a tester",
  opened: "a draft opening never affects a working tester",
  stopped: "the session ends: every button refuses for good",
  ended: "the session ends: every button refuses for good",
  next_round: "a new round never changes a working tester's contract",
  invited: "the developer's invites to others",
  lowered: "(batch 15 section 40) read from the call itself: the lowered length and its reason show on the session page and in the paid line",
  key: "the developer's yellow keys box only",
  paused: "a hold shows as the paused banner and refusals",
  resumed: "the paused banner goes away",
  subscription: "the developer's own subscription: testers never see it",
  sentpaid: "(batch 30 §2) the tester's own update of a paid piece (reason E from another tab)",
};
export function devStopOnce(events: TestEventLike[], seenAt: Date, confirmed: boolean) {
  return stopOnce(events, seenAt, confirmed, DEV_STOP_KINDS);
}

/**
 * (Owner, Oct 29, batch 26 section 3) What a tester's stop line needs: the contract's end, and the test's `adminStoppedAt` (the team's Stop: the line never names the
 * developer, "This test was stopped at 3:10 PM."); `teamTime` is that time as the tester reads it (their zone; without it, "on <date>").
 */
export type StopCtx = { endKind: string; endedAt: Date | null; test?: { adminStoppedAt?: Date | null } | null; teamTime?: string };
/** (Batch 26 section 3) Was this tester's work ended by the team's Stop (never named)? */
export const teamStopped = (c: StopCtx) => c.endKind === "stopped" && !!c.test?.adminStoppedAt;
/** "This test was stopped at 3:10 PM" (or "…on Oct 29, 2026" when no time was given). */
const teamStopHalf = (c: StopCtx, fmt: (d: Date) => string) => `This test was stopped ${c.teamTime ? `at ${c.teamTime}` : `on ${fmt(c.endedAt!)}`}`;

/** The one line a tester reads (and every later press is refused with) once their work was ended by the developer. */
export function endedLine(c: StopCtx & { status: string; title?: string }, devName: string, fmt: (d: Date) => string) {
  if (c.status !== "ended" || !c.endedAt) return "";
  if (c.endKind === "blocked") return `Your session on ${c.title ?? "this test"} ended.`; // neutral: a block is never revealed
  if (teamStopped(c)) return `${teamStopHalf(c, fmt)}. Work you sent is still reviewed.`;
  if (c.endKind === "stopped") return `${devName} stopped the test on ${fmt(c.endedAt)}. Work you sent is still reviewed.`;
  if (c.endKind === "closed") return `This test ended on ${fmt(c.endedAt)}. Work you sent is still reviewed.`; // neutral: a pause closure never says why
  if (c.endKind === "rated") return `${devName} finished your part in ${c.title ?? "this test"}. Work you sent is still reviewed.`;
  return `${devName} ended your session early on ${fmt(c.endedAt)}. Work you sent is still reviewed.`;
}

// ---------- (Owner, Oct 28, batch 16 section 24) The tester's page after the test stops, closes, or their work is ended early ----------

/** (Owner, Oct 28, batch 16 section 28) The top line of the limited view a suspended tester gets of a test they were removed from. */
// (Owner, Oct 28, batch 17 section 10) Dispute is the only press there: Charge and Let it go wait for the reinstatement (nothing is lost: Charge never happens on its own).
export const LIMITED_VIEW_LINE = "Your account is paused. You can still dispute a payment.";
/** (Batch 17 section 10) Charge or Let it go pressed from the limited view (an old page). */
export const LIMITED_CHOICE_REFUSAL = "You can do this once your account is active again.";
/** The work is over for this tester (the developer or the team stopped the test, it closed, or their work was ended early): never a block, a rating or a leave. */
export const workOver = (c: { status: string; endKind: string; endedAt: Date | null }) => c.status === "ended" && !!c.endedAt && !["blocked", "rated"].includes(c.endKind);
/** The first half of the stopped line, as endedLine says it: "Nora Lane stopped the test on Nov 3" / "This test ended on Nov 3" / "Nora Lane ended your session early on Nov 3". */
function overHalf(c: StopCtx, devName: string, fmt: (d: Date) => string) {
  const d = fmt(c.endedAt!);
  if (teamStopped(c)) return teamStopHalf(c, fmt); // (batch 26 section 3) never who
  return c.endKind === "stopped" ? `${devName} stopped the test on ${d}` : c.endKind === "closed" ? `This test ended on ${d}` : `${devName} ended your session early on ${d}`;
}
/** The presses that go once the work is over (hidden on the page, refused on the server); WORK_OVER_PRESSES are the names the refusal gives them. */
export const WORK_OVER_ACTIONS = ["terms", "written", "recording-start", "recording-done", "recording-send", "recording-remove", "request-time", "answer-request", "cancel-call", "cancel-set", "key-broken"] as const;
export const WORK_OVER_PRESSES = ["Switch", "Keep", "Send", "upload", "Remove", "Request a time", "Accept", "Decline", "Withdraw", "Cancel call", "“This key doesn't work”"] as const;
/** The press's name in the refusal: "Send", "Switch", "Request a time", "Cancel call", "“This key doesn't work”"… ("" for a press that isn't one of them). */
export function workOverPress(action: string, body: Record<string, unknown> = {}): string {
  switch (action) {
    case "terms": return body.choice === "keep" ? "Keep" : "Switch";
    case "written": case "recording-send": return "Send";
    case "recording-start": case "recording-done": return "upload";
    case "recording-remove": return "Remove";
    case "request-time": return "Request a time";
    case "answer-request": return body.action === "decline" ? "Decline" : body.action === "withdraw" ? "Withdraw" : "Accept";
    case "cancel-call": case "cancel-set": return "Cancel call";
    case "key-broken": return "“This key doesn't work”";
  }
  return "";
}
/** An old page's press after the work ended: "Nora Lane stopped the test on Nov 3, so your Send didn't go through. Work you sent is still reviewed." */
export const workOverLine = (c: StopCtx, devName: string, fmt: (d: Date) => string, press: string) =>
  `${overHalf(c, devName, fmt)}, so your ${press} didn't go through. Work you sent is still reviewed.`;
/**
 * The stopped line at the top of the session page, listing what still works (built from what is actually on the page, as the paused banner does):
 * "Nora Lane stopped the test on Nov 3. You can still charge or let go of unreviewed work, dispute, rate and chat. Work you sent is still reviewed."
 * With `press` (an old page's press was refused), it names it: "Nora Lane stopped the test on Nov 3, so your Send didn't go through. You can still …".
 */
export function stillWorksLine(c: StopCtx, devName: string, fmt: (d: Date) => string, can: { charge?: boolean; dispute?: boolean; rate?: boolean; chat?: boolean; excerpt?: boolean }, press = "") {
  const list = [can.charge && "charge or let go of unreviewed work", can.dispute && "dispute", can.rate && "rate", can.excerpt && "ask to show an excerpt", can.chat && "chat"].filter((x): x is string => !!x);
  return `${overHalf(c, devName, fmt)}${press ? `, so your ${press} didn't go through` : ""}.${list.length ? ` You can still ${andList(list)}.` : ""} Work you sent is still reviewed.`;
}

// ---------- (Batch 17 §15) The developer's Stop reason ----------

/** The ContractNote kind recorded on every contract the developer's Stop ended (its text carries the reason; the team's Stop never writes one). */
export const STOP_NOTE_KIND = "stopped";
/** The entry in each stopped tester's contract changes: "Test stopped: “We have what we need.”". */
export const stopNoteText = (reason: string) => `Test stopped: “${reason}”`;
/** The test's timeline line (the admin's test timeline): "The developer stopped the test: “We have what we need.”". */
export const stopEventText = (reason: string) => `The developer stopped the test: “${reason}”`;
/** The reason back out of a stop note or timeline line ("" for any other line, e.g. an older stop with no reason or the team's stop). */
export function stopReasonOf(text: string) {
  const m = /^(?:Test stopped|The developer stopped the test): “([\s\S]*)”$/.exec(text);
  return m ? m[1] : "";
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
  // (Batch 15 section 18) Open until is the last day to join.
  if (t.openUntil && t.openUntil.getTime() < now.getTime()) return { result: "refused", message: closedToNewLine(t.openUntil, (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })) };
  if (t.status !== "open") return { result: "refused", message: "This test isn't taking new testers any more." };
  if (t.testersIn >= t.spots) return { result: "refused", message: "This test is full." };
  if (seenListingVersion !== t.listingVersion && !confirmed) return { result: "changed" };
  return { result: "go" };
}

// ---------- Payment hold, auto-pay, Open until, invites (owner, Oct 22, newest) ----------

export const REVIEW_DAYS = 7; // (Owner, Oct 29, batch 12 section 6; batch 15 section 18) the review window: Charge opens at the later of the tester's own deadline and this many days after a part was sent
export const HOLD_APPROVAL_AFTER = 3;
/** The label that replaces an exact hold count outside the profile totals (admin only). */
export const MANY_HOLDS_LABEL = "More than 3 holds"; // (Owner, Oct 27) after a developer's 3rd payment hold, every later hold needs an admin's Approve to lift
export const OWED_DAYS = 3; // (no longer used since Oct 27: a declined payment starts the hold at once)
const DAY = 86_400_000;

/** What gets paid automatically after the review window: the listing amount (older rule; see autoPayFor). */
export const autoPayAmount = (listingCents: number | null) => listingCents ?? 0;
export const payByFrom = (sentAt: Date) => new Date(sentAt.getTime() + REVIEW_DAYS * DAY);
export const owedUntilFrom = (failedAt: Date) => new Date(failedAt.getTime() + OWED_DAYS * DAY);

/** When a hold lifts, deadlines, Open until and review clocks move on by the length of the pause. */
export function shiftForHold<T extends Date | null>(d: T, holdStartedAt: Date, liftedAt: Date): T {
  if (!d) return d;
  return new Date(d.getTime() + Math.max(0, liftedAt.getTime() - holdStartedAt.getTime())) as T;
}

/**
 * (Owner, Oct 28 afternoon) What a tester can do in a paused test (a payment hold, a chargeback hold or an admin suspension of the developer). The items the owner hasn't confirmed
 * yet are DEFAULTs: flip them here.
 */
export const PAUSE_DEFAULTS = {
  /** DEFAULT: drafts stay editable while paused (written answers typed and kept, recordings uploaded); only Send is refused. false = the forms hide while paused. */
  draftsEditable: true,

  /** DEFAULT: the team's pause of one test (admin pause) follows the same tester rules. false = testers keep sending and chatting in a team-paused test. */
  teamPauseSameRules: true,
  /** DEFAULT: when a pause lifts (a hold lift, a reinstatement, the team's unpause) working testers' deadlines and Open until move later by its length. false = they stay. */
  shiftDeadlines: true,
} as const;

/** (Design doc 8) The tester is never told why a test is paused (no "hold", "suspended" ...). */
export const PAUSED_RIGHT_NOW = "This test is paused right now.";
/** What a tester can do on a paused test's session page right now (batch 10: the banner lists only these), and what comes back when it resumes. */
export type PausedCan = { drafts: boolean; charge: boolean; dispute: boolean; rate: boolean; leave: boolean; cancelCalls: boolean; send: boolean; requestCalls: boolean; /** (Batch 11) the tester has a deadline and it moves with the pause */ deadline?: boolean };
/** (Owner, Oct 29, batch 11) The banner's deadline line, when the tester has a deadline and PAUSE_DEFAULTS.shiftDeadlines is on. */
export const PAUSED_DEADLINE_LINE = "Your deadline is paused too: it moves later by however long the pause lasts.";
const listAnd = (xs: string[], oxford: boolean) => (xs.length <= 1 ? xs.join("") : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}`);
/**
 * (Owner, Oct 29, batch 10) The blue banner at the top of a paused test's session page (never "hold", "suspended", "failed" or "chargeback"), built from what is actually
 * available, so it never offers a button that isn't there. With everything available:
 * "This test is paused right now. For now you can save drafts of your parts, charge or let go of work left unreviewed, dispute, rate, leave the test, and cancel booked calls.
 * Sending work and requesting calls come back when it resumes." (Batch 15 section 1: a paused test no longer closes the chat, so the banner never mentions it.)
 */
export function pausedForTesters(can: PausedCan) {
  const now = [can.drafts && "save drafts of your parts", can.charge && "charge or let go of work left unreviewed", can.dispute && "dispute", can.rate && "rate", can.leave && "leave the test", can.cancelCalls && "cancel booked calls"].filter((x): x is string => !!x);
  const back = [can.send && "sending work", can.requestCalls && "requesting calls"].filter((x): x is string => !!x);
  const backLine = back.length ? ` ${listAnd(back, false).replace(/^./, (c) => c.toUpperCase())} ${back.length === 1 ? "comes" : "come"} back when it resumes.` : "";
  return `${PAUSED_RIGHT_NOW}${now.length ? ` For now you can ${listAnd(now, true)}.` : ""}${backLine}${can.deadline && PAUSE_DEFAULTS.shiftDeadlines ? ` ${PAUSED_DEADLINE_LINE}` : ""}`;
}
/** The full banner (everything available). */
export const PAUSED_FOR_TESTERS = pausedForTesters({ drafts: true, charge: true, dispute: true, rate: true, leave: true, cancelCalls: true, send: true, requestCalls: true });
/** (Owner, Oct 28 afternoon) Send (written answers, recordings) while the test is paused. */
export const PAUSED_SEND = `${PAUSED_RIGHT_NOW} You can send this once it resumes.`;
/**
 * (Owner, Oct 30, batch 15 section 1) Chat is closed only while a PERSON is restricted, never because a test is paused. The other person can still open and read the chat;
 * the message box is replaced by this neutral note (never "suspended", "hold" or "failed" about the other person).
 */
export const CHAT_PAUSED_NOTE = "Messages are paused for now. You can still read this chat.";
/** The blue notice under Send when the other person became restricted after the page loaded (the typed text is kept). */
export const CHAT_NOT_SENT = "Messages are paused for now, so this wasn't sent.";
/** (Owner, Oct 28 afternoon) A Charge pressed while the developer is on a payment or chargeback hold: added to what they owe, paid when they pay it. */
export const chargedDelayedLine = (cents: number) => `Charged ${money(cents)}. Payment may be delayed until the test resumes.`;
/** Is a developer's test paused for its testers (a payment hold, the developer's suspension, or an admin pause)? */
export const testPaused = (dev: { holdStartedAt?: Date | null; devSuspendedAt?: Date | null }, test?: { adminPausedAt?: Date | null } | null) => !!(dev.holdStartedAt || dev.devSuspendedAt || test?.adminPausedAt);
/** (Owner, Oct 28 afternoon) Do the paused-test tester rules apply (no sending, chat closed)? A team pause of one test counts only with PAUSE_DEFAULTS.teamPauseSameRules. */
export const testerPaused = (dev: { holdStartedAt?: Date | null; devSuspendedAt?: Date | null }, test?: { adminPausedAt?: Date | null } | null) =>
  !!(dev.holdStartedAt || dev.devSuspendedAt || (PAUSE_DEFAULTS.teamPauseSameRules && test?.adminPausedAt));
/**
 * (Owner, Oct 28 afternoon, DEFAULT) How far a pause that ran from `start` to `now` moves deadlines, Open until and review clocks. When another pause of the same test is still on
 * (`others`: the start of each), only the part before the earliest of them counts now: the rest is counted when that one lifts, so overlapping pauses never count twice.
 */
export function pauseShiftMs(start: Date, now: Date, others: (Date | null | undefined)[] = []) {
  if (!PAUSE_DEFAULTS.shiftDeadlines) return 0;
  const still = others.filter((d): d is Date => !!d).map((d) => d.getTime());
  const until = still.length ? Math.min(now.getTime(), Math.min(...still)) : now.getTime();
  return Math.max(0, until - start.getTime());
}
export const PAY_WAITS = "Pay what you owe first.";
/** (Owner, Oct 29, batch 11) A charge made while the developer wasn't there waits this long for their bank confirmation, then counts as declined. */
export const CONFIRM_DAYS = 3;
/** (Batch 12 section 5) A press's confirmation pop-up locks the piece for at most this long. */
export const PRESS_ACTION_MS = 15 * 60_000;
export const BANK_NOT_CONFIRMED = "Your bank didn't confirm the payment, so nothing was charged.";
/**
 * (Batch 17 §11) The bank's check opens inline, under the button that charges. A charge made while the developer was away on a test is confirmed on that test page, under
 * the piece ("Confirm with your bank"). (Batch 29 §32) Its bell line is bankWaitingAllLine's, one across tests and renewals.
 */
export const CONFIRM_WITH_BANK = "Confirm with your bank";
/**
 * (Owner, Oct 29, batch 29 §32) ONE bell line for every charge waiting for the bank, across tests and renewals: "Your bank wants you to confirm a $10.00 payment on
 * “Harbor Run” by Nov 2" (a renewal: "… a $10.00 payment by Nov 2"), or "Your bank wants you to confirm 3 payments ($24.50 in all): the first by Nov 2".
 */
export const bankWaitingAllLine = (list: { cents: number; title: string | null; by: Date }[]) => {
  const first = [...list].sort((a, b) => a.by.getTime() - b.by.getTime())[0];
  if (list.length === 1) return `Your bank wants you to confirm a ${money(first.cents)} payment${first.title ? ` on “${first.title}”` : ""} by ${T(first.by, "date")}`;
  return `Your bank wants you to confirm ${list.length} payments (${money(list.reduce((s, x) => s + x.cents, 0))} in all): the first by ${T(first.by, "date")}`;
};
/** (Batch 29 §32) Where that line opens: the dashboard's "Your bank wants you to confirm" box (batch 24). */
export const BANK_TO_CONFIRM_HREF = "/app#bank-to-confirm";
/** (Batch 17 §11) The fake Stripe (tests, recordings, dev without a publishable key) draws this clearly-marked stand-in where the bank's own check would be. */
export const BANK_STAND_IN = "Stand-in for your bank's check";
export const BANK_STAND_IN_NOTE = "Your bank's own page shows here when payments are live. Nothing is charged until it's confirmed.";
export const BANK_CHECK_TITLE = "Your bank's check";
export const BANK_CONFIRMED = "Your bank confirmed it: the payment went through.";
export const CARD_NOT_VERIFIED = "The card wasn't verified. Try again or use another card.";
/** (Batch 17 §11) The anchor of a charge's "Confirm with your bank" button on its test page (Payments and the bell line link to it; the jump marks it). */
export const bankAnchor = (paymentId: string) => `bank-${paymentId}`;
export const bankHref = (testId: string, paymentId: string) => `/app/tests/${testId}#${bankAnchor(paymentId)}`;
/** (Batch 17 §11) The line above "Confirm with your bank" on the test page. */
export const bankWaitingLine = (cents: number, what: string, by: string) => `Your bank wants you to confirm a ${money(cents)} payment for ${what}, made while you were away. Confirm it by ${by}.`;
export const PIECE_LOCKED = "A payment for this is being confirmed right now.";
/** (Owner, Oct 29, batch 11 section 4) Automatic retries of what is owed during a hold: once a day, at most this many a hold. */
export const HOLD_RETRY_MAX = 7;
/** (Batch 25 section 5) Items named in one line: "A", "A and B", "A, B and C"; more than 3: "A, B, C and 2 more". */
export const namesList = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : names.length <= 3 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
/**
 * (Owner, Oct 29, batch 25 section 5) An automatic retry's ONE bell line, naming what was paid: "We charged your card $10.00 for what you owed: Ana Silva's call on Oct 30."
 * (It is a money line, so it also rides the payment email: that is the retry's receipt; no separate "Receipt:" line.)
 */
export const retriedLine = (cents: number, names: string[] = []) => `We charged your card ${money(cents)} for what you owed${names.length ? `: ${namesList(names)}` : ""}.`;
/** (Batch 25 section 5) What a receipt for paying what's owed names: "what you owed: Ana Silva's call on Oct 30 and Ben Okafor's written answers". */
export const owedReceiptWhat = (names: string[]) => (names.length ? `what you owed: ${namesList(names)}` : "an amount you owed");
/** Payments' line about the automatic retries. */
export function retryStatusLine(u: { holdRetries: number; holdRetryAt: Date | null }, fmt: (d: Date) => string) {
  if (u.holdRetries >= HOLD_RETRY_MAX) return "No more automatic tries: press Pay what you owe.";
  if (!u.holdRetryAt) return "";
  return `Last try: ${fmt(u.holdRetryAt)} · next try: ${fmt(new Date(u.holdRetryAt.getTime() + 86_400_000))}`;
}
/** (Owner, Oct 29, batch 11) A written part (all its answers and notes together) is at most this many characters. */
export const WRITTEN_MAX_CHARS = 50_000; // (Owner, Oct 29, batch 14 section 5; was 10,000)
export const writtenLength = (texts: string[]) => texts.reduce((a, t) => a + withoutAttachmentMarkers(t ?? "").length, 0);
export function checkWrittenLength(texts: string[]): Check {
  const n = writtenLength(texts);
  return n > WRITTEN_MAX_CHARS ? no(`Your written answers can be at most ${WRITTEN_MAX_CHARS.toLocaleString("en-US")} characters in all (now ${n.toLocaleString("en-US")}).`) : yes;
}
/**
 * (Owner, Oct 29, batch 11) A tester who deleted their account: work they sent is still reviewed when their payout account was connected (Pay reaches their Stripe
 * account). DEFAULT: without one nothing can reach them, so it leaves Needs you with deletedNoPayoutsLine.
 */
export const testerPayable = (t: { deletedAt: Date | null; stripeAccountId: string | null; payoutsReady: boolean }) => !t.deletedAt || (!!t.stripeAccountId && t.payoutsReady);
/** The same rule as a Prisma filter on a tester. */
export const PAYABLE_TESTER: Prisma.UserWhereInput = { OR: [{ deletedAt: null }, { stripeAccountId: { not: null }, payoutsReady: true }] };
/** (Owner, Oct 29, batch 12 section 1) The tester's part still under review when the developer deleted their account. */
export const devDeletedLine = (dev: string) => `${dev} deleted their account, so this can't be paid.`;
export const deletedNoPayoutsLine = (name: string) => `${name} deleted their account before setting up payouts, so this can't be paid.`;
/** (Owner, Oct 29, batch 10) A hold lifted (paid, or a chargeback hold cleared) while an admin suspension is still on: bell and email, sent even with email Off. */
/** (Owner, Oct 29, batch 10) The platform won a chargeback: the developer's bell and email, and (when they had already paid it back) the receipt line for the refund. */
export const chargebackWonLine = (cents: number) => `Your bank's chargeback of ${money(cents)} was reversed in your favour.`;
export const chargebackRefundLine = (cents: number) => `Refund: your bank's chargeback of ${money(cents)} was reversed`;
/** (Owner, Oct 29, batch 11) Each chargeback adds this fee to what the developer owes, on top of the reversed amount. */
export const CHARGEBACK_FEE_CENTS = 1500;
const wholeMoney = (cents: number) => money(cents).replace(/\.00$/, "");
/** The Payments line of an open chargeback: "Your bank reversed a $X payment: $X + $15 chargeback fee." */
export const chargebackOwedLine = (cents: number) => `Your bank reversed a ${wholeMoney(cents)} payment: ${wholeMoney(cents)} + ${wholeMoney(CHARGEBACK_FEE_CENTS)} chargeback fee`;
/** (Batch 11) The stop-once line on the developer's test page and Edit when the platform won a chargeback (a payments-kind line). */
export const chargebackReversedLine = (cents: number, backCents: number, refunded: boolean) =>
  `Your bank's chargeback of ${money(cents)} was reversed: ${money(backCents)} ${refunded ? "refunded to your card" : "taken off what you owe"}.`;
/**
 * (Owner, Oct 29, batch 23 section 6) A chargeback hold's Pay what you owe reserves the money on the card (an authorization, Stripe shows it "Uncaptured"); the team's Approve
 * takes it. An authorization lasts about 7 days: unused by then, it is released and the developer presses Pay what you owe again.
 */
export const RESERVE_DAYS = 7;
export const reservedLine = (cents: number) => `Reserved ${money(cents)}: it's taken when the team approves lifting your hold.`;
export const RESERVE_EXPIRED = "Your reservation expired: press Pay what you owe again so the team can approve it.";
/** (Batch 34 §3) The developer's reservation line; added charges are explained by the disabled button. */
export const reservedAddedLine = (reservedCents: number, addedCents: number) => {
  void addedCents;
  return reservedLine(reservedCents);
};
/** (Batch 28 §8) The admin's chargeback row: "$23.00 reserved · $5.00 added since (charged after the hold lifts)". */
export const adminReservedLine = (reservedCents: number, addedCents: number) => `${money(reservedCents)} reserved${addedCents > 0 ? ` · ${money(addedCents)} added since (charged after the hold lifts)` : ""}`;
export const STILL_SUSPENDED_LINE = "Your payment went through. Your tests stay paused while your account is suspended.";
/** (Owner, Oct 27) What a tester reads while the developer owes a declined payment: Dispute and Charge wait (never "failed"). */
export const OWED_FOR_TESTERS = "Payment from this developer is delayed right now. You can try again once it's sorted.";

/** Open until can be moved only before it passes; once passed, it can't be extended. */
export function checkOpenUntilChange(current: Date | null, next: Date | null, now: Date, fmt: (d: Date) => string): Check {
  const same = (current?.getTime() ?? null) === (next?.getTime() ?? null);
  if (same) return yes;
  if (current && current.getTime() < now.getTime()) return no(`Joining closed on ${fmt(current)} (Open until), so it can't be extended.`);
  return yes;
}

/** (Design doc 5) Open until can only be extended: a red line when the new date is earlier (or a date is added to a test with no end). "" when fine. */
export function openUntilShortened(current: string | null, next: string | null, fmt: (d: Date) => string) {
  if (next == null) return "";
  if (current == null) return "Open until can only be extended: this test has no end date now.";
  return new Date(next).toISOString().slice(0, 10) < new Date(current).toISOString().slice(0, 10) ? `Open until can only be extended: it's ${fmt(new Date(current))} now.` : "";
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
/**
 * (Batch 15 section 18) Open until is the last day to JOIN: the developer reads "“X” closes to new testers on Nov 20" on Open until's marks. (Batch 16 section 1) A working
 * tester reads their OWN deadline ("Your deadline on “X” is Nov 20: send your work before then.") on their own marks, counted to their deadline (ownDeadlineMarkDue).
 */
export const joinClosingLine = (title: string, openUntil: Date, fmt: (d: Date) => string) => `“${title}” closes to new testers on ${fmt(openUntil)}.`;
export const ownDeadlineLine = (title: string, dueAt: Date, fmt: (d: Date) => string) => `Your deadline on “${title}” is ${fmt(dueAt)}: send your work before then.`;

/** Invite: reasons the whole press is refused for good. */
export function inviteTestRefusal(
  t: { status: string; spots: number; testersIn: number; openUntil: Date | null; stoppedAt: Date | null; paused: boolean; title?: string },
  now: Date,
  fmt: (d: Date) => string,
) {
  if (t.status === "stopped") return `This test was stopped${t.stoppedAt ? ` on ${fmt(t.stoppedAt)}` : ""}, so nobody can be invited.`;
  if (t.openUntil && t.openUntil.getTime() < now.getTime()) return `Joining closed on ${fmt(t.openUntil)} (Open until), so nobody can be invited.`;
  if (t.paused) return "This test is paused until you pay what you owe, so nobody can be invited.";
  if (t.status !== "open") return "This test isn't taking new testers, so nobody can be invited.";
  // New invites wait for spots (open ones stay open while full: correction 6).
  if (t.testersIn >= t.spots) return `${t.title ?? "This test"} is full. Add spots to invite more people.`;
  return "";
}

/** (Owner, Oct 28, batch 20 section 10) Under the disabled Invite button while every spot is taken ("in Edit" opens Edit's spots field). */
export const INVITE_FULL_LINE = "This test is full. Add spots in Edit to invite more people.";
/**
 * (Batch 20 section 10) While nobody can be invited (full, paused, stopped, joining closed), the panel's Invite button is disabled with this line under it
 * (`full`: the full line, with its Edit link); null when Invite works. The server still refuses with inviteTestRefusal for pages opened before.
 */
export function inviteBlocked(t: Parameters<typeof inviteTestRefusal>[0], now: Date, fmt: (d: Date) => string): { line: string; full: boolean } | null {
  const r = inviteTestRefusal(t, now, fmt);
  if (!r) return null;
  const full = r === `${t.title ?? "This test"} is full. Add spots to invite more people.`;
  return { line: full ? INVITE_FULL_LINE : r, full };
}

/**
 * (Owner, Oct 28, batch 20 section 24) A tester's rating never stops a developer press by itself: a working tester who rates leaves ("Testers leaving", one stop line:
 * "ff finished their part (rated you)"); one whose part had ended gives only the live box's line, with the developer's own window. Never the stars.
 */
export const ratedYouLine = (name: string) => `${name} rated you`;
export const finishedAndRatedLine = (name: string) => `${name} finished their part (rated you)`;
export const ratedYouLiveLine = (name: string, until: string | null) => (until ? `${name} rated you. You can rate them until ${until}.` : `${name} rated you. You can rate them once everything they sent is settled.`);
/** The test page's Needs you row for an open Rate: "Rate ff · 14 days left". */
export const rateNeedsLine = (name: string, endsAt: Date, now = new Date()) => {
  const days = Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
  return `Rate ${name} · ${days} day${days === 1 ? "" : "s"} left`;
};

/** (Owner, Oct 28, batch 20 section 27) End early's and Stop's reasons: at least this many characters (after trimming), like the Mature reason. */
export const WHY_MIN_CHARS = 5;
export const WHY_TOO_SHORT = "Say a little more: at least 5 characters.";

/** (Owner, Oct 28, batch 20 section 26) "Send my updated answers / recording" with nothing different from the last send: disabled (its tooltip), and the server's refusal. */
export const NOTHING_CHANGED_LINE = "Nothing has changed since you sent it.";

/** (Owner, Oct 28, batch 20 section 16) An admin account never gets a developer or tester side. */
export const ADMIN_ONLY_LINE = "An admin account is only for the admin console. To post or test, use a separate account.";

/** (Owner, Oct 28, batch 20 section 22) A ticked part left without a price: $0 only through the Free tick. */
export const PART_PRICE_MISSING = { written: "Enter a price for the written answers, or tick Free.", recording: "Enter a price for the recording, or tick Free.", live: "Enter an hourly rate for live calls, or tick Free." } as const;

export const MAX_ACTIVE_TESTS = LIMITS.testsPerTester;
/** (7.3) Joining, applying, accepting an invite and asking to rejoin all refuse with this line at the limit. */
export const TEST_LIMIT_LINE = "You can't join more tests right now.";
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

/** (Batch 15 section 11) A call's day in a bell line: a token, written in each reader's own time zone. */
const callDay = (d: Date) => T(d, "dayTime");
const CANCEL_WHY = { paused: "the test is paused", stopped: "the test was stopped", closed: "the test was closed", ended: "your session was ended" } as const;

/** What a tester reads when a booked call is cancelled for them (never any fault). */
export const callCancelledLine = (startsAt: Date, why: keyof typeof CANCEL_WHY) => `Your call on ${callDay(startsAt)} was cancelled because ${CANCEL_WHY[why]}.`;

/** The Pay box reference for a call: the listing rate × the entered length (or the booked length). */
export function callReference(rateCents: number | null, minutes: number, contractRate: number | null = rateCents) {
  if (rateCents == null) return { cents: null as number | null, text: NOT_LISTED };
  const cents = callCharge(rateCents, minutes);
  const label = rateCents === contractRate ? "Listing" : "Agreed";
  return { cents, text: `${label}: ${money(rateCents).replace(/\.00$/, "")}/h × ${minutes} min = ${money(cents)}` };
}

// (Batch 15 section 40) "How long was the call?" is gone: the app measures each call's length (callMeasure.ts); the developer can only lower it, with a reason.

/** (NEWEST+8) A call request's length, typed by the requester (the old listing field's limits). */
export const CALL_MIN_MINUTES = 10, CALL_MAX_MINUTES = 180;
export function checkCallMinutes(v: unknown): { ok: true; minutes: number } | { ok: false; message: string } {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < CALL_MIN_MINUTES || n > CALL_MAX_MINUTES) return { ok: false, message: `A live call lasts from ${CALL_MIN_MINUTES} to ${CALL_MAX_MINUTES} minutes.` };
  return { ok: true, minutes: n };
}

/**
 * (Owner, Oct 28 afternoon) Calls can be requested and booked on ANY test, whether or not a live call is a listed part. A call is "listed" only when the listing has a Live call part
 * AND it is in this tester's contract; otherwise it is "not a listed part": its pay is up to the developer (the Pay box starts empty), (batch 9) at most $200 an hour for the minutes logged
 * (its pay plus extras; outside the 100% cap), and Charge / Let it go never opens for it.
 */
export const callListed = (test: { liveRateCents: number | null }, contract: { liveRateCents: number | null }) => test.liveRateCents != null && contract.liveRateCents != null;
/** (Owner, Oct 28 evening) The short label on both sides for a call (or any part) that isn't a listed part of the tester's contract; the $100 cap is said only when a Pay goes over it. */
export const NOT_LISTED = "Not listed";
export const NOBODY_JOINED = "Nobody joined, so the call was cancelled.";
/** (Batch 21 section 4) Both opened the call room but their browsers never connected (a strict network): nothing was measured, the call is cancelled, no charge. */
export const COULD_NOT_CONNECT = "It couldn't connect, so the call was cancelled.";

/** A declined Pay, shown under that Pay button. */
export const declinedLine = (name: string, cents: number, label: string) =>
  `Your card was declined, so ${name} wasn't paid ${money(cents)} for the ${label === "live call" ? "call" : label}. Update your card in Payments, then press Pay again.`;
/** (Owner, Oct 27) A Pay declined at the press starts the payment hold at once. */
export const declinedHoldLine = (name: string, cents: number, label: string) =>
  `Your card was declined, so ${name} wasn't paid ${money(cents)} for the ${label === "live call" ? "call" : label} yet. Your tests are paused until you pay what you owe: open Payments.`;
export const DELAYED_CALL_LINE = "Payment for this call may be delayed.";

/** Email settings (Owner, Oct 26): Off, or On with Daily / Weekly / Monthly (one email lists everything since the last). The always-send emails ignore it. */
export function emailDecision(pref: string, always: boolean): "send" | "summary" | "skip" {
  if (always) return "send";
  if (pref === "off" || pref === "none") return "skip";
  return "summary"; // daily / weekly / monthly (a leftover "each" counts as daily)
}

// ---------- Newest owner rules (Oct 22): asked amounts, cancelling, summaries, heads-up line ----------

// (Owner, Oct 26) The tester's "Ask $" is gone: the Pay box always starts at the listing (or the call's agreed rate × length), and the Charge cap
// is the listing minus what is already paid for that part. Old asks stay in the database, unused.

/** Auto-pay after the review window: contract parts only, the listing amount; null = never auto-paid. */
export const autoPayFor = (listingCents: number | null) => (listingCents == null ? null : listingCents);
export const REMIND_DAYS = 3;
// (Owner, Oct 30, batch 15 section 2) UNLISTED_REMIND_DAYS is gone: an unlisted part gets the same review reminders as a listed one (REVIEW_MARKS), then they stop.

/** Cancel a call any time; within 24 hours of it a reason is required (the other side sees it). */
export const cancelNeedsReason = (startsAt: Date, now: Date) => startsAt.getTime() - now.getTime() < CANCEL_HOURS * 3_600_000;
export function checkCancel(startsAt: Date, now: Date, reason: string): Check {
  if (now.getTime() >= startsAt.getTime()) return no("The call has started, so it can't be cancelled. Report a no-show instead if someone didn't come.");
  if (cancelNeedsReason(startsAt, now) && reason.trim().length < 3) return no("The call is less than 24 hours away: say why you're cancelling (the other side sees it).");
  return yes;
}
const whenLong = (d: Date) => T(d, "dayTime");
export const cancelLine = (name: string, startsAt: Date, reason: string) => `${name} cancelled the call on ${whenLong(startsAt)}${reason.trim() ? `: ${reason.trim()}` : "."}`;

/**
 * (Batch 15 section 18) The last-3-days line. A working tester reads their OWN deadline: "⏱ Your deadline on Harbor Run is in 2 days 4 hours: send your work before then."
 * The developer reads when the test closes to new testers (Open until): "⏱ Harbor Run closes to new testers in 2 days 4 hours."
 */
export function closesInLine(title: string, at: Date, now: Date, who: "tester" | "developer" = "tester") {
  const mins = Math.max(0, Math.floor((at.getTime() - now.getTime()) / 60_000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const left = d > 0 ? [pl(d, "day"), h ? pl(h, "hour") : ""].filter(Boolean).join(" ") : h > 0 ? [pl(h, "hour"), m ? pl(m, "minute") : ""].filter(Boolean).join(" ") : pl(Math.max(m, 1), "minute");
  return who === "developer" ? `⏱ ${title} closes to new testers in ${left}.` : `⏱ Your deadline on ${title} is in ${left}: send your work before then.`;
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
  if (already) return no("You already sent your side."); // (batch 16 section 21) the same press already made, in another tab or here
  if (text.trim().length < 5) return no("Write your side in a sentence or two.");
  return yes;
}

/** The review window passed on an unreviewed contract part: the tester chooses. */
export const choiceLine = (devName: string, kind: string, cents: number) =>
  `${devName} didn't review your ${kind === "recording" ? "recording" : "written answers"} in ${REVIEW_DAYS} days: charge ${money(cents)} or let it go`;
/**
 * (Owner, Oct 26; batch 15 section 18) When Charge / Let it go opens for a contract part sent and left unreviewed: only once BOTH (1) REVIEW_DAYS (7; batch 12) have passed since it
 * was sent (payBy, which outages and pauses move on) and (2) the tester's own deadline (the contract's dueAt) has passed: the later of the two. Returns when it opens (null while
 * that is not known yet).
 */
export function chargeOpensAt(s: { payBy: Date | null }, test: { openUntil: Date | null; status: string }, contract: { status: string; dueAt: Date }, now = new Date()): Date | null {
  void test;
  void now;
  if (!s.payBy) return null;
  // (Owner, Oct 30, batch 15 section 18, DEFAULT) The review date is the later of THIS tester's own deadline and sent + 7 days (Open until was only the shared deadline).
  return reviewDateOf(s.payBy, contract.dueAt);
}
/**
 * (Owner, Oct 29, batch 26 section 6, DEFAULT) A sent, listed piece waiting for the developer tells the tester when Charge opens: "If Nora Lane hasn't paid by Nov 5, you
 * can charge or let it go then." (the review date: it moves with pauses like the date itself).
 */
export const chargeOpensNote = (devName: string, date: string) => `If ${devName} hasn't paid by ${date}, you can charge or let it go then.`;
/** (Batch 15 sections 2, 15 and 18) A part's (or a call's) review date: the later of the tester's own deadline and sent (or the call) + 7 days. */
export const reviewDateOf = (sevenDaysAfter: Date, dueAt: Date) => new Date(Math.max(sevenDaysAfter.getTime(), dueAt.getTime()));
export const chargeIsOpen = (...a: Parameters<typeof chargeOpensAt>) => {
  const at = chargeOpensAt(...a);
  return !!at && at.getTime() <= (a[3] ?? new Date()).getTime();
};
export const CHARGED_BY_TESTER = `Charged by the tester after ${REVIEW_DAYS} days without a review.`;
/**
 * (Owner, Oct 29, batch 28 §21) A listed call not paid 7 days after it is charged automatically (rate × measured minutes): the reason stored on its review, and the closing
 * reason when there was nothing to charge (no measured time, or the $1,000 for calls used).
 */
export const AUTO_CHARGED_CALL = `Charged automatically ${REVIEW_DAYS} days after the call.`;
export const AUTO_NOTHING_CALL = "Closed with nothing to pay.";
/** An older page's Charge or Let it go on a listed call. */
export const AUTO_CHARGE_NO_CHOICE = "This call is charged automatically, so there's nothing to choose.";
/** The developer's line in a listed call's Pay box: "If you don't pay by Nov 5, it's charged automatically: $25.00 (30 min × $50.00/h)." */
export const autoChargeLine = (date: string, cents: number, minutes: number, rateCents: number) => `If you don't pay by ${date}, it's charged automatically: ${money(cents)} (${minutes} min × ${money(rateCents)}/h).`;
/** The tester's line on a listed call waiting for pay: "If Nora Lane doesn't pay by Nov 5, it's charged automatically." */
export const testerAutoChargeLine = (dev: string, date: string) => `If ${dev} doesn't pay by ${date}, it's charged automatically.`;
/** (Batch 12 section 6) The reason stored on tester charges made before the review window dropped to 7 days. */
export const CHARGED_BY_TESTER_14 = "Charged by the tester after 14 days without a review.";
export const LET_GO_BY_TESTER = "Let go by the tester: nothing charged.";
/** A review the tester made with Charge (any review window). */
export const chargedByTester = (reason: string) => reason === CHARGED_BY_TESTER || reason === CHARGED_BY_TESTER_14;
/** A review the tester made with Charge or Let it go. */
export const byTesterChoice = (reason: string) => chargedByTester(reason) || reason === LET_GO_BY_TESTER;
export const TESTER_CHOICE_REASONS = [CHARGED_BY_TESTER, CHARGED_BY_TESTER_14, LET_GO_BY_TESTER];
export const CHARGED_AUTOMATICALLY = "Charged automatically: no choice within 14 more days.";

// ---------- Notification schedule (owner) ----------

const DAY_MS = 86_400_000;
export const MARKS = [
  { mark: "1m", ms: 30 * 86_400_000, label: "in 1 month" },
  { mark: "1w", ms: 7 * 86_400_000, label: "in 1 week" },
  { mark: "3d", ms: 3 * 86_400_000, label: "in 3 days" },
  { mark: "1d", ms: 1 * 86_400_000, label: "tomorrow" },
] as const;

/**
 * Countdown pattern: 1 month before (only if it started more than a month away), 1 week, 3 days, 1 day before.
 * Returns the one mark due now (never one already sent; skipped marks aren't sent late), or null. Used for Open until's heads-ups to the developer (the review reminders
 * use reviewMarksFor since batch 15; each tester's own deadline uses ownDeadlineMarkDue since batch 16). `noMonth` leaves the month out.
 */
export function countdownDue(deadline: Date | null, now: Date, sent: string[], startedAt: Date, noMonth = false) {
  if (!deadline) return null;
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return null;
  const marks = noMonth ? MARKS.filter((m) => m.mark !== "1m") : MARKS;
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i], next = marks[i + 1];
    if (left <= m.ms && (!next || left > next.ms)) {
      if (sent.includes(m.mark)) return null;
      if (m.mark === "1m" && deadline.getTime() - startedAt.getTime() <= m.ms) return null;
      return m;
    }
  }
  return null;
}

/**
 * (Owner, Oct 30, batch 15 section 2) The developer's review reminders, the same for listed and unlisted parts: 1 month before the review date (only when it was more than
 * a month away at sending), then 3 weeks, 2 weeks and 1 week, 3 days and 1 day before. (The other countdowns, such as Open until's heads-ups, keep MARKS.)
 */
export const REVIEW_MARKS = [
  { mark: "1m", ms: 30 * DAY_MS, label: "in 1 month" },
  { mark: "3w", ms: 21 * DAY_MS, label: "in 3 weeks" },
  { mark: "2w", ms: 14 * DAY_MS, label: "in 2 weeks" },
  { mark: "1w", ms: 7 * DAY_MS, label: "in 1 week" },
  { mark: "3d", ms: 3 * DAY_MS, label: "in 3 days" },
  { mark: "1d", ms: 1 * DAY_MS, label: "tomorrow" },
] as const;
export type ReviewMark = (typeof REVIEW_MARKS)[number] & { at: Date };
/**
 * The reminders for work sent at `sentAt` with this review date: only marks still ahead when it was sent; the month only when the date was more than a month away; and
 * none within 24 hours of sending (that day's "<name> sent work" notice counts as the first). A 25-day review date gives 3 weeks, 2 weeks, 1 week, 3 days, 1 day; a
 * 7-day one gives 3 days and 1 day.
 */
export function reviewMarksFor(sentAt: Date, reviewDate: Date): ReviewMark[] {
  const away = reviewDate.getTime() - sentAt.getTime();
  return REVIEW_MARKS.filter((m) => (m.mark !== "1m" || away > m.ms) && reviewDate.getTime() - m.ms >= sentAt.getTime() + DAY_MS).map((m) => ({ ...m, at: new Date(reviewDate.getTime() - m.ms) }));
}
/** The reminder due now (the latest mark passed and not sent yet; an earlier missed one is never sent late), or null; nothing on or after the review date. */
export function reviewMarkDue(sentAt: Date, reviewDate: Date, now: Date, sent: string[]): ReviewMark | null {
  if (now.getTime() >= reviewDate.getTime()) return null;
  const passed = reviewMarksFor(sentAt, reviewDate).filter((m) => m.at.getTime() <= now.getTime());
  const last = passed[passed.length - 1];
  return last && !sent.includes(last.mark) ? last : null;
}

/**
 * (Owner, Oct 28, batch 16 section 1) A working tester's own deadline reminders: 1 month, 1 week, 3 days and 1 day before THEIR deadline (dueAt). The same rule as the
 * review reminders (reviewMarksFor): only marks still ahead when they joined; the month only when the deadline was more than a month away then; none within 24 hours of
 * joining. Every tester gets the same tester days from joining (batch 15 section 18), so on one test every tester gets the same set: 10 days per tester gives 1 week,
 * 3 days and 1 day; 45 days gives all four; 2 days gives 1 day.
 */
export function deadlineMarksFor(joinedAt: Date, dueAt: Date) {
  const away = dueAt.getTime() - joinedAt.getTime();
  return MARKS.filter((m) => (m.mark !== "1m" || away > m.ms) && dueAt.getTime() - m.ms >= joinedAt.getTime() + DAY_MS).map((m) => ({ ...m, at: new Date(dueAt.getTime() - m.ms) }));
}
/** The key prefix of one contract's sent deadline marks for one deadline, kept in Test.notifiedMarks (Open until's own marks there are bare: "1w"). */
export const deadlineMarkKey = (contractId: string, dueAt: Date) => `due:${contractId}:${dueAt.getTime()}:`;
/**
 * (Batch 16 section 1) The tester's deadline reminder due now, and what to record. Sent marks are kept per contract AND per deadline (`due:<contract>:<deadline ms>:<mark>`),
 * so a mark is never sent twice for the same deadline. When the deadline moved (an Edit moving Open until later, a pause shift), the first daily run that sees the new
 * deadline records the marks already behind it as passed: only the marks still ahead of the new deadline fire. As with the review reminders, the latest mark passed is
 * sent and every earlier one is recorded with it, so a missed mark is never sent late. `seen` marks a deadline the daily job has looked at.
 */
export function ownDeadlineMarkDue(c: { id: string; joinedAt: Date; dueAt: Date }, recorded: string[], now: Date): { send: (typeof MARKS)[number] | null; record: string[] } {
  const key = deadlineMarkKey(c.id, c.dueAt);
  const mine = recorded.filter((x) => x.startsWith(`due:${c.id}:`));
  const here = mine.filter((x) => x.startsWith(key)).map((x) => x.slice(key.length));
  const firstLook = here.length ? [] : [`${key}seen`];
  if (now.getTime() >= c.dueAt.getTime()) return { send: null, record: [] };
  const passed = deadlineMarksFor(c.joinedAt, c.dueAt).filter((m) => m.at.getTime() <= now.getTime());
  const behind = passed.filter((m) => !here.includes(m.mark)).map((m) => `${key}${m.mark}`);
  // The deadline moved: what's already behind the new one is recorded, never sent.
  if (!here.length && mine.length) return { send: null, record: [...firstLook, ...behind] };
  const last = passed[passed.length - 1];
  if (!last || here.includes(last.mark)) return { send: null, record: firstLook };
  return { send: MARKS.find((m) => m.mark === last.mark)!, record: [...firstLook, ...behind] };
}

export const ADMIN_DIGEST_DAYS = 3;
export const INVITE_REMIND_DAYS = 1; // (Owner, Oct 26) invite reminders are daily

/** "Charge": the listing minus what's already been paid for that part (0 = only "Close it"). */
export const chargeAmount = (listingCents: number | null, paidCents: number) => (listingCents == null ? 0 : Math.max(0, listingCents - paidCents));

// ---------- New terms offered to working testers (owner) ----------

export type ContractTerms = { ndaText?: string; writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null; liveMinutes: number | null; deadlineDays: number; questions: string[]; writtenRequired?: boolean; recordingRequired?: boolean; liveRequired?: boolean };
const whole = (c: number) => money(c).replace(/\.00$/, "");

/** "written $8 → $10, added a recording ($12)"; "" when the contract terms are the same. */
export function termsDiff(a: ContractTerms, b: ContractTerms) {
  const out: string[] = [];
  const part = (x: number | null, y: number | null, name: string, added: string, removed: string) => {
    if (x === y) return;
    if (x == null) out.push(`added ${added} (${whole(y!)})`);
    else if (y == null) out.push(`removed ${removed}`);
    else out.push(`${name} ${whole(x)} → ${whole(y)}`);
  };
  part(a.writtenCents, b.writtenCents, "written", "written answers", "written answers");
  part(a.recordingCents, b.recordingCents, "recording", "a recording", "the recording");
  if (a.liveRateCents !== b.liveRateCents) {
    if (a.liveRateCents == null) out.push(`added a live call (${whole(b.liveRateCents!)}/h)`);
    else if (b.liveRateCents == null) out.push("removed the live call");
    else out.push(`live call ${whole(a.liveRateCents)}/h → ${whole(b.liveRateCents)}/h`);
  }
  if (a.deadlineDays !== b.deadlineDays) out.push(`${a.deadlineDays} → ${b.deadlineDays} days`);
  if (JSON.stringify(a.questions) !== JSON.stringify(b.questions)) out.push("questions changed");
  // (5) A changed NDA is always a new offer the tester accepts, never applied silently.
  if ((a.ndaText ?? "") !== (b.ndaText ?? "")) out.push(!(a.ndaText ?? "") ? "added an NDA" : !(b.ndaText ?? "") ? "removed the NDA" : "NDA changed");
  // (NEWEST+10) The Required label is part of the terms.
  const req = (x: boolean | undefined, y: boolean | undefined, name: string, on: boolean) => { if (on && !!x !== !!y) out.push(`${name} now ${y ? "required" : "not required"}`); };
  req(a.writtenRequired, b.writtenRequired, "written answers", b.writtenCents != null);
  req(a.recordingRequired, b.recordingRequired, "the recording", b.recordingCents != null);
  req(a.liveRequired, b.liveRequired, "the live call", b.liveRateCents != null);
  return out.join(", ");
}

/** Switching never moves the tester's deadline earlier; it moves later if the new days give more time. */
export const newDueAt = (dueAt: Date, joinedAt: Date, days: number) => new Date(Math.max(dueAt.getTime(), joinedAt.getTime() + days * 86_400_000));

/** The Pay box line about day 14: "If you don't pay by Nov 5, Ana Silva can charge you $8.00, her contract price, or let it go." */
export const choiceNoteLine = (by: string, name: string, cents: number, poss: string) =>
  `If you don't pay by ${by}, ${name} can charge you ${money(cents)}, ${poss} contract price, or let it go.`;

// ---------- Join call (owner) ----------

export const JOIN_OPENS_MIN = 10;
export const JOIN_CLOSES_AFTER_END_MIN = 30;

/** Why Join call can't open the room now, or "". Shown in blue under Join. */
export function joinCallRefusal(
  x: { status: string; startsAt: Date; minutes: number; noShow: boolean; paused: boolean; testStatus: string; contractStatus: string; blocked: boolean; side: "tester" | "developer" },
  now: Date,
  fmtTime: (d: Date) => string,
) {
  if (x.status === "cancelled") return "This call was cancelled.";
  if (x.blocked) return "This call isn't available.";
  if (x.noShow) return "This call was reported as a no-show.";
  if (x.paused) return "This test is paused.";
  if (x.testStatus === "stopped") return "This test was stopped.";
  if (x.contractStatus === "left") return x.side === "tester" ? "You left this test." : "They left the test.";
  if (x.contractStatus === "ended") return x.side === "tester" ? "Your session ended." : "Their session ended.";
  const opens = new Date(x.startsAt.getTime() - JOIN_OPENS_MIN * 60_000);
  if (now < opens) return `You can join from ${fmtTime(opens)}.`;
  if (now.getTime() > x.startsAt.getTime() + (x.minutes + JOIN_CLOSES_AFTER_END_MIN) * 60_000) return "This call is over.";
  return "";
}

/** (Owner, as in the full app) Join call shows only while the room can be joined: from 10 min before to 30 min after the end. */
export function callJoinable(x: { status: string; startsAt: Date; minutes: number; cappedAt?: Date | null; endedAt?: Date | null }, now = new Date()) {
  if (x.status !== "booked" || x.cappedAt || x.endedAt) return false; // (batch 18 section 3; batch 21 section 2) a call the server ended can't be joined
  const t = now.getTime(), s = x.startsAt.getTime();
  return t >= s - JOIN_OPENS_MIN * 60_000 && t <= s + (x.minutes + JOIN_CLOSES_AFTER_END_MIN) * 60_000;
}

/** (The full app's joinedWords) Who joined a call that started: "both joined", "only you joined", "only Ana joined", "nobody joined". */
export function joinedWords(x: { startsAt: Date; devJoinedAt: Date | null; testerJoinedAt: Date | null }, side: "tester" | "developer", otherName: string, now = new Date()) {
  if (x.startsAt.getTime() > now.getTime()) return "";
  const mine = side === "tester" ? !!x.testerJoinedAt : !!x.devJoinedAt;
  const theirs = side === "tester" ? !!x.devJoinedAt : !!x.testerJoinedAt;
  return mine && theirs ? "both joined" : mine ? "only you joined" : theirs ? `only ${otherName} joined` : "nobody joined";
}

/** A past call's outcome badges (Past calls): cancelled (and by whom / why), a problem reported, paid / not paid yet. */
export function callOutcome(x: { status: string; cancelledBy: string | null; cancelNote: string; noShowBy: string | null; review: { amountCents: number; rejected: boolean } | null }, devName: string, side: "tester" | "developer") {
  const out: { label: string; tone: "grey" | "amber" | "green" | "rose" }[] = [];
  if (x.status === "cancelled") {
    const who = x.cancelledBy === side ? "you" : x.cancelledBy === "tester" ? (side === "developer" ? "the tester" : "you") : x.cancelledBy === "developer" ? devName : "the site";
    out.push({ label: x.cancelNote && x.cancelledBy !== "tester" && x.cancelledBy !== "developer" ? x.cancelNote.replace(/\.$/, "") : `cancelled by ${who}`, tone: "grey" });
    return out;
  }
  if (x.noShowBy) out.push({ label: "problem reported", tone: "amber" });
  if (x.review) out.push(x.review.rejected ? { label: "not paid (rejected)", tone: "rose" } : { label: `paid ${money(x.review.amountCents)}`, tone: "green" });
  else out.push({ label: "not paid yet", tone: "amber" });
  return out;
}



/** The tester's deadline is a guide (never blocks). A call booked after it reads this on both sides. */
export const bookedLateLabel = (name: string, dueAt: Date, fmt: (d: Date) => string) => `Booked after ${name}'s deadline (${fmt(dueAt)})`;
export const isBookedLate = (bookedAt: Date, dueAt: Date) => bookedAt.getTime() > dueAt.getTime();

// ---------- Ask to rejoin (design doc 7.3, 8) ----------

/** "3 days 4 h", "5 h 10 min", "40 min": how long a returning tester had left. */
export function leftText(ms: number, words = false) {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  // (Batch 12 section 6) `words`: the join page's "in 2 days 5 hours".
  if (d > 0) return h ? `${d} day${d === 1 ? "" : "s"} ${h} ${words ? (h === 1 ? "hour" : "hours") : "h"}` : `${d} day${d === 1 ? "" : "s"}`;
  if (words && h > 0) return `${h} hour${h === 1 ? "" : "s"}`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.max(m, 1)} min`;
}

/**
 * May this tester ask to rejoin? They left, or the developer ended their work (or the team's suspension removed them), BEFORE their deadline
 * passed; not after a stop, a block or a rating.
 */
export function canAskToRejoin(c: { status: string; endKind: string; endedAt: Date | null; dueAt: Date }, rated: boolean) {
  if (rated) return false;
  if (c.status !== "left" && c.status !== "ended") return false;
  if (["rated", "stopped", "closed", "blocked"].includes(c.endKind)) return false;
  return !!c.endedAt && c.endedAt.getTime() < c.dueAt.getTime();
}

// ---------- (Owner, Oct 28, batch 17 sections 1, 2, 12, 14 and 16) When Rate is open, and what stops it ----------

/** (Batch 17 section 2) Your own side suspended (or, for a developer, on a hold): Rate is hidden and an old page's press is refused. */
export const RATE_INACTIVE = "You can rate once your account is active again.";
/** (Batch 17 section 1) The tester's Rate is disabled, with the first of these lines that applies. */
export const RATE_CHARGE_FIRST = "Charge or let go of your unreviewed work first.";
export const RATE_MY_DISPUTE = "Rating opens once the team decides your dispute.";
export const rateOpensOnLine = (date: string, devName: string) => `Rating opens on ${date}, or sooner if ${devName} reviews everything you sent.`;
/** A piece in its review window with no review date yet (a call still being measured). */
export const rateOpensReviewLine = (devName: string) => `Rating opens once ${devName} reviews everything you sent.`;
/** (Batch 17 section 1) The developer's Rate is disabled while a dispute with that tester on this test is open. */
export const rateTheirDisputeLine = (name: string) => `Rating opens once the team decides ${name}'s dispute.`;
/** (Batch 17 section 16) The developer's Rate is hidden until the tester has rated and everything they sent is settled; an old page's press reads this. */
export const ratePendingLine = (name: string) => `You can rate ${name} once they've rated you and everything they sent is settled.`;
/** (Batch 17 section 12) A Cancel call pressed on a page opened before the test stopped (its calls ahead were cancelled by the stop). */
export const CALL_CANCELLED_BY_STOP = "This call was cancelled when the test stopped.";
/** "3:10 PM" when it happened in the last 12 hours, else "Tue, Nov 3, 3:10 PM". */
const stopAt = (d: Date, now: Date, fmtTime: (d: Date) => string, fmtDateTime: (d: Date) => string) => (now.getTime() - d.getTime() < 12 * 3_600_000 ? fmtTime(d) : fmtDateTime(d));
/**
 * (Batch 17 section 12) The stop as the one change a page opened before it reads. Testers: "Nora Lane stopped this test at 3:10 PM." (the developer's Stop), "This test was
 * stopped at 3:10 PM." (the team's: never who or why), "This test closed at 3:10 PM.", "Nora Lane ended your work early at 3:10 PM.". The developer: "You stopped this test
 * at …", "The team stopped this test at …" (the reason is on the banner), "This test closed at …", "You ended Ana's work early at …".
 */
export function stopMomentLine(side: "tester" | "developer", kind: "dev" | "team" | "closed" | "early", at: Date, names: { dev: string; tester: string }, fmtTime: (d: Date) => string, fmtDateTime: (d: Date) => string, now = new Date()) {
  const t = stopAt(at, now, fmtTime, fmtDateTime);
  if (kind === "closed") return `This test closed at ${t}.`;
  if (side === "tester") return kind === "team" ? `This test was stopped at ${t}.` : kind === "early" ? `${names.dev} ended your work early at ${t}.` : `${names.dev} stopped this test at ${t}.`;
  return kind === "team" ? `The team stopped this test at ${t}.` : kind === "early" ? `You ended ${names.tester}'s work early at ${t}.` : `You stopped this test at ${t}.`;
}

/**
 * (Owner, Oct 29, batch 29 section 11) A pause as the one change a page opened before it reads, like a stop. Testers: "This test was paused at 3:10 PM." (never why: no
 * "hold" or "suspended"). The developer: "The team paused this test at …", "Your tests were paused at …" (a payment or chargeback hold), "Your developer account was
 * suspended at …".
 */
export function pauseMomentLine(side: "tester" | "developer", cause: "team" | "hold" | "suspended", at: Date, fmtTime: (d: Date) => string, fmtDateTime: (d: Date) => string, now = new Date()) {
  const t = stopAt(at, now, fmtTime, fmtDateTime);
  if (side === "tester") return `This test was paused at ${t}.`;
  return cause === "team" ? `The team paused this test at ${t}.` : cause === "hold" ? `Your tests were paused at ${t}.` : `Your developer account was suspended at ${t}.`;
}

// ---------- Rate's stop-once lines (owner, Oct 27-28) ----------

/** The stop-once kinds that still apply to Rate after the test closed (stopped or closed): pay, reject, charge, let go, a dispute filed or decided. */
export const RATE_AFTER_CLOSE_KINDS = ["paid", "rejected", "payment", "choice", "chargeback", "dispute", "admin"] as const;
/** Is the test closed for Rate's purposes? */
export const testClosedForRate = (t: { status: string }) => t.status === "closed" || t.status === "stopped";
/**
 * (Owner, Oct 28) Does this line stop Rate? While the test is still open EVERY stop-once kind applies (the full developer or tester list); after it closes only
 * the post-close subset (batch 4 D4): pay, reject, charge, let go, dispute filed or decided.
 */
export function rateStops(e: TestEventLike, closed: boolean) {
  // (Owner, Oct 29, batch 29 sections 12-13) Your own changes in another tab never stop Rate (it only races with Rate itself: "You already rated …").
  if (e.kind === "own") return false;
  if (!closed) return true;
  return (RATE_AFTER_CLOSE_KINDS as readonly string[]).includes(e.kind);
}

// ---------- (Owner, Oct 28, batch 17 section 19) Close-out: 14 days after the last tester's deadline, money and ratings end ----------

export const CLOSE_OUT_DAYS = 14;
/**
 * (Owner, final) Where a test's close-out counts from: the last tester's deadline (every contract's, working or not), and no earlier than Open until (or the stop).
 * null while testers can still join or work (an open test before Open until, or a working tester's deadline ahead). The close-out itself (server/closeOut) adds 14
 * days, moved later by pauses and outages after this point; each piece keeps Charge and Pay at least 14 days after its own Charge opened (pieceCloseOut).
 */
export function closeOutBase(t: { status: string; stoppedAt: Date | null; openUntil: Date | null }, contracts: { status: string; dueAt: Date }[], now = new Date()): Date | null {
  if (t.status === "draft") return null;
  const stopped = t.status === "stopped";
  if (!stopped && (!t.openUntil || t.openUntil.getTime() > now.getTime())) return null;
  if (!stopped && contracts.some((c) => c.status === "working" && c.dueAt.getTime() > now.getTime())) return null;
  const from = stopped ? (t.stoppedAt ?? now) : t.openUntil!;
  return new Date(Math.max(from.getTime(), ...contracts.map((c) => c.dueAt.getTime())));
}
/** "Rating closed on Dec 6." (the tester's Rate after close-out). */
export const ratingClosedLine = (date: string) => `Rating closed on ${date}.`;

// ---------- (Owner, Oct 28, Batch 17 §19, final) Close-out, the money half: Pay more with the test's last Pay / Charge; Pay, Charge and Let it go per piece ----------
// (Batch 17 §19 replaces batch 16 section 22: Pay more no longer closes 30 days after the test ended, but together with the last Pay / Charge on the test: server/closeOut payMoreClosesAt.)
// Each piece's Charge / Let it go and the developer's Pay close on that piece's own date (server/closeOut pieceCloseOut: the test's close-out, or 14 days after its Charge
// opened if later; the tester's side adds the time their tester side was suspended). Unpaid work stays unpaid. Disputes are unchanged.

/** The last days before close-out in which the boxes and Needs you rows say when they close. */
export const CLOSE_OUT_WARN_DAYS = 7;
/** The bell reminders before close-out (3 days and 1 day before), each sent once. */
export const CLOSE_OUT_REMINDER_DAYS = [3, 1] as const;
/** Is the close-out within its last CLOSE_OUT_WARN_DAYS (and not passed yet)? */
export const closeOutSoon = (at: Date | null, now = new Date()) => !!at && at.getTime() > now.getTime() && at.getTime() - now.getTime() <= CLOSE_OUT_WARN_DAYS * 86_400_000;
/** The developer's Pay (more) pressed after close-out: "Pay closed on Dec 6." / "Pay more closed on Dec 6.". */
export const payClosedLine = (date: string, more = false) => `${more ? "Pay more" : "Pay"} closed on ${date}.`;
/** The tester's Charge or Let it go pressed after their close-out. */
export const chargeClosedLine = (date: string) => `Charge and Let it go closed on ${date}.`;
/** The grey line in the last 7 days: under the Charge box, on Needs you's rows, and under a Pay more box. */
export const chargeClosesLine = (date: string) => `Charge closes on ${date}.`;
export const payClosesLine = (date: string, more = false) => `${more ? "Pay more" : "Pay"} closes on ${date}.`;
/** Where an unpaid piece was: the developer's test page, and the tester's part. */
export const closedNotPaidLine = (date: string) => `Closed on ${date}: not paid.`;
export const notPaidClosedLine = (date: string) => `Not paid (closed on ${date})`;

// ---------- Extra pay from the Testers panel (owner, Oct 26) ----------

/** Over this amount the developer must also tick "I confirm this payment is over $200." (the same ticks as any Pay box). */
export const EXTRA_PAY_TICK_CENTS = PAY_TICK_CENTS;
/** The most one extra payment can be. For now only Stripe's own limit; the owner is deciding a cap, so it lives here and nowhere else. */
export const EXTRA_PAY_MAX_CENTS = STRIPE_MAX_CENTS;
export const EXTRA_PAY_TICK_LINE = PAY_TICK_LINE;

/** (Batch 9 section 1) A part with no listed price: written answers or a recording at most $1000 per piece; a call at most $200 an hour for the minutes logged. */
export const NO_LISTING_WORK_CAP_CENTS = 100_000;
export const NO_LISTING_CALL_RATE_CAP_CENTS = 20_000;
// (Owner, Oct 30, batch 15 section 34) NO_LISTING_CALLS_TOTAL_CENTS became CALLS_TOTAL_CENTS (callMeasure.ts): one $1,000 for ALL of a tester's calls on a test.
/** The blocked line for an unlisted call over its own room ($200 an hour for its measured minutes; nothing above it). */
export const overCallsLine = (roomCents: number) => `This is more than you can pay for this call (up to ${money(roomCents)} at ${money(NO_LISTING_CALL_RATE_CAP_CENTS).replace(/\.00$/, "")} an hour).`;
/** A piece's max: $1000 for written answers or a recording; $200/h × the logged minutes for a call. */
export const pieceMaxCents = (kind: "submission" | "call", minutes = 0) => (kind === "call" ? Math.round((NO_LISTING_CALL_RATE_CAP_CENTS * minutes) / 60) : NO_LISTING_WORK_CAP_CENTS);
/**
 * (Owner, Oct 29, batch 29 §38; corrects batch 28 §20) A piece's cap is the part's MAX IN TOTAL (Pay + every Pay more + any dispute raise), listed or not: $1,000 in all
 * for written answers or a recording; $200/h × the measured minutes for a call (and still within the $1,000 for all of that tester's calls on the test, pieceRoom).
 * A listed price at the max leaves no Pay more room (a listing above the max, which the forms don't allow, is still payable in full).
 */
export const pieceCapCents = (listingCents: number | null, maxCents: number) => Math.max(maxCents, listingCents ?? 0);
/** (Batch 28 §14) The developer's line where Pay more was, once the piece reached its cap: "Paid the most this piece can be paid ($20.00)." */
export const paidMostLine = (cents: number) => `Paid the most this piece can be paid (${money(cents)}).`;
/**
 * (Batch 28 §14) The tester's line on a paid part. (A paid part can't be changed in this app, so the lines say what Pay more can still add rather than "an update".)
 * "Nora Lane has paid $10.00 for this. It can be paid more, up to $1,000.00 in all." / "This part is already paid the most it can be ($20.00)." / "Pay more closed on Nov 2."
 */
export const testerPayMoreLine = (dev: string, paidCents: number, allCents: number) => `${dev} has paid ${money(paidCents)} for this. It can be paid more, up to ${money(allCents)} in all.`;
export const testerPaidMostLine = (cents: number) => `This part is already paid the most it can be (${money(cents)}).`;
/** (Batch 29 §38) The same for a part that isn't listed: what's left of its max in all ("up to $990 more, $1,000 in all" once something is paid). */
export const overMaxLine = (roomCents: number, totalCents: number = roomCents) =>
  `This is more than this piece can be paid (up to ${money(roomCents).replace(/\.00$/, "")}${roomCents < totalCents ? ` more, ${money(totalCents).replace(/\.00$/, "")} in all` : ""}).`;
export function checkExtraPay(amountCents: number | null, tickedCents: number | null, over200 = false): Check {
  if (amountCents == null || !Number.isInteger(amountCents) || amountCents <= 0) return no("Enter an amount like 7.50.");
  if (amountCents > EXTRA_PAY_MAX_CENTS) return amountCents > STRIPE_MAX_CENTS ? no(STRIPE_MAX_LINE) : no(`The most you can pay at once is ${money(EXTRA_PAY_MAX_CENTS)}.`);
  if (amountCents < MIN_CHARGE_CENTS) return no(`The smallest card charge is ${money(MIN_CHARGE_CENTS)}.`);
  return payTicks(amountCents, tickedCents, over200);
}

/**
 * (Owner, Oct 28, batch 18 section 8) The tester's Switch / Keep box when the questions changed. Answers already sent keep the price they were sent at (`sent`, the
 * written part; nothing sent yet: only the first sentence; a part that wasn't listed: no price).
 */
export const switchQuestionsLine = (sent: { agreedCents: number | null } | null | undefined) =>
  `Switching means answering the new questions: send your updated answers.${!sent ? "" : sent.agreedCents != null ? ` Answers you already sent stay payable at ${money(sent.agreedCents)}.` : " Answers you already sent stay payable."}`;

// ---------- (Batch 18 section 9, replaced by batch 21 section 2) Calls in progress ----------
// A pause (any cause), a block, a suspension of either side, a leave, End early or a Stop ends a call in progress at that moment, on the server (both rooms hang up;
// the minutes measured up to then are kept and payable). Join and any re-Join are refused with the existing lines.
// (Batch 23, a batch 21 leftover) The in-app room: no "ends when you both leave" (the server ends it); a call opened but never connected is "Waiting to connect".
export const IN_PROGRESS_DEV = "In progress";
export const WAITING_TO_CONNECT = "Waiting to connect";
export const IN_PROGRESS_TESTER = "In progress";
/** The call page once its length is final: "Call ended at 3:42 PM." (neutral, for both sides). */
export const callEndedLine = (time: string) => `Call ended at ${time}.`;
/** Started and not ended yet (still being measured). */
export const callInProgress = (x: { status: string; startsAt: Date; measuredAt: Date | null; actualMinutes: number | null }, now = new Date()) =>
  x.status === "booked" && x.startsAt.getTime() <= now.getTime() && !x.measuredAt && x.actualMinutes == null;
/** Why nobody can (re-)join this call any more although it may still be in progress: the test paused or stopped, the session over, a block; "" when it's open. */
export function callClosedToJoins(x: { paused: boolean; testStatus: string; contractStatus: string; blocked: boolean; side: "tester" | "developer"; endKind?: string }) {
  return callClosedLineOf(callClosedKind(x), x.side, x.endKind);
}
/** (Batch 21 section 2) What closed a call (it ends a call in progress at that moment): a block, a pause (any cause), a stop, a leave, the session's end. */
export type CallClosedKind = "blocked" | "paused" | "stopped" | "left" | "ended";
export function callClosedKind(x: { paused: boolean; testStatus: string; contractStatus: string; blocked: boolean }): CallClosedKind | "" {
  if (x.blocked) return "blocked";
  if (x.paused) return "paused";
  if (x.testStatus === "stopped") return "stopped";
  if (x.contractStatus === "left") return "left";
  if (x.contractStatus === "ended") return "ended";
  return "";
}
/** Each side's neutral line for it (never "hold" or "suspended"; a tester removed by a suspension reads that their session ended). */
export function callClosedLineOf(kind: CallClosedKind | "" | string, side: "tester" | "developer", endKind = "") {
  if (kind === "blocked") return "This call isn't available.";
  if (kind === "paused") return "This test is paused.";
  if (kind === "stopped") return "This test was stopped.";
  if (kind === "left") return side === "tester" ? (endKind === "suspended" || endKind === "deleted" ? "Your session ended." : "You left this test.") : "They left the test.";
  if (kind === "ended") return side === "tester" ? "Your session ended." : "Their session ended.";
  return "";
}
/** (Owner, Oct 28, batch 18 section 13; batch 21 section 1) "Check your call setup", from booking onward: an in-app camera and microphone check (no call). */
export const CALL_CHECK_LABEL = "Check your call setup";
export const CALL_CHECK_NOTE = "Preview your camera and microphone before the call. Nothing is sent or recorded.";
