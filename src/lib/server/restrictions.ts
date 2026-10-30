import { db } from "@/lib/db";
import { PAYOUT_LINE, payoutWaitLine } from "@/lib/payout";
import { displayName, fmtDateTime, fmtTime, money } from "@/lib/format";
import { callCancelledLine } from "@/lib/rules";
import { HttpError } from "./http";
import { adminUsers, bell, notify } from "./notify";
import { cancelCallsAhead, recordEvent, spotOpened, tellCancelled } from "./tests";
import { closeRequests } from "./requests";
import { chargeDeferred, markPaused, resumeTests, shiftAfterPause } from "./holds";
import { accountEvent } from "./reports";

// (Design doc 2 and 11.4; owner, Oct 27) Suspensions and deletion.
//   Developer suspended (or on a payment / chargeback hold: ONE state, see lib/restricted.ts): all their tests are paused (testers stay in them; (owner, Oct 28 afternoon) under
//   every kind of pause testers can't send work or chat, and can still save drafts, charge or let go, dispute, rate, leave and cancel calls: rules.ts PAUSE_DEFAULTS); every press on
//   the developer's pages is refused except Cancel call; calls starting within 3 days of the start are cancelled with no fault, later ones 3 days before they start if it still
//   lasts. Invites and applications wait. Lifted: the tests resume as normal.
//   Tester suspended: removed from every test at once (their work stays, is reviewed and, since batch 22, is paid
//   normally: no held shares). Reinstated (owner, Oct 28): no automatic re-invite; the tests they were removed from wait on their dashboard with
//   "You were removed from this test" and Ask to rejoin until they ask or dismiss.

const DAY = 86_400_000;
export const CALL_SUSPENSION_DAYS = 3;

/** Calls starting within the next 3 days of a suspended or held developer are cancelled with no fault (both sides told). */
export async function cancelCallsNearPause(devId: string, now = new Date()) {
  const soon = new Date(now.getTime() + CALL_SUSPENSION_DAYS * DAY);
  const calls = await db.call.findMany({
    where: { status: "booked", startsAt: { gt: now, lte: soon }, contract: { test: { developerId: devId } } },
    include: { contract: { include: { tester: true, test: { include: { developer: true } } } } },
  });
  let n = 0;
  for (const c of calls) {
    const done = await db.call.updateMany({ where: { id: c.id, status: "booked" }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: now, cancelNote: "The test is paused." } });
    if (!done.count) continue;
    await db.callSlot.update({ where: { id: c.slotId }, data: { status: "removed" } }).catch(() => null);
    n++;
    const line = callCancelledLine(c.startsAt, "paused");
    await notify(c.contract.tester.email, line, [line], `/app/sessions/${c.contractId}#call-${c.id}`, { about: c.contract.test.developerId });
    await notify(c.contract.test.developer.email, line.replace("Your call", `Your call with ${displayName(c.contract.tester)}`), [line], `/app/tests/${c.contract.testId}#call-${c.id}`);
  }
  return n;
}
/** @deprecated the old name (suspensions only) */
export const cancelCallsNearSuspension = cancelCallsNearPause;

/** The daily job: later calls of a suspended or held developer are cancelled once the pause is still in force 3 days before them. */
export async function cancelLatePauseCalls(now = new Date()) {
  let n = 0;
  for (const u of await db.user.findMany({ where: { isDeveloper: true, OR: [{ devSuspendedAt: { not: null } }, { holdStartedAt: { not: null } }] }, select: { id: true } })) n += await cancelCallsNearPause(u.id, now);
  return n;
}
export const cancelLateSuspensionCalls = cancelLatePauseCalls;

async function pauseDeveloper(u: { id: string; email: string }) {
  const tests = await db.test.findMany({ where: { developerId: u.id, status: { in: ["open", "closed", "draft"] } }, select: { id: true } });
  const contractIds = (await db.contract.findMany({ where: { test: { developerId: u.id } }, select: { id: true } })).map((c) => c.id);
  await closeRequests({ contractIds }, "the test is paused");
  // (Owner, Oct 28 afternoon) Invites and applications WAIT while the tests are paused: they work again after the lift unless something else closed them.
  for (const t of tests) await db.$transaction((tx) => recordEvent(tx, t.id, "paused", "Your account is paused", false));
  await cancelCallsNearPause(u.id);
  await (await import("./pauseClosure")).bellPausedTests(u.id);
}

