import { db } from "@/lib/db";
import { T } from "@/lib/tz";
import { displayName, fmtDate, money, pronouns } from "@/lib/format";
import { HttpError } from "./http";
import { bell, notify } from "./notify";
import { finishedAndRatedLine, ratedYouLine, ratingClosedLine, RATE_CHARGE_FIRST, RATE_INACTIVE, RATE_MY_DISPUTE, TESTER_CHOICE_REASONS, chargeIsOpen, chargeOpensAt, ratePendingLine, rateOpensOnLine, rateOpensReviewLine, rateTheirDisputeLine, type TestEventLike } from "@/lib/rules";
import { cancelCallsAhead, lockTest, ownContract, ownTest, recordEvent, spotOpened } from "./tests";
import { tabOf, testerPaymentChanges } from "./live";
import { FINISHED_PART_REASON, payMoreLine, TESTER_CALL_KINDS, testerChanges } from "./testerGate";
import { devStopSince, loadedOf, stopBox, testerStopSince } from "./stopMoment";
import { closeOutOf, closedOut, devPauseSpans, windowEnd, type Span } from "./closeOut";

// (Owner, Oct 22, NEWEST+5) Ratings. (Owner, Oct 28, batch 17 sections 1, 2, 14, 16 and 17: the rules below replace the earlier ones where they differ.)
// TESTER rates the developer once some work was sent or a call took place. Rate is DISABLED (shown, with one grey line) while they can still Charge or Let it go of a
// piece, while a dispute of theirs is open, or while work they sent is inside its review window; HIDDEN (and refused) while their tester side is suspended. No end date.
// Rating finishes their part like Leave (no rejoin ever); Dispute stays.
// DEVELOPER rates a tester only once the tester has rated them AND everything that tester sent is settled (paid, charged or let go); until then Rate is hidden. Their
// 14 days start then and pause while they can't rate (their developer side suspended, a payment or chargeback hold). A dispute opened later disables Rate until decided.
// BLIND REVEAL: the tester's rating stays hidden (from the developer, profiles and averages) until the developer rates or their 14 days end (see revealAt).

export type Side = "tester" | "developer";
const DAY = 86_400_000;
export const WINDOW_DAYS = 14;
/** (Owner, Oct 27) Rating reminders: every 3 days, for 2 weeks only. (Batch 29 §21) On running tests too. */
export const REMINDER_WEEKS = 2;
/**
 * (Owner, Oct 29, batch 29 §21) Every rating line ("<tester> finished <test>. You can rate them…", the developer's reminders, the tester's "Rate <dev> on <test>" and its
 * reminders) stacks in ONE "Ratings to give" entry per day across tests, opening the dashboard's Ratings to give box.
 */
const RATINGS = { group: "ratings" } as const;
export const RATINGS_HREF = "/app#ratings-to-give";

/**
 * (Batch 17) One Rate box's state: "open" (pressable), "disabled" (shown with its grey line), "hidden" (not shown; an old page's press is refused with the line),
 * "closed" (after the test's close-out: a note, refused), "rated" (done). The developer's also carries their window: when it opened and ends (`paused`: the end moves on while they can't rate) and when the tester's rating shows.
 */
export type RateState = { kind: "open" | "disabled" | "hidden" | "closed" | "rated"; line: string; opensAt?: Date | null; endsAt?: Date | null; paused?: boolean; revealAt?: Date | null };

/** Why this side can't rate yet ("" = available; "rated" = done; otherwise the line, for a hidden or a disabled box). */
export async function rateBlocker(contractId: string, side: Side, now = new Date()) {
  const s = side === "tester" ? await testerRateState(contractId, now) : (await devRateStates([contractId], now)).get(contractId)!;
  return s.kind === "rated" ? "rated" : s.kind === "open" ? "" : s.line;
}

