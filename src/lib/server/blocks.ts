import { db } from "@/lib/db";
import { displayName, fmtTime } from "@/lib/format";
import { joinCallRefusal, testPaused } from "@/lib/rules";
import { HttpError } from "./http";
import { fmtFor } from "@/lib/tz";
import { notify } from "./notify";
import { callClosedLine, callEndState, callLineFor, endIfClosed } from "./calls";
import { answerTermsFirst } from "./terms";
import { CALL_OVER_LINE, END_WARN_MS, endWarnLine } from "@/lib/callMeasure";

// Block (owner rule): either side can block the other. At once: their sessions together end (sent work stays payable
// and reviewable; disputes still allowed), booked calls between them are cancelled, neither can book or join a call with
// the other, no invites or joins to the blocker's tests, pending applications and rejoin asks between them close (batch 16
// section 11), and chat between them closes. Whoever blocked whom, the tester no longer sees that developer's other tests. Never revealed to the blocked
// person, who only reads neutral lines. Unblock from Account → Blocked people (nothing reopens by itself).

/** Is there a block either way between these two people? */
export async function blockedEitherWay(a: string, b: string) {
  return (await db.block.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) > 0;
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
export const iBlocked = async (me: string, other: string) => (await db.block.count({ where: { blockerId: me, blockedId: other } })) > 0;

/** Everyone this user blocked or was blocked by (for hiding tests from Find). */
export async function blockPartners(userId: string) {
  const rows = await db.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
  return rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId));
}

export async function blockUser(me: { id: string; email: string; name: string }, otherId: string) {
  if (!otherId || otherId === me.id) throw new HttpError(400, "bad_user", "Choose someone to block.");
  const other = await db.user.findUnique({ where: { id: otherId } });
  if (!other) throw new HttpError(404, "not_found", "That person doesn't exist.");
  // (Owner, Oct 27) The only stop: already blocked (in another tab).
  if (await iBlocked(me.id, otherId)) throw new HttpError(409, "already", `You already blocked ${displayName(other)}.`);
  await db.block.upsert({ where: { blockerId_blockedId: { blockerId: me.id, blockedId: otherId } }, update: {}, create: { blockerId: me.id, blockedId: otherId } });
  const now = new Date();
  const contracts = await db.contract.findMany({
    where: { status: "working", OR: [{ testerId: otherId, test: { developerId: me.id } }, { testerId: me.id, test: { developerId: otherId } }] },
    include: { tester: true, test: { include: { developer: true } } },
  });
  for (const c of contracts) {
    // (Owner, Oct 29, batch 26 section 2) A call already in progress between them ends at once, on both pages (like a pause, but whether or not they were connected).
    const by = c.testerId === me.id ? "tester" : "developer";
    const { endCallForBlock } = await import("./calls");
    for (const call of await db.call.findMany({ where: { contractId: c.id, status: "booked", startsAt: { lte: now }, endedAt: null, measuredAt: null, actualMinutes: null } })) await endCallForBlock(call.id, by, now);
    await db.contract.update({ where: { id: c.id }, data: { status: "ended", endKind: "blocked", endedAt: now, endReason: "" } });
    const calls = await db.call.findMany({ where: { contractId: c.id, status: "booked", startsAt: { gt: now } } });
    for (const call of calls) {
      await db.call.update({ where: { id: call.id }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: now, cancelNote: "" } });
      await db.callSlot.update({ where: { id: call.slotId }, data: { status: "removed" } });
    }
    // Neutral lines for the blocked side (never "blocked").
    if (c.testerId === otherId) await notify(c.tester.email, `Your session on ${c.title} ended.`, [`Your session on ${c.title} ended. Work you sent is still reviewed.`], `/app/sessions/${c.id}`);
    else await notify(c.test.developer.email, `${displayName(c.tester)}'s session on ${c.title} ended.`, [`${displayName(c.tester)}'s session on ${c.title} ended.`], `/app/tests/${c.testId}#tester-${c.id}`);
  }
  await (await import("./requests")).closeRequests({ contractIds: contracts.map((c) => c.id) }, "the session ended");
  await db.termsOffer.updateMany({ where: { status: "open", contractId: { in: contracts.map((c) => c.id) } }, data: { status: "superseded", decidedAt: now } });
  const invitesClosed = await (await import("./invites")).openInviteIds({ OR: [{ testerId: otherId, test: { developerId: me.id } }, { testerId: me.id, test: { developerId: otherId } }] });
  await db.invite.updateMany({ where: { id: { in: invitesClosed }, status: "sent" }, data: { status: "cancelled" } });
  await (await import("./invites")).tellInvitesClosed(invitesClosed); // (batch 30 §6) the neutral line (never "blocked")
  // (Owner, Oct 28, batch 16 section 11) Pending applications and rejoin asks between them close, like invites. The tester reads the neutral line; the developer nothing.
  // (Application has no relations: its tests are found by developer first.)
  const pairs = [{ tester: otherId, dev: me.id }, { tester: me.id, dev: otherId }];
  for (const p of pairs) {
    const tests = await db.test.findMany({ where: { developerId: p.dev }, select: { id: true, title: true } });
    const apps = await db.application.findMany({ where: { status: "pending", testerId: p.tester, testId: { in: tests.map((t) => t.id) } } });
    if (!apps.length) continue;
    await db.application.updateMany({ where: { id: { in: apps.map((a) => a.id) } }, data: { status: "closed", closedReason: "blocked", decidedAt: now } });
    const tester = await db.user.findUnique({ where: { id: p.tester }, select: { email: true } });
    for (const a of apps) {
      const title = tests.find((t) => t.id === a.testId)?.title ?? "";
      if (tester) await notify(tester.email, appClosedLine(title), [appClosedLine(title)], `/app/find/${a.testId}`, { testId: a.testId, group: "apps" }); // (batch 29 §23)
    }
  }
  for (const c of contracts) await (await import("./tests")).spotOpened(c.testId);
  return { blocked: true, ended: contracts.length };
}