async function removeTester(u: { id: string; name: string; email: string; pronoun: string }, kind: "suspended" | "deleted") {
  const contracts = await db.contract.findMany({ where: { testerId: u.id, status: "working" }, include: { test: { include: { developer: true } } } });
  // (Owner, Oct 28, batch 16 section 21) A closed tester account is a tester leaving: the developer's "left" line (Testers leaving in Alerts), never why; a deleted
  // account by the name every other page shows for it, "Deleted account".
  const who = kind === "deleted" ? "Deleted account" : displayName(u);
  for (const c of contracts) {
    const cancelled = await db.$transaction(async (tx) => {
      await tx.contract.update({ where: { id: c.id }, data: { status: "left", endKind: kind, endedAt: new Date() } });
      const list = await cancelCallsAhead(tx, [c.id], `${who} left the test.`);
      await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the tester left", decidedAt: new Date() } });
      // Developers only ever see "left" (never why).
      await recordEvent(tx, c.testId, "left", `${who} left the test`, true, {}, c.id);
      return list;
    });
    await tellCancelled(cancelled, "ended");
    await notify(c.test.developer.email, `${who} left “${c.title}”`, [`${who} left your test “${c.title}”. Work they already sent still waits for your review.`], `/app/tests/${c.testId}#tester-${c.id}`, { about: u.id });
    await spotOpened(c.testId);
  }
  await db.application.updateMany({ where: { testerId: u.id, status: "pending" }, data: { status: "withdrawn", decidedAt: new Date() } });
}

export type SuspendSide = "developer" | "tester";
/** (Batch 15 section 16) The side an admin's Suspend or Reinstate is about: an account with both roles names it; a one-role account has only that side. */
export function sideToSuspend(u: { isDeveloper: boolean; isTester: boolean }, asked: unknown): SuspendSide | null {
  if (asked === "developer" || asked === "tester") return (asked === "developer" ? u.isDeveloper : u.isTester) ? asked : null;
  if (u.isDeveloper && u.isTester) return null; // a mixed account must choose
  return u.isTester ? "tester" : "developer";
}
const sideWord = (s: SuspendSide) => (s === "developer" ? "developer side" : "tester side");
/** "Your developer account is paused" / "Your tester account is paused" (emails and bell, batch 15 section 16). */
export const sidePausedLine = (s: SuspendSide) => `Your ${s} account is paused`;
const fields = (s: SuspendSide) =>
  s === "developer"
    ? ({ at: "devSuspendedAt", note: "devSuspendNote", by: "devSuspendedById", back: "devReinstatedAt" } as const)
    : ({ at: "testerSuspendedAt", note: "testerSuspendNote", by: "testerSuspendedById", back: "testerReinstatedAt" } as const);

// ---------- (Batch 17 §6) The admin's view was older than the change ----------

/** An admin's Suspend / Reinstate / any press on a deleted account (delete wins). */
export const ACCOUNT_DELETED = "That account was deleted.";
/** What the admin's Suspend or Reinstate was pressed on: when their Preview (or else the page, or the list's row) was loaded. */
export type SeenFrom = { since: Date; from: "preview" | "page" };
export function seenFromBody(body: Record<string, unknown>): SeenFrom | null {
  const since = typeof body.since === "string" ? new Date(body.since) : null;
  if (!since || isNaN(since.getTime())) return null;
  return { since, from: body.from === "preview" ? "preview" : "page" };
}
const cap = (s: string) => (s.includes("@") ? s : s.charAt(0).toUpperCase() + s.slice(1)); // an email stays as it is
/** "Since your Preview, bo@… reinstated that account's developer side at Oct 28, 3:10 PM." */
export const changedSinceLine = (from: SeenFrom["from"], who: string, verb: "suspended" | "reinstated", side: SuspendSide, at: Date) =>
  `${from === "preview" ? "Since your Preview" : "Since this page loaded"}, ${who} ${verb} that account's ${sideWord(side)} at ${fmtDateTime(at)}.`;