/** (Batch 17 sections 1 and 2) The tester's Rate box. */
export async function testerRateState(contractId: string, now = new Date()): Promise<RateState> {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } }, submissions: { include: { review: true } }, calls: { include: { review: true } } } });
  if (await db.rating.findUnique({ where: { contractId_side: { contractId, side: "tester" } } })) return { kind: "rated", line: "" };
  if (c.tester.testerSuspendedAt) return { kind: "hidden", line: RATE_INACTIVE };
  const done = c.calls.filter((x) => x.status === "booked" && x.startsAt <= now);
  if (!c.submissions.length && !done.length) return { kind: "hidden", line: "Rating opens once some work was sent or a call took place." };
  // (Batch 17 section 19) The test's close-out ends the tester's Rate: "Rating closed on <date>." (shown as a note, refused on the server).
  const closeOut = await closeOutOf(c.testId, now);
  if (closedOut(closeOut, now)) return { kind: "closed", line: ratingClosedLine(fmtDate(closeOut!)) };
  // A part or listed call they can still Charge or Let it go (Charge never happens on its own: they settle it first).
  // (Batch 30 §3) Late work never has a Charge to settle.
  if ([...c.submissions, ...done].some((x) => !x.review && x.choiceOfferedAt && !("late" in x && x.late))) return { kind: "disabled", line: RATE_CHARGE_FIRST };
  if (await db.dispute.count({ where: { contractId, status: "open" } })) return { kind: "disabled", line: RATE_MY_DISPUTE };
  // Work still inside its review window (sent, not reviewed, Charge not open yet); an unlisted part stops blocking at its review date (as before).
  const waitSubs = c.submissions.filter((s) => !s.review && !chargeIsOpen(s, c.test, c, now));
  const waitCalls = done.filter((x) => !x.review && !(x.payBy && chargeIsOpen(x, c.test, c, now))); // (batch 15 section 15) a call: paid, or its review date passed
  if (waitSubs.length || waitCalls.length) {
    const dev = displayName(c.test.developer);
    const dates = [...waitSubs, ...waitCalls].map((x) => chargeOpensAt(x, c.test, c, now));
    if (dates.some((d) => !d)) return { kind: "disabled", line: rateOpensReviewLine(dev) };
    return { kind: "disabled", line: rateOpensOnLine(fmtDate(new Date(Math.max(...dates.map((d) => d!.getTime())))), dev) };
  }
  return { kind: "open", line: "" };
}

// ---------- the developer's window (batch 17 sections 2 and 16) ----------

