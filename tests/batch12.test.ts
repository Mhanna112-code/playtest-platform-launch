import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import * as R from "@/lib/rules";
import { MAX_OPEN_TESTS, TOO_MANY_OPEN_LINE } from "@/lib/subscription";
import { adminCases, runDaily } from "@/lib/server/holds";
import { decideDispute } from "@/lib/server/payments";
import { decideTerms } from "@/lib/server/terms";
import { deleteAccount } from "@/lib/server/restrictions";
import { devDeleteLines, DEV_DELETE_LINE } from "@/lib/server/deletion";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// Batch 12 (owner, Oct 29, evening): developer deletion (the owner's version), the unlisted call caps, Pay more on every paid piece, at most 10 open tests, the bank
// confirmation lock, and Open until as every tester's deadline with a 7-day review window.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const post = (cookie: string, over: Record<string, unknown> = {}) => testsPOST(req("/api/tests", { cookie, body: listingBody(over) })).then(json);
afterEach(() => setStripeForTests(null));

async function sentWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}

describe("batch 12 item 1: a developer can always delete their account", () => {
  it("the warning lists the counts, then what happens; nothing blocks the delete", async () => {
    const { dev, sessionId, tester, sub } = await sentWork();
    const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date(), payBy: new Date(), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    expect(rec).toBeTruthy();
    const lines = await devDeleteLines(dev.user.id);
    expect(lines.map((l) => l.text)).toEqual(["1 part waiting for your review", "1 part testers can still charge", DEV_DELETE_LINE]);
    expect(DEV_DELETE_LINE).toBe("Testers can still charge for parts already open to charging. Work you haven't reviewed can't be charged after you delete.");
    expect(src("lib/server/deletion.ts")).not.toContain("devDeleteBlockers");
    expect(src("app/app/account/page.tsx")).toContain("devLines={dev ? await devDeleteLines(u.id) : []}");
    expect(await deleteAccount(dev.user.id, "self")).toEqual({ ok: true });
    // Work still under review never opens Charge, and the tester reads why.
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await runDaily();
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull();
    expect(R.devDeletedLine("Nora Lane")).toBe("Nora Lane deleted their account, so this can't be paid.");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("developerDeleted={devGone && !sub.choiceOfferedAt ? devRealName : null}");
    expect(tester).toBeTruthy();
  });

  it("a part already open to charging stays open: the charge goes to the saved card; declined, there is no hold and it stays delayed for the admins", async () => {
    const { dev, sessionId, tester, sub } = await sentWork();
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await deleteAccount(dev.user.id, "self");
    setStripeForTests({ paymentIntents: { create: async () => { throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" }); } } } as unknown as Stripe);
    const c = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(c.status).toBe(200);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id, kind: "review" } });
    expect(p).toMatchObject({ status: "failed" });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
    expect((await adminCases()).some((x) => x.kind === "payout" && x.text === "Failed charge still owed: $10.00")).toBe(true);
  });

  it("an open dispute is still decided by the admins after the developer deletes; a decision for the tester charges the saved card", async () => {
    const { dev, tester, sessionId, sub } = await sentWork();
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful" })).status).toBe(200);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await devDeleteLines(dev.user.id)).map((l) => l.text)).toEqual(["1 open dispute", DEV_DELETE_LINE]);
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await deleteAccount(dev.user.id, "self");
    const made: { customer?: string }[] = [];
    setStripeForTests({ paymentIntents: { create: async (p: { customer?: string }) => { made.push(p); return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    const a = await makeUser({ name: "Admin" });
    const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const row = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(await decideDispute(admin, row.id, { total: "10.00", tickCents: 600 })).toEqual({ extraCents: 600 });
    expect(made).toHaveLength(1);
    expect(await db.payment.findFirstOrThrow({ where: { disputeId: row.id } })).toMatchObject({ kind: "dispute", amountCents: 600 });
  });
});

describe("batch 12 item 3: Pay more on every paid piece", () => {
  it("written answers, recordings and calls, listed or not", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain('<PayBox more={{ testId: t.id, contractId: c.id }} owes={owesNow} kind="submission"');
    expect(page).toContain('<PayBox more={{ testId: t.id, contractId: c.id }} owes={owesNow} kind="call"');
  });
});

describe("batch 12 item 4: at most 10 open tests", () => {
  it("the 11th is refused with the blue notice; counted at the press, so one stopped meanwhile lets it through", async () => {
    expect(MAX_OPEN_TESTS).toBe(10);
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await post(dev.cookie, { title: `Test ${i}` });
      expect(r.status).toBe(200);
      ids.push(r.body.id);
    }
    const eleventh = await post(dev.cookie, { title: "Eleven" });
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.error.message).toBe(TOO_MANY_OPEN_LINE);
    await act(ids[0], "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    expect((await post(dev.cookie, { title: "Eleven" })).status).toBe(200);
  });

  it("posting a draft at 10 open tests is refused the same way", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await post(dev.cookie, { title: `Test ${i}` })).body.id);
    await settle();
    const draft = await act(ids[0], "next-round", dev.cookie, { seenAt: seen(), confirmed: true });
    expect(draft.status).toBe(200);
    const r = await act(draft.body.id, "post-draft", dev.cookie, listingBody({ title: "Round 2" }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "too_many_open", message: TOO_MANY_OPEN_LINE });
  });
});