/** "That account was deleted. bo@… deleted it at Oct 28, 3:10 PM." */
export const deletedSinceLine = (who: string, at: Date) => `${ACCOUNT_DELETED} ${cap(who)} deleted it at ${fmtDateTime(at)}.`;
const emailOf = async (id: string | null | undefined, none: string) => {
  if (!id) return none;
  const x = await db.user.findUnique({ where: { id }, select: { email: true, deletedAt: true } });
  return !x || x.deletedAt ? "an admin (deleted)" : x.email;
};

/** A deleted account refuses Suspend and Reinstate; deleted after the admin's view: the line names who and when. */
async function refuseDeleted(u: { id: string; deletedAt: Date | null; deletedBy: string }, seen: SeenFrom | null) {
  if (!u.deletedAt) return;
  if (!seen || u.deletedAt <= seen.since) throw new HttpError(409, "deleted", ACCOUNT_DELETED);
  const act = u.deletedBy === "admin" ? await db.adminAction.findFirst({ where: { targetId: u.id, action: "delete-account" }, orderBy: { createdAt: "desc" } }) : null;
  throw new HttpError(409, "deleted", deletedSinceLine(u.deletedBy === "self" ? "its owner" : await emailOf(act?.adminId, "an admin"), u.deletedAt));
}

/** Another admin suspended or reinstated this side after the admin's Preview (or page) was loaded: refused, naming who and when. */
// The side's own times (written by this server, like `since`; never the database's clock) say what changed last: a suspension clears the reinstated time.
async function refuseIfChangedSince(adminId: string, userId: string, side: SuspendSide, seen: SeenFrom | null) {
  if (!seen) return;
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) return;
  const f = fields(side);
  const suspendedAt = u[f.at], reinstatedAt = u[f.back];
  if (suspendedAt && suspendedAt > seen.since && u[f.by] !== adminId) throw new HttpError(409, "changed_since", changedSinceLine(seen.from, await emailOf(u[f.by], "the team"), "suspended", side, suspendedAt));
  if (!suspendedAt && reinstatedAt && reinstatedAt > seen.since) {
    const ev = await db.accountEvent.findFirst({ where: { userId, kind: "reinstated", side: side === "developer" ? { in: ["developer", ""] } : "tester" }, orderBy: { createdAt: "desc" } });
    if (ev?.byId !== adminId) throw new HttpError(409, "changed_since", changedSinceLine(seen.from, await emailOf(ev?.byId, "the team"), "reinstated", side, reinstatedAt));
  }
}

/**
 * Admin: suspend ONE side of an account (owner, Oct 30, batch 15 section 16). To suspend both, the admin suspends each side. The developer side: their tests pause,
 * billing pauses (batches 5-12). The tester side: they're removed from every test they're in. The other side keeps working.
 */
export async function suspendAccount(adminId: string, userId: string, note: string, asked?: unknown, seen: SeenFrom | null = null) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new HttpError(404, "not_found", "That account doesn't exist.");
  await refuseDeleted(u, seen);
  const side = sideToSuspend(u, asked) ?? (u.isDeveloper || u.isTester ? null : "developer");
  if (!side) throw new HttpError(400, "choose_side", "Choose the side to suspend: Developer side or Tester side.");
  const f = fields(side);
  // (Batch 17 §6) Pressed on a Preview (or page) older than another admin's change to this side: refused, naming who and when.
  await refuseIfChangedSince(adminId, userId, side, seen);
  // Two admins at once: the second is refused, naming the first (batch 15 section 21). (Batch 17 §6) A Delete at the same moment wins.
  const claimed = await db.user.updateMany({ where: { id: userId, [f.at]: null, deletedAt: null }, data: { [f.at]: new Date(), [f.note]: note, [f.by]: adminId, [f.back]: null } });
  if (claimed.count !== 1) {
    const now = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (now.deletedAt) throw new HttpError(409, "deleted", ACCOUNT_DELETED);
    const by = now[f.by] ? await db.user.findUnique({ where: { id: now[f.by]! }, select: { email: true } }) : null;
    throw new HttpError(409, "already", `That account's ${sideWord(side)} is already suspended${by ? ` (by ${by.email})` : ""}.`);
  }
  await accountEvent(userId, "suspended", adminId, note, side);
  if (side === "developer" && u.isDeveloper) {
    await markPaused({ developerId: userId }); // (batch 9) one clock per paused test
    await pauseDeveloper(u);
    await (await import("./subscription")).pauseBilling(userId);
  }
  if (side === "tester" && u.isTester) await removeTester(u, "suspended");
  await notify(u.email, sidePausedLine(side), [`${sidePausedLine(side)}. Contact us in Settings if you think this is a mistake.`], "/app/help", { always: true, group: "admindecision" });
  return { ok: true, side };
}

