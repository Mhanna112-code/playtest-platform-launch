import { db } from "@/lib/db";
import { displayName, money, pronouns } from "@/lib/format";
import { HttpError } from "./http";
import { notify } from "./notify";
import { testerGate } from "./testerGate";
import { cancelCallsAhead, devGate, lockTest, ownContract, ownTest, recordEvent, spotOpened, tellCancelled } from "./tests";

// (Owner, Oct 22, NEWEST+5) Ratings, both ways: the tester rates the developer, the developer rates each tester.
// Available once (1) at least one part was sent or one call took place, (2) every sent part / call is decided or past
// the 14-day point, (3) there's no open dispute in this test. One rating per side per test, final. Rating finishes the
// rater's part (tester: like Leave; developer: ends that tester's session like End early); money actions stay.

export type Side = "tester" | "developer";
const DAY = 86_400_000;

/** Why rating isn't available yet ("" = available). */
export async function rateBlocker(contractId: string, side: Side, now = new Date()) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { submissions: { include: { review: true } }, calls: { include: { review: true } } } });
  if (await db.rating.findUnique({ where: { contractId_side: { contractId, side } } })) return "rated";
  const done = c.calls.filter((x) => x.status === "booked" && x.startsAt <= now);
  if (!c.submissions.length && !done.length) return "Rating opens once some work was sent or a call took place.";
  const waiting = c.submissions.some((s) => !s.review && !s.choiceOfferedAt && !(s.payBy && s.payBy < now)) || done.some((x) => !x.review && x.startsAt.getTime() + 14 * DAY > now.getTime());
  if (waiting) return side === "tester" ? "Rating opens once the developer has reviewed everything you sent (or 14 days have passed)." : "Rating opens once you've paid or rejected everything they sent (or 14 days have passed).";
  if (await db.dispute.count({ where: { contractId, status: "open" } })) return "Rating opens once the team has decided the open dispute.";
  return "";
}

/** "4.6 ★ (12 ratings)" and the comments (never the rater's name). */
export async function ratingSummary(userId: string) {
  const rows = await db.rating.findMany({ where: { rateeId: userId }, orderBy: { createdAt: "desc" } });
  if (!rows.length) return { line: "", comments: [] as string[], n: 0 };
  const avg = rows.reduce((a, r) => a + r.stars, 0) / rows.length;
  return { line: `${avg.toFixed(1)} ★ (${rows.length} rating${rows.length === 1 ? "" : "s"})`, comments: rows.filter((r) => r.comment).slice(0, 10).map((r) => r.comment), n: rows.length };
}

/** Send the "Rate …" prompt (bell + email) once per side, when rating first becomes available. */
export async function maybePromptRating(contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
  if (!c) return;
  if (!c.ratePromptedAt && !(await rateBlocker(c.id, "tester"))) {
    await db.contract.update({ where: { id: c.id }, data: { ratePromptedAt: new Date() } });
    const line = `Rate ${displayName(c.test.developer)}`;
    await notify(c.tester.email, `${line} on “${c.title}”`, [`You can now rate ${displayName(c.test.developer)} for “${c.title}”.`], `/app/sessions/${c.id}#rate`);
  }
  if (!c.devRatePromptedAt && !(await rateBlocker(c.id, "developer"))) {
    await db.contract.update({ where: { id: c.id }, data: { devRatePromptedAt: new Date() } });
    const line = `Rate ${displayName(c.tester)}`;
    await notify(c.test.developer.email, `${line} on “${c.title}”`, [`You can now rate ${displayName(c.tester)} for “${c.title}”.`], `/app/tests/${c.testId}`);
  }
}

