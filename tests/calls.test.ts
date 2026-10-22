import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 5));
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function withTimes(over: Record<string, unknown> = {}, hours = [48, 72]) {
  const s = await setup(over);
  const j = await joined(s.testId);
  await later();
  const r = await act(s.testId, "offer-times", s.dev.cookie, { seenAt: seen(), times: hours.map(inHours) });
  expect(r.status).toBe(200);
  const slots = await db.callSlot.findMany({ where: { testId: s.testId }, orderBy: { startsAt: "asc" } });
  await later();
  return { ...s, ...j, slots };
}

describe("offering times", () => {
  it("up to 5 at once; clashes are refused with the clashing time", async () => {
    const { dev, testId } = await withTimes();
    expect((await act(testId, "offer-times", dev.cookie, { seenAt: seen(), confirmed: true, times: [1, 2, 3, 4, 5, 6].map((h) => inHours(100 + h)) })).body.error.message).toBe("Up to 5 times at once.");
    const clash = await act(testId, "offer-times", dev.cookie, { seenAt: seen(), confirmed: true, times: [inHours(48)] });
    expect(clash.body.error.message).toMatch(/^You already have a call time then: .+\. Pick another time\.$/);
  });

  it("the live-call panel uses the developers' stop-once gate (a tester joined since the page loaded)", async () => {
    const { dev, testId } = await withTimes();
    const pageLoaded = seen();
    await later();
    await joined(testId, "Ben Carter", "he");
    const first = await act(testId, "offer-times", dev.cookie, { seenAt: pageLoaded, times: [inHours(200)] });
    expect(first.body.error).toMatchObject({ code: "stop_once" });
    expect(first.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Ben Carter joined"]);
    expect((await act(testId, "offer-times", dev.cookie, { seenAt: pageLoaded, confirmed: true, times: [inHours(200)] })).status).toBe(200);
  });
});

describe("booking and cancelling", () => {
  it("a tester books; the call copies their contract rate; the developer's top panel stops once for it", async () => {
    const { dev, testId, tester, sessionId, slots } = await withTimes();
    const pageLoaded = seen();
    await later();
    expect((await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[0].id })).status).toBe(200);
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    expect(call).toMatchObject({ rateCents: 3000, minutes: 30, status: "booked" });
    const r = await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded });
    expect(r.body.error.changes[0].text).toMatch(/^Ana Silva booked a call for /);
    expect((await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[1].id })).body.error.message).toMatch(/^You already have a call booked/);
  });

  it("any tester may book, even without a live call in their contract (extra)", async () => {
    const { tester, sessionId, slots } = await withTimes({ liveRateCents: null });
    expect((await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[0].id })).status).toBe(200);
    expect((await db.call.findFirstOrThrow({ where: { contractId: sessionId } })).rateCents).toBeNull();
  });

  it("the tester's panel stops once for call changes since their page loaded; the second press books", async () => {
    const { dev, testId, tester, sessionId, slots } = await withTimes();
    const pageLoaded = seen();
    await later();
    await act(testId, "offer-times", dev.cookie, { seenAt: seen(), times: [inHours(120)] });
    const first = await sact(sessionId, "book", tester.cookie, { seenAt: pageLoaded, slotId: slots[0].id });
    expect(first.body.error.code).toBe("stop_once");
    expect(first.body.error.changes[0].text).toMatch(/^A new call time was offered: /);
    expect((await sact(sessionId, "book", tester.cookie, { seenAt: pageLoaded, slotId: slots[0].id, confirmed: true })).status).toBe(200);
  });

  it("a time someone else took is refused for good", async () => {
    const { testId, tester, sessionId, slots } = await withTimes();
    const ben = await joined(testId, "Ben Carter", "he");
    await sact(ben.sessionId, "book", ben.tester.cookie, { seenAt: seen(), slotId: slots[0].id });
    const r = await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[0].id, confirmed: true });
    expect(r.body.error.message).toBe("Someone already booked that time. Pick another.");
  });

  it("cancel any time; within 24 hours a reason is required and the other side sees it; a tester's cancel reopens the time, a developer's removes it", async () => {
    const { dev, testId, tester, sessionId, slots } = await withTimes({}, [10, 48]);
    await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[0].id });
    const near = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await sact(sessionId, "cancel-call", tester.cookie, { seenAt: seen(), callId: near.id })).body.error.message).toBe("The call is less than 24 hours away: say why you're cancelling (the other side sees it).");
    expect((await sact(sessionId, "cancel-call", tester.cookie, { seenAt: seen(), callId: near.id, reason: "car trouble" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { endsWith: ": car trouble" }, AND: { text: { startsWith: "Ana Silva cancelled the call on " } } } })).toBe(1);
    expect((await db.callSlot.findUniqueOrThrow({ where: { id: slots[0].id } })).status).toBe("open");
    await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[1].id, confirmed: true });
    const c2 = await db.call.findFirstOrThrow({ where: { contractId: sessionId, status: "booked" } });
    await later();
    expect((await act(testId, "cancel-call", dev.cookie, { seenAt: seen(), callId: c2.id })).status).toBe(200);
    expect((await db.callSlot.findUniqueOrThrow({ where: { id: slots[1].id } })).status).toBe("removed");
  });

  it("an ended tester can't book (refused with the reason); End early cancels calls ahead", async () => {
    const { dev, testId, tester, sessionId, slots } = await withTimes();
    await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[0].id });
    await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractId: sessionId, reason: "We have enough" });
    expect((await db.call.findFirstOrThrow({ where: { contractId: sessionId } })).status).toBe("cancelled");
    const r = await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[1].id, confirmed: true });
    expect(r.body.error.message).toContain("ended your session early");
  });
});

describe("paying for a call and no-shows", () => {
  it("pays with the same Pay box after the call started (reference: rate × booked minutes)", async () => {
    const { dev, tester, sessionId, slots } = await withTimes();
    await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[0].id });
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    const pay = (body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie: dev.cookie, body: { payKey: randomUUID(), seenAt: seen(), kind: "call", id: call.id, ...body } })).then(json);
    expect((await pay({ amount: "15.00", tickedCents: 1500 })).body.error.message).toBe("You can pay for this call once it has started.");
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 3_600_000) } });
    await later();
    expect((await pay({ amount: "10.00", tickedCents: 1000 })).body.error.message).toContain("listing's $15.00");
    expect((await pay({ amount: "15.00", tickedCents: 1500 })).status).toBe(200);
    expect(await db.payment.findFirstOrThrow({ where: { callId: call.id } })).toMatchObject({ kind: "call", amountCents: 1500, testerCents: 1200 });
  });

  it("either side reports a problem after the start, once", async () => {
    const { dev, testId, tester, sessionId, slots } = await withTimes();
    await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[0].id });
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await sact(sessionId, "no-show", tester.cookie, { callId: call.id, note: "Nobody came" })).body.error.message).toContain("once the call's time has started");
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    expect((await act(testId, "no-show", dev.cookie, { callId: call.id, note: "Ana never joined" })).status).toBe(200);
    expect((await sact(sessionId, "no-show", tester.cookie, { callId: call.id, note: "Nobody came" })).body.error.message).toBe("A problem with this call was already reported.");
  });
});
