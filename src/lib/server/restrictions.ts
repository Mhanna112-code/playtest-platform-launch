import { db } from "@/lib/db";
import { PAYOUT_LINE } from "@/lib/payout";
import { displayName } from "@/lib/format";
import { callCancelledLine } from "@/lib/rules";
import { HttpError } from "./http";
import { bell, notify } from "./notify";
import { cancelCallsAhead, recordEvent, spotOpened, tellCancelled } from "./tests";
import { closeRequests } from "./requests";
import { chargeDeferred, resumeTests } from "./holds";
import { sendWaitingTransfer } from "./stripe";

// (Design doc 2 and 11.4) Suspensions and deletion.
//   Developer suspended: all their tests are paused (testers stay in them but can't do anything except send work, Let it go, Leave,
//   chat and Rate); calls starting within 3 days of the suspension (or while it lasts) are cancelled with no fault; they can only Pay
//   (from Payments) and cancel booked calls, and appeal through Contact us. Lifted: the tests resume as normal.
//   Tester suspended: removed from every test at once (their work stays and is reviewed; the pay is charged but their share is held
//   until reinstatement). Reinstated: re-invited to tests that are open with spots and not invite only; the others wait with a
//   "Suspended" label and Ask to rejoin.

const DAY = 86_400_000;
export const CALL_SUSPENSION_DAYS = 3;

