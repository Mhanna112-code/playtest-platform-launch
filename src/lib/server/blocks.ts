import { db } from "@/lib/db";
import { ACCOUNT_WAS_DELETED, displayName, fmtTime } from "@/lib/format";
import { joinCallRefusal, testPaused } from "@/lib/rules";
import { HttpError } from "./http";
import { stoppedPressLine } from "@/lib/refusal";
import { isUniqueClash } from "./passwords";
import { fmtFor } from "@/lib/tz";
import { notify } from "./notify";
import { callClosedLine, callEndState, callLineFor, endIfClosed } from "./calls";
import { answerTermsFirst } from "./terms";
import { CALL_OVER_LINE, END_WARN_MS, endWarnLine } from "@/lib/callMeasure";
import { closeOffersOfEnded } from "./offerClose";

// Block (owner rule): either side can block the other. At once: their sessions together end (sent work stays payable
// and reviewable; disputes still allowed), booked calls between them are cancelled, neither can book or join a call with
// the other, no invites or joins to the blocker's tests, pending applications and rejoin asks between them close (batch 16
// section 11), and chat between them closes. Whoever blocked whom, the tester no longer sees that developer's other tests. Never revealed to the blocked
// person, who only reads neutral lines. Unblock from Account → Blocked people (nothing reopens by itself).

/** Is there a block either way between these two people? */
export async function blockedEitherWay(a: string, b: string, q: Pick<typeof db, "block"> = db) {
  return (await q.block.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) > 0;
}
/** (Owner, Oct 28, batch 16 section 11) The one neutral line for a join, an apply or a rejoin ask across a block (never says why). */
export const NOT_TAKING_LINE = "This test isn't taking new testers right now.";
/** Was this tester part of the test before (a contract, an invite or an application, whatever became of it)? */
export async function wasPartOf(testerId: string, testId: string) {
  const [c, i, a] = await Promise.all([
    db.contract.count({ where: { testId, testerId } }),
    db.invite.count({ where: { testId, testerId } }),
    db.application.count({ where: { testId, testerId } }),
  ]);
  return c + i + a > 0;
}
/**
 * (Batch 16 section 11) A block either way hides that developer's tests the tester was never part of: a direct link reads "This test isn't available
 * right now." (like a paused test for someone not involved). Tests they were part of stay as they are.
 */
export async function hiddenByBlock(testerId: string, t: { id: string; developerId: string }) {
  if (testerId === t.developerId || !(await blockedEitherWay(testerId, t.developerId))) return false;
  return !(await wasPartOf(testerId, t.id));
}
export const iBlocked = async (me: string, other: string, q: Pick<typeof db, "block"> = db) => (await q.block.count({ where: { blockerId: me, blockedId: other } })) > 0;

/** Everyone this user blocked or was blocked by (for hiding tests from Find). */
export async function blockPartners(userId: string) {
  const rows = await db.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
  return rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId));
}

