import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { testerChanges, devRequestCancelledLine } from "@/lib/server/testerGate";
import { closeRequests } from "@/lib/server/requests";
import { act, atHours, joined, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §379 item 5) A developer's call request closed by a pause or a hold never stops a press (a quiet line, still in the top box and the bell), worded
// "Nora Lane's call request for … was cancelled"; a cancelled booked call names why, like the bell; real call changes keep stopping once.

describe("§379 item 5: call lines on the tester's side", () => {
  it("a request closed by a pause: quiet, in the one wording, and the bell says the same", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await act(s.testId, "request-time", s.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [j.sessionId], startsAt: atHours(60) })).status).toBe(200);
    const since = new Date();
    await settle();
    await closeRequests({ contractIds: [j.sessionId] }, "the test is paused");
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const lines = await testerChanges(j.tester.user.id, j.sessionId, s.testId, since);
    const line = lines.find((l) => l.text.includes("call request"));
    expect(line?.text).toMatch(/^Nora Lane's call request for .+ was cancelled$/);
    expect(line?.kind).not.toBe("requested"); // never a stop
    const bell = await db.notification.findMany({ where: { userId: j.tester.user.id, createdAt: { gte: since } } });
    expect(bell.some((n) => /^Nora Lane's call request on “Harbor Run” for .+ was cancelled$/.test(n.text))).toBe(true);
    expect(devRequestCancelledLine("Nora Lane", "Fri, Nov 13, 3:00 PM")).toBe("Nora Lane's call request for Fri, Nov 13, 3:00 PM was cancelled");
    void r;
  });

  it("a booked call the system cancelled for the pause names why; it still stops once", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const since = new Date();
    await settle();
    const slot = await db.callSlot.create({ data: { testId: s.testId, startsAt: new Date(Date.now() + 60 * 3_600_000), minutes: 30, allowedTesterIds: [], status: "removed" } });
    await db.call.create({ data: { slotId: slot.id, contractId: j.sessionId, startsAt: slot.startsAt, minutes: 30, status: "cancelled", cancelledBy: "system", cancelledAt: new Date(), cancelNote: "The test is paused." } });
    const line = (await testerChanges(j.tester.user.id, j.sessionId, s.testId, since)).find((l) => l.kind === "cancelled");
    expect(line?.text).toMatch(/^Your call with Nora Lane on .+ was cancelled because the test is paused$/);
  });
});