/** Calls starting within the next 3 days of a suspended developer are cancelled with no fault (both sides told). */
export async function cancelCallsNearSuspension(devId: string, now = new Date()) {
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

/** The daily job: later calls of a suspended developer are cancelled once the suspension is still in force 3 days before them. */
export async function cancelLateSuspensionCalls(now = new Date()) {
  let n = 0;
  for (const u of await db.user.findMany({ where: { suspendedAt: { not: null }, isDeveloper: true }, select: { id: true } })) n += await cancelCallsNearSuspension(u.id, now);
  return n;
}

async function pauseDeveloper(u: { id: string; email: string }) {
  const tests = await db.test.findMany({ where: { developerId: u.id, status: { in: ["open", "closed", "draft"] } }, select: { id: true } });
  const contractIds = (await db.contract.findMany({ where: { test: { developerId: u.id } }, select: { id: true } })).map((c) => c.id);
  await closeRequests({ contractIds }, "the test is paused");
  for (const t of tests) await db.$transaction((tx) => recordEvent(tx, t.id, "paused", "Your account is paused", false));
  await cancelCallsNearSuspension(u.id);
  await (await import("./pauseClosure")).bellPausedTests(u.id);
}

async function removeTester(u: { id: string; name: string; email: string; pronoun: string }, kind: "suspended" | "deleted") {
  const contracts = await db.contract.findMany({ where: { testerId: u.id, status: "working" }, include: { test: { include: { developer: true } } } });
  for (const c of contracts) {
    const cancelled = await db.$transaction(async (tx) => {
      await tx.contract.update({ where: { id: c.id }, data: { status: "left", endKind: kind, endedAt: new Date() } });
      const list = await cancelCallsAhead(tx, [c.id], `${displayName(u)} left the test.`);
      await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the tester left", decidedAt: new Date() } });
      // Developers only ever see "left" (never why).
      await recordEvent(tx, c.testId, "left", `${displayName(u)} left the test`, true, {}, c.id);
      return list;
    });
    await tellCancelled(cancelled, "ended");
    await notify(c.test.developer.email, `${displayName(u)} left “${c.title}”`, [`${displayName(u)} left your test “${c.title}”. Work they already sent still waits for your review.`], `/app/tests/${c.testId}#tester-${c.id}`, { about: u.id });
    await spotOpened(c.testId);
  }
  await db.application.updateMany({ where: { testerId: u.id, status: "pending" }, data: { status: "withdrawn", decidedAt: new Date() } });
}

/** Admin: suspend an account (developer side, tester side, or both). */
export async function suspendAccount(adminId: string, userId: string, note: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new HttpError(404, "not_found", "That account doesn't exist.");
  if (u.suspendedAt) throw new HttpError(409, "already", "That account is already suspended.");
  if (u.deletedAt) throw new HttpError(409, "deleted", "That account was deleted.");
  await db.user.update({ where: { id: userId }, data: { suspendedAt: new Date(), suspendNote: note, suspendedById: adminId, reinstatedAt: null } });
  if (u.isDeveloper) await pauseDeveloper(u);
  if (u.isTester) await removeTester(u, "suspended");
  await notify(u.email, "Your account is paused", ["Your account is paused. Contact us in Settings if you think this is a mistake."], "/app/help", { always: true, own: true });
  return { ok: true };
}

/** The held shares of a tester whose pay was charged during a suspension: sent now, or kept waiting for a payout account. */
export async function releaseHeldShares(testerId: string, ids?: string[]) {
  const held = await db.payment.findMany({ where: { testerId, transferStatus: "held", ...(ids ? { id: { in: ids } } : {}) } });
  let sent = 0;
  for (const p of held) {
    await db.payment.update({ where: { id: p.id }, data: { transferStatus: "waiting" } });
    try {
      await sendWaitingTransfer(p.id);
      sent++;
    } catch {
      // no payout account yet (or Stripe is off): it waits like any other share
    }
  }
  return { released: held.length, sent };
}

/** (11.4) Re-invite a reinstated tester to the tests they were removed from that are open with spots and not invite only. */
async function reinviteAfterSuspension(u: { id: string; email: string; name: string }) {
  const removed = await db.contract.findMany({ where: { testerId: u.id, status: "left", endKind: "suspended" }, include: { test: { include: { developer: true } } } });
  const invited: string[] = [];
  for (const c of removed) {
    const t = c.test;
    const testersIn = await db.contract.count({ where: { testId: t.id, status: "working" } });
    const blocked = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: u.id }] } })) > 0;
    const open = t.status === "open" && (!t.openUntil || t.openUntil > new Date()) && testersIn < t.spots && t.joinMode !== "invite" && !t.developer.suspendedAt && !t.developer.holdStartedAt && !t.adminPausedAt && !blocked;
    if (!open) continue;
    if (await db.invite.count({ where: { testId: t.id, testerId: u.id, status: "sent" } })) continue;
    await db.invite.create({ data: { testId: t.id, testerId: u.id } });
    invited.push(t.title);
    await notify(u.email, `You're invited back to “${t.title}”`, [`You're invited back to “${t.title}”. Open it and press Join.`], `/app/find/${t.id}`);
  }
  return invited;
}

/** Admin: lift a suspension. */
export async function reinstateAccount(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new HttpError(404, "not_found", "That account doesn't exist.");
  if (!u.suspendedAt) throw new HttpError(409, "not_suspended", "That account isn't suspended.");
  const start = u.suspendedAt, now = new Date();
  await db.user.update({ where: { id: userId }, data: { suspendedAt: null, suspendNote: "", suspendedById: null, reinstatedAt: now } });
  if (u.isDeveloper) {
    await db.$transaction((tx) => resumeTests(tx, userId, start, now));
    if (!u.holdStartedAt) await chargeDeferred(userId);
    const testers = await db.contract.findMany({ where: { status: "working", test: { developerId: userId } }, include: { tester: true } });
    for (const c of testers) await notify(c.tester.email, `“${c.title}” is running again`, [`“${c.title}” is running again. Your deadline moved on by the pause.`], `/app/sessions/${c.id}`, { about: userId, group: "paused" });
  }
  if (u.isTester) {
    await reinviteAfterSuspension(u);
    await releaseHeldShares(userId);
  }
  await notify(u.email, "Your account is active again", ["Your account is active again."], "/app", { always: true, own: true });
  return { ok: true };
}

// ---------- deletion ----------