export async function blockUser(me: { id: string; email: string; name: string }, otherId: string, body: Record<string, unknown> = {}) {
  if (!otherId || otherId === me.id) throw new HttpError(400, "bad_user", "Choose someone to block.");
  const other = await db.user.findUnique({ where: { id: otherId } });
  if (!other) throw new HttpError(404, "not_found", "That person doesn't exist.");
  // (Owner, Nov 9, §360) A deleted account (an old profile tab's Block): nothing to block.
  if (other.deletedAt) throw new HttpError(409, "deleted", ACCOUNT_WAS_DELETED);
  // (Owner, Nov 11, §380; replaces Oct 27's refusal) Already blocked: what Block wanted, no refusal, nothing said (Owner, Nov 11, §380 G: no other page reloads or redraws for a Block).
  if (await iBlocked(me.id, otherId)) return { blocked: true, ended: 0, already: true };
  // (Owner, Nov 11, §378; replaces §271 here) Block never stops once: a pause of their test (or the team's lift) since the profile loaded no longer stops it. Only
  // the race refusal above stays (already blocked in another tab). Report keeps its §271 stop.
  // (Owner, Nov 11, §380 F; replaces §157's row-first claim and §375's per-session lock) ONE transaction that first takes the lock of EVERY test either of the two
  // develops (in test-id order, so two Blocks, or a Block and any press, never deadlock), then writes the Block row, ends their sessions and closes their open
  // invites and waiting applications. Every press about the other person checks the block (or the session's end) inside its own test lock, so there are only two
  // orders: the press first (it goes through, then the block), or the block first (the press is refused with its existing line). The row's unique key still
  // settles two Blocks at the same moment: the second is silent.
  await (await import("./raceHold")).raceHold(body); // (§380 F) test-only: the order of a Block and another press
  const now = new Date();
  const include = { tester: true, test: { include: { developer: true } } } as const;
  const between = { OR: [{ testerId: otherId, test: { developerId: me.id } }, { testerId: me.id, test: { developerId: otherId } }] };
  const done = await db.$transaction(async (tx) => {
    const tests = await tx.test.findMany({ where: { developerId: { in: [me.id, otherId] } }, select: { id: true }, orderBy: { id: "asc" } });
    for (const t of tests) await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${t.id} FOR UPDATE`;
    // Then both people's rows (in id order; the direct chat's Send holds its sender's): a direct message is either fully before the block or refused.
    for (const id of [me.id, otherId].sort()) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR NO KEY UPDATE`;
    if (await iBlocked(me.id, otherId, tx)) return null;
    await tx.block.create({ data: { blockerId: me.id, blockedId: otherId } });
    const contracts = await tx.contract.findMany({ where: { status: "working", ...between }, include });
    await tx.contract.updateMany({ where: { id: { in: contracts.map((c) => c.id) }, status: "working" }, data: { status: "ended", endKind: "blocked", endedAt: now, endReason: "" } });
    for (const c of contracts) await (await import("./accessKeys")).releaseTesterKeys(tx, c.id);
    // Calls ahead between them are cancelled in the same step (a Join call or a booking after it reads them cancelled); one in progress ends just after.
    const ahead = await tx.call.findMany({ where: { contractId: { in: contracts.map((c) => c.id) }, status: "booked", startsAt: { gt: now } }, select: { id: true, slotId: true } });
    await tx.call.updateMany({ where: { id: { in: ahead.map((x) => x.id) }, status: "booked" }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: now, cancelNote: "" } });
    await tx.callSlot.updateMany({ where: { id: { in: ahead.map((x) => x.slotId) } }, data: { status: "removed" } });
    const invitesClosed = await (await import("./invites")).openInviteIds(between, tx);
    await tx.invite.updateMany({ where: { id: { in: invitesClosed }, status: "sent" }, data: { status: "cancelled" } });
    // (Owner, Oct 28, batch 16 section 11) Pending applications and rejoin asks between them close, like invites. (Application has no relations: its tests are
    // found by developer.)
    const apps: { id: string; testerId: string; testId: string }[] = [];
    for (const p of [{ tester: otherId, dev: me.id }, { tester: me.id, dev: otherId }]) {
      const theirs = await tx.application.findMany({ where: { status: "pending", testerId: p.tester, testId: { in: (await tx.test.findMany({ where: { developerId: p.dev }, select: { id: true } })).map((t) => t.id) } }, select: { id: true, testerId: true, testId: true } });
      apps.push(...theirs);
    }
    if (apps.length) await tx.application.updateMany({ where: { id: { in: apps.map((a) => a.id) } }, data: { status: "closed", closedReason: "blocked", decidedAt: now } });
    return { contracts, invitesClosed, apps };
  }, { maxWait: 20_000, timeout: 30_000 }).catch((e) => {
    if (isUniqueClash(e)) return null; // (§380) the other Block of the same moment did it: silent
    throw e;
  });
  if (!done) return { blocked: true, ended: 0, already: true };
  const ended = done.contracts;
  for (const c of ended) {
    // (Owner, Oct 29, batch 26 section 2) A call already in progress between them ends at once, on both pages (like a pause, but whether or not they were connected).
    const by = c.testerId === me.id ? "tester" : "developer";
    const { endCallForBlock } = await import("./calls");
    for (const call of await db.call.findMany({ where: { contractId: c.id, status: "booked", startsAt: { lte: now }, endedAt: null, measuredAt: null, actualMinutes: null } })) await endCallForBlock(call.id, by, now);
    // Neutral lines for the blocked side (never "blocked").
    if (c.testerId === otherId) await notify(c.tester.email, `Your session on ${c.test.title} ended.`, [`Your session on ${c.test.title} ended. Work you sent is still reviewed.`], `/app/sessions/${c.id}`);
    else await notify(c.test.developer.email, `${displayName(c.tester)}'s session on ${c.test.title} ended.`, [`${displayName(c.tester)}'s session on ${c.test.title} ended.`], `/app/tests/${c.testId}#tester-${c.id}`);
  }
  await (await import("./requests")).closeRequests({ contractIds: ended.map((c) => c.id) }, "the session ended");
  await closeOffersOfEnded(db, ended.map((c) => c.id), now); // (batch 35 §118) the part ended: its offer closes
  await (await import("./invites")).tellInvitesClosed(done.invitesClosed); // (batch 30 §6) the neutral line (never "blocked")
  // The tester whose application closed reads the neutral line; the developer nothing.
  const titles = new Map((await db.test.findMany({ where: { id: { in: done.apps.map((a) => a.testId) } }, select: { id: true, title: true } })).map((t) => [t.id, t.title]));
  for (const a of done.apps) {
    const tester = await db.user.findUnique({ where: { id: a.testerId }, select: { email: true } });
    const title = titles.get(a.testId) ?? "";
    if (tester) await notify(tester.email, appClosedLine(title), [appClosedLine(title)], `/app/find/${a.testId}`, { testId: a.testId, group: "apps" }); // (batch 29 §23)
  }
  for (const c of ended) await (await import("./tests")).spotOpened(c.testId);
  return { blocked: true, ended: ended.length };
}

