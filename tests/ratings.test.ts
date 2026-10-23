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
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 5 })).body.error.message).toBe("Rating opens once the developer has reviewed everything you sent (or 14 days have passed).");
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Rate Nora Lane" } } })).toBe(1);
    // A form mistake is red (400) at the field; then it goes.
    expect((await sact(sessionId, "rate", tester.cookie, {})).status).toBe(400);
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 4, comment: "x".repeat(501) })).status).toBe(400);
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 4, comment: "Clear build, quick pay." })).status).toBe(200);
    // Final: no second rating, and the prompt never repeats.
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 1 })).body.error.message).toBe("You already rated this test.");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Rate Nora Lane" } } })).toBe(1);
  });

  it("an open dispute holds rating back; the 14-day point counts as decided", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question", confirmed: true });
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 3 })).body.error.message).toBe("Rating opens once the team has decided the open dispute.");
    // Another tester, whose work waited 14 days (no review): available.
    const b = await joined(testId, "Ben Carter", "he");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    await db.submission.updateMany({ where: { contractId: b.sessionId }, data: { payBy: new Date(Date.now() - 60_000) } });
    expect((await sact(b.sessionId, "rate", b.tester.cookie, { stars: 2 })).status).toBe(200);
  });

  it("the warning lists unsent parts and the calls line; rating finishes the part like Leave; no rejoin; Charge and Dispute stay", async () => {
    const { dev, testId } = await setup({ recordingCents: "15.00" });
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 60_000), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 14 * 86_400_000) } });
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    const w = await rateWarning(sessionId);
    expect(w).toEqual({ working: true, lines: ["Not sent yet from your contract: recording ($12) — it won't be paid.", "All your upcoming calls will be cancelled."] });
    // Rate is a button like the others: stops once for a change since the page loaded.
    const pageLoaded = seen();
    await new Promise((r) => setTimeout(r, 5));
    await act(testId, "edit", dev.cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { description: "New words" } });
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 5, seenAt: pageLoaded })).body.error.code).toBe("stop_once");
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 5, seenAt: pageLoaded, confirmed: true })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(c).toMatchObject({ status: "left", endKind: "rated" });
    expect(await db.call.count({ where: { contractId: sessionId, status: "booked", startsAt: { gt: new Date() } } })).toBe(0);
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["c", "d"] })).body.error.message).toBe("You rated this test, so your part is finished.");
    // No rejoin, ever.
    expect((await act(testId, "join", tester.cookie, { listingVersion: c.listingVersion })).body.error.message).toBe("You rated this test, so you can't join it again.");
    // Charge stays available after rating.
    const ch = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000 });
    expect(ch.status).toBe(200);
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
    expect(await ratingSummary(dev.user.id)).toEqual({ line: "4.5 ★ (2 ratings)", comments: ["Great"], n: 2 });
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
    expect((await act(testId, "rate", dev.cookie, { contractId: sessionId, stars: 4, seenAt: seen(), confirmed: true })).body.error.message).toBe("You can rate Ana Silva once she has rated you.");
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

  it("after 14 days without the developer's rating: the tester's rating shows and the window is closed", async () => {
    const { dev, testId, tester, sessionId } = await ratedByTester();
    await sact(sessionId, "rate", tester.cookie, { stars: 4 });
    await db.rating.updateMany({ where: { contractId: sessionId, side: "tester" }, data: { createdAt: new Date(Date.now() - 15 * 86_400_000) } });
    expect((await ratingSummary(dev.user.id)).line).toBe("4.0 ★ (1 rating)");
    expect((await act(testId, "rate", dev.cookie, { contractId: sessionId, stars: 5, seenAt: seen(), confirmed: true })).body.error.message).toBe("The 14 days to rate Ana Silva have passed.");
  });

});