/** Admin: lift the suspension of one side (batch 15 section 16). A one-role account, or an account with only one side suspended, needs no side named. */
export async function reinstateAccount(userId: string, asked?: unknown, adminId: string | null = null, seen: SeenFrom | null = null) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new HttpError(404, "not_found", "That account doesn't exist.");
  await refuseDeleted(u, seen); // (Batch 17 §6) delete wins
  const both = !!u.devSuspendedAt && !!u.testerSuspendedAt;
  const side: SuspendSide | null = asked === "developer" || asked === "tester" ? asked : both ? null : u.devSuspendedAt ? "developer" : u.testerSuspendedAt ? "tester" : null;
  if (!side) {
    if (both) throw new HttpError(400, "choose_side", "Choose the side to reinstate: Developer side or Tester side.");
    throw new HttpError(409, "not_suspended", "That account isn't suspended.");
  }
  const f = fields(side);
  if (adminId) await refuseIfChangedSince(adminId, userId, side, seen); // (Batch 17 §6)
  const start = u[f.at], now = new Date();
  // Two admins at once: the second is refused, naming the first.
  // (Batch 17 §6) The lift and its record commit together, so a second admin's refusal can always name who reinstated it.
  const lifted = start
    ? await db.$transaction(async (tx) => {
        const r = await tx.user.updateMany({ where: { id: userId, [f.at]: start }, data: { [f.at]: null, [f.note]: "", [f.by]: null, [f.back]: now } });
        if (r.count === 1) await tx.accountEvent.create({ data: { userId, kind: "reinstated", byId: adminId ?? u[f.by], note: "", side } });
        return r;
      })
    : { count: 0 };
  if (!start || lifted.count !== 1) {
    const ev = await db.accountEvent.findFirst({ where: { userId, kind: "reinstated", side }, orderBy: { createdAt: "desc" } });
    const by = ev?.byId ? await db.user.findUnique({ where: { id: ev.byId }, select: { email: true } }) : null;
    throw new HttpError(409, "not_suspended", `That account's ${sideWord(side)} was already reinstated${by ? ` (by ${by.email})` : ""}.`);
  }
  if (side === "developer" && u.isDeveloper) {
    // (Owner, Oct 28 afternoon, DEFAULT) Deadlines and Open until move on by the pause; a hold still on keeps the tests paused (they resume, and move on the rest, when it lifts).
    const running = await db.$transaction((tx) => resumeTests(tx, userId, start!, now, [u.holdStartedAt]));
    if (!u.holdStartedAt) await chargeDeferred(userId);
    await (await import("./subscription")).resumeBilling(userId, now);
    const testers = await db.contract.findMany({ where: { status: "working", testId: { in: running } }, include: { tester: true } });
    for (const c of testers) await notify(c.tester.email, `“${c.title}” is running again`, [`“${c.title}” is running again. Your deadline moved on by the pause.`], `/app/sessions/${c.id}`, { about: userId, group: "paused" });
  }
  // (Owner, Oct 28) No automatic re-invite: the tests they were removed from wait on their dashboard with "You were removed from this test" and Ask to rejoin
  // (while the test is open, has a spot and isn't paused) until they ask or dismiss; the developer can also invite them again as usual.
  const line = `Your ${side} account is active again`;
  await notify(u.email, line, [`${line}.`], "/app", { always: true, group: "admindecision" });
  return { ok: true, side };
}

// ---------- deletion ----------

