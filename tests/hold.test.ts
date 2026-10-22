import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { startHold } from "@/lib/server/holds";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 5));
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
    await db.user.update({ where: { id: ben.user.id }, data: { suspendedAt: new Date() } });
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
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [dee.user.id] });
    await db.testerProfile.update({ where: { userId: ben.user.id }, data: { languages: ["Spanish"] } });
    const r = await act(testId, "invite", dev.cookie, { seenAt: pageLoaded, testerIds: [cara.user.id, dee.user.id, ben.user.id] });
    expect(r.body.error.code).toBe("stop_once");
    const texts = r.body.error.changes.map((c: { text: string }) => c.text);
    expect(texts).toEqual(expect.arrayContaining(["Cara Diaz joined this test, so she's no longer in your invite list", "You also did this in another tab: invited Dee Moss", "Ben Carter removed English, which this test needs"]));
    await joined(testId, "Eve Ray");
    const full = await act(testId, "invite", dev.cookie, { seenAt: pageLoaded, testerIds: [ben.user.id], confirmed: true });
    expect(full.body.error.message).toBe("This test is full (2 of 2 spots), so nobody can be invited. Add spots in Edit to invite more.");
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ben.user.id], confirmed: true })).body.error.message).toMatch(/^This test was stopped on .+, so nobody can be invited\.$/);
  });
});

describe("payment hold", () => {
  it("pauses everything but sending; lifting it shifts deadlines and Open until by the pause", async () => {
    const { dev, testId } = await setup({ openUntil: new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10) });
    const { tester, sessionId } = await joined(testId);
    const before = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    const t0 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    await startHold(dev.user.id, "unpaid");
    // Sending still works; joining, booking, posting, Pay and Next round wait.
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toBe("Pay what you owe first.");
    const ben = await makeUser({ tester: true });
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).body.error.message).toBe("This test is paused, so it isn't taking new testers right now.");
    expect((await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody() })))).body.error.message).toContain("Pay what you owe first.");
    expect((await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true })).status).toBe(409);
    // Pretend the hold started 2 days ago, then pay what's owed (nothing failed) → lifts and shifts by ~2 days.
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 2 * DAY) } });
    const r = await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })));
    expect(r.body.lifted).toBe(true);
    const after = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    const t1 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(Math.round((after.dueAt.getTime() - before.dueAt.getTime()) / DAY)).toBe(2);
    expect(Math.round((t1.openUntil!.getTime() - t0.openUntil!.getTime()) / DAY)).toBe(2);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).status).toBe(200);
  });

  it("only booked calls whose time comes during the hold are cancelled; the tester reads only that the test is paused", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await act(testId, "offer-times", dev.cookie, { seenAt: seen(), confirmed: true, times: [new Date(Date.now() + 2 * DAY).toISOString(), new Date(Date.now() + 3 * DAY).toISOString()] });
    const slots = await db.callSlot.findMany({ where: { testId }, orderBy: { startsAt: "asc" } });
    await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[0].id });
    await startHold(dev.user.id, "unpaid");
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    expect(call.status).toBe("booked"); // a call after the hold may still happen
    // The hold goes on; the call's time comes while still on hold → cancelled.
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 2 * 3_600_000) } });
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    const { sweepHeldCalls } = await import("@/lib/server/holds");
    await sweepHeldCalls(dev.user.id);
    expect(await db.call.findFirstOrThrow({ where: { contractId: sessionId } })).toMatchObject({ status: "cancelled", cancelledBy: "system" });
    const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: tester.user.email, subject: { contains: "was cancelled" } } });
    expect(mail.text).toContain("This test is paused. Payment for your work may be delayed.");
    expect(mail.text).not.toMatch(/hold|chargeback|suspend/i);
    expect((await sact(sessionId, "book", tester.cookie, { seenAt: seen(), slotId: slots[1].id, confirmed: true })).body.error.message).toBe("This test is paused. Payment for your work may be delayed.");
    expect((await sact(sessionId, "leave", tester.cookie)).status).toBe(200); // may leave any time
  });
});

