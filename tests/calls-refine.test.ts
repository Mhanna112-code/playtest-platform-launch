import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as joinPOST } from "@/app/api/calls/[id]/join/route";
import { GET as statusGET } from "@/app/api/calls/[id]/status/route";
import { GET as roomGET } from "@/app/api/calls/[id]/room/route";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import * as R from "@/lib/rules";
import { invitable } from "@/lib/server/invites";
import { decideDispute, review } from "@/lib/server/payments";
import { liftHoldIfClear, payOwed, startHold } from "@/lib/server/holds";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

const join = (cookie: string, id: string) => joinPOST(req(`/api/calls/${id}/join`, { cookie, body: {} }), { params: Promise.resolve({ id }) }).then(json);
const room = (cookie: string, id: string) => roomGET(req(`/api/calls/${id}/room?after=0`, { cookie }), { params: Promise.resolve({ id }) }).then(json);
const status = (cookie: string, id: string) => statusGET(req(`/api/calls/${id}/status`, { cookie }), { params: Promise.resolve({ id }) }).then(json);

async function booked(minutesFromNow: number) {
  const s = await setup();
  const j = await joined(s.testId);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
  await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() + minutesFromNow * 60_000) } });
  return { ...s, ...j, call };
}

describe("calls / hold / block refinements", () => {
  it("cancel up to the start (reason inside 24h); not after it starts", async () => {
    expect(R.checkCancel(new Date(Date.now() - 1000), new Date(), "reason").ok).toBe(false);
    const { tester, sessionId, call } = await booked(-5);
    expect((await sact(sessionId, "cancel-call", tester.cookie, { callId: call.id, reason: "late" })).body.error.message).toMatch(/^The call has started/);
  });

  it("each side's first time in the call room is recorded (batch 21: the room's first poll, not the Join press)", async () => {
    const { dev, tester, call } = await booked(-5);
    expect((await join(tester.cookie, call.id)).body.url).toBe(`/app/calls/${call.id}`);
    await join(dev.cookie, call.id);
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).devJoinedAt).toBeNull();
    expect((await room(tester.cookie, call.id)).status).toBe(200);
    expect((await room(dev.cookie, call.id)).status).toBe(200);
    const c = await db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(c.devJoinedAt && c.testerJoinedAt).toBeTruthy();
    expect((await status(dev.cookie, call.id)).body.bothJoinedAt).toBeTruthy();
  });

  it("no Lower the length during a hold", async () => {
    const { dev, testId, call } = await booked(-60);
    await startHold(dev.user.id, "unpaid");
    expect((await act(testId, "lower-length", dev.cookie, { callId: call.id, minutes: 25, reason: "We stopped early." })).body.error.code).toBe("held"); // (Owner, Oct 27) every developer press is refused during a hold
  });

  it("a cancel or a block closes the room (status line) for both", async () => {
    const { dev, tester, call, testId } = await booked(-5);
    expect((await status(tester.cookie, call.id)).body.line).toBe("");
    await blocksPOST(req("/api/blocks", { cookie: dev.cookie, body: { userId: tester.user.id } }));
    expect((await status(tester.cookie, call.id)).body.line).toBe("This call isn't available.");
    expect((await status(dev.cookie, call.id)).body.line).toBe("This call isn't available.");
    expect((await invitable(dev.user.id, testId)).some((x) => x.id === tester.user.id)).toBe(false); // Invite hidden for that tester
  });

  it("after a block the new-terms offer is withdrawn", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, confirmed: true });
    await blocksPOST(req("/api/blocks", { cookie: tester.cookie, body: { userId: dev.user.id } }));
    expect(await db.termsOffer.count({ where: { contractId: sessionId, status: "open" } })).toBe(0);
  });

  it("(batch 6) an admin decision that charges the developer during a hold is added to what is owed and paid with Pay what you owe", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await review(dev.user, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers here", payKey: randomUUID(), seenAt: seen(), confirmed: true });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully" });
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    await startHold(dev.user.id, "unpaid");
    const admin = await makeUser();
    await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
    await decideDispute({ ...admin.user, isAdmin: true }, d.id, { total: "10.00" });
    expect(await db.payment.findFirstOrThrow({ where: { disputeId: d.id } })).toMatchObject({ status: "owed", amountCents: 600 });
    expect(await liftHoldIfClear(dev.user.id)).toBe(false); // owed first
    expect((await payOwed(dev.user)).lifted).toBe(true);
    expect((await db.payment.findFirstOrThrow({ where: { disputeId: d.id } })).status).not.toBe("owed");
  });

  it("booked after the deadline: allowed (a guide), labelled on both sides", async () => {
    expect(R.bookedLateLabel("Ana Silva", new Date(2026, 9, 20), () => "Oct 20")).toBe("Booked after Ana Silva's deadline (Oct 20)");
    expect(R.isBookedLate(new Date("2026-10-21T00:00:00Z"), new Date("2026-10-20T00:00:00Z"))).toBe(true);
    const s = await setup();
    const j = await joined(s.testId);
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: new Date(Date.now() - 86_400_000) } });
    await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    const call = await db.call.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(R.isBookedLate(call.createdAt, c.dueAt)).toBe(true);
  });
});