/** (Batch 17 section 16) The developer's Rate box for each contract, and when the tester's rating shows. */
export async function devRateStates(contractIds: string[], now = new Date()) {
  const out = new Map<string, RateState>();
  if (!contractIds.length) return out;
  const cs = await db.contract.findMany({ where: { id: { in: contractIds } }, include: { tester: true, test: { include: { developer: true } }, submissions: { include: { review: true } }, calls: { include: { review: true } } } });
  const [ratings, disputes, events] = await Promise.all([
    db.rating.findMany({ where: { contractId: { in: contractIds } } }),
    db.dispute.groupBy({ by: ["contractId"], where: { contractId: { in: contractIds }, status: "open" }, _count: { _all: true } }),
    db.accountEvent.findMany({ where: { userId: { in: [...new Set(cs.map((c) => c.test.developerId))] }, kind: { in: ["hold", "hold-lifted", "suspended", "reinstated"] } }, select: { userId: true, kind: true, side: true, createdAt: true } }),
  ]);
  const open = new Set(disputes.map((d) => d.contractId));
  const spans = new Map<string, Span[]>();
  const closeOuts = new Map<string, Date | null>();
  for (const id of new Set(cs.map((c) => c.testId))) closeOuts.set(id, await closeOutOf(id, now));
  for (const c of cs) {
    const dev = c.test.developer;
    const name = displayName(c.tester);
    if (!spans.has(dev.id)) spans.set(dev.id, devPauseSpans(events.filter((e) => e.userId === dev.id), dev, now));
    const mine = ratings.find((r) => r.contractId === c.id && r.side === "developer");
    const theirs = ratings.find((r) => r.contractId === c.id && r.side === "tester");
    // Everything they sent is settled: every part and every call that took place has its Pay, Charge or Let it go.
    const pieces = [...c.submissions, ...c.calls.filter((x) => x.status === "booked" && x.startsAt <= now)];
    const settled = pieces.every((x) => !!x.review);
    // (Batch 17 section 19) A tester who never rated: the developer can rate them for 14 days from the test's close-out (or from when their last open piece settled, if
    // later), only if everything they sent was settled (a piece that closed unpaid never settles: no rating of that tester).
    const closeOut = closeOuts.get(c.testId) ?? null;
    const lastSettled = Math.max(0, ...pieces.map((x) => x.review?.createdAt.getTime() ?? 0));
    const opensAt = !settled ? null : theirs ? new Date(Math.max(theirs.createdAt.getTime(), lastSettled)) : closedOut(closeOut, now) && pieces.length > 0 ? new Date(Math.max(closeOut!.getTime(), lastSettled)) : null; // (DEFAULT) only a tester who sent something or had a call
    const w = opensAt ? windowEnd(opensAt, spans.get(dev.id)!, now, WINDOW_DAYS) : null;
    // The tester's rating shows once the developer rates or their 14 days end. A window that hadn't opened 14 days after the tester rated (the developer left work
    // unsettled that long) doesn't hold it back past those 14 days.
    const revealAt = !theirs ? null : (theirs.revealedAt ?? (opensAt && w && opensAt.getTime() <= theirs.createdAt.getTime() + WINDOW_DAYS * DAY ? w.end : new Date(theirs.createdAt.getTime() + WINDOW_DAYS * DAY)));
    const base = { opensAt, endsAt: w?.end ?? null, paused: w?.paused ?? false, revealAt };
    if (mine) out.set(c.id, { kind: "rated", line: "", ...base });
    else if (dev.devSuspendedAt || dev.holdStartedAt) out.set(c.id, { kind: "hidden", line: RATE_INACTIVE, ...base });
    else if (!opensAt) out.set(c.id, { kind: "hidden", line: ratePendingLine(name), ...base });
    else if (w && w.end.getTime() <= now.getTime()) out.set(c.id, { kind: "hidden", line: `The ${WINDOW_DAYS} days to rate ${name} have passed.`, ...base });
    else if (open.has(c.id)) out.set(c.id, { kind: "disabled", line: rateTheirDisputeLine(name), ...base });
    else out.set(c.id, { kind: "open", line: "", ...base });
  }
  return out;
}

/** The coarse filter: every rating that may show (a tester's never shows before 14 days); `stillHidden` removes the ones whose developer window runs longer. */
const revealedWhere = (now = new Date()) => ({ OR: [{ revealedAt: { not: null } }, { side: "tester", createdAt: { lte: new Date(now.getTime() - WINDOW_DAYS * DAY) } }] });
export const revealedRatingsWhere = revealedWhere;
/** (Batch 17 section 16) Of these ratings, the tester ratings whose developer can still rate back (their window runs past 14 days): still hidden. */
export async function stillHidden(rows: { id: string; side: string; contractId: string; revealedAt: Date | null }[], now = new Date()) {
  const cands = rows.filter((r) => r.side === "tester" && !r.revealedAt);
  const states = await devRateStates(cands.map((r) => r.contractId), now);
  return new Set(
    cands
      .filter((r) => {
        const at = states.get(r.contractId)?.revealAt;
        return !!at && at.getTime() > now.getTime();
      })
      .map((r) => r.id),
  );
}

