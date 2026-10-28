import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as verifyPOST } from "@/app/api/payments/verify-card/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { runDaily, startHold } from "@/lib/server/holds";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, listingBody, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 30));
const DAY = 86_400_000;
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } }));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), ...body } })).then(json);
afterEach(() => setStripeForTests(null));

describe("invites", () => {
  it("invites the testers who can be invited and names the others with reasons", async () => {
    const { dev, testId } = await setup();
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const dee = await makeUser({ tester: true, name: "Dee Moss" });
    const ben = await makeUser({ tester: true, name: "Ben Carter", pronoun: "he" });
    await db.user.update({ where: { id: ben.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    const r = await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ana.user.id, dee.user.id, ben.user.id] });
    expect(r.body.message).toBe("Invited Ana Silva and Dee Moss. Ben Carter can't be invited right now.");
    expect(await db.invite.count({ where: { testId, status: "sent" } })).toBe(2);
    // The tester joins with the normal Join; the invite becomes joined.
    expect((await act(testId, "join", ana.cookie, { listingVersion: 1 })).status).toBe(200);
    expect((await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id } })).status).toBe("joined");
  });

  it("stops once when a ticked tester joined, was invited in another tab, or no longer fits; refused for good when full or stopped", async () => {
    const { dev, testId } = await setup({ languages: ["English"], spots: 2 });
    const cara = await makeUser({ tester: true, name: "Cara Diaz", pronoun: "she" });
    const dee = await makeUser({ tester: true, name: "Dee Moss" });
    const ben = await makeUser({ tester: true, name: "Ben Carter", pronoun: "he" });
    const pageLoaded = seen();
    await later();
    await act(testId, "join", cara.cookie, { listingVersion: 1 });
    await later(); // the clock can lag a few ms: let the join settle before the other tab's page time
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [dee.user.id], tab: "tab-2" });
    await db.testerProfile.update({ where: { userId: ben.user.id }, data: { languages: ["Spanish"] } });
    const r = await act(testId, "invite", dev.cookie, { seenAt: pageLoaded, testerIds: [cara.user.id, dee.user.id, ben.user.id], tab: "tab-1" });
    expect(r.body.error.code).toBe("stop_once");
    const texts = r.body.error.changes.map((c: { text: string }) => c.text);
    expect(texts).toEqual(expect.arrayContaining(["Cara Diaz joined this test, so she's no longer in your invite list", "You invited Dee Moss in another tab", "Ben Carter removed English, which this test needs"]));
    await joined(testId, "Eve Ray");
    const full = await act(testId, "invite", dev.cookie, { seenAt: pageLoaded, testerIds: [ben.user.id], confirmed: true });
    expect(full.body.error.message).toBe("Harbor Run is full. Add spots to invite more people.");
    await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ben.user.id], confirmed: true })).body.error.message).toMatch(/^This test was stopped on .+, so nobody can be invited\.$/);
  });
});

