import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { act, joined, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 30));
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, confirmed: true });
};

describe("new terms offered to working testers", () => {
  it("diff wording and the deadline rule", () => {
    const a = { writtenCents: 800, recordingCents: null, liveRateCents: 3000, liveMinutes: 30, deadlineDays: 7, questions: ["Q"] };
    expect(R.termsDiff(a, { ...a, writtenCents: 1000, recordingCents: 1200 })).toBe("written $8 → $10, added a recording ($12)");
    expect(R.termsDiff(a, { ...a, liveRateCents: null })).toBe("removed the live call");
    expect(R.termsDiff(a, a)).toBe("");
    const joinedAt = new Date("2026-11-01T00:00:00Z"), due = new Date("2026-11-08T00:00:00Z");
    expect(R.newDueAt(due, joinedAt, 3).toISOString()).toBe(due.toISOString()); // never earlier
    expect(R.newDueAt(due, joinedAt, 10).toISOString()).toBe("2026-11-11T00:00:00.000Z");
    expect(R.choiceNoteLine("Nov 5", "Ana Silva", 800, "her")).toBe("If you don't pay by Nov 5, Ana Silva can charge you $8.00, her contract price, or let it go.");
  });

  it("Edit offers the new terms (bell + email); the contract changes only on Switch; sent work keeps its price", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    // (Batch 12) No days field any more: the deadline is Open until.
    const r = await edit(testId, dev.cookie, { writtenCents: "12.00", recordingCents: "15.00", deadlineDays: 10 });
    expect(r.body.offered).toBe(1);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId } });
    expect(offer.diff).toBe("written $10 → $12, added a recording ($15)");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Nora Lane updated the listing: written $10 → $12, added a recording ($15)" } })).toBe(1);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).writtenCents).toBe(1000); // not until they switch
    const before = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect((await sact(sessionId, "terms", tester.cookie, { offerId: offer.id, choice: "switch" })).status).toBe(200);
    const after = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after).toMatchObject({ writtenCents: 1200, recordingCents: 1500 });
    expect(after.dueAt.getTime()).toBe(before.dueAt.getTime()); // the deadline stays Open until
    expect((await db.submission.findFirstOrThrow({ where: { contractId: sessionId, kind: "written" } })).agreedCents).toBe(1000); // sent work keeps its price
  });

  it("Send stops once (box under the button) if new terms were offered since the page loaded; the second press sends under current terms", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const pageLoaded = seen();
    await later();
    await edit(testId, dev.cookie, { writtenCents: "12.00" });
    const first = await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: pageLoaded });
    expect(first.status).toBe(409);
    expect(first.body.error).toMatchObject({ code: "stop_once", tail: "Press again to send under your current terms, or switch first." });
    expect(first.body.error.changes[0].text).toBe("Nora Lane offered new terms: written $10 → $12");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: pageLoaded, confirmed: true })).status).toBe(200);
    expect((await db.submission.findFirstOrThrow({ where: { contractId: sessionId } })).agreedCents).toBe(1000);
  });

  it("Switch / Keep stop once if the terms changed again (shows the newest); Keep keeps the contract", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await edit(testId, dev.cookie, { writtenCents: "12.00" });
    const old = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId } });
    await edit(testId, dev.cookie, { writtenCents: "14.00" });
    const r = await sact(sessionId, "terms", tester.cookie, { offerId: old.id, choice: "switch" });
    expect(r.body.error.changes[0].text).toBe("Nora Lane changed the terms again: written $10 → $14");
    expect((await sact(sessionId, "terms", tester.cookie, { offerId: old.id, choice: "keep", confirmed: true })).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).writtenCents).toBe(1000);
  });

  it("a spots-only edit offers nothing", async () => {
    const { dev, testId } = await setup();
    await joined(testId);
    expect((await edit(testId, dev.cookie, { spots: 9 })).body.offered).toBe(0);
  });
});

describe("(Owner, reason A) new terms always stop the next press, even when the top box showed them", () => {
  it("an offer arrives while the page is open and the top box shows it: Cancel call stops (top = true), the second press goes ahead", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const pageSeenAt = new Date(Date.now() - 1000).toISOString();
    // A call to cancel (a request the tester books themselves is enough: use a booked call through the developer's request).
    const at = new Date(Date.now() + 72 * 3_600_000); at.setSeconds(0, 0);
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], times: [at.toISOString()] });
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId } });
    await sact(sessionId, "answer-request", tester.cookie, { requestId: r.id, action: "accept" });
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    await later();
    await edit(testId, dev.cookie, { writtenCents: "12.00" });
    await later();
    // The top box showed the offer: the page's marker moved to now, but the page itself was rendered before it.
    const shown = new Date().toISOString();
    const first = await sact(sessionId, "cancel-call", tester.cookie, { callId: call.id, seenAt: shown, pageSeenAt });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe("stop_once");
    expect(first.body.error.top).toBe(true);
    expect((first.body.error.changes as { text: string }[])[0].text).toContain("offered new terms");
    // The second press (with the box's time) cancels under the tester's current terms.
    const second = await sact(sessionId, "cancel-call", tester.cookie, { callId: call.id, seenAt: shown, pageSeenAt, confirmed: true, boxAt: first.body.error.now });
    expect(second.status).toBe(200);
    // Once they have decided on the offer, it no longer stops anything.
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId } });
    await sact(sessionId, "terms", tester.cookie, { offerId: offer.id, choice: "keep", seenAt: shown, pageSeenAt, confirmed: true, boxAt: shown });
    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: new Date().toISOString(), pageSeenAt })).status).toBe(200);
  });
});
