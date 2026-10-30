import { db } from "@/lib/db";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { HttpError } from "./http";

// (Owner, Oct 30, batch 34 §1) Two admins on the same account, test, hold or outage. Every admin press sends its page time (`since`: when the row, the profile's
// state or the Preview was read, server time). When another admin changed the same thing since then and the press is still possible, it stops ONCE in the blue box
// ("Your Delete account didn't go through. Since this page loaded: bo@… reinstated the tester side at 12:19 AM. Press Delete account again to go ahead."); the
// second press (confirmed, with the box's time) goes ahead unless something newer happened. A press that is no longer possible is a plain refusal naming who and
// when ("That test was already paused (by bo@… at 12:19 AM).").

/** What an admin's press was made on: the page's time, and on the second press of a stop, the box's. */
export type AdminSeen = { since: Date; confirmed: boolean; boxAt: Date | null };
const dateOf = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : null;
};
/** The page time a press sent (`since`), with its second-press marks; null for a press without one (an API call, an older page): it goes ahead as before. */
export function adminSeen(body: Record<string, unknown>): AdminSeen | null {
  const since = dateOf(body.since);
  return since ? { since, confirmed: body.confirmed === true, boxAt: dateOf(body.boxAt) } : null;
}
/** From when a press looks for other admins' changes: the page's time; on the second press the box's (none: it goes ahead). */
export const checkFrom = (s: AdminSeen | null) => (!s ? null : s.confirmed ? s.boxAt : s.since);

/** An admin by email, as admin views name them ("an admin (deleted)" once that account is gone); `none` when nobody is named. */
export async function adminEmail(id: string | null | undefined, none = "the team") {
  if (!id) return none;
  const x = await db.user.findUnique({ where: { id }, select: { email: true, deletedAt: true } });
  return !x || x.deletedAt ? "an admin (deleted)" : x.email;
}
/** A time in a refusal or a stop line: the time alone within a day, else the day too. */
export const whenText = (d: Date, now = new Date()) => (now.getTime() - d.getTime() < 20 * 3_600_000 ? fmtTime(d) : fmtDateTime(d));
/** "(by bo@… at 12:19 AM)" */
export const byAt = (who: string, at: Date) => `(by ${who} at ${whenText(at)})`;

export type RaceLine = { text: string; at: Date };

/** The second press stops again only for what is newer than the box: the stop itself. */
export function stopIfChanged(press: string, lines: RaceLine[]) {
  if (!lines.length) return;
  throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: lines.map((l) => ({ text: l.text, at: l.at.toISOString(), kind: "stop" })), press });
}

// ---------- what changed, as the stop box lists it ----------

/** The admin actions on a test, as a stop line says them ("bo@… lifted the pause at 12:19 AM."). */
const TEST_ACTIONS: Record<string, string> = {
  "pause-test": "paused the test",
  "unpause-test": "lifted the pause",
  "stop-test": "stopped the test",
  "extend-pause": "extended the closing date",
  "close-paused": "closed the test",
  "allow-critical-changes": "allowed 3 more changes of the locked fields",
  "team-close": "closed the test's open reviews for $0",
};
/** The admin actions on a chargeback hold (target: the developer). */
const HOLD_ACTIONS: Record<string, string> = {
  "approve-chargeback": "approved lifting the hold",
  "decline-chargeback": "didn't approve lifting the hold (the reservation was released)",
};

async function actionLines(targetId: string, adminId: string, from: Date, said: Record<string, string>): Promise<RaceLine[]> {
  const rows = await db.adminAction.findMany({ where: { targetId, action: { in: Object.keys(said) }, createdAt: { gt: from }, adminId: { not: adminId } }, orderBy: { createdAt: "asc" }, take: 20 });
  const out: RaceLine[] = [];
  for (const r of rows) out.push({ text: `${await adminEmail(r.adminId)} ${said[r.action]} at ${whenText(r.createdAt)}.`, at: r.createdAt });
  return out;
}

/** Another admin's changes to this test since `from` (pause, lift, stop, extend, close now, allow changes, the $0 close-out). */
export const testChangesSince = (testId: string, adminId: string, from: Date) => actionLines(testId, adminId, from, TEST_ACTIONS);
/** Another admin's Approve or Don't approve on this developer's chargeback hold since `from`. */
export const holdChangesSince = (devId: string, adminId: string, from: Date) => actionLines(devId, adminId, from, HOLD_ACTIONS);

