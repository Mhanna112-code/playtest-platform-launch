import { db } from "@/lib/db";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { HttpError } from "./http";

// (Owner, Oct 30, batch 34 §1) Two admins on the same account, test, hold or outage. Every admin press sends its page time (`since`: when the row, the profile's
// state or the Preview was read, server time). When another admin changed the same thing since then and the press is still possible, it stops ONCE in the blue box
// ("Your Delete account didn't go through. Since this page loaded: bo@… reinstated the tester side at 12:19 AM. Press Delete account again to go ahead."); the
// second press (confirmed, with the box's time) goes ahead unless something newer happened. A press that is no longer possible is a plain refusal naming who and
// when ("That test was already paused (by bo@… at 12:19 AM).").
// (Owner, Oct 31, batch 35 §45) The admin's OWN changes made in another tab or page since this page's time count too, in the second person: the stop line "You
// paused this test in another tab at 3:20 AM.", the refusal "You already paused this test in another tab at 3:20 AM.". A change made from this same page load
// never stops its own presses. Other admins' wording is unchanged.

/** What an admin's press was made on: the page's time, and on the second press of a stop, the box's; (batch 35 §45) the page load (tab) it came from. */
export type AdminSeen = { since: Date; confirmed: boolean; boxAt: Date | null; tab?: string };
const dateOf = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : null;
};
/** (Batch 35 §51) The press's page load: its per-load id (x-load), else (an older page) its tab's id. */
export const tabOf = (body: Record<string, unknown> | null | undefined) =>
  body && typeof body.load === "string" && body.load ? body.load.slice(0, 64) : body && typeof body.tab === "string" ? body.tab.slice(0, 64) : "";
