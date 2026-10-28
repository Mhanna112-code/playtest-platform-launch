import { db } from "@/lib/db";
import { displayName, fmtDateTime, fmtTime } from "@/lib/format";
import { stopMomentLine, type TestEventLike } from "@/lib/rules";
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
  return { kind: "stop", text: stopMomentLine("tester", kind, c.endedAt, { dev: displayName(c.test.developer), tester: displayName(c.tester) }, fmtTime, fmtDateTime, now), createdAt: c.endedAt };
}

/** The stop a developer's page opened before it hasn't shown: the test stopping or closing, or (with `contractId`) that tester's work ended early. */
export async function devStopSince(testId: string, contractId: string | null, loaded: Date | null, now = new Date()): Promise<TestEventLike | null> {
  if (!loaded) return null;
  const t = await db.test.findUnique({ where: { id: testId }, select: { status: true, stoppedAt: true, adminStoppedAt: true, pauseClosedAt: true } });
  if (!t) return null;
  if (t.status === "stopped" && t.stoppedAt && t.stoppedAt > loaded) {
    const kind = t.pauseClosedAt ? "closed" : t.adminStoppedAt ? "team" : "dev";
    return { kind: "stop", text: stopMomentLine("developer", kind, t.stoppedAt, { dev: "", tester: "" }, fmtTime, fmtDateTime, now), createdAt: t.stoppedAt };
  }
  if (!contractId) return null;
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true } });
  if (!c || c.testId !== testId || c.status !== "ended" || c.endKind !== "early" || !c.endedAt || c.endedAt <= loaded) return null;
  return { kind: "stop", text: stopMomentLine("developer", "early", c.endedAt, { dev: "", tester: displayName(c.tester) }, fmtTime, fmtDateTime, now), createdAt: c.endedAt };
}

/** The stop box itself (the same shape as every stop-once box). */
export function stopBox(lines: TestEventLike[], extra: Record<string, unknown> = {}): never {
  throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: lines.map((e) => ({ text: e.text, at: e.createdAt })), tail: "Press again to go ahead.", ...extra });
}