/** The tester's line when a block closed their application: "“Harbor Run”: your application was closed." */
export const appClosedLine = (title: string) => `“${title}”: your application was closed.`;

export async function unblockUser(me: { id: string }, otherId: string) {
  await db.block.deleteMany({ where: { blockerId: me.id, blockedId: otherId } });
  return { unblocked: true };
}

/** Join call: the call page (the built-in room) only when the call can be joined now; otherwise the refusal line (shown under Join). */
export async function joinCall(user: { id: string }, callId: string) {
  await (await import("./calls")).sweepNobodyJoined();
  // (Batch 18 section 3; batch 21 section 2) A call the server ended (150%, the $1,000, or what closed it): Join is refused (and the button goes).
  const own = await db.call.findUnique({ where: { id: callId }, include: { contract: { include: { test: true } } } });
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
    },
    new Date(),
    fmtTime,
  );
  // (Owner, Oct 30, batch 15 section 38) A stale Join: "Your Join call didn't go through: Ana cancelled this call at 3:05 PM." (the row then leaves the page).
  if (refusal) {
    const by = call.cancelledBy === "developer" ? displayName(c.test.developer) : call.cancelledBy === "tester" ? displayName(await db.user.findUniqueOrThrow({ where: { id: c.testerId } })) : "";
    const mine = (call.cancelledBy === "developer" && side === "developer") || (call.cancelledBy === "tester" && side === "tester");
    const why = call.status !== "cancelled" ? refusal[0].toLowerCase() + refusal.slice(1).replace(/.$/, "") : by ? `${mine ? "you" : by} cancelled this call${call.cancelledAt ? ` at ${fmtFor(await db.user.findUnique({ where: { id: user.id }, select: { timeZone: true } }), call.cancelledAt, "time")}` : ""}` : call.cancelNote ? `this call was cancelled: ${call.cancelNote.replace(/[.s]+$/, "")}` : "this call was cancelled";
    throw new HttpError(409, "cant_join", `Your Join call didn't go through: ${why}.`, { cancelled: call.status === "cancelled" });
  }
  // (Batch 27 section 1) The tester's Join call waits while new terms are open: Switch or Keep first.
  if (side === "tester") await answerTermsFirst(c.id);
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
  const tester = amTester ? null : await db.user.findUnique({ where: { id: c.testerId }, select: { name: true, email: true } });
  const otherName = amTester ? (c.test.developer.name || c.test.developer.email.split("@")[0]) : (tester?.name || tester?.email.split("@")[0] || "");
  const tz = await db.user.findUnique({ where: { id: user.id }, select: { timeZone: true } });
  const side = amTester ? "tester" : "developer";
  const closed = fresh.status === "booked" && !fresh.endedAt && !fresh.measuredAt ? await callClosedLine(call, side) : "";
  const line = callLineFor({ ...fresh, contract: c }, side, otherName, tz, closed);
  const now = Date.now();
  const capLine = !line && state && !state.ended && state.together && state.endsAt.getTime() - now <= END_WARN_MS ? endWarnLine(fmtFor(tz, state.endsAt, "time")) : "";
  return {
    line, capLine, capped: !!(fresh.endedAt || fresh.cappedAt), ended: !!(fresh.endedAt || fresh.cappedAt || fresh.measuredAt), cancelled: call.status === "cancelled", bothJoinedAt: both, startsAt: call.startsAt, minutes: call.minutes,
    other: { name: otherName, joinedAt: amTester ? call.devJoinedAt : call.testerJoinedAt },
    meJoinedAt: amTester ? call.testerJoinedAt : call.devJoinedAt,
  };
}