export type AccountKind = "suspended" | "reinstated" | "team-closed" | "hold-approved";
const sidePart = (side: string) => (side === "developer" || side === "tester" ? `the ${side} side` : "the account");
/** Another admin's (or the app's) changes to this account since `from`, from its history: suspensions, reinstatements, $0 close-outs, hold approvals. */
export async function accountChangesSince(userId: string, adminId: string, from: Date, kinds: AccountKind[]): Promise<RaceLine[]> {
  const rows = await db.accountEvent.findMany({ where: { userId, kind: { in: kinds }, createdAt: { gt: from }, OR: [{ byId: null }, { byId: { not: adminId } }] }, orderBy: { createdAt: "asc" }, take: 20 });
  const out: RaceLine[] = [];
  for (const e of rows) {
    const who = await adminEmail(e.byId, "the team");
    const at = whenText(e.createdAt);
    const what =
      e.kind === "suspended" ? `suspended ${sidePart(e.side)}`
      : e.kind === "reinstated" ? `reinstated ${sidePart(e.side)}`
      : e.kind === "team-closed" ? `closed ${/^(\d+ open reviews?) closed for \$0/.exec(e.note)?.[1] ?? "open reviews"} for $0`
      : "approved lifting the hold";
    out.push({ text: `${who} ${what} at ${at}.`, at: e.createdAt });
  }
  return out;
}

// ---------- presses that are no longer possible ----------

type TestState = { id: string; status: string; stoppedAt: Date | null; adminStoppedAt: Date | null; adminStoppedById: string | null; pauseClosedAt: Date | null; developerId: string };
/** "That test was already stopped (by bo@… at 12:19 AM)." / "…already closed (by …)" (closed after 7 days paused, or Close now). */
export async function stoppedRefusal(t: TestState) {
  const closed = !!t.pauseClosedAt;
  const at = t.adminStoppedAt ?? t.pauseClosedAt ?? t.stoppedAt ?? new Date();
  let who: string;
  if (t.adminStoppedById) who = await adminEmail(t.adminStoppedById);
  else if (closed) who = "the app"; // closed after 7 days paused
  else who = (await db.user.findUnique({ where: { id: t.developerId }, select: { email: true } }))?.email ?? "its developer";
  return new HttpError(409, "stopped", `That test was already ${closed ? "closed" : "stopped"} ${byAt(who, at)}.`);
}

/** "That test was already paused (by bo@… at 12:19 AM)." */
export async function pausedRefusal(t: { adminPausedAt: Date | null; adminPausedById: string | null }) {
  return new HttpError(409, "already", `That test was already paused ${byAt(await adminEmail(t.adminPausedById), t.adminPausedAt ?? new Date())}.`);
}

/**
 * (Owner, Oct 29, batch 22 section 5) Why Lift the pause (or Extend / Close now on a test no longer paused) can't go through: the pause was lifted already (by whom and
 * when), the test was stopped or closed (by whom and when: batch 34), or the test is paused only by the developer's account state (a hold or a suspension, which admins
 * don't lift here).
 */
export async function liftRefusal(testId: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  if (t.status === "stopped") return stoppedRefusal(t);
  const last = await db.adminAction.findFirst({ where: { targetId: testId, action: "unpause-test" }, orderBy: { createdAt: "desc" } });
  if (last) return new HttpError(409, "pause_lifted", `That test's pause was already lifted ${byAt(await adminEmail(last.adminId, "an admin (deleted)"), last.createdAt)}.`);
  if (t.developer.holdStartedAt || t.developer.devSuspendedAt) return new HttpError(409, "pause_lifted", "That test isn't paused by the team: it's paused by the developer's account state.");
  return new HttpError(409, "pause_lifted", "That test isn't paused.");
}

/** The last admin action of these kinds on this target (who and when), or null. */
export const lastAction = (targetId: string, actions: string[]) => db.adminAction.findFirst({ where: { targetId, action: { in: actions } }, orderBy: { createdAt: "desc" } });
