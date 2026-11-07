import { db } from "@/lib/db";
import { T } from "@/lib/tz";
import { displayName } from "@/lib/format";
import { PAUSE_CLOSE_DAYS, pauseClosedReason, pauseClosesAt } from "@/lib/pause";
import { andList, dayIn } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { cancelCallsAhead, recordEvent, tellCancelled } from "./tests";
import { checkFrom, liftRefusal, presserOf, stopIfChanged, stoppedRefusal, testChangesSince, type AdminSeen } from "./adminRace";
import { closeOffersOfEnded } from "./offerClose";

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
  let invitesClosed: string[] = [];
  const cancelled = await db.$transaction(async (tx) => {
    // (Nov 2, §119) The same test lock as Stop: two Close nows (or a Close now and a Stop) at once can't both close it; the second reads who did it once settled.
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const fresh = await tx.test.findUniqueOrThrow({ where: { id: testId } });
    if (fresh.status === "stopped") return null; // somebody stopped it a moment ago: nothing to do
    invitesClosed = await (await import("./invites")).openInviteIds({ testId }, tx);
    await tx.contract.updateMany({ where: { testId, status: "working" }, data: { status: "ended", endKind: "closed", endedAt: now, endReason: "The test ended." } });
    const list = await cancelCallsAhead(tx, cs.map((c) => c.id), "The test ended.");
    await closeOffersOfEnded(tx, cs.map((c) => c.id), now); // (batch 35 §118)
    await tx.callRequest.updateMany({ where: { contractId: { in: cs.map((c) => c.id) }, status: "pending" }, data: { status: "closed", closedReason: "the test ended", decidedAt: now } });
    await tx.callSlot.updateMany({ where: { testId, status: "open" }, data: { status: "removed" } });
    await tx.invite.updateMany({ where: { testId, status: "sent" }, data: { status: "cancelled" } });
    await tx.application.updateMany({ where: { testId, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: now } });
    await recordEvent(tx, testId, "stopped", "The test was closed", true, { status: "stopped", stoppedAt: now, pauseClosedAt: now, pauseClosedReason: reason, ...(by === "admin" ? { adminStoppedById: adminId } : {}) });
    return list;
  });
  if (!cancelled) return { closed: false };
  await tellCancelled(cancelled, "closed");
  await (await import("./invites")).tellInvitesClosed(invitesClosed); // (batch 30 §6)
  for (const c of cs) await notify(c.tester.email, `“${c.title}” ended`, [`“${c.title}” ended. Work you already sent is still reviewed and paid. Calls ahead are cancelled.`], `/app/sessions/${c.id}`, { group: "tstopped" });
  // (A system explanation, never a typed reason: it stays in the line.)
  await notify(t.developer.email, `“${t.title}” was closed. ${reason}`, [`“${t.title}” was closed. ${reason}`, "What testers already sent still waits for you to pay. Contact us in Settings if you think this is a mistake."], `/app/tests/${testId}`, { always: true, group: "payhold" }); // (batch 29 §33) in the day's "Payments and holds" entry with the hold lines
  return { closed: true, testers: cs.length };
}

/**
 * (Owner, Oct 30, batch 34 §1) The admin's Close now: stopped or closed already, or no longer paused, refused naming who and when; another admin extended (or
 * otherwise changed) the test since the page loaded: stops once, and the second press closes it.
 */
export async function adminClosePaused(adminId: string, testId: string, seen: AdminSeen | null = null) {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  const p = presserOf(adminId, seen); // (batch 35 §45) this admin's own changes in another tab: "You already …"
  if (t.status === "stopped") throw await stoppedRefusal(t, p);
  if (!pauseClosesAt(t.developer, t)) throw seen ? await liftRefusal(testId, p) : new HttpError(409, "not_paused", "That test isn't paused.");
  const from = checkFrom(seen);
  if (from) stopIfChanged("Close now", await testChangesSince(testId, adminId, from, seen?.tab));
  const r = await closePausedTest(testId, "admin", new Date(), adminId);
  if (!r.closed) throw await stoppedRefusal(await db.test.findUniqueOrThrow({ where: { id: testId } }), p); // stopped a moment ago
  return r;
}