/** "4.6 ★ (12 ratings)" and the comments (never the rater's name); revealed ratings only. */
export async function ratingSummary(userId: string) {
  const all = await db.rating.findMany({ where: { rateeId: userId, ...revealedWhere() }, orderBy: { createdAt: "desc" } });
  const hidden = await stillHidden(all);
  const rows = all.filter((r) => !hidden.has(r.id));
  if (!rows.length) return { line: "", comments: [] as string[], n: 0, avg: 0 };
  const avg = rows.reduce((a, r) => a + r.stars, 0) / rows.length;
  return { line: `${avg.toFixed(1)} ★ (${rows.length} rating${rows.length === 1 ? "" : "s"})`, comments: rows.filter((r) => r.comment).slice(0, 10).map((r) => r.comment), n: rows.length, avg };
}

/** Both ratings on a contract, as each side may see them. */
export async function contractRatings(contractId: string, now = new Date()) {
  const [tester, developer] = await Promise.all([
    db.rating.findUnique({ where: { contractId_side: { contractId, side: "tester" } } }),
    db.rating.findUnique({ where: { contractId_side: { contractId, side: "developer" } } }),
  ]);
  const revealOn = tester ? (tester.revealedAt ?? (await devRateStates([contractId], now)).get(contractId)?.revealAt ?? null) : null;
  return { tester, developer, testerRevealed: !!tester && !!revealOn && revealOn.getTime() <= now.getTime(), revealOn };
}

/** Send the tester's "Rate …" prompt (bell + email) once, when rating first becomes available; and the developer's once theirs opens (section 16). */
export async function maybePromptRating(contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
  if (!c) return;
  await maybeOpenDevRating(c.id);
  if (c.ratePromptedAt || (await rateBlocker(c.id, "tester"))) return;
  await db.contract.update({ where: { id: c.id }, data: { ratePromptedAt: new Date() } });
  await notify(c.tester.email, `Rate ${displayName(c.test.developer)} on “${c.title}”`, [`You can now rate ${displayName(c.test.developer)} for “${c.title}”.`], RATINGS_HREF, { ...RATINGS, testId: c.testId });
}

/** (Batch 17 section 16) The developer's Rate for this tester just opened (they rated and everything they sent is settled): "<tester> finished <test>. You can rate them for 14 days.", once. */
export async function maybeOpenDevRating(contractId: string, now = new Date()) {
  const s = (await devRateStates([contractId], now)).get(contractId);
  if (!s || s.kind !== "open" || s.paused) return false;
  const key = `rate-open:${contractId}`;
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { tester: true, test: true } });
  if (await db.notification.findFirst({ where: { userId: c.test.developerId, reminderKey: key }, select: { id: true } })) return false;
  await bell(c.test.developerId, `${displayName(c.tester)} finished ${c.title}. You can rate ${pronouns(c.tester.pronoun).obj} for ${WINDOW_DAYS} days.`, RATINGS_HREF, undefined, { ...RATINGS, testId: c.testId, reminder: key });
  return true;
}

/** The tester's in-page warning lines (what rating will end): contract parts not sent yet, and one calls line. */
export async function rateWarning(contractId: string) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { submissions: true, calls: true } });
  const working = c.status === "working";
  if (!working) return { working, lines: [] as string[] };
  const sent = new Set(c.submissions.map((s) => s.kind));
  const share = (cents: number) => money(Math.round(cents * 0.8)).replace(/\.00$/, "");
  // (NEWEST+10) An unsent part marked Required says so (a label only: rating is still available).
  const req = (on: boolean) => (on ? " (required)" : "");
  const missing = [c.writtenCents != null && !sent.has("written") ? `written answers (${share(c.writtenCents)})${req(c.writtenRequired)}` : "", c.recordingCents != null && !sent.has("recording") ? `recording (${share(c.recordingCents)})${req(c.recordingRequired)}` : ""].filter(Boolean);
  const lines: string[] = [];
  if (missing.length) lines.push(`Not sent yet from your contract: ${missing.join(", ")} — it won't be paid.`);
  if (c.calls.some((x) => x.status === "booked" && x.startsAt > new Date())) lines.push("All your upcoming calls will be cancelled.");
  return { working, lines };
}