/**
 * (Design doc 11.4) Deleting an account stops its tests, cancels its invites and applications and removes it from the tests it is in.
 * History stays; holds, chargebacks and obligations are never cleared. `by`: "self" | "admin".
 * (Owner, Oct 28) A tester: they leave every test, calls ahead are cancelled, invites and applications are cancelled and open disputes are withdrawn; work they sent that
 * isn't paid yet can no longer be paid, charged or disputed (delayed payments still reach their Stripe account when the developer pays).
 * (Owner, Oct 29, batch 12 section 1) A developer can always delete their own account: parts already open to charging stay open, work under review never opens Charge,
 * open disputes are still decided, and what they owe stays owed.
 */
export async function deleteAccount(userId: string, by: "self" | "admin", reason = "") {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new HttpError(404, "not_found", "That account doesn't exist.");
  if (u.deletedAt) throw new HttpError(409, "deleted", "That account was already deleted.");
  // (Owner, Oct 29, batch 12 section 1) A developer can always delete their account (the warning lists what is left; nothing blocks it).
  // (Batch 8) The subscription ends at once, with no refund.
  if (u.isDeveloper) await (await import("./subscription")).endOnDelete(userId);
  await db.user.update({ where: { id: userId }, data: { deletedAt: new Date(), deletedBy: by, deleteReason: reason } });
  await db.invite.updateMany({ where: { testerId: userId, status: "sent" }, data: { status: "cancelled" } });
  if (u.isDeveloper) {
    const tests = await db.test.findMany({ where: { developerId: userId, status: { not: "stopped" } } });
    for (const t of tests) {
      const cs = await db.contract.findMany({ where: { testId: t.id, status: "working" }, include: { tester: true } });
      let invitesClosed: string[] = [];
      const cancelled = await db.$transaction(async (tx) => {
        invitesClosed = await (await import("./invites")).openInviteIds({ testId: t.id }, tx);
        await tx.contract.updateMany({ where: { testId: t.id, status: "working" }, data: { status: "ended", endKind: "stopped", endedAt: new Date(), endReason: "The test was stopped." } });
        const list = await cancelCallsAhead(tx, cs.map((c) => c.id), "The test was stopped.");
        await tx.callRequest.updateMany({ where: { contractId: { in: cs.map((c) => c.id) }, status: "pending" }, data: { status: "closed", closedReason: "the test was stopped", decidedAt: new Date() } });
        await tx.invite.updateMany({ where: { testId: t.id, status: "sent" }, data: { status: "cancelled" } });
        await tx.application.updateMany({ where: { testId: t.id, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: new Date() } });
        await recordEvent(tx, t.id, "stopped", "The test was stopped", true, { status: "stopped", stoppedAt: new Date() });
        return list;
      });
      await tellCancelled(cancelled, "stopped");
      await (await import("./invites")).tellInvitesClosed(invitesClosed); // (batch 30 §6)
      for (const c of cs) await notify(c.tester.email, `“${c.title}” was stopped`, [`“${c.title}” was stopped. Work you already sent is still reviewed and paid. Calls ahead are cancelled.`], `/app/sessions/${c.id}`, { group: "tstopped" });
    }
  }
  if (u.isTester) {
    await removeTester(u, "deleted");
    // (Owner, Oct 28) Open disputes are withdrawn.
    await db.dispute.updateMany({ where: { testerId: userId, status: "open" }, data: { status: "withdrawn" } });
  }
  // (Owner, Oct 29, batch 13) A tester's excerpt requests and shown excerpts are removed; a developer's pending requests close (shown excerpts stay).
  await (await import("./excerpts")).excerptsOnDelete(userId);
  return { ok: true };
}

/** (Owner, Oct 26-27) A reminder every DAY to the admins to review suspended accounts: one line covering all of them (the daily job). Deleted admins get nothing. */
export async function suspendedAccountsReminder(now = new Date()) {
  const state = await db.appState.findUnique({ where: { key: "suspended-reminder" } });
  if (state && now.getTime() - new Date(state.value).getTime() < DAY - 3_600_000) return 0; // daily, one line for all suspended accounts
  // (Batch 15 section 16) Each suspended SIDE counts.
  const people = await db.user.findMany({ where: { OR: [{ devSuspendedAt: { not: null } }, { testerSuspendedAt: { not: null } }], deletedAt: null }, select: { devSuspendedAt: true, testerSuspendedAt: true } });
  if (!people.length) return 0;
  const sides = people.reduce((n, p) => n + (p.devSuspendedAt ? 1 : 0) + (p.testerSuspendedAt ? 1 : 0), 0);
  for (const a of await adminUsers()) await bell(a.id, `${sides} suspended account side${sides === 1 ? "" : "s"} to review`, "/admin#suspensions", undefined, { group: "suspendedreview", reminder: "suspended-review" });
  await db.appState.upsert({ where: { key: "suspended-reminder" }, update: { value: now.toISOString() }, create: { key: "suspended-reminder", value: now.toISOString() } });
  return sides;
}

