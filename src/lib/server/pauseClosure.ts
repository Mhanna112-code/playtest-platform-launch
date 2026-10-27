import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { PAUSE_CLOSE_DAYS, pauseClosedReason, pauseClosesAt } from "@/lib/pause";
import { HttpError } from "./http";
import { bell, notify } from "./notify";
import { cancelCallsAhead, recordEvent, tellCancelled } from "./tests";

// (Owner, Oct 26) PAUSED TESTS AUTO-CLOSE AFTER 7 DAYS, whatever the cause. The daily job closes them; closing works like Stop. Testers are
// told neutrally that the test ended; the developer is told why. The admin can extend a test's closure date or close it sooner.

const DAY = 86_400_000;

/**
 * Close one paused test like a Stop: testers' work ends (what they sent is still reviewed and paid), calls ahead are cancelled, requests, invites and
 * applications close. Testers read "ended" (never why); the developer is told the reason.
 */
export async function closePausedTest(testId: string, by: "daily" | "admin", now = new Date(), adminId: string | null = null) {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  const info = pauseClosesAt(t.developer, t);
  if (t.status === "stopped") throw new HttpError(409, "stopped", "That test was already stopped.");
  if (!info) throw new HttpError(409, "not_paused", "That test isn't paused.");
  const reason = pauseClosedReason(info.causes, by);
  const cs = await db.contract.findMany({ where: { testId, status: "working" }, include: { tester: true } });
  const cancelled = await db.$transaction(async (tx) => {
    const fresh = await tx.test.findUniqueOrThrow({ where: { id: testId } });
    if (fresh.status === "stopped") return null; // somebody stopped it a moment ago: nothing to do
    await tx.contract.updateMany({ where: { testId, status: "working" }, data: { status: "ended", endKind: "closed", endedAt: now, endReason: "The test ended." } });
    const list = await cancelCallsAhead(tx, cs.map((c) => c.id), "The test ended.");
    await tx.callRequest.updateMany({ where: { contractId: { in: cs.map((c) => c.id) }, status: "pending" }, data: { status: "closed", closedReason: "the test ended", decidedAt: now } });
    await tx.callSlot.updateMany({ where: { testId, status: "open" }, data: { status: "removed" } });
    await tx.invite.updateMany({ where: { testId, status: "sent" }, data: { status: "cancelled" } });
    await tx.application.updateMany({ where: { testId, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: now } });
    await recordEvent(tx, testId, "stopped", "The test was closed", true, { status: "stopped", stoppedAt: now, pauseClosedAt: now, pauseClosedReason: reason, ...(by === "admin" ? { adminStoppedById: adminId } : {}) });
    return list;
  });
  if (!cancelled) return { closed: false };
  await tellCancelled(cancelled, "closed");
  for (const c of cs) await notify(c.tester.email, `“${c.title}” ended`, [`“${c.title}” ended. Work you already sent is still reviewed and paid. Calls ahead are cancelled.`], `/app/sessions/${c.id}`, { own: true });
  await notify(t.developer.email, `“${t.title}” was closed`, [`“${t.title}” was closed. ${reason}`, "What testers already sent still waits for you to pay or reject. Contact us in Settings if you think this is a mistake."], `/app/tests/${testId}`, { always: true, group: "team" });
  return { closed: true, testers: cs.length };
}

/** The daily job: close every paused test whose closure date has come. */
export async function closePausedTests(now = new Date()) {
  const tests = await db.test.findMany({
    where: { status: { in: ["open", "closed"] }, OR: [{ adminPausedAt: { not: null } }, { developer: { OR: [{ holdStartedAt: { not: null } }, { suspendedAt: { not: null } }] } }] },
    include: { developer: true },
  });
  let n = 0;
  for (const t of tests) {
    const info = pauseClosesAt(t.developer, t);
    if (!info || info.at.getTime() > now.getTime()) continue;
    try {
      if ((await closePausedTest(t.id, "daily", now)).closed) n++;
    } catch (e) {
      console.error("[daily] closing a paused test failed:", t.id, (e as Error).message); // one bad test never stops the daily job
    }
  }
  return n;
}