function readRating(body: Record<string, unknown>) {
  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, "bad_stars", "Choose 1 to 5 stars.");
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (comment.length > 500) throw new HttpError(400, "bad_comment", "Keep the comment to 500 characters or fewer.");
  return { stars, comment };
}

/**
 * (Owner, Oct 28, batch 17 sections 12 and 14) What stops Rate once: only changes about that person and your shared work, plus the test stopping, closing or that
 * tester's work ending early (on a page opened before it). Tester: the developer's Pay or Pay more on their work, a dispute of theirs decided. Developer: a dispute
 * with them decided (everything was settled before Rate opened: section 16). Everything else goes straight through (other testers, calls, edits, keys, Alerts, the
 * other side's suspension or hold, a pause); a dispute opened meanwhile disables Rate instead (its refusal line).
 */
async function testerRateGate(testerId: string, contractId: string, devName: string, body: Record<string, unknown>) {
  const since = loadedOf(body);
  if (!since) return;
  const lines: TestEventLike[] = [];
  const stop = await testerStopSince(contractId, since);
  if (stop) lines.push(stop);
  // A Pay that went through late (owed, then paid) comes as its payment's lines instead of the review's.
  const late = new Set((await db.payment.findMany({ where: { contractId, OR: [{ owedUntil: { not: null } }, { settledAt: { not: null } }, { status: { in: ["owed", "deferred"] } }] }, select: { submissionId: true, callId: true } })).map((p) => p.submissionId ?? p.callId));
  for (const r of await db.review.findMany({ where: { contractId, createdAt: { gt: since }, reason: { notIn: TESTER_CHOICE_REASONS } }, include: { submission: true } })) {
    if (!r.rejected && late.has(r.submissionId ?? r.callId)) continue;
    const what = r.callId ? "your live call" : `your ${r.submission?.kind === "recording" ? "recording" : "written answers"}`;
    lines.push({ kind: "paid", text: r.rejected ? `${devName} rejected ${what}` : `${devName} paid ${money(r.amountCents)} for ${what}`, createdAt: r.createdAt });
  }
  const kinds = new Map((await db.submission.findMany({ where: { contractId }, select: { id: true, kind: true } })).map((x) => [x.id, x.kind]));
  for (const p of await db.payment.findMany({ where: { contractId, kind: "extra", createdAt: { gt: since }, status: { in: ["charged", "not_set_up"] } } })) {
    lines.push({ kind: "paid", text: payMoreLine(devName, p.amountCents, p.callId ? "live call" : kinds.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers"), createdAt: p.createdAt }); // (batch 20 section 12) the same line as the other presses
  }
  lines.push(...(await testerPaymentChanges(testerId, contractId, since, true)));
  // (Owner, Oct 28, batch 20 section 14) On a running test, Rate ends their part (calls ahead and requests close): a call change between them and the developer
  // since the page loaded stops it once too (a request, a booking, a decline, a withdraw, a cancel); other testers' calls never do. Alerts Off: they don't stop.
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, select: { status: true, testId: true, tester: { select: { testerAlertsOff: true } }, test: { select: { status: true } } } });
  if (c.status === "working" && c.test.status === "open" && !c.tester.testerAlertsOff) lines.push(...(await testerChanges(testerId, contractId, c.testId, since, tabOf(body))).filter((e) => TESTER_CALL_KINDS.has(e.kind)));
  if (lines.length) stopBox(lines.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()));
}
async function devRateGate(testId: string, contractId: string, body: Record<string, unknown>, devId = "") {
  const since = loadedOf(body);
  if (!since) return;
  const lines: TestEventLike[] = [];
  // (Owner, Oct 29, batch 29 section 12) The developer's own changes in another tab (a Pay more, a call change…) never stop Rate: it only races with Rate itself.
  void devId;
  const stop = await devStopSince(testId, contractId, since);
  if (stop) lines.push(stop);
  lines.push(...(await db.testEvent.findMany({ where: { testId, contractId, kind: "admin", createdAt: { gt: since }, text: { startsWith: "The team decided" } } })));
  // (Owner, Oct 29, batch 30 §4) No call changes here: the developer's Rate only opens after the tester rated (which ends their part) or at close-out, so "call changes
  // between the two of them while that tester is still working" could never apply.
  if (lines.length) stopBox(lines.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()));
}
function refuse(s: RateState, already: string): never {
  if (s.kind === "rated") throw new HttpError(409, "rated", already);
  throw new HttpError(409, s.line === RATE_INACTIVE ? "inactive" : "not_yet", s.line);
}

