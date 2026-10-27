import { db } from "@/lib/db";
import { displayName, fmtTime } from "@/lib/format";
import { joinCallRefusal, testPaused } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { roomUrl } from "./calls";

// Block (owner rule): either side can block the other. At once: their sessions together end (sent work stays payable
// and reviewable; disputes still allowed), booked calls between them are cancelled, neither can book or join a call with
// the other, no invites or joins to the blocker's tests, and chat between them closes. Never revealed to the blocked
// person, who only reads neutral lines. Unblock from Account → Blocked people (nothing reopens by itself).

/** Is there a block either way between these two people? */
export async function blockedEitherWay(a: string, b: string) {
  return (await db.block.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) > 0;
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
  await db.invite.updateMany({ where: { status: "sent", OR: [{ testerId: otherId, test: { developerId: me.id } }, { testerId: me.id, test: { developerId: otherId } }] }, data: { status: "cancelled" } });
  for (const c of contracts) await (await import("./tests")).spotOpened(c.testId);
  return { blocked: true, ended: contracts.length };
}

export async function unblockUser(me: { id: string }, otherId: string) {
  await db.block.deleteMany({ where: { blockerId: me.id, blockedId: otherId } });
  return { unblocked: true };
}

/** Join call: the room link only when the call can be joined now; otherwise the refusal line (shown under Join). */
export async function joinCall(user: { id: string }, callId: string) {
  await (await import("./calls")).sweepNobodyJoined();
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
  if (refusal) throw new HttpError(409, "cant_join", refusal);
  const now = new Date();
  if (side === "developer" && !call.devJoinedAt) await db.call.update({ where: { id: call.id }, data: { devJoinedAt: now } });
  if (side === "tester" && !call.testerJoinedAt) await db.call.update({ where: { id: call.id }, data: { testerJoinedAt: now } });
  return { url: `/app/calls/${call.id}`, room: roomUrl(call, call.slot) };
}

/** The call page's status check (every few seconds): "" while it can go on; otherwise the line that replaces the room. */
export async function callStatus(user: { id: string }, callId: string) {
  const call = await db.call.findUnique({ where: { id: callId }, include: { contract: { include: { test: { include: { developer: true } } } } } });
  const c = call?.contract;
  if (!call || !c || (c.testerId !== user.id && c.test.developerId !== user.id)) throw new HttpError(404, "not_found", "That call doesn't exist.");
  const line = call.status === "cancelled" ? "This call was cancelled." : (await blockedEitherWay(c.testerId, c.test.developerId)) ? "This call isn't available." : "";
  const both = call.devJoinedAt && call.testerJoinedAt ? new Date(Math.max(call.devJoinedAt.getTime(), call.testerJoinedAt.getTime())) : null;
  // (The full app's CallPresence) Who has joined the room, for the other side's line: lean keeps each side's first join.
  const amTester = c.testerId === user.id;
  const tester = amTester ? null : await db.user.findUnique({ where: { id: c.testerId }, select: { name: true, email: true } });
  const otherName = amTester ? (c.test.developer.name || c.test.developer.email.split("@")[0]) : (tester?.name || tester?.email.split("@")[0] || "");
  return {
    line, bothJoinedAt: both, startsAt: call.startsAt, minutes: call.minutes,
    other: { name: otherName, joinedAt: amTester ? call.devJoinedAt : call.testerJoinedAt },
    meJoinedAt: amTester ? call.testerJoinedAt : call.devJoinedAt,
  };
}