/** Admin: move a paused test's closure date later (default a week more). */
export async function extendPauseClosure(testId: string, days: unknown, now = new Date()) {
  const n = days === undefined || days === "" || days === null ? PAUSE_CLOSE_DAYS : Number(days);
  if (!Number.isFinite(n) || n < 1 || n > 90 || Math.floor(n) !== n) throw new HttpError(400, "bad_days", "Enter a whole number of days from 1 to 90.");
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  const info = pauseClosesAt(t.developer, t);
  if (!info) throw new HttpError(409, "not_paused", "That test isn't paused.");
  const at = new Date(info.at.getTime() + n * DAY);
  await db.test.update({ where: { id: testId }, data: { pauseCloseAt: at, pauseCloseSetAt: now } });
  await notify(t.developer.email, `“${t.title}” will close later`, [`The team moved the date “${t.title}” closes to ${fmtDate(at)} (it stays paused until your account is cleared).`], `/app/tests/${testId}`, { own: true });
  return { ok: true, closesAt: at.toISOString() };
}

/** The admin page's list: every paused test with its closure date, soonest first. */
export async function pausedTestsForAdmin() {
  const tests = await db.test.findMany({
    where: { status: { in: ["open", "closed"] }, OR: [{ adminPausedAt: { not: null } }, { developer: { OR: [{ holdStartedAt: { not: null } }, { suspendedAt: { not: null } }] } }] },
    include: { developer: true },
  });
  return tests
    .map((t) => ({ test: t, info: pauseClosesAt(t.developer, t)!, dev: displayName(t.developer) }))
    .filter((x) => x.info)
    .sort((a, b) => a.info.at.getTime() - b.info.at.getTime());
}

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * (Owner, Oct 26) The developer is told by bell, once per pause, that a test is paused and when it closes: "Harbor Run is paused and closes on
 * Nov 2 unless your account is cleared". (No countdown on the pages: the bell is enough, and the admin keeps the dates in its lists.)
 */
export async function bellPausedTests(devId: string, now = new Date()) {
  const dev = await db.user.findUnique({ where: { id: devId } });
  if (!dev) return 0;
  let n = 0;
  for (const t of await db.test.findMany({ where: { developerId: devId, status: { in: ["open", "closed"] } } })) {
    const info = pauseClosesAt(dev, t);
    if (!info) continue;
    const text = `${t.title} is paused and closes on ${day(info.at)} ${info.causes.some((c) => c !== "team") ? "unless your account is cleared" : "unless the team lifts the pause"}`;
    if (await db.notification.count({ where: { userId: devId, testId: t.id, text, createdAt: { gt: info.since } } })) continue;
    await bell(devId, text, `/app/tests/${t.id}`, undefined, { own: true });
    n++;
  }
  void now;
  return n;
}

/** The daily job: one bell a day before a paused test closes. */
export async function warnPausedClosures(now = new Date()) {
  const tests = await db.test.findMany({
    where: { status: { in: ["open", "closed"] }, OR: [{ adminPausedAt: { not: null } }, { developer: { OR: [{ holdStartedAt: { not: null } }, { suspendedAt: { not: null } }] } }] },
    include: { developer: true },
  });
  let n = 0;
  for (const t of tests) {
    const info = pauseClosesAt(t.developer, t);
    if (!info || info.at.getTime() <= now.getTime() || info.at.getTime() - now.getTime() > DAY) continue;
    const text = `${t.title} closes tomorrow (${day(info.at)}) unless ${info.causes.some((c) => c !== "team") ? "your account is cleared" : "the team lifts the pause"}`;
    if (await db.notification.count({ where: { userId: t.developerId, testId: t.id, text: { startsWith: `${t.title} closes tomorrow` }, createdAt: { gt: info.since } } })) continue;
    await bell(t.developerId, text, `/app/tests/${t.id}`, undefined, { own: true });
    n++;
  }
  return n;
}