// ---------- the team pausing or stopping one test (design doc 6 and 10) ----------

/** Admin: pause one test. The developer can stop it, end testers' work early or cancel calls (batch 15 sections 23 and 37); testers see it as paused. */
export async function pauseTest(adminId: string, testId: string, note: string) {
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  if (t.status === "stopped") throw new HttpError(409, "stopped", "That test was stopped.");
  if (t.adminPausedAt) throw new HttpError(409, "already", "That test is already paused.");
  await markPaused({ id: testId }); // (batch 9) one clock per paused test: kept if a hold or suspension already paused it
  await db.$transaction((tx) => recordEvent(tx, testId, "paused", "The team paused this test", true, { adminPausedAt: new Date(), adminNote: note, adminPausedById: adminId }));
  await closeRequests({ contractIds: (await db.contract.findMany({ where: { testId }, select: { id: true } })).map((c) => c.id) }, "the test is paused");
  const dev = await db.user.findUniqueOrThrow({ where: { id: t.developerId } });
  await (await import("./pauseClosure")).bellPausedTests(dev.id);
  // (Batch 15 section 20) Never the note in the bell line: it says what happened; the note is on the test page and in the email.
  await notify(dev.email, `The team paused “${t.title}”`, [`The team paused “${t.title}”${note ? `: ${note}` : "."} For now you can stop it, end testers' work early, or cancel calls.`, "Contact us in Settings if you think this is a mistake."], `/app/tests/${testId}`, { always: true, group: "payhold" }); // (batch 29 §33) in the day's "Payments and holds" entry with the hold lines
  return { ok: true };
}

/**
 * (Owner, Oct 29, batch 22 section 5) Why Lift the pause can't go through: the pause was lifted already (by whom and when), the test closed (when), or the test is
 * paused only by the developer's account state (a hold or a suspension, which admins don't lift here).
 */
async function liftRefusal(testId: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  if (t.status === "stopped") return new HttpError(409, "pause_lifted", `That test's pause was already lifted when it closed at ${fmtDateTime(t.pauseClosedAt ?? t.stoppedAt ?? t.adminStoppedAt ?? new Date())}.`);
  const last = await db.adminAction.findFirst({ where: { targetId: testId, action: "unpause-test" }, orderBy: { createdAt: "desc" } });
  if (last) {
    const by = await db.user.findUnique({ where: { id: last.adminId }, select: { email: true, deletedAt: true } });
    return new HttpError(409, "pause_lifted", `That test's pause was already lifted (by ${!by || by.deletedAt ? "an admin (deleted)" : by.email} at ${fmtTime(last.createdAt)}).`);
  }
  if (t.developer.holdStartedAt || t.developer.devSuspendedAt) return new HttpError(409, "pause_lifted", "That test isn't paused by the team: it's paused by the developer's account state.");
  return new HttpError(409, "pause_lifted", "That test isn't paused.");
}

/** Admin: lift the team's pause. Two admins at once: the first lifts it (its admin action is kept with it), the second is refused naming them. */
export async function unpauseTest(testId: string, adminId: string | null = null) {
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  if (!t.adminPausedAt || t.status === "stopped") throw await liftRefusal(testId);
  const start = t.adminPausedAt, now = new Date();
  const dev = await db.user.findUniqueOrThrow({ where: { id: t.developerId } });
  const lifted = await db.$transaction(async (tx) => {
    const claimed = await tx.test.updateMany({ where: { id: testId, adminPausedAt: start, status: { not: "stopped" } }, data: { adminPausedAt: null, adminNote: "", ...(dev.holdStartedAt || dev.devSuspendedAt ? {} : { pausedSince: null }) } });
    if (claimed.count !== 1) return false;
    // (Owner, Oct 28 afternoon, DEFAULT) The same clock shift as a hold lift or a reinstatement (only the part not covered by the developer's own pause, if one is still on).
    await shiftAfterPause(tx, t, start, now, [dev.holdStartedAt, dev.devSuspendedAt]);
    await recordEvent(tx, testId, "resumed", "The team lifted the pause on this test", true);
    if (adminId) await tx.adminAction.create({ data: { adminId, action: "unpause-test", targetId: testId } });
    return true;
  });
  if (!lifted) throw await liftRefusal(testId);
  await notify(dev.email, `The team lifted the pause on “${t.title}”`, [`The team lifted the pause on “${t.title}”: it is running again.`], `/app/tests/${testId}`, { own: true });
  return { ok: true };
}