describe("payment hold", () => {
  it("pauses everything, the testers' sending too (batch 6); Pay waits; lifting it shifts deadlines and Open until by the pause", async () => {
    const { dev, testId } = await setup({ openUntil: new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10) });
    const { tester, sessionId } = await joined(testId);
    const before = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    const t0 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    await startHold(dev.user.id, "unpaid");
    // (Owner, Oct 28 afternoon) Sending waits for the tester too; joining, booking, posting, Pay, Reject and Next round wait.
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).body.error.message).toBe("This test is paused right now. You can send this once it resumes.");
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    // (Owner, Oct 27) Pay and Reject are unavailable during ANY hold: refused, and the refusal names the press for the dashboard box.
    const waits = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(waits.status).toBe(403);
    expect(waits.body.error).toMatchObject({ code: "held", failed: "Your Pay on Harbor Run didn't go through" });
    expect((await pay(dev.cookie, { amount: "0", kind: "submission", id: sub.id, reason: "Not useful" })).body.error.code).toBe("held");
    expect(await db.payment.count({ where: { submissionId: sub.id } })).toBe(0);
    const ben = await makeUser({ tester: true });
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).body.error.message).toBe("This test is paused right now.");
    expect((await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody() })))).body.error.code).toBe("held");
    expect((await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true })).body.error.code).toBe("held");
    // Pretend the hold started 2 days ago, then pay what's owed (nothing failed) → lifts and shifts by ~2 days.
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 2 * DAY) } });
    const r = await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })));
    expect(r.body.lifted).toBe(true);
    const after = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    const t1 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(Math.round((after.dueAt.getTime() - before.dueAt.getTime()) / DAY)).toBe(2);
    expect(Math.round((t1.openUntil!.getTime() - t0.openUntil!.getTime()) / DAY)).toBe(2);
    // Lifted: Pay works again.
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  });

  it("calls starting within 3 days are cancelled with no fault when the hold starts; later ones 3 days before they start while it lasts; the tester reads only that the test is paused", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const soon = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const later5 = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 24 * 5);
    await startHold(dev.user.id, "unpaid");
    expect(await db.call.findUniqueOrThrow({ where: { id: soon.id } })).toMatchObject({ status: "cancelled", cancelledBy: "system" });
    expect((await db.call.findUniqueOrThrow({ where: { id: later5.id } })).status).toBe("booked"); // a call after the hold may still happen
    const line = await db.notification.findFirstOrThrow({ where: { userId: tester.user.id, text: { contains: "was cancelled" } } });
    expect(line.text).toContain("because the test is paused");
    expect(line.text).not.toMatch(/hold|chargeback|suspend/i);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "was cancelled because the test is paused" } } })).toBe(1); // both sides told
    // The hold goes on: 3 days before the later call (2 days later), the daily job cancels it.
    const { cancelLatePauseCalls } = await import("@/lib/server/restrictions");
    expect(await cancelLatePauseCalls(new Date(Date.now() + 1.5 * DAY))).toBe(0);
    expect(await cancelLatePauseCalls(new Date(Date.now() + 2.5 * DAY))).toBe(1);
    expect(await db.call.findUniqueOrThrow({ where: { id: later5.id } })).toMatchObject({ status: "cancelled", cancelledBy: "system" });
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), startsAt: new Date(Date.now() + 3 * DAY).toISOString(), confirmed: true })).body.error.message).toBe("This test is paused right now. You can request calls once it resumes.");
    expect((await sact(sessionId, "leave", tester.cookie)).status).toBe(200); // may leave any time
  });
});

describe("chargebacks (Stripe dispute webhook)", () => {
  it("adds a developer stop-once reason and starts the hold; the card check and the admin's approval lift it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "8.00", tickedCents: 800, reason: "Short answers", confirmed: true });
    const pi = "pi_" + randomUUID();
    await db.payment.updateMany({ where: { submissionId: sub.id }, data: { stripePaymentIntentId: pi } });
    setStripeForTests({ webhooks: { constructEvent: (raw: string, sig: string) => { if (sig !== "good") throw new Error("bad"); return JSON.parse(raw); } } } as unknown as Stripe);
    const hook = (sig: string) => webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig }, body: JSON.stringify({ type: "charge.dispute.created", data: { object: { payment_intent: pi } } }) }));
    expect((await hook("bad")).status).toBe(400);
    const pageLoaded = seen();
    await later();
    expect((await hook("good")).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
    // (Owner, Oct 27) Every developer press is refused during a hold, except (batch 15 section 29) Stop, End early and Cancel call; the bank's reversal is on the test's list of events.
    const r = await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded });
    expect(r.body.error.code).toBe("held");
    expect((await db.testEvent.findMany({ where: { testId, kind: "chargeback" } })).map((e) => e.text)).toContain("Your bank reversed your $8.00 payment for Ana Silva's written answers");
    const owner = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: owner.user.id }, data: { isAdmin: true } });
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    const { POST: adminPOST } = await import("@/app/api/admin/[action]/route");
    const approve = () => adminPOST(req("/api/admin/approve-chargeback", { cookie: owner.cookie, body: { id: dev.user.id } }), { params: Promise.resolve({ action: "approve-chargeback" }) }).then(json);
    expect((await approve()).body.error.code).toBe("steps_missing"); // the card isn't verified yet
    setStripeForTests(null); // no Stripe here (dev): the card check is simulated
    expect((await verifyPOST(req("/api/payments/verify-card", { cookie: dev.cookie, body: {} }))).status).toBe(200); // simulated without Stripe
    // (Owner, Oct 27) The reversed $8.00 is owed again (batch 11: with the $15 fee): Approve waits for it to be paid with "Pay what you owe".
    expect((await approve()).body.error.message).toBe("Not yet: $23.00 is still owed.");
    const paid = await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })));
    expect(paid.body).toMatchObject({ paid: 1, stillFailing: [] });
    expect(await db.payment.findFirstOrThrow({ where: { repaysId: p.id } })).toMatchObject({ kind: "chargeback", amountCents: 2300, testerCents: 0, status: "not_set_up" }); // (batch 11) with the $15 fee
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull(); // paying alone never lifts a chargeback hold
    expect((await approve()).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
  });
});