describe("chargebacks (Stripe dispute webhook)", () => {
  it("adds a developer stop-once reason and starts the hold; the admin resolving it lifts the hold", async () => {
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
    const r = await act(testId, "end-early", dev.cookie, { seenAt: pageLoaded, contractId: sessionId, reason: "We have enough" });
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toContain("Your bank reversed your $8.00 payment for Ana Silva's written answers");
    const owner = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: owner.user.id }, data: { isAdmin: true } });
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    const { POST: adminPOST } = await import("@/app/api/admin/[action]/route");
    expect((await adminPOST(req("/api/admin/resolve-chargeback", { cookie: owner.cookie, body: { id: p.id } }), { params: Promise.resolve({ action: "resolve-chargeback" }) })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
  });
});

describe("daily job", () => {
  it("needs CRON_SECRET", async () => {
    expect((await cronGET(new Request("http://localhost:3400/api/cron/daily"))).status).toBe(401);
  });

  it("pays contract parts after 14 days unreviewed (lower of listing and asked); never parts outside the contract; not during a hold", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await startHold(dev.user.id, "unpaid");
    await cron();
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0); // clock paused
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null } });
    await cron(); // day 14: the tester is offered the choice
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).not.toBeNull();
    await db.submission.update({ where: { id: sub.id }, data: { choiceBy: new Date(Date.now() - 1000) } });
    await cron(); // no choice within 14 more days: charged automatically
    expect(await db.review.findFirstOrThrow({ where: { submissionId: sub.id } })).toMatchObject({ amountCents: 1000, auto: true });
    // Outside the contract: never auto-paid; the developer gets a bell reminder every 7 days.
    const x = await setup({ writtenCents: null, questions: [] });
    const j = await joined(x.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["more feedback"] });
    const xs = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.submission.update({ where: { id: xs.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await cron();
    await cron(); // not reminded twice within 7 days
    expect(await db.review.count({ where: { submissionId: xs.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: x.dev.user.id, text: { contains: "still waits for you to pay or reject" } } })).toBe(1);
    // A contract part with a lower asked amount auto-pays the asked amount.
    const y = await setup();
    const k = await joined(y.testId);
    await sact(k.sessionId, "written", k.tester.cookie, { answers: ["a", "b"], ask: "6.00" });
    const ys = await db.submission.findFirstOrThrow({ where: { contractId: k.sessionId } });
    expect(ys.askedCents).toBe(600);
    await db.submission.update({ where: { id: ys.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await cron();
    await db.submission.update({ where: { id: ys.id }, data: { choiceBy: new Date(Date.now() - 1000) } });
    await cron();
    expect(await db.review.findFirstOrThrow({ where: { submissionId: ys.id } })).toMatchObject({ amountCents: 600, auto: true });
  });

  it("a failed charge unpaid after 3 days starts a hold; Open until heads-ups go 3 days and 1 day before", async () => {
    const { dev, testId } = await setup();
    const { tester } = await joined(testId);
    await db.payment.create({ data: { kind: "review", developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() - 1000), retriedAt: new Date() } });
    await cron(); // (already retried today, so the daily retry skips it)
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdReason).toBe("unpaid");
    const h = await setup();
    const hj = await joined(h.testId);
    await db.test.update({ where: { id: h.testId }, data: { openUntil: new Date(Date.now() + 2 * DAY) } });
    await cron();
    const n = () => db.notification.count({ where: { userId: hj.tester.user.id, text: { contains: "closes on" } } });
    expect(await n()).toBe(1);
    await cron(); // not twice
    expect(await n()).toBe(1);
    await db.test.update({ where: { id: h.testId }, data: { openUntil: new Date(Date.now() + 12 * 3_600_000) } });
    await cron();
    expect(await n()).toBe(2);
  });
});

describe("Open until", () => {
  it("can be moved later before it passes, never after", async () => {
    const { dev, testId } = await setup({ openUntil: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10) });
    let v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { openUntil: new Date(Date.now() + 9 * DAY).toISOString().slice(0, 10) } })).status).toBe(200);
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - DAY) } });
    v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    const r = await act(testId, "edit", dev.cookie, { version: v, fields: { openUntil: new Date(Date.now() + 9 * DAY).toISOString().slice(0, 10) } });
    expect(r.body.error.message).toMatch(/^Joining closed on .+ \(Open until\), so it can't be extended\.$/);
  });
});