describe("batch 12 item 5: stop-once first, never twice", () => {
  it("a Pay with a change since the page loaded stops before any charge", async () => {
    const { dev, sub, testId } = await sentWork();
    const loaded = new Date(Date.now() - 60_000).toISOString();
    await db.testEvent.create({ data: { testId, kind: "joined", text: "Someone joined" } });
    let made = 0;
    setStripeForTests({ paymentIntents: { create: async () => { made++; return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    const r = await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { payKey: randomUUID(), seenAt: loaded, kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 } })).then(json);
    expect(r.body.error.code).toBe("stop_once");
    expect(made).toBe(0);
    const key = randomUUID();
    const twice = await Promise.all([1, 2].map(() => reviewPOST(req("/api/review", { cookie: dev.cookie, body: { payKey: key, seenAt: seen(), confirmed: true, kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 } })).then(json)));
    expect(twice.some((x) => x.status === 200)).toBe(true);
    expect(made).toBe(1);
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(1);
  });
});

describe("batch 12 item 6: Open until is required and is every tester's deadline; a 7-day review window", () => {
  it("Post needs Open until 3 to 30 days ahead; the 'days after joining' field is gone", async () => {
    const dev = await makeUser({ dev: true });
    expect((await post(dev.cookie, { openUntil: "" })).body.error.message).toBe(R.OPEN_UNTIL_RANGE);
    expect((await post(dev.cookie, { openUntil: day(2) })).body.error.message).toBe(R.OPEN_UNTIL_RANGE);
    expect((await post(dev.cookie, { openUntil: day(31) })).body.error.message).toBe("Open until can be at most 30 days from today.");
    expect((await post(dev.cookie, { openUntil: day(3) })).status).toBe(200);
    expect(src("app/app/tests/TestForm.tsx")).not.toContain("How long do new testers have?");
    expect(R.termsLine({ writtenCents: 1000, recordingCents: null, liveRateCents: null, liveMinutes: null, deadlineDays: 7 })).toBe("Written $10.00");
    expect(src("app/app/find/[id]/page.tsx")).toContain("Your deadline: {dueIfNow}");
    expect(src("app/app/find/[id]/page.tsx")).toContain("yourDeadlineLine(dueAt, days, utcDay)"); // (batch 15 section 18) "Dec 3 (14 days from joining)"
  });

  it("every tester's deadline is Open until, late joiners too; moving it later in Edit moves the working testers' deadlines; at most 30 days", async () => {
    const { dev, testId } = await setup({ openUntil: day(10) });
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const a = await joined(testId);
    expect((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).dueAt.getTime()).toBe(t.openUntil!.getTime());
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { openUntil: day(31) } })).body.error.message).toMatch(/^Open until can be at most 30 days after the test opened \([A-Z][a-z]{2} \d{1,2}\)\.$/); // (batch 16 section 16)
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { openUntil: day(20) }, seenAt: seen(), confirmed: true })).status).toBe(200);
    const t2 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).dueAt.getTime()).toBe(t2.openUntil!.getTime());
  });

  it("the review window is 7 days: Charge opens at the later of Open until and 7 days after sending; reminders 1 week / 3 days / 1 day", () => {
    expect(R.REVIEW_DAYS).toBe(7);
    const sent = new Date("2026-11-01T00:00:00Z");
    const payBy = R.payByFrom(sent);
    expect(payBy.toISOString()).toBe("2026-11-08T00:00:00.000Z");
    // (Batch 15 section 18) The tester's own deadline takes Open until's place.
    expect(R.chargeOpensAt({ payBy }, { openUntil: null, status: "open" }, { status: "working", dueAt: new Date("2026-11-05T23:59:59Z") })!.toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(R.chargeOpensAt({ payBy }, { openUntil: null, status: "open" }, { status: "working", dueAt: new Date("2026-11-20T23:59:59Z") })!.toISOString()).toBe("2026-11-20T23:59:59.000Z");
    // (Batch 15 section 2) The review reminders have their own marks (REVIEW_MARKS); Open until's heads-ups keep MARKS.
    const opens = new Date(Date.now() + 29 * DAY);
    expect(R.countdownDue(opens, new Date(), [], new Date(Date.now() - 40 * DAY))?.mark).toBe("1m");
    expect(R.choiceLine("Nora Lane", "written", 1000)).toBe("Nora Lane didn't review your written answers in 7 days: charge $10.00 or let it go");
  });

  it("switching to new terms never moves the deadline past Open until; the join page reads 'in 2 days 5 hours'", async () => {
    const { dev, testId } = await setup({ openUntil: day(4) });
    const a = await joined(testId);
    const before = (await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).dueAt;
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: a.sessionId, status: "open" } });
    await decideTerms({ id: a.tester.user.id }, a.sessionId, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true });
    expect((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).dueAt.getTime()).toBe(before.getTime());
    expect(R.leftText((2 * 24 + 5) * 3_600_000, true)).toBe("2 days 5 hours");
    expect(R.leftText(3_600_000, true)).toBe("1 hour");
  });

  it("a tester charge made under the old 14-day window is still recognised as the tester's choice", () => {
    expect(R.CHARGED_BY_TESTER).toBe("Charged by the tester after 7 days without a review.");
    expect(R.chargedByTester("Charged by the tester after 14 days without a review.")).toBe(true);
    expect(R.byTesterChoice(R.LET_GO_BY_TESTER)).toBe(true);
    expect(R.byTesterChoice("Good work")).toBe(false);
  });
});
