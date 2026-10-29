import { db } from "@/lib/db";
import { displayName, fmtDateTimeIn, fmtTimeIn } from "@/lib/format";
import { pauseMomentLine, stopMomentLine, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { seenOf } from "./live";

/**
 * (Owner, Oct 28, batch 17 section 12) "Stops" = the developer's Stop, the team's Stop, the test closing (7 days paused, or Close now) and End early for that tester,
 * all treated alike. The next Charge / Let it go (tester), Pay / Pay more (developer) or Rate (both) on a page opened BEFORE the stop stops once with the stop as the
 * change; the second press (its stop box shown after the stop) goes ahead. Dispute, the developer's side of a dispute and excerpts never stop for it.
 */

/** When the page was loaded, as this press knows it: the stop box's time on a second press, else the page's render. null = an old client that sent no page time (no stop). */
export function loadedOf(body: Record<string, unknown>) {
  const boxAt = seenOf(body.boxAt);
  if (body.confirmed === true) return boxAt ?? null;
  return seenOf(body.pageSeenAt) ?? seenOf(body.seenAt);
}

/** The stop a tester's page opened before it hasn't shown (null: none, or the page was opened after it). */
export async function testerStopSince(contractId: string, loaded: Date | null, now = new Date()): Promise<TestEventLike | null> {
  if (!loaded) return null;
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
  if (!c || c.status !== "ended" || !c.endedAt || c.endedAt <= loaded) return null;
  const kind = c.endKind === "closed" ? "closed" : c.endKind === "early" ? "early" : c.endKind === "stopped" ? (c.test.adminStoppedAt ? "team" : "dev") : null;
  if (!kind) return null;
  // (Batch 26 section 3) The time in the tester's own zone; a team Stop never names who stopped it ("This test was stopped at 3:10 PM.").
  const tz = c.tester.timeZone;
  return { kind: "stop", text: stopMomentLine("tester", kind, c.endedAt, { dev: displayName(c.test.developer), tester: displayName(c.tester) }, (d) => fmtTimeIn(d, tz), (d) => fmtDateTimeIn(d, tz), now), createdAt: c.endedAt };
}

/** The stop a developer's page opened before it hasn't shown: the test stopping or closing, or (with `contractId`) that tester's work ended early. */
export async function devStopSince(testId: string, contractId: string | null, loaded: Date | null, now = new Date()): Promise<TestEventLike | null> {
  if (!loaded) return null;
  const t = await db.test.findUnique({ where: { id: testId }, select: { status: true, stoppedAt: true, adminStoppedAt: true, pauseClosedAt: true, developer: { select: { timeZone: true } } } });
  if (!t) return null;
  // (Batch 26 section 4) The time in the developer's own zone.
  const tz = t.developer.timeZone;
  const time = (d: Date) => fmtTimeIn(d, tz), dateTime = (d: Date) => fmtDateTimeIn(d, tz);
  if (t.status === "stopped" && t.stoppedAt && t.stoppedAt > loaded) {
    const kind = t.pauseClosedAt ? "closed" : t.adminStoppedAt ? "team" : "dev";
    return { kind: "stop", text: stopMomentLine("developer", kind, t.stoppedAt, { dev: "", tester: "" }, time, dateTime, now), createdAt: t.stoppedAt };
  }
  if (!contractId) return null;
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true } });
  if (!c || c.testId !== testId || c.status !== "ended" || c.endKind !== "early" || !c.endedAt || c.endedAt <= loaded) return null;
  return { kind: "stop", text: stopMomentLine("developer", "early", c.endedAt, { dev: "", tester: displayName(c.tester) }, time, dateTime, now), createdAt: c.endedAt };
}

/**
 * (Owner, Oct 29, batch 29 section 11) A pause the developer's page opened before it hasn't shown: the team's pause of this test, or the developer's hold or suspension
 * (whichever began first after the page loaded and still holds). Like a stop, it stops the next press once ("The team paused this test at 3:10 PM."); the second goes ahead.
 */
export async function devPauseSince(testId: string, loaded: Date | null, now = new Date()): Promise<TestEventLike | null> {
  if (!loaded) return null;
  const t = await db.test.findUnique({ where: { id: testId }, select: { adminPausedAt: true, developer: { select: { timeZone: true, holdStartedAt: true, devSuspendedAt: true } } } });
  if (!t) return null;
  const causes = ([["team", t.adminPausedAt], ["hold", t.developer.holdStartedAt], ["suspended", t.developer.devSuspendedAt]] as const)
    .filter((x): x is readonly ["team" | "hold" | "suspended", Date] => !!x[1] && x[1] > loaded)
    .sort((a, b) => a[1].getTime() - b[1].getTime());
  if (!causes.length) return null;
  const [cause, at] = causes[0];
  const tz = t.developer.timeZone;
  return { kind: "stop", text: pauseMomentLine("developer", cause, at, (d) => fmtTimeIn(d, tz), (d) => fmtDateTimeIn(d, tz), now), createdAt: at };
}

/** (Batch 29 section 11) The same for a tester's page: "This test was paused at 3:10 PM." (testers read only "paused": never why, never "hold" or "suspended"). */
export async function testerPauseSince(contractId: string, loaded: Date | null, now = new Date()): Promise<TestEventLike | null> {
  if (!loaded) return null;
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { tester: { select: { timeZone: true } }, test: { select: { adminPausedAt: true, developer: { select: { holdStartedAt: true, devSuspendedAt: true } } } } } });
  if (!c) return null;
  const at = [c.test.adminPausedAt, c.test.developer.holdStartedAt, c.test.developer.devSuspendedAt].filter((d): d is Date => !!d && d > loaded).sort((a, b) => a.getTime() - b.getTime())[0];
  if (!at) return null;
  const tz = c.tester.timeZone;
  return { kind: "stop", text: pauseMomentLine("tester", "team", at, (d) => fmtTimeIn(d, tz), (d) => fmtDateTimeIn(d, tz), now), createdAt: at };
}

/**
 * The stop box itself (the same shape as every stop-once box). (Batch 26 section 4) A stop line already says its time ("…stopped at 3:10 PM."), so it goes as kind
 * "stop": the box shows it without adding the time again.
 */
export function stopBox(lines: TestEventLike[], extra: Record<string, unknown> = {}): never {
  throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: lines.map((e) => ({ text: e.text, at: e.createdAt, ...(e.kind === "stop" ? { kind: "stop" } : {}) })), tail: "Press again to go ahead.", ...extra });
}