/** The tester's line when a block closed their application: "“Harbor Run”: your application was closed." */
export const appClosedLine = (title: string) => `“${title}”: your application was closed.`;

export async function unblockUser(me: { id: string }, otherId: string) {
  await db.block.deleteMany({ where: { blockerId: me.id, blockedId: otherId } });
  return { unblocked: true };
}

/** Join call: the call page (the built-in room) only when the call can be joined now; otherwise the refusal line (shown under Join). */
export async function joinCall(user: { id: string }, callId: string, body: Record<string, unknown> = {}) {
  await (await import("./calls")).sweepNobodyJoined();
  // (Batch 18 section 3; batch 21 section 2) A call the server ended (150%, the $500, or what closed it): Join is refused (and the button goes).
  const own = await db.call.findUnique({ where: { id: callId }, include: { contract: { include: { test: true } } } });
  if (own && (own.contract.testerId === user.id || own.contract.test.developerId === user.id)) await (await import("./workWindow")).finishWorkIfDue(own.contract.testId);
  if (own && (own.contract.testerId === user.id || own.contract.test.developerId === user.id) && ((await callEndState(callId))?.ended || own.endedAt))
    throw new HttpError(409, "cant_join", CALL_OVER_LINE, { cancelled: true, over: true });
  const call = await db.call.findUnique({ where: { id: callId }, include: { slot: true, contract: { include: { test: { include: { developer: true } } } } } });
  const c = call?.contract;
  const side = c?.testerId === user.id ? "tester" : c?.test.developerId === user.id ? "developer" : null;
  if (!call || !c || !side) throw new HttpError(404, "not_found", "That call doesn't exist.");
  const refusal = joinCallRefusal(
    {
      status: call.status, startsAt: call.startsAt, minutes: call.minutes, noShow: !!call.noShowBy, paused: testPaused(c.test.developer, c.test),
      testStatus: c.test.status, contractStatus: c.status, blocked: await blockedEitherWay(c.testerId, c.test.developerId), side,
      // (Batch 35 §162) The developer reads "She left the test." in the tester's pronoun.
      testerPronoun: side === "developer" ? (await db.user.findUnique({ where: { id: c.testerId }, select: { pronoun: true } }))?.pronoun : null,
    },
    new Date(),
    fmtTime,
  );
  // (Owner, Oct 30, batch 15 section 38) A stale Join: "Your Join call didn't go through: Ana cancelled this call at 3:05 PM." (the row then leaves the page).
  if (refusal) {
    const by = call.cancelledBy === "developer" ? displayName(c.test.developer) : call.cancelledBy === "tester" ? displayName(await db.user.findUniqueOrThrow({ where: { id: c.testerId } })) : "";
    const mine = (call.cancelledBy === "developer" && side === "developer") || (call.cancelledBy === "tester" && side === "tester");
    const why = call.status !== "cancelled" ? refusal[0].toLowerCase() + refusal.slice(1).replace(/.$/, "") : by ? `${mine ? "you" : by} cancelled this call${call.cancelledAt ? ` at ${fmtFor(await db.user.findUnique({ where: { id: user.id }, select: { timeZone: true } }), call.cancelledAt, "time")}` : ""}` : call.cancelNote ? `this call was cancelled: ${call.cancelNote.replace(/[.s]+$/, "")}` : "this call was cancelled";
    // (Owner, Nov 9, §363) A stopped test: the one stopped line.
    if (call.status !== "cancelled" && c.test.status === "stopped") throw new HttpError(409, "cant_join", stoppedPressLine("Join call"), { cancelled: false });
    throw new HttpError(409, "cant_join", `Your Join call didn't go through: ${why}.`, { cancelled: call.status === "cancelled" });
  }
  // (Batch 27 section 1) The tester's Join call waits while new terms are open: Switch or Keep first.
  if (side === "tester") await answerTermsFirst(c.id);
  if (side === "developer") {
    const m = await import("./stopMoment");
    m.pauseStopOnce(await m.devPauseMoments(c.testId, m.loadedOf(body)), body);
  }
  // (Batch 21) The room itself records who came in (its first poll); a press alone isn't being in the call.
  return { url: `/app/calls/${call.id}` };
}