/** Tester rates the developer. Like Leave (no rejoin ever); Dispute stays. Hidden until revealed. */
export async function testerRate(tester: { id: string; name: string; email: string; pronoun?: string }, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId);
  const state = await testerRateState(contractId);
  if (state.kind !== "open") refuse(state, `You already rated ${displayName(c0.test.developer)}.`); // (batch 29 section 13) a Rate made in another tab: a plain refusal
  const r = readRating(body);
  await testerRateGate(tester.id, contractId, displayName(c0.test.developer), body);
  await db.$transaction(async (tx) => {
    await lockTest(tx, c0.testId);
    await tx.rating.create({ data: { testId: c0.testId, contractId, side: "tester", raterId: tester.id, rateeId: c0.test.developerId, ...r } });
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const wasWorking = c.status === "working";
    if (wasWorking) {
      await tx.contract.update({ where: { id: c.id }, data: { status: "left", endKind: "rated", endedAt: new Date() } });
      await cancelCallsAhead(tx, [c.id], `${displayName(tester)} finished their part.`);
      // (Owner, Oct 29, batch 24 section 2) Said in the tester's terms: they finished their part (Leave and a suspension's removal keep "the tester left").
      await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: FINISHED_PART_REASON, decidedAt: new Date() } });
    }
    // (Owner, Oct 28, batch 20 section 24) A working tester who rates is leaving: one line ("Testers leaving"). One whose part had ended: "ff rated you" (Ratings from
    // testers). Either stops the developer's presses once; never the stars (the blind reveal).
    if (wasWorking) await recordEvent(tx, c.testId, "left", `${finishedAndRatedLine(displayName(tester))}`, true, {}, c.id);
    else await recordEvent(tx, c.testId, "rated", `${ratedYouLine(displayName(tester))}`, false, {}, c.id);
  });
  // (Batch 17 section 16) The developer's Rate (and its 14 days) opens once everything this tester sent is settled too: now, or when the last piece is.
  await maybeOpenDevRating(contractId);
  await spotOpened(c0.testId);
  return { rated: true };
}

/** Developer rates a tester who already rated them, once everything they sent is settled (within 14 days). Both ratings show at once. */
export async function devRate(dev: { id: string; name: string; email: string }, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const contractId = String(body.contractId ?? "");
  const c0 = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true } });
  if (!c0 || c0.testId !== testId) throw new HttpError(404, "not_found", "Choose a tester.");
  const state = (await devRateStates([contractId])).get(contractId)!;
  if (state.kind !== "open") refuse(state, `You already rated ${displayName(c0.tester)}.`);
  const r = readRating(body);
  await devRateGate(testId, contractId, body, dev.id);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await lockTest(tx, testId);
    await tx.rating.create({ data: { testId, contractId, side: "developer", raterId: dev.id, rateeId: c0.testerId, ...r, revealedAt: now } });
    await tx.rating.updateMany({ where: { contractId, side: "tester", revealedAt: null }, data: { revealedAt: now } });
  });
  return { rated: true };
}