/**
 * (Design doc 11.4) Deleting an account stops its tests, cancels its invites and applications and removes it from the tests it is in.
 * History stays; holds, chargebacks and obligations are never cleared. `by`: "self" | "admin".
 */
export async function deleteAccount(userId: string, by: "self" | "admin", reason = "") {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new HttpError(404, "not_found", "That account doesn't exist.");
  if (u.deletedAt) throw new HttpError(409, "deleted", "That account was already deleted.");
  await db.user.update({ where: { id: userId }, data: { deletedAt: new Date(), deletedBy: by, deleteReason: reason.slice(0, 500) } });
  await db.invite.updateMany({ where: { testerId: userId, status: "sent" }, data: { status: "cancelled" } });
  if (u.isDeveloper) {
    const tests = await db.test.findMany({ where: { developerId: userId, status: { not: "stopped" } } });
    for (const t of tests) {
      const cs = await db.contract.findMany({ where: { testId: t.id, status: "working" }, include: { tester: true } });
      const cancelled = await db.$transaction(async (tx) => {
        await tx.contract.updateMany({ where: { testId: t.id, status: "working" }, data: { status: "ended", endKind: "stopped", endedAt: new Date(), endReason: "The test was stopped." } });
        const list = await cancelCallsAhead(tx, cs.map((c) => c.id), "The test was stopped.");
        await tx.callRequest.updateMany({ where: { contractId: { in: cs.map((c) => c.id) }, status: "pending" }, data: { status: "closed", closedReason: "the test was stopped", decidedAt: new Date() } });
        await tx.invite.updateMany({ where: { testId: t.id, status: "sent" }, data: { status: "cancelled" } });
        await tx.application.updateMany({ where: { testId: t.id, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: new Date() } });
        await recordEvent(tx, t.id, "stopped", "The test was stopped", true, { status: "stopped", stoppedAt: new Date() });
        return list;
      });
      await tellCancelled(cancelled, "stopped");
      for (const c of cs) await notify(c.tester.email, `“${c.title}” was stopped`, [`“${c.title}” was stopped. Work you already sent is still reviewed and paid. Calls ahead are cancelled.`], `/app/sessions/${c.id}`, { own: true });
    }
  }
  if (u.isTester) await removeTester(u, "deleted");
  return { ok: true };
}

/** A reminder every day to the admins to review suspended accounts: one line covering all of them (the daily job). */
export async function suspendedAccountsReminder(now = new Date()) {
  const state = await db.appState.findUnique({ where: { key: "suspended-reminder" } });
  if (state && now.getTime() - new Date(state.value).getTime() < DAY - 3_600_000) return 0; // (Owner, Oct 26) daily, one line for all suspended accounts
  const people = await db.user.findMany({ where: { suspendedAt: { not: null }, deletedAt: null }, select: { email: true, name: true, suspendedAt: true } });
  if (!people.length) return 0;
  const admins = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const admin = await db.user.findMany({ where: { OR: [{ isAdmin: true }, { email: { in: admins } }] }, select: { id: true } });
  for (const a of admin) await bell(a.id, `${people.length} suspended account${people.length === 1 ? "" : "s"} to review`, "/admin#users");
  await db.appState.upsert({ where: { key: "suspended-reminder" }, update: { value: now.toISOString() }, create: { key: "suspended-reminder", value: now.toISOString() } });
  return people.length;
}

// ---------- the team pausing or stopping one test (design doc 6 and 10) ----------

/** Admin: pause one test. It behaves like a stop for the developer, who can only stop it; testers see it as paused. */
export async function pauseTest(adminId: string, testId: string, note: string) {
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  if (t.status === "stopped") throw new HttpError(409, "stopped", "That test was stopped.");
  if (t.adminPausedAt) throw new HttpError(409, "already", "That test is already paused.");
  await db.$transaction((tx) => recordEvent(tx, testId, "paused", "The team paused this test", true, { adminPausedAt: new Date(), adminNote: note, adminPausedById: adminId }));
  await closeRequests({ contractIds: (await db.contract.findMany({ where: { testId }, select: { id: true } })).map((c) => c.id) }, "the test is paused");
  const dev = await db.user.findUniqueOrThrow({ where: { id: t.developerId } });
  await (await import("./pauseClosure")).bellPausedTests(dev.id);
  await notify(dev.email, `The team paused “${t.title}”`, [`The team paused “${t.title}”${note ? `: ${note}` : "."} You can only stop it for now.`, "Contact us in Settings if you think this is a mistake."], `/app/tests/${testId}`, { always: true, group: "team" });
  return { ok: true };
}