/**
 * The call page's status check (and the Join button's and the presence line's): "" while the room can be used; otherwise the line that replaces it ("This call was
 * cancelled.", "Call ended: …", the closed-to-joins line). (Batch 21 section 2) `warn`: "This call ends at 3:42 PM." from 2 minutes before a planned end.
 */
export async function callStatus(user: { id: string }, callId: string) {
  const call = await db.call.findUnique({ where: { id: callId }, include: { contract: { include: { test: { include: { developer: true } } } } } });
  const c = call?.contract;
  if (!call || !c || (c.testerId !== user.id && c.test.developerId !== user.id)) throw new HttpError(404, "not_found", "That call doesn't exist.");
  // Where the call stands against its planned end, or what closed it (this check also ends it at that moment).
  const closedNow = call.status === "booked" && (await endIfClosed(callId));
  const state = call.status === "cancelled" ? null : await callEndState(callId);
  const fresh = state?.ended || closedNow ? await db.call.findUniqueOrThrow({ where: { id: callId } }) : call;
  const both = call.devJoinedAt && call.testerJoinedAt ? new Date(Math.max(call.devJoinedAt.getTime(), call.testerJoinedAt.getTime())) : null;
  const amTester = c.testerId === user.id;
  const tester = amTester ? null : await db.user.findUnique({ where: { id: c.testerId }, select: { name: true, email: true, pronoun: true, deletedAt: true } });
  // (Owner, Nov 9, §360) A deleted account reads "Deleted account" here too.
  const otherName = amTester ? displayName(c.test.developer) : tester ? displayName(tester) : "";
  const tz = await db.user.findUnique({ where: { id: user.id }, select: { timeZone: true } });
  const side = amTester ? "tester" : "developer";
  const closed = fresh.status === "booked" && !fresh.endedAt && !fresh.measuredAt ? await callClosedLine(call, side) : "";
  const line = callLineFor({ ...fresh, contract: { ...c, ...(tester ? { tester: { pronoun: tester.pronoun } } : {}) } }, side, otherName, tz, closed);
  const now = Date.now();
  const capLine = !line && state && !state.ended && state.together && state.endsAt.getTime() - now <= END_WARN_MS ? endWarnLine(fmtFor(tz, state.endsAt, "time")) : "";
  return {
    line, capLine, capped: !!(fresh.endedAt || fresh.cappedAt), ended: !!(fresh.endedAt || fresh.cappedAt || fresh.measuredAt), cancelled: call.status === "cancelled", bothJoinedAt: both, startsAt: call.startsAt, minutes: call.minutes,
    other: { name: otherName, joinedAt: amTester ? call.devJoinedAt : call.testerJoinedAt },
    meJoinedAt: amTester ? call.testerJoinedAt : call.devJoinedAt,
  };
}
