import { db } from "@/lib/db";
import { T } from "@/lib/tz";
import { displayName, money, pronouns } from "@/lib/format";
import { HttpError } from "./http";
import { bell, notify } from "./notify";
import { chargeIsOpen, rateStops, testClosedForRate, testPaused } from "@/lib/rules";
import { testerGate } from "./testerGate";
import { cancelCallsAhead, devGate, lockTest, ownContract, ownTest, recordEvent, spotOpened } from "./tests";

// (Owner, Oct 22, NEWEST+5) Ratings.
// TESTER rates the developer once (1) at least one part was sent or one call took place, (2) every sent part / call is
// decided or past the point where Charge / Let it go opens (14 days and the test's Open until), (3) there's no open dispute in this test. Rating finishes their part like Leave (no
// rejoin ever); Charge / Let it go and Dispute stay. The "Rate …" prompt is sent once.
// DEVELOPER rates a tester only after that tester rated them (no open dispute), within 14 days of the tester's rating.
// BLIND REVEAL: the tester's rating stays hidden (from the developer, profiles and averages) until the developer rates
// or the 14-day window closes; then both show at once.

export type Side = "tester" | "developer";
const DAY = 86_400_000;
export const WINDOW_DAYS = 14;
/** (Owner, Oct 27) Rating reminders after a stop or close: every 3 days, for 2 weeks only. */
export const REMINDER_WEEKS = 2;

/** Is this rating visible (to the other side, on profiles, in averages)? */
export const isRevealed = (r: { side: string; revealedAt: Date | null; createdAt: Date }, now = new Date()) =>
  !!r.revealedAt || (r.side === "tester" && r.createdAt.getTime() + WINDOW_DAYS * DAY <= now.getTime());
const revealedWhere = (now = new Date()) => ({ OR: [{ revealedAt: { not: null } }, { side: "tester", createdAt: { lte: new Date(now.getTime() - WINDOW_DAYS * DAY) } }] });

/** Why the tester can't rate yet ("" = available; "rated" = done). */
export async function rateBlocker(contractId: string, side: Side, now = new Date()) {
  if (side === "developer") return devRateBlocker(contractId, now);
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: true, submissions: { include: { review: true } }, calls: { include: { review: true } } } });
  if (await db.rating.findUnique({ where: { contractId_side: { contractId, side: "tester" } } })) return "rated";
  const done = c.calls.filter((x) => x.status === "booked" && x.startsAt <= now);
  if (!c.submissions.length && !done.length) return "Rating opens once some work was sent or a call took place.";
  const waiting = c.submissions.some((s) => !s.review && !s.choiceOfferedAt && !chargeIsOpen(s, c.test, c, now)) || done.some((x) => !x.review && x.startsAt.getTime() + 14 * DAY > now.getTime());
  if (waiting) return "Rating opens once the developer has reviewed everything you sent (or Charge / Let it go has opened for it).";
  if (await db.dispute.count({ where: { contractId, status: "open" } })) return "Rating opens once the team has decided the open dispute.";
  return "";
}

async function devRateBlocker(contractId: string, now = new Date()) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { tester: true } });
  if (await db.rating.findUnique({ where: { contractId_side: { contractId, side: "developer" } } })) return "rated";
  const theirs = await db.rating.findUnique({ where: { contractId_side: { contractId, side: "tester" } } });
  if (!theirs) return `You can rate ${displayName(c.tester)} once ${pronouns(c.tester.pronoun).subj} has rated you.`;
  if (theirs.createdAt.getTime() + WINDOW_DAYS * DAY <= now.getTime()) return `The ${WINDOW_DAYS} days to rate ${displayName(c.tester)} have passed.`;
  if (await db.dispute.count({ where: { contractId, status: "open" } })) return "Rating opens once the team has decided the open dispute.";
  return "";
}