/** Admin: stop one test for good (what was sent still waits to be paid or rejected). */
export async function adminStopTest(testId: string, note: string, adminId: string | null = null) {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  if (t.status === "stopped") throw new HttpError(409, "stopped", "This test was already stopped.");
  let cs: Awaited<ReturnType<typeof db.contract.findMany<{ include: { tester: true } }>>> = [];
  let invitesClosed: string[] = [];
  const cancelled = await db.$transaction(async (tx) => {
    // (Batch 15 section 35) The same test lock as the developer's Stop: a developer Stop and an admin Stop at once can't both run; the second is refused.
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const now = await tx.test.findUniqueOrThrow({ where: { id: testId }, select: { status: true } });
    if (now.status === "stopped") throw new HttpError(409, "stopped", "This test was already stopped.");
    cs = await tx.contract.findMany({ where: { testId, status: "working" }, include: { tester: true } });
    invitesClosed = await (await import("./invites")).openInviteIds({ testId }, tx);
    await tx.contract.updateMany({ where: { testId, status: "working" }, data: { status: "ended", endKind: "stopped", endedAt: new Date(), endReason: "The test was stopped." } });
    const list = await cancelCallsAhead(tx, cs.map((c) => c.id), "The test was stopped.");
    await tx.callRequest.updateMany({ where: { contractId: { in: cs.map((c) => c.id) }, status: "pending" }, data: { status: "closed", closedReason: "the test was stopped", decidedAt: new Date() } });
    await tx.invite.updateMany({ where: { testId, status: "sent" }, data: { status: "cancelled" } });
    await tx.application.updateMany({ where: { testId, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: new Date() } });
    // (Owner, Oct 28) Not an "admin decision" stop-once: a stopped test always refuses what it does not allow, and Pay / Reject carry on without stopping for it.
    await recordEvent(tx, testId, "stopped", "The team stopped this test", true, { status: "stopped", stoppedAt: new Date(), adminStoppedAt: new Date(), adminNote: note, adminStoppedById: adminId });
    return list;
  });
  await tellCancelled(cancelled, "stopped");
  await (await import("./invites")).tellInvitesClosed(invitesClosed); // (batch 30 §6) never who
  for (const c of cs) await notify(c.tester.email, `“${c.title}” was stopped`, [`“${c.title}” was stopped. Work you already sent is still reviewed and paid. Calls ahead are cancelled.`], `/app/sessions/${c.id}`, { group: "tstopped" });
  await notify(t.developer.email, `The team stopped “${t.title}”`, [`The team stopped “${t.title}”${note ? `: ${note}` : "."}`, "What testers sent still waits for you to pay. Contact us in Settings if you think this is a mistake."], `/app/tests/${testId}`, { always: true, group: "payhold" }); // (batch 29 §33) in the day's "Payments and holds" entry with the hold lines
  return { ok: true };
}

