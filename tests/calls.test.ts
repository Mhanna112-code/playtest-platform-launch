import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 30));

describe("calls are always requests", () => {
  it("the developer's request books on the tester's Accept at the contract rate; the top panel stops once for it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const pageLoaded = seen();
    await later();
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    expect(call).toMatchObject({ rateCents: 3000, minutes: 30, status: "booked" });
    const r = await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded });
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toContain(`Ana Silva booked a call for ${call.startsAt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
  });

  it("offered times and instant Book are gone", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await act(testId, "offer-times", dev.cookie, { seenAt: seen(), times: [atHours(48)] })).status).toBe(404);
    expect((await sact(sessionId, "book", tester.cookie, { slotId: "x" })).status).toBe(404);
  });

  it("not in the contract: the tester's request books only if the developer accepts, at no listed rate (there is no Ask $)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.contract.update({ where: { id: sessionId }, data: { liveRateCents: null } }); // the listing has a live call, this tester's contract has none
    const r = await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(48), ask: "35" });
    expect(r.body.requested).toBe(true);
    await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: r.body.id, action: "accept", seenAt: seen(), confirmed: true });
    expect((await db.call.findFirstOrThrow({ where: { contractId: sessionId } })).rateCents).toBeNull();
  });

  it("cancel up to the start; within 24 hours a reason is required and the other side sees it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const near = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 10);
    expect((await sact(sessionId, "cancel-call", tester.cookie, { seenAt: seen(), callId: near.id })).body.error.message).toBe("The call is less than 24 hours away: say why you're cancelling (the other side sees it).");
    expect((await sact(sessionId, "cancel-call", tester.cookie, { seenAt: seen(), callId: near.id, reason: "car trouble" })).status).toBe(200);
    // (Batch 15 section 20) The reason is in the email and on the page, never in the bell line.
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { endsWith: "." }, AND: { text: { startsWith: "Ana Silva cancelled the call on " } } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "car trouble" } } })).toBe(0);
    const far = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 60);
    await later();
    expect((await act(testId, "cancel-call", dev.cookie, { seenAt: seen(), callId: far.id })).status).toBe(200);
  });

  it("an ended tester can't request (refused with the reason); End early cancels calls ahead", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractId: sessionId, reason: "We have enough" });
    expect((await db.call.findFirstOrThrow({ where: { contractId: sessionId } })).status).toBe("cancelled");
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: atHours(72) })).body.error.message).toMatch(/^Nora Lane ended your session early on .+, so your Request a time didn't go through\. Work you sent is still reviewed\.$/); // (batch 16 section 24)
  });
});

describe("paying for a call and no-shows", () => {
  it("pays with the same Pay box after the call started (reference: agreed rate × booked minutes)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const pay = (body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie: dev.cookie, body: { payKey: randomUUID(), seenAt: seen(), kind: "call", id: call.id, ...body } })).then(json);
    expect((await pay({ amount: "15.00", tickedCents: 1500 })).body.error.message).toBe("You can pay for this call once it has started.");
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 3_600_000) } });
    // (Batch 15 section 40) Not while its length is being measured; then the measured length × the rate.
    expect((await pay({ amount: "15.00", tickedCents: 1500 })).body.error.message).toMatch(/still being measured/);
    await db.call.update({ where: { id: call.id }, data: { measuredMinutes: 30, measuredAt: new Date() } });
    await later();
    expect((await pay({ amount: "10.00", tickedCents: 1000 })).body.error.message).toContain("listing's $15.00");
    expect((await pay({ amount: "15.00", tickedCents: 1500, confirmed: true })).status).toBe(200);
  });

  it("either side reports a problem after the start, once", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    expect((await sact(sessionId, "no-show", tester.cookie, { callId: call.id, note: "Nobody came" })).body.error.message).toContain("once the call's time has started");
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    expect((await act(testId, "no-show", dev.cookie, { callId: call.id, note: "Ana never joined" })).status).toBe(200);
    expect((await sact(sessionId, "no-show", tester.cookie, { callId: call.id, note: "Nobody came" })).body.error.message).toBe("A problem with this call was already reported.");
  });
});

describe("Report a problem (the full app's fold): No-show / Late plus a note", () => {
  it("the kind is kept with the note; without a kind the note must say what happened", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 1);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await sact(sessionId, "no-show", tester.cookie, { callId: call.id, note: "" })).status).toBe(400);
    expect((await sact(sessionId, "no-show", tester.cookie, { callId: call.id, kind: "late", note: "20 minutes late" })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).noShowNote).toBe("Was late: 20 minutes late");
  });
});