/** "4.6 ★ (12 ratings)" and the comments (never the rater's name); revealed ratings only. */
export async function ratingSummary(userId: string) {
  const rows = await db.rating.findMany({ where: { rateeId: userId, ...revealedWhere() }, orderBy: { createdAt: "desc" } });
  if (!rows.length) return { line: "", comments: [] as string[], n: 0, avg: 0 };
  const avg = rows.reduce((a, r) => a + r.stars, 0) / rows.length;
  return { line: `${avg.toFixed(1)} ★ (${rows.length} rating${rows.length === 1 ? "" : "s"})`, comments: rows.filter((r) => r.comment).slice(0, 10).map((r) => r.comment), n: rows.length, avg };
}
export const revealedRatingsWhere = revealedWhere;

/** Both ratings on a contract, as each side may see them. */
export async function contractRatings(contractId: string) {
  const [tester, developer] = await Promise.all([
    db.rating.findUnique({ where: { contractId_side: { contractId, side: "tester" } } }),
    db.rating.findUnique({ where: { contractId_side: { contractId, side: "developer" } } }),
  ]);
  return { tester, developer, testerRevealed: !!tester && isRevealed(tester), revealOn: tester ? new Date(tester.createdAt.getTime() + WINDOW_DAYS * DAY) : null };
}

/** Send the tester's "Rate …" prompt (bell + email) once, when rating first becomes available. */
export async function maybePromptRating(contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
  if (!c || c.ratePromptedAt || (await rateBlocker(c.id, "tester"))) return;
  await db.contract.update({ where: { id: c.id }, data: { ratePromptedAt: new Date() } });
  await notify(c.tester.email, `Rate ${displayName(c.test.developer)} on “${c.title}”`, [`You can now rate ${displayName(c.test.developer)} for “${c.title}”.`], `/app/sessions/${c.id}#rate`, { own: c.test.status === "stopped" });
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

/** Tester rates the developer. Like Leave (no rejoin ever); Charge / Let it go and Dispute stay. Hidden until revealed. */
export async function testerRate(tester: { id: string; name: string; email: string; pronoun?: string }, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId);
  const blocker = await rateBlocker(contractId, "tester");
  if (blocker === "rated") throw new HttpError(409, "rated", "You already rated this test.");
  if (blocker) throw new HttpError(409, "not_yet", blocker);
  const r = readRating(body);
  // (Owner, Oct 28) While the test is open every stop-once kind applies; after it closes only pay, reject, charge, let go and disputes (batch 4 D4).
  const closed = testClosedForRate(c0.test);
  await testerGate(tester.id, contractId, c0.testId, body, undefined, { keep: (e) => rateStops(e, closed) });
  await db.$transaction(async (tx) => {
    await lockTest(tx, c0.testId);
    await tx.rating.create({ data: { testId: c0.testId, contractId, side: "tester", raterId: tester.id, rateeId: c0.test.developerId, ...r } });
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (c.status === "working") {
      await tx.contract.update({ where: { id: c.id }, data: { status: "left", endKind: "rated", endedAt: new Date() } });
      await cancelCallsAhead(tx, [c.id], `${displayName(tester)} finished their part.`);
      await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the tester left", decidedAt: new Date() } });
    }
    await recordEvent(tx, c.testId, "left", `${displayName(tester)} finished ${c0.title} and rated you`, true, {}, c.id);
  });
  await bell(c0.test.developerId, `${displayName(tester)} finished ${c0.title}. You can rate ${pronouns(tester.pronoun).obj} for ${WINDOW_DAYS} days.`, `/app/tests/${c0.testId}#tester-${c0.id}`, undefined, { own: c0.test.status === "stopped" });
  await spotOpened(c0.testId);
  return { rated: true };
}

/** Developer rates a tester who already rated them (within 14 days). Both ratings show at once. */
export async function devRate(dev: { id: string; name: string; email: string }, testId: string, body: Record<string, unknown>) {
  const test = await ownTest(dev.id, testId);
  const closed = testClosedForRate(test);
  const contractId = String(body.contractId ?? "");
  const c0 = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true } });
  if (!c0 || c0.testId !== testId) throw new HttpError(404, "not_found", "Choose a tester.");
  const blocker = await rateBlocker(contractId, "developer");
  if (blocker === "rated") throw new HttpError(409, "rated", `You already rated ${displayName(c0.tester)}.`);
  if (blocker) throw new HttpError(409, "not_yet", blocker);
  const r = readRating(body);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await lockTest(tx, testId);
    // (Owner, Oct 28) While the test is open every stop-once kind applies; after it closes only pay, reject, charge, let go and disputes (batch 4 D4).
    await devGate(tx, testId, body, {}, [], (e) => rateStops(e, closed));
    await tx.rating.create({ data: { testId, contractId, side: "developer", raterId: dev.id, rateeId: c0.testerId, ...r, revealedAt: now } });
    await tx.rating.updateMany({ where: { contractId, side: "tester", revealedAt: null }, data: { revealedAt: now } });
  });
  return { rated: true };
}


