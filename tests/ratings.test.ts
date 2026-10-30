import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";
import { rateWarning, ratingSummary } from "@/lib/server/ratings";

// (Owner, Oct 22, NEWEST+5) Ratings: the tester rates the developer.

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

describe("the tester rates the developer", () => {
  it("not before something was sent and decided; available after the review; the prompt is sent once", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 5 })).body.error.message).toBe("Rating opens once some work was sent or a call took place.");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 5 })).body.error.message).toMatch(/^Rating opens on .+, or sooner if Nora Lane reviews everything you sent\.$/); // (batch 17 section 1)
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Rate Nora Lane" } } })).toBe(1);
    // A form mistake is red (400) at the field; then it goes.
    expect((await sact(sessionId, "rate", tester.cookie, {})).status).toBe(400);
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 4, comment: "x".repeat(501) })).status).toBe(400);
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 4, comment: "Clear build, quick pay." })).status).toBe(200);
    // Final: no second rating, and the prompt never repeats.
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 1 })).body.error.message).toBe("You already rated Nora Lane.");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Rate Nora Lane" } } })).toBe(1);
  });

  it("an open dispute holds rating back; the point where Charge opens (the review date) counts as decided", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question", confirmed: true });
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 3 })).body.error.message).toBe("Rating opens once the team decides your dispute.");
    // Another tester, whose work waited 14 days (no review): available.
    const b = await joined(testId, "Ben Carter", "he");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    await db.submission.updateMany({ where: { contractId: b.sessionId }, data: { payBy: new Date(Date.now() - 60_000) } });
    // 14 days alone is not enough: Charge also needs the test's Open until to have passed.
    expect((await sact(b.sessionId, "rate", b.tester.cookie, { stars: 2 })).body.error.message).toMatch(/^Rating opens on /); // (batch 17 section 1)
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 60_000) } }); await db.contract.updateMany({ where: { testId: testId }, data: { dueAt: new Date(Date.now() - 60_000) } }); // (batch 15 section 18: the tester's own deadline)
    expect((await sact(b.sessionId, "rate", b.tester.cookie, { stars: 2 })).status).toBe(200);
  });

  it("the warning lists unsent parts and the calls line; rating finishes the part like Leave; no rejoin; Charge and Dispute stay", async () => {
    const { dev, testId } = await setup({ recordingCents: "15.00" });
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    // (Batch 17 section 1) Everything sent must be settled first: paid under the listing (with a reason).
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short" })).status).toBe(200);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    const w = await rateWarning(sessionId);
    expect(w).toEqual({ working: true, lines: ["Not sent yet from your contract: recording ($12) — it won't be paid.", "All your upcoming calls will be cancelled."] });
    // (Batch 17 section 14) Rate stops only for changes about this person's work: a listing edit goes straight through.
    const pageLoaded = seen();
    await new Promise((r) => setTimeout(r, 30));
    await act(testId, "edit", dev.cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { description: "New words" } });
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 5, seenAt: pageLoaded })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(c).toMatchObject({ status: "left", endKind: "rated" });
    expect(await db.call.count({ where: { contractId: sessionId, status: "booked", startsAt: { gt: new Date() } } })).toBe(0);
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["c", "d"] })).body.error.message).toBe("You rated this test, so your part is finished.");
    // No rejoin, ever.
    expect((await act(testId, "join", tester.cookie, { listingVersion: c.listingVersion })).body.error.message).toBe("You rated this test, so you can't join it again.");
    // Dispute stays available after rating.
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered all", confirmed: true })).status).toBe(200);
  });

  it("averages count revealed ratings only; '4.5 ★ (2 ratings)'; comments without names", async () => {
    const { dev, testId } = await setup();
    const ids: string[] = [];
    for (const [name, stars, comment] of [["Ana Silva", 5, "Great"], ["Ben Carter", 4, ""]] as const) {
      const { tester, sessionId } = await joined(testId, name);
      await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
      await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
      expect((await sact(sessionId, "rate", tester.cookie, { stars, comment })).status).toBe(200);
      ids.push(sessionId);
    }
    expect((await ratingSummary(dev.user.id)).line).toBe(""); // hidden until the developer rates (or 14 days)
    for (const id of ids) expect((await act(testId, "rate", dev.cookie, { contractId: id, stars: 5, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await ratingSummary(dev.user.id)).toEqual({ line: "4.5 ★ (2 ratings)", comments: ["Great"], n: 2, avg: 4.5, at: expect.any(Date) });
  });
});

describe("the developer rates a tester (after the tester rated; blind reveal)", () => {
  async function ratedByTester() {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    return { ...s, ...j };
  }

  it("not before the tester rated; then a bell; the tester's rating is hidden until the developer rates, then both show", async () => {
    const { dev, testId, tester, sessionId } = await ratedByTester();
    expect((await act(testId, "rate", dev.cookie, { contractId: sessionId, stars: 4, seenAt: seen(), confirmed: true })).body.error.message).toBe("You can rate Ana Silva once they've rated you and everything they sent is settled.");
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 3, comment: "Slow replies" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Ana Silva finished Harbor Run. You can rate her for 14 days." } })).toBe(1);
    const { contractRatings } = await import("@/lib/server/ratings");
    expect((await contractRatings(sessionId)).testerRevealed).toBe(false);
    expect((await ratingSummary(dev.user.id)).line).toBe("");
    expect((await act(testId, "rate", dev.cookie, { contractId: sessionId, seenAt: seen(), confirmed: true })).status).toBe(400); // stars missing: red
    expect((await act(testId, "rate", dev.cookie, { contractId: sessionId, stars: 5, comment: "Thorough", seenAt: seen(), confirmed: true })).status).toBe(200);
    const after = await contractRatings(sessionId);
    expect(after.testerRevealed).toBe(true);
    expect(after.developer?.revealedAt).toEqual(after.tester?.revealedAt);
    expect((await ratingSummary(dev.user.id)).line).toBe("3.0 ★ (1 rating)");
    expect((await ratingSummary(tester.user.id)).line).toBe("5.0 ★ (1 rating)");
    expect((await act(testId, "rate", dev.cookie, { contractId: sessionId, stars: 1, seenAt: seen(), confirmed: true })).body.error.message).toBe("You already rated Ana Silva.");
  });

  it("after the rating window without the developer's rating: the tester's rating shows and the window is closed", async () => {
    const { dev, testId, tester, sessionId } = await ratedByTester();
    await sact(sessionId, "rate", tester.cookie, { stars: 4 });
    await db.rating.updateMany({ where: { contractId: sessionId, side: "tester" }, data: { createdAt: new Date(Date.now() - 15 * 86_400_000) } });
    await db.review.updateMany({ where: { contractId: sessionId }, data: { createdAt: new Date(Date.now() - 16 * 86_400_000) } }); // (batch 17 section 16) the window counts from the later of the two
    expect((await ratingSummary(dev.user.id)).line).toBe("4.0 ★ (1 rating)");
    expect((await act(testId, "rate", dev.cookie, { contractId: sessionId, stars: 5, seenAt: seen(), confirmed: true })).body.error.message).toBe("The 14 days to rate Ana Silva have passed.");
  });

});