/** What suspending an account would do right now (the admin's preview before pressing Suspend). */
export async function previewSuspension(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new HttpError(404, "not_found", "That account doesn't exist.");
  const soon = new Date(Date.now() + CALL_SUSPENSION_DAYS * DAY);
  const lines: string[] = [];
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (u.isDeveloper) {
    const tests = await db.test.count({ where: { developerId: userId, status: { in: ["open", "closed", "draft"] } } });
    const testers = await db.contract.count({ where: { status: "working", test: { developerId: userId } } });
    const calls = await db.call.count({ where: { status: "booked", startsAt: { gt: new Date(), lte: soon }, contract: { test: { developerId: userId } } } });
    const later = await db.call.count({ where: { status: "booked", startsAt: { gt: soon }, contract: { test: { developerId: userId } } } });
    lines.push(`${s(tests, "test")} paused with ${s(testers, "working tester")}; ${s(calls, "call")} in the next 3 days cancelled; ${s(later, "later call")} cancelled if the suspension lasts.`);
  }
  if (u.isTester) {
    const contracts = await db.contract.count({ where: { testerId: userId, status: "working" } });
    const calls = await db.call.count({ where: { status: "booked", startsAt: { gt: new Date() }, contract: { testerId: userId } } });
    lines.push(`Removed from ${s(contracts, "test")}; ${s(calls, "booked call")} cancelled; pay for work they sent still reaches them.`); // (batch 22: no held shares)
  }
  if (!lines.length) lines.push("This account has no developer or tester side yet: nothing else changes.");
  return { lines };
}

// ---------- payout problems (design doc 9) ----------

const REMIND_DAYS = 3;

/** Stripe says a payout failed (or the payout account needs attention): the tester gets the banner and a bell now, then every 3 days until fixed. */
export async function payoutProblem(accountId: string, now = new Date()) {
  const u = await db.user.findUnique({ where: { stripeAccountId: accountId } });
  if (!u) return false;
  if (!u.payoutProblemAt) {
    await db.user.update({ where: { id: u.id }, data: { payoutProblemAt: now, payoutRemindedAt: now } });
    await bell(u.id, PAYOUT_LINE, "/app/payments#payout", undefined, { payment: true, group: "payout" });
  }
  return true;
}

/** The payout works again: the banner and the reminders stop (the money stayed in their Stripe balance). */
export async function payoutFixed(accountId: string) {
  await db.user.updateMany({ where: { stripeAccountId: accountId, payoutProblemAt: { not: null } }, data: { payoutProblemAt: null, payoutRemindedAt: null } });
}

/** The daily job: a bell reminder every 3 days until the payout is fixed. */
export async function payoutReminders(now = new Date()) {
  const due = await db.user.findMany({ where: { payoutProblemAt: { not: null }, OR: [{ payoutRemindedAt: null }, { payoutRemindedAt: { lt: new Date(now.getTime() - REMIND_DAYS * DAY + 3_600_000) } }] } });
  for (const u of due) {
    await bell(u.id, PAYOUT_LINE, "/app/payments#payout", undefined, { payment: true, group: "payout", reminder: "payout" });
    await db.user.update({ where: { id: u.id }, data: { payoutRemindedAt: now } });
  }
  return due.length;
}

/**
 * (Owner, Oct 29, batch 32 §1) Money waiting for a tester's payout setup: a bell line (and the payment email) as soon as a share waits, then every 3 days until
 * the setup is done ("$8.00 is waiting for you: finish your payout setup to receive it."). Runs with the sweep; the last line's time is its reminder key's.
 */
export async function payoutWaitReminders(now = new Date()) {
  const rows = await db.payment.groupBy({ by: ["testerId"], where: { transferStatus: "waiting", status: "charged", testerCents: { gt: 0 }, kind: { not: "subscription" } }, _sum: { testerCents: true } });
  if (!rows.length) return 0;
  const people = await db.user.findMany({ where: { id: { in: rows.map((r) => r.testerId) }, deletedAt: null, NOT: { payoutsReady: true, stripeAccountId: { not: null } } }, select: { id: true } });
  const since = new Date(now.getTime() - REMIND_DAYS * DAY + 3_600_000);
  const recent = new Set((await db.notification.findMany({ where: { userId: { in: people.map((u) => u.id) }, reminderKey: "payoutwait", createdAt: { gt: since } }, select: { userId: true } })).map((n) => n.userId));
  let n = 0;
  for (const u of people) {
    if (recent.has(u.id)) continue;
    const cents = rows.find((r) => r.testerId === u.id)?._sum.testerCents ?? 0;
    await bell(u.id, payoutWaitLine(money(cents)), "/app/payments#payout", undefined, { payment: true, group: "payout", reminder: "payoutwait" });
    n++;
  }
  return n;
}