/** The page time a press sent (`since`), with its second-press marks; null for a press without one (an API call, an older page): it goes ahead as before. */
export function adminSeen(body: Record<string, unknown>): AdminSeen | null {
  const since = dateOf(body.since);
  return since ? { since, confirmed: body.confirmed === true, boxAt: dateOf(body.boxAt), tab: tabOf(body) } : null;
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

// ---------- (Batch 35 §45) which page load made a change ----------
// Every admin press that goes through leaves a marker: an ActionLog row ("test" ADMIN_TABS, so no test page reads it; no new column) with the press's tab (the
// page load's id, which every press sends as x-tab) and the time the press started, written once the press is done. Every row the press wrote (its admin
// action, an account event) lies between the two times, so a change belongs to a page load when one of its markers spans the change's time.
// (Owner, Oct 31, batch 35 §51) The marker's `tab` is the press's PAGE load (x-load: the tab's id plus a part for each page drawn in it), so a change made in the
// same browser tab before a reload or before moving to another page is not "this page's own": a page that didn't show it stops once ("You … in another tab at …").

/** The ActionLog "test" of the admin press markers: never a real test id. */
export const ADMIN_TABS = "admin-tab";
// ---------- (Batch 35 §49) each admin action's reason, kept with its own event ----------
// A Pause's or a Stop's reason is an ActionLog row ("test" ADMIN_NOTES, so no test page reads it; no new column) keyed by the event's id (`tab`): the admin Timeline
// quotes the event's own reason, never the test's latest note (a Stop right after a Pause no longer lends the pause its reason).

/** The ActionLog "test" of the admin reasons: never a real test id. */
export const ADMIN_NOTES = "admin-note";
type NoteTx = { actionLog: { create: (a: { data: { userId: string; testId: string; tab: string; text: string } }) => Promise<unknown> } };
/** Keep the reason ("" for none) with the event it belongs to. */
export const keepNote = (tx: NoteTx, eventId: string, adminId: string | null | undefined, note: string) =>
  tx.actionLog.create({ data: { userId: adminId ?? "", testId: ADMIN_NOTES, tab: eventId, text: note } });
/** The reasons kept with these events (an event missing here is older: it has none of its own). */
export async function notesOf(eventIds: string[]) {
  if (!eventIds.length) return new Map<string, string>();
  const rows = await db.actionLog.findMany({ where: { testId: ADMIN_NOTES, tab: { in: eventIds } }, select: { tab: true, text: true } });
  return new Map(rows.map((r) => [r.tab, r.text]));
}

/** Who presses, from which page load ("" when the press can't say: then only other admins' changes count, as before). */
export type Presser = { adminId: string; tab: string };
/** The presser of a press: the admin and the tab its body (or its AdminSeen) carries. */
export const presserOf = (adminId: string | null | undefined, from: { tab?: unknown } | null | undefined): Presser | null =>
  adminId ? { adminId, tab: tabOf(from as Record<string, unknown> | null) } : null;
/** A press that went through: its marker (from `start` to now) for this admin and page load. */
export async function markPress(adminId: string, tab: string, start: Date) {
  if (!tab) return;
  await db.actionLog.create({ data: { userId: adminId, testId: ADMIN_TABS, tab: tab.slice(0, 64), text: start.toISOString(), createdAt: new Date() } }).catch(() => null);
}
/** Whether a press from this page load made the change at `at`. */
async function madeHere(p: Presser, at: Date) {
  const marks = await db.actionLog.findMany({ where: { userId: p.adminId, testId: ADMIN_TABS, tab: p.tab, createdAt: { gte: at } }, orderBy: { createdAt: "asc" }, take: 10, select: { text: true } });
  return marks.some((m) => new Date(m.text).getTime() <= at.getTime());
}
/**
 * Whose change (made by `byId` at `at`) it is for this press: null (another admin's, or the app's); "here" (this page load's own, or the presser's from a press
 * that can't say its page); "other" (the presser's own, in another tab or page).
 */
export async function ownChange(p: Presser | null, byId: string | null | undefined, at: Date): Promise<"here" | "other" | null> {
  if (!p || !byId || byId !== p.adminId) return null;
  if (!p.tab) return "here";
  return (await madeHere(p, at)) ? "here" : "other";
}
/** The stop line for the presser's own change in another tab: "You paused this test in another tab at 3:20 AM." */
export const youLine = (what: string, at: Date) => `You ${what} in another tab at ${whenText(at)}.`;
/** A refusal for the presser's own change: "You already paused this test in another tab at 3:20 AM." ("… at 3:20 AM." when this page did it). */
export const youAlready = (what: string, where: "here" | "other", at: Date) => `You already ${what}${where === "other" ? " in another tab" : ""} at ${whenText(at)}.`;
/**
 * A refusal's line: `theirs(email)` for another admin (as before: "That test was already paused (by bo@… at 12:19 AM)."), or "You already <mine> in another tab at
 * 3:20 AM." for the presser's own change.
 */
export async function alreadyLine(p: Presser | null, byId: string | null | undefined, at: Date, theirs: (who: string) => string, mine: string, none = "the team") {
  const own = await ownChange(p, byId, at);
  return own ? youAlready(mine, own, at) : theirs(await adminEmail(byId, none));
}

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
/** (Batch 35 §45) The same, said to the admin who did them in another tab ("You paused this test in another tab at 3:20 AM."). */
const TEST_YOU: Record<string, string> = {
  "pause-test": "paused this test",
  "unpause-test": "lifted the pause on this test",
  "stop-test": "stopped this test",
  "extend-pause": "extended this test's closing date",
  "close-paused": "closed this test",
  "allow-critical-changes": "allowed 3 more changes of this test's locked fields",
  "team-close": "closed this test's open reviews for $0",
};
/** The admin actions on a chargeback hold (target: the developer). */
const HOLD_ACTIONS: Record<string, string> = {
  "approve-chargeback": "approved lifting the hold",
  "decline-chargeback": "didn't approve lifting the hold (the reservation was released)",
};
const HOLD_YOU = HOLD_ACTIONS;

async function actionLines(targetId: string, adminId: string, from: Date, said: Record<string, string>, you: Record<string, string>, tab = ""): Promise<RaceLine[]> {
  const p: Presser = { adminId, tab };
  // (Batch 35 §45) With the press's page load known, the admin's own changes from another tab count too; without it, only other admins' (as before).
  const rows = await db.adminAction.findMany({ where: { targetId, action: { in: Object.keys(said) }, createdAt: { gt: from }, ...(tab ? {} : { adminId: { not: adminId } }) }, orderBy: { createdAt: "asc" }, take: 20 });
  const out: RaceLine[] = [];
  for (const r of rows) {
    const own = await ownChange(p, r.adminId, r.createdAt);
    if (own === "here") continue; // this page's own press never stops it
    out.push({ text: own ? youLine(you[r.action], r.createdAt) : `${await adminEmail(r.adminId)} ${said[r.action]} at ${whenText(r.createdAt)}.`, at: r.createdAt });
  }
  return out;
}

/** Another admin's (or, batch 35 §45, this admin's in another tab) changes to this test since `from` (pause, lift, stop, extend, close now, allow changes, the $0 close-out). */
export const testChangesSince = (testId: string, adminId: string, from: Date, tab = "") => actionLines(testId, adminId, from, TEST_ACTIONS, TEST_YOU, tab);
/** Another admin's (or this admin's in another tab) Approve or Don't approve on this developer's chargeback hold since `from`. */
export const holdChangesSince = (devId: string, adminId: string, from: Date, tab = "") => actionLines(devId, adminId, from, HOLD_ACTIONS, HOLD_YOU, tab);

export type AccountKind = "suspended" | "reinstated" | "team-closed" | "hold-approved";
const sidePart = (side: string) => (side === "developer" || side === "tester" ? `the ${side} side` : "the account");
/**
 * Another admin's (or the app's) changes to this account since `from`, from its history: suspensions, reinstatements, $0 close-outs, hold approvals. (Batch 35 §45)
 * With the press's tab: this admin's own changes from another tab too ("You suspended the developer side in another tab at 3:20 AM.").
 */
export async function accountChangesSince(userId: string, adminId: string, from: Date, kinds: AccountKind[], tab = ""): Promise<RaceLine[]> {
  const p: Presser = { adminId, tab };
  const rows = await db.accountEvent.findMany({ where: { userId, kind: { in: kinds }, createdAt: { gt: from }, ...(tab ? {} : { OR: [{ byId: null }, { byId: { not: adminId } }] }) }, orderBy: { createdAt: "asc" }, take: 20 });
  const out: RaceLine[] = [];
  for (const e of rows) {
    const own = await ownChange(p, e.byId, e.createdAt);
    if (own === "here") continue; // this page's own press
    const what =
      e.kind === "suspended" ? `suspended ${sidePart(e.side)}`
      : e.kind === "reinstated" ? `reinstated ${sidePart(e.side)}`
      : e.kind === "team-closed" ? `closed ${/^(\d+ open reviews?) closed for \$0/.exec(e.note)?.[1] ?? "open reviews"} for $0`
      : "approved lifting the hold";
    out.push({ text: own ? youLine(what, e.createdAt) : `${await adminEmail(e.byId, "the team")} ${what} at ${whenText(e.createdAt)}.`, at: e.createdAt });
  }
  return out;
}

// ---------- presses that are no longer possible ----------

type TestState = { id: string; status: string; stoppedAt: Date | null; adminStoppedAt: Date | null; adminStoppedById: string | null; pauseClosedAt: Date | null; developerId: string };
/**
 * "That test was already stopped (by bo@… at 12:19 AM)." / "…already closed (by …)" (closed after 7 days paused, or Close now). (Batch 35 §45) The presser's own:
 * "You already stopped this test in another tab at 3:20 AM."
 */
export async function stoppedRefusal(t: TestState, p: Presser | null = null) {
  const closed = !!t.pauseClosedAt;
  const at = t.adminStoppedAt ?? t.pauseClosedAt ?? t.stoppedAt ?? new Date();
  const word = closed ? "closed" : "stopped";
  if (t.adminStoppedById) return new HttpError(409, "stopped", await alreadyLine(p, t.adminStoppedById, at, (who) => `That test was already ${word} ${byAt(who, at)}.`, `${word} this test`));
  let who: string;
  if (closed) who = "the app"; // closed after 7 days paused
  else who = (await db.user.findUnique({ where: { id: t.developerId }, select: { email: true } }))?.email ?? "its developer";
  return new HttpError(409, "stopped", `That test was already ${word} ${byAt(who, at)}.`);
}

/** "That test was already paused (by bo@… at 12:19 AM)." (Batch 35 §45) The presser's own: "You already paused this test in another tab at 3:20 AM." */
export async function pausedRefusal(t: { adminPausedAt: Date | null; adminPausedById: string | null }, p: Presser | null = null) {
  const at = t.adminPausedAt ?? new Date();
  return new HttpError(409, "already", await alreadyLine(p, t.adminPausedById, at, (who) => `That test was already paused ${byAt(who, at)}.`, "paused this test"));
}

/**
 * (Owner, Oct 29, batch 22 section 5) Why Lift the pause (or Extend / Close now on a test no longer paused) can't go through: the pause was lifted already (by whom and
 * when), the test was stopped or closed (by whom and when: batch 34), or the test is paused only by the developer's account state (a hold or a suspension, which admins
 * don't lift here). (Batch 35 §45) The presser's own lift: "You already lifted the pause on this test in another tab at 3:20 AM."
 */
export async function liftRefusal(testId: string, p: Presser | null = null) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  if (t.status === "stopped") return stoppedRefusal(t, p);
  const last = await db.adminAction.findFirst({ where: { targetId: testId, action: "unpause-test" }, orderBy: { createdAt: "desc" } });
  if (last) return new HttpError(409, "pause_lifted", await alreadyLine(p, last.adminId, last.createdAt, (who) => `That test's pause was already lifted ${byAt(who, last.createdAt)}.`, "lifted the pause on this test", "an admin (deleted)"));
  if (t.developer.holdStartedAt || t.developer.devSuspendedAt) return new HttpError(409, "pause_lifted", "That test isn't paused by the team: it's paused by the developer's account state.");
  return new HttpError(409, "pause_lifted", "That test isn't paused.");
}

/** The last admin action of these kinds on this target (who and when), or null. */
export const lastAction = (targetId: string, actions: string[]) => db.adminAction.findFirst({ where: { targetId, action: { in: actions } }, orderBy: { createdAt: "desc" } });