describe("daily job", () => {
  it("needs CRON_SECRET", async () => {
    expect((await cronGET(new Request("http://localhost:3400/api/cron/daily"))).status).toBe(401);
  });

  it("offers Charge / Let it go once the review date passes (the listing amount); never for parts outside the contract; not during a hold", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 1000) } }); await db.contract.updateMany({ where: { testId: testId }, data: { dueAt: new Date(Date.now() - 1000) } }); // (batch 15 section 18: the tester's own deadline) // Charge opens only after Open until (Owner, Oct 26)
    await startHold(dev.user.id, "unpaid");
    await cron();
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0); // clock paused
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null } });
    await cron(); // day 14: the tester is offered the choice
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).not.toBeNull();
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000 })).body).toMatchObject({ amountCents: 1000 });
    // Outside the contract: never auto-paid; the developer gets a bell reminder every 7 days.
    const x = await setup({ writtenCents: null, questions: [] });
    const j = await joined(x.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["more feedback"] });
    const xs = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    // (Batch 15 section 2) Its review date passed: no Charge, never auto-paid, and its reminders have stopped (the row stays).
    await db.submission.update({ where: { id: xs.id }, data: { payBy: new Date(Date.now() - 1000), updatedAt: new Date(Date.now() - 8 * 86_400_000) } });
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: new Date(Date.now() - 1000) } });
    await cron();
    await cron();
    expect(await db.review.count({ where: { submissionId: xs.id } })).toBe(0);
    expect((await db.submission.findUniqueOrThrow({ where: { id: xs.id } })).choiceOfferedAt).toBeNull();
    // A stray ask on a send is ignored: Charge is always the listing.
    const z = await setup();
    const m = await joined(z.testId);
    await sact(m.sessionId, "written", m.tester.cookie, { answers: ["a", "b"], ask: "6.00" });
    const zs = await db.submission.findFirstOrThrow({ where: { contractId: m.sessionId } });
    expect(zs.askedCents).toBeNull();
    await db.submission.update({ where: { id: zs.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await db.test.update({ where: { id: z.testId }, data: { openUntil: new Date(Date.now() - 1000) } }); await db.contract.updateMany({ where: { testId: z.testId }, data: { dueAt: new Date(Date.now() - 1000) } }); // (batch 15 section 18: the tester's own deadline)
    await cron();
    expect((await sact(m.sessionId, "choose", m.tester.cookie, { submissionId: zs.id, choice: "charge", tickedCents: 1000 })).body).toMatchObject({ amountCents: 1000 });
  });

  it("the daily job never retries a declined payment or starts a hold by itself (a decline is a hold at once); Open until heads-ups go 3 days and 1 day before", async () => {
    const { dev, testId } = await setup();
    const { tester } = await joined(testId);
    const failed = await db.payment.create({ data: { kind: "review", developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() - 1000) } });
    await cron();
    expect((await db.payment.findUniqueOrThrow({ where: { id: failed.id } })).retriedAt).toBeNull(); // no daily retries
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "Pay $" } } })).toBe(0); // no "Pay $X by ..." reminder
    const h = await setup();
    const hj = await joined(h.testId);
    await db.test.update({ where: { id: h.testId }, data: { openUntil: new Date(Date.now() + 2 * DAY) } }); await db.contract.updateMany({ where: { testId: h.testId }, data: { dueAt: new Date(Date.now() + 2 * DAY), joinedAt: new Date(Date.now() - 5 * DAY) } }); // (batch 16 section 1: the tester's own deadline, joined 5 days ago: the 3-day mark)
    await cron();
    const n = () => db.notification.count({ where: { userId: hj.tester.user.id, text: { startsWith: "Your deadline on" } } }); // (batch 15 section 18: each tester reads their own deadline)
    expect(await n()).toBe(1);
    await cron(); // not twice
    expect(await n()).toBe(1);
    await runDaily(new Date(Date.now() + DAY + 60_000)); // (batch 16 section 1) a day later: the 1-day mark
    expect(await n()).toBe(2);
  });
});

describe("Open until", () => {
  it("can be moved later before it passes, never after", async () => {
    const { dev, testId } = await setup({ deadlineDays: 2, openUntil: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10) });
    let v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { openUntil: new Date(Date.now() + 9 * DAY).toISOString().slice(0, 10) } })).status).toBe(200);
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - DAY) } }); await db.contract.updateMany({ where: { testId: testId }, data: { dueAt: new Date(Date.now() - DAY) } }); // (batch 15 section 18: the tester's own deadline)
    v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    const r = await act(testId, "edit", dev.cookie, { version: v, fields: { openUntil: new Date(Date.now() + 9 * DAY).toISOString().slice(0, 10) } });
    expect(r.body.error.message).toMatch(/^Joining closed on .+ \(Open until\), so it can't be extended\.$/);
  });
});