/** How long a tester's own side was suspended since `from` (their reminders pause then). */
async function testerSuspendedMs(testerId: string, from: Date, now: Date) {
  const u = await db.user.findUnique({ where: { id: testerId }, select: { testerSuspendedAt: true } });
  const evs = await db.accountEvent.findMany({ where: { userId: testerId, kind: { in: ["suspended", "reinstated"] }, side: { in: ["tester", ""] } }, orderBy: { createdAt: "asc" } });
  let ms = 0;
  let on: number | null = null;
  for (const e of evs) {
    if (e.kind === "suspended" && on == null) on = e.createdAt.getTime();
    else if (e.kind === "reinstated" && on != null) {
      ms += Math.max(0, e.createdAt.getTime() - Math.max(on, from.getTime()));
      on = null;
    }
  }
  if (u?.testerSuspendedAt) ms += Math.max(0, now.getTime() - Math.max(on ?? u.testerSuspendedAt.getTime(), from.getTime()));
  return ms;
}

/**
 * (Owner, Oct 26-27; batch 29 §21) Rating prompts and their reminders every 3 days, whatever the test's state (running, paused, stopped or closed), stacked in the day's
 * "Ratings to give" entry across tests. Tester: until they have rated or 2 weeks have passed (from the later of the stop / close and the first prompt), not counting the time their side
 * was suspended (batch 17 section 2: their Rate has no end date, so only the reminders pause). Developer (batch 17 section 16): from when their Rate opened, until they
 * rate or their 14 days end, paused while they can't rate.
 */