export async function unpauseTest(testId: string) {
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t?.adminPausedAt) throw new HttpError(409, "not_paused", "That test isn't paused by the team.");
  const start = t.adminPausedAt, now = new Date();
  const gap = now.getTime() - start.getTime();
  await db.$transaction(async (tx) => {
    await tx.test.update({ where: { id: testId }, data: { adminPausedAt: null, adminNote: "", ...(t.openUntil ? { openUntil: new Date(t.openUntil.getTime() + gap) } : {}) } });
    for (const c of await tx.contract.findMany({ where: { testId, status: "working" } })) await tx.contract.update({ where: { id: c.id }, data: { dueAt: new Date(c.dueAt.getTime() + gap) } });
    await recordEvent(tx, testId, "resumed", "The team lifted the pause on this test", true);
  });
  const dev = await db.user.findUniqueOrThrow({ where: { id: t.developerId } });
  await notify(dev.email, `The team lifted the pause on “${t.title}”`, [`The team lifted the pause on “${t.title}”: it is running again.`], `/app/tests/${testId}`, { own: true });
  return { ok: true };
}

/** Admin: stop one test for good (what was sent still waits to be paid or rejected). */
export async function adminStopTest(testId: string, note: string, adminId: string | null = null) {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  if (t.status === "stopped") throw new HttpError(409, "stopped", "That test was already stopped.");
  const cs = await db.contract.findMany({ where: { testId, status: "working" }, include: { tester: true } });
  const cancelled = await db.$transaction(async (tx) => {
    await tx.contract.updateMany({ where: { testId, status: "working" }, data: { status: "ended", endKind: "stopped", endedAt: new Date(), endReason: "The test was stopped." } });
    const list = await cancelCallsAhead(tx, cs.map((c) => c.id), "The test was stopped.");
    await tx.callRequest.updateMany({ where: { contractId: { in: cs.map((c) => c.id) }, status: "pending" }, data: { status: "closed", closedReason: "the test was stopped", decidedAt: new Date() } });
    await tx.invite.updateMany({ where: { testId, status: "sent" }, data: { status: "cancelled" } });
    await tx.application.updateMany({ where: { testId, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: new Date() } });
    await recordEvent(tx, testId, "admin", "The team stopped this test", true, { status: "stopped", stoppedAt: new Date(), adminStoppedAt: new Date(), adminNote: note, adminStoppedById: adminId });
    return list;
  });
  await tellCancelled(cancelled, "stopped");
  for (const c of cs) await notify(c.tester.email, `“${c.title}” was stopped`, [`“${c.title}” was stopped. Work you already sent is still reviewed and paid. Calls ahead are cancelled.`], `/app/sessions/${c.id}`, { own: true });
  await notify(t.developer.email, `The team stopped “${t.title}”`, [`The team stopped “${t.title}”${note ? `: ${note}` : "."}`, "What testers sent still waits for you to pay or reject. Contact us in Settings if you think this is a mistake."], `/app/tests/${testId}`, { always: true, group: "team" });
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
    lines.push(`Removed from ${s(contracts, "test")}; ${s(calls, "booked call")} cancelled; later pay is charged to the developer but the share is held.`);
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
    await bell(u.id, PAYOUT_LINE, "/app/payments#payout", undefined, { payment: true, group: "payout" });
    await db.user.update({ where: { id: u.id }, data: { payoutRemindedAt: now } });
  }
  return due.length;
}