/** The in-page warning lines (what rating will end): contract parts not sent yet and calls ahead. */
export async function rateWarning(contractId: string, side: Side) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { submissions: true, calls: true, tester: true, test: { include: { developer: true } } } });
  const working = c.status === "working";
  if (!working) return { working, lines: [] as string[] };
  const sent = new Set(c.submissions.map((s) => s.kind));
  const lines: string[] = [];
  const share = (cents: number) => (side === "tester" ? money(Math.round(cents * 0.8)) : money(cents)).replace(/\.00$/, "");
  const missing = [c.writtenCents != null && !sent.has("written") ? `written answers (${share(c.writtenCents)})` : "", c.recordingCents != null && !sent.has("recording") ? `recording (${share(c.recordingCents)})` : ""].filter(Boolean);
  if (missing.length) lines.push(`Not sent yet from ${side === "tester" ? "your" : "their"} contract: ${missing.join(", ")} — it won't be paid.`);
  // (Spec update) One short line, only when calls are booked.
  if (c.calls.some((x) => x.status === "booked" && x.startsAt > new Date())) lines.push(side === "tester" ? "All your upcoming calls will be cancelled." : `All ${pronouns(c.tester.pronoun).poss} upcoming calls will be cancelled.`);
  return { working, lines };
}

function readRating(body: Record<string, unknown>) {
  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, "bad_stars", "Choose 1 to 5 stars.");
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (comment.length > 500) throw new HttpError(400, "bad_comment", "Keep the comment to 500 characters or fewer.");
  return { stars, comment };
}

/** Tester rates the developer. Like Leave (no rejoin ever); Charge / Let it go and Dispute stay. */
export async function testerRate(tester: { id: string; name: string; email: string }, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId);
  const blocker = await rateBlocker(contractId, "tester");
  if (blocker === "rated") throw new HttpError(409, "rated", "You already rated this test.");
  if (blocker) throw new HttpError(409, "not_yet", blocker);
  const r = readRating(body);
  await testerGate(tester.id, contractId, c0.testId, body);
  await db.$transaction(async (tx) => {
    await lockTest(tx, c0.testId);
    await tx.rating.create({ data: { testId: c0.testId, contractId, side: "tester", raterId: tester.id, rateeId: c0.test.developerId, ...r } });
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (c.status === "working") {
      await tx.contract.update({ where: { id: c.id }, data: { status: "left", endKind: "rated", endedAt: new Date() } });
      await cancelCallsAhead(tx, [c.id], `${displayName(tester)} finished their part.`);
      await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the tester left", decidedAt: new Date() } });
      await recordEvent(tx, c.testId, "left", `${displayName(tester)} rated the test and finished`, true, {}, c.id);
    }
  });
  await notify(c0.test.developer.email, `${displayName(tester)} rated “${c0.title}”`, [`${displayName(tester)} rated your test “${c0.title}” and finished their part.`], `/app/tests/${c0.testId}`);
  await spotOpened(c0.testId);
  return { rated: true };
}

/** Developer rates a tester (from their row). Ends that tester's session like End early; their money actions stay. */
export async function devRate(dev: { id: string; name: string; email: string }, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const contractId = String(body.contractId ?? "");
  const c0 = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true } });
  if (!c0 || c0.testId !== testId) throw new HttpError(404, "not_found", "Choose a tester.");
  const blocker = await rateBlocker(contractId, "developer");
  if (blocker === "rated") throw new HttpError(409, "rated", `You already rated ${displayName(c0.tester)}.`);
  if (blocker) throw new HttpError(409, "not_yet", blocker);
  const r = readRating(body);
  let cancelled: Awaited<ReturnType<typeof cancelCallsAhead>> = [];
  let ended = false;
  await db.$transaction(async (tx) => {
    await lockTest(tx, testId);
    await devGate(tx, testId, body);
    await tx.rating.create({ data: { testId, contractId, side: "developer", raterId: dev.id, rateeId: c0.testerId, ...r } });
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (c.status === "working") {
      ended = true;
      await tx.contract.update({ where: { id: c.id }, data: { status: "ended", endKind: "rated", endedAt: new Date(), endReason: "" } });
      cancelled = await cancelCallsAhead(tx, [c.id], "The developer finished the work.");
      await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the session ended", decidedAt: new Date() } });
      await recordEvent(tx, testId, "ended", `You rated ${displayName(c0.tester)} and finished their part`, false, {}, c.id);
    }
  });
  await tellCancelled(cancelled, "ended");
  if (ended) {
    const line = `${displayName(dev)} finished your part in ${c0.title}.`;
    await notify(c0.tester.email, line, [line, "Work you already sent is still reviewed and paid."], `/app/sessions/${c0.id}`);
    await spotOpened(testId);
  }
  return { rated: true };
}