/**
 * (Owner, Oct 26-27) Rating prompts: while the test is open they stack with that test's other same-day lines. Once the test is closed (stopped) each is its
 * own line, with a reminder every 3 days until the person has rated or 2 weeks have passed (the tester's from the later of the stop / close and the first prompt; the developer's
 * from the tester's rating). The Rate button itself has no end date (DEFAULT: change it in rateBlocker).
 */
export async function ratingReminders(now = new Date()) {
  const every = 3 * DAY - 3_600_000;
  let n = 0;
  const sinceLast = async (userId: string, testId: string, fallback: Date) => {
    const last = await db.notification.findFirst({ where: { userId, testId, text: { startsWith: "Reminder: rate " } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    return last && last.createdAt > fallback ? last.createdAt : fallback;
  };
  // Tester: prompted once, then every 3 days until they rate.
  const prompted = await db.contract.findMany({ where: { test: { status: "stopped" }, ratePromptedAt: { not: null, lt: new Date(now.getTime() - every) } }, orderBy: { ratePromptedAt: "desc" }, take: 500, include: { test: { include: { developer: true } } } });
  const rated = new Set((await db.rating.findMany({ where: { contractId: { in: prompted.map((c) => c.id) }, side: "tester" }, select: { contractId: true } })).map((r) => r.contractId));
  for (const c of prompted) {
    if (rated.has(c.id) || testPaused(c.test.developer, c.test)) continue;
    const from = new Date(Math.max(c.ratePromptedAt!.getTime(), c.test.stoppedAt?.getTime() ?? 0));
    if (now.getTime() > from.getTime() + REMINDER_WEEKS * 7 * DAY) continue; // 2 weeks only
    if (now.getTime() - (await sinceLast(c.testerId, c.testId, c.ratePromptedAt!)).getTime() < every) continue;
    if ((await rateBlocker(c.id, "tester")) !== "") continue;
    await bell(c.testerId, `Reminder: rate ${displayName(c.test.developer)} on “${c.title}”`, `/app/sessions/${c.id}#rate`, undefined, { own: true, reminder: `rate:${c.id}` });
    n++;
  }
  // Developer: the tester rated; every 3 days until they rate back or the 14 days end.
  const theirs = await db.rating.findMany({ where: { side: "tester", createdAt: { gt: new Date(now.getTime() - WINDOW_DAYS * DAY), lt: new Date(now.getTime() - every) } }, take: 500 });
  const back = new Set((await db.rating.findMany({ where: { contractId: { in: theirs.map((r) => r.contractId) }, side: "developer" }, select: { contractId: true } })).map((r) => r.contractId));
  for (const r of theirs) {
    if (back.has(r.contractId)) continue;
    const c = await db.contract.findUnique({ where: { id: r.contractId }, include: { tester: true, test: { include: { developer: true } } } });
    if (!c || c.test.status !== "stopped" || testPaused(c.test.developer, c.test)) continue;
    if (now.getTime() - (await sinceLast(c.test.developerId, c.testId, r.createdAt)).getTime() < every) continue;
    if ((await rateBlocker(c.id, "developer", now)) !== "") continue;
    await bell(c.test.developerId, `Reminder: rate ${displayName(c.tester)} for “${c.title}” (until ${T(new Date(r.createdAt.getTime() + WINDOW_DAYS * DAY), "date")})`, `/app/tests/${c.testId}#tester-${c.id}`, undefined, { own: true, reminder: `rate-dev:${c.id}` });
    n++;
  }
  return n;
}