export async function ratingReminders(now = new Date()) {
  const every = 3 * DAY - 3_600_000;
  let n = 0;
  const sinceLast = async (userId: string, testId: string, fallback: Date) => {
    const last = await db.notification.findFirst({ where: { userId, testId, text: { startsWith: "Reminder: rate " } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    return last && last.createdAt > fallback ? last.createdAt : fallback;
  };
  // Tester: prompted once (when their Rate opens), then every 3 days for 2 weeks until they rate, whatever the test's state (batch 29 §21: running tests too).
  const prompted = await db.contract.findMany({ where: { ratePromptedAt: { not: null, lt: new Date(now.getTime() - every), gt: new Date(now.getTime() - 365 * DAY) } }, orderBy: { ratePromptedAt: "desc" }, take: 500, include: { tester: { select: { testerSuspendedAt: true } }, test: { include: { developer: true } } } });
  const rated = new Set((await db.rating.findMany({ where: { contractId: { in: prompted.map((c) => c.id) }, side: "tester" }, select: { contractId: true } })).map((r) => r.contractId));
  for (const c of prompted) {
    if (rated.has(c.id) || c.tester.testerSuspendedAt) continue;
    // (Batch 29 §21) 2 weeks from when their Rate opened (the prompt), not counting the time their tester side was suspended.
    const from = c.ratePromptedAt!;
    if (now.getTime() > from.getTime() + REMINDER_WEEKS * 7 * DAY + (await testerSuspendedMs(c.testerId, from, now))) continue; // 2 weeks only
    if (now.getTime() - (await sinceLast(c.testerId, c.testId, c.ratePromptedAt!)).getTime() < every) continue;
    if ((await rateBlocker(c.id, "tester", now)) !== "") continue;
    await bell(c.testerId, `Reminder: rate ${displayName(c.test.developer)} on “${c.title}”`, RATINGS_HREF, undefined, { ...RATINGS, testId: c.testId, reminder: `rate:${c.id}` });
    n++;
  }
  // Developer: once their Rate opened (the tester rated and everything is settled, or (section 19) a never-rated tester at the close-out); every 3 days until they
  // rate or their 14 days end.
  const theirs = await db.rating.findMany({ where: { side: "tester", revealedAt: null, createdAt: { gt: new Date(now.getTime() - 365 * DAY) } }, orderBy: { createdAt: "desc" }, take: 1000, select: { contractId: true } });
  const ended = await db.contract.findMany({ where: { joinedAt: { gt: new Date(now.getTime() - 365 * DAY) }, test: { OR: [{ status: "stopped" }, { openUntil: { lt: new Date(now.getTime() - 14 * DAY) } }] } }, orderBy: { joinedAt: "desc" }, take: 2000, select: { id: true } });
  const anyRating = new Set((await db.rating.findMany({ where: { contractId: { in: ended.map((c) => c.id) } }, select: { contractId: true } })).map((r) => r.contractId));
  const cands = [...theirs, ...ended.filter((c) => !anyRating.has(c.id)).map((c) => ({ contractId: c.id }))];
  const states = await devRateStates(cands.map((r) => r.contractId), now);
  for (const r of cands) {
    const s = states.get(r.contractId);
    if (!s || s.kind !== "open" || s.paused) continue;
    if (await maybeOpenDevRating(r.contractId, now)) continue; // the opening line itself (once)
    const c = await db.contract.findUnique({ where: { id: r.contractId }, include: { tester: true, test: true } });
    if (!c) continue; // (batch 29 §21) on a running test too
    if (now.getTime() - (await sinceLast(c.test.developerId, c.testId, s.opensAt!)).getTime() < every) continue;
    await bell(c.test.developerId, `Reminder: rate ${displayName(c.tester)} for “${c.title}” (until ${T(s.endsAt!, "date")})`, RATINGS_HREF, undefined, { ...RATINGS, testId: c.testId, reminder: `rate-dev:${c.id}` });
    n++;
  }
  return n;
}

/**
 * (Owner, Oct 28, batch 17 section 17) "Ratings to give" on a dashboard: every rating this person can give right now, newest first. Tester: each test whose Rate is
 * open ("Rate Nora Lane on “Harbor Run”"); developer: each tester whose Rate is open (section 16: "Rate Ana Silva on “Harbor Run” · 12 days left"). A row follows the
 * Rate rules exactly (a dispute opening, a suspension or a hold, a rating given takes it away). Nothing while the viewer's own side is suspended or on a hold.
 */
export async function ratingsToGive(user: { id: string; testerSuspendedAt: Date | null; devSuspendedAt: Date | null; holdStartedAt: Date | null }, side: Side, now = new Date()) {
  const rows: { id: string; text: string; href: string; at: number }[] = [];
  if (side === "tester") {
    if (user.testerSuspendedAt) return rows;
    const cs = await db.contract.findMany({ where: { testerId: user.id, OR: [{ submissions: { some: {} } }, { calls: { some: { status: "booked", startsAt: { lte: now } } } }] }, include: { test: { include: { developer: true } } }, orderBy: { joinedAt: "desc" }, take: 500 });
    const rated = new Set((await db.rating.findMany({ where: { contractId: { in: cs.map((c) => c.id) }, side: "tester" }, select: { contractId: true } })).map((r) => r.contractId));
    for (const c of cs.filter((x) => !rated.has(x.id))) {
      if ((await testerRateState(c.id, now)).kind !== "open") continue;
      rows.push({ id: c.id, text: `Rate ${displayName(c.test.developer)} on “${c.title}”`, href: `/app/sessions/${c.id}#rate`, at: (c.endedAt ?? c.joinedAt).getTime() });
    }
  } else {
    if (user.devSuspendedAt || user.holdStartedAt) return rows;
    const cs = await db.contract.findMany({ where: { test: { developerId: user.id } }, include: { tester: true }, orderBy: { joinedAt: "desc" }, take: 2000 });
    const mine = new Set((await db.rating.findMany({ where: { contractId: { in: cs.map((c) => c.id) }, side: "developer" }, select: { contractId: true } })).map((r) => r.contractId));
    const states = await devRateStates(cs.filter((c) => !mine.has(c.id)).map((c) => c.id), now);
    for (const c of cs) {
      const s = states.get(c.id);
      if (!s || s.kind !== "open" || !s.endsAt) continue;
      const days = Math.max(1, Math.ceil((s.endsAt.getTime() - now.getTime()) / DAY));
      rows.push({ id: c.id, text: `Rate ${displayName(c.tester)} on “${c.title}” · ${days} day${days === 1 ? "" : "s"} left`, href: `/app/tests/${c.testId}#rate-${c.id}`, at: s.opensAt!.getTime() });
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}