/** The daily job: close every paused test whose closure date has come. */
export async function closePausedTests(now = new Date()) {
  const tests = await db.test.findMany({
    where: { status: { in: ["open", "closed"] }, OR: [{ adminPausedAt: { not: null } }, { developer: { OR: [{ holdStartedAt: { not: null } }, { devSuspendedAt: { not: null } }] } }] },
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
export async function extendPauseClosure(testId: string, days: unknown, now = new Date(), adminId: string | null = null, seen: AdminSeen | null = null) {
  const n = days === undefined || days === "" || days === null ? PAUSE_CLOSE_DAYS : Number(days);
  if (!Number.isFinite(n) || n < 1 || n > 90 || Math.floor(n) !== n) throw new HttpError(400, "bad_days", "Enter a whole number of days from 1 to 90.");
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  // (Batch 34 §1) Closed or stopped meanwhile, or no longer paused: refused naming who and when; another admin's change since the page loaded: stops once.
  const p = presserOf(adminId, seen); // (batch 35 §45) this admin's own changes in another tab: "You already …"
  if (t.status === "stopped") throw await stoppedRefusal(t, p);
  const info = pauseClosesAt(t.developer, t);
  if (!info) throw seen ? await liftRefusal(testId, p) : new HttpError(409, "not_paused", "That test isn't paused.");
  const from = checkFrom(seen);
  if (from && adminId) stopIfChanged("Extend", await testChangesSince(testId, adminId, from, seen?.tab));
  const at = new Date(info.at.getTime() + n * DAY);
  await db.test.update({ where: { id: testId }, data: { pauseCloseAt: at, pauseCloseSetAt: now } });
  // (Owner, Nov 6, §299) Like the team's pause: `always` (with email Off too, in the end-of-day email), in the same "Payments and holds" stack.
  await notify(t.developer.email, `“${t.title}” will close later`, [`The team moved the date “${t.title}” closes to ${T(at, "date")} (it stays paused until your account is cleared).`], `/app/tests/${testId}`, { always: true, group: "payhold" });
  return { ok: true, closesAt: at.toISOString() };
}

/** The admin page's list: every paused test with its closure date, soonest first. */
export async function pausedTestsForAdmin() {
  const tests = await db.test.findMany({
    where: { status: { in: ["open", "closed"] }, OR: [{ adminPausedAt: { not: null } }, { developer: { OR: [{ holdStartedAt: { not: null } }, { devSuspendedAt: { not: null } }] } }] },
    include: { developer: true },
  });
  return tests
    .map((t) => ({ test: t, info: pauseClosesAt(t.developer, t)!, dev: displayName(t.developer) }))
    .filter((x) => x.info)
    .sort((a, b) => a.info.at.getTime() - b.info.at.getTime());
}

const day = (d: Date) => T(d, "date"); // (batch 15 section 11) in the reader's own zone

/** What lifts the pause, in the developer's words (an account cause wins over the team's pause). */
function liftsWhen(causes: ReturnType<typeof pauseClosesAt> extends infer R ? (R extends { causes: infer C } ? C : never) : never) {
  if (causes.includes("hold") || causes.includes("chargeback")) return "you pay what you owe";
  if (causes.includes("suspension")) return "your account is cleared";
  return "the team lifts the pause";
}

/**
 * (Owner, Nov 6, §310b) "closes on <date> unless <what lifts it>": the paused line's own words, in the team pause's line ("The team paused “…”: it closes on
 * … unless the team lifts the pause"), so the two read the same. Null when the test isn't paused.
 */
export function closesUnless(dev: Parameters<typeof pauseClosesAt>[0], test: Parameters<typeof pauseClosesAt>[1]) {
  const info = pauseClosesAt(dev, test);
  return info ? `closes on ${day(info.at)} unless ${liftsWhen(info.causes)}` : null;
}

/** (§313a) How many test names a line lists before "and N more" (like the other lines that list names). */
const NAMES_SHOWN = 5;
/**
 * (Owner, Nov 6, §313a) The developer's paused tests and when each closes, for the ONE line a hold or a suspension starts with (it replaces the per-test "<test> is
 * paused and closes on <date> unless …" lines): "“Harbor Run” and “Sky Lab” close on Nov 13"; different dates, grouped by day in date order: "“Harbor Run” closes on
 * Nov 13, “Sky Lab” on Nov 15"; over 5 names: the first 5, then "and N more". Null when none of their tests is paused (the line reads as before, without dates).
 */
export async function pausedClosingWords(devId: string): Promise<string | null> {
  const dev = await db.user.findUnique({ where: { id: devId } });
  if (!dev) return null;
  const rows: { title: string; at: Date }[] = [];
  for (const t of await db.test.findMany({ where: { developerId: devId, status: { in: ["open", "closed"] } }, orderBy: { createdAt: "asc" } })) {
    const info = pauseClosesAt(dev, t);
    if (info) rows.push({ title: t.title, at: info.at });
  }
  if (!rows.length) return null;
  const tz = dev.timeZone;
  const groups: { at: Date; titles: string[] }[] = [];
  for (const r of [...rows].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const g = groups.find((x) => dayIn(x.at, tz) === dayIn(r.at, tz));
    if (g) g.titles.push(r.title);
    else groups.push({ at: r.at, titles: [r.title] });
  }
  // (Owner, Nov 6, §313a) Names past the 5th are counted where their date is: "“T1”, “T2”, “T3”, “T4”, “T5” and 2 more close on Nov 13"; a later date with no
  // name left reads "…, and 3 more on Nov 20" (several such dates: "…, and 4 more by Nov 22").
  let left = NAMES_SHOWN;
  const parts: string[] = [];
  const hidden: { n: number; at: Date }[] = [];
  for (const [i, g] of groups.entries()) {
    const shown = g.titles.slice(0, Math.max(0, left)).map((x) => `“${x}”`);
    left -= shown.length;
    const rest = g.titles.length - shown.length;
    if (!shown.length) {
      hidden.push({ n: rest, at: g.at });
      continue;
    }
    const verb = i === 0 ? (g.titles.length === 1 ? " closes" : " close") : "";
    const names = rest ? `${shown.join(", ")} and ${rest} more` : andList(shown);
    parts.push(`${names}${verb} on ${day(g.at)}`);
  }
  const n = hidden.reduce((a, h) => a + h.n, 0);
  const tail = !hidden.length ? "" : hidden.length === 1 ? `${n} more on ${day(hidden[0].at)}` : `${n} more by ${day(hidden[hidden.length - 1].at)}`;
  return tail ? `${parts.join(", ")}, and ${tail}` : parts.join(", ");
}

/** (Owner, Nov 6, §316) The hold reminder's one key: a Weekly or Monthly email shows only its newest copy; once a day per developer (holdReminders). */
export const HOLD_REMINDER_KEY = "holdreminder";
/**
 * (Owner, Nov 6, §316) The developer on a HOLD (a payment hold or a chargeback hold; not a suspension, not the team's pause) gets ONE reminder a day, from the
 * first daily job on a later day than the hold started (never the same day as the hold's own line), until the hold lifts or every paused test has closed:
 * "Reminder: your tests are paused until you pay what you owe: “Harbor Run” and “Sky Lab” close on Nov 13" / "Reminder: your tests are paused after a chargeback:
 * … unless you finish the steps" (the dates in §313a's words). In "Payments and holds", emailed whatever the setting. Returns how many were sent.
 */
export async function holdReminders(now = new Date()) {
  let n = 0;
  for (const dev of await db.user.findMany({ where: { holdStartedAt: { not: null }, deletedAt: null }, take: 5000 })) {
    if (dayIn(dev.holdStartedAt!, dev.timeZone) === dayIn(now, dev.timeZone)) continue; // the hold's own line said it today
    const last = await db.notification.findFirst({ where: { userId: dev.id, reminderKey: HOLD_REMINDER_KEY }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (last && dayIn(last.createdAt, dev.timeZone) === dayIn(now, dev.timeZone)) continue; // once a day
    const closing = await pausedClosingWords(dev.id);
    if (!closing) continue; // every paused test has closed
    const cb = dev.holdReason === "chargeback";
    const line = cb ? `Reminder: your tests are paused after a chargeback: ${closing} unless you finish the steps` : `Reminder: your tests are paused until you pay what you owe: ${closing}`;
    await notify(dev.email, line, [`${line}.`], cb ? "/app/payments#chargeback-steps" : "/app/payments#owed", { side: "developer", always: true, payment: true, group: "payhold", reminder: HOLD_REMINDER_KEY });
    n++;
  }
  return n;
}
