import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import * as R from "@/lib/rules";
import { decideDispute, disputeBounds } from "@/lib/server/payments";
import { liftHoldIfClear, owed, payOwed, startHold } from "@/lib/server/holds";
import { approveChargebackHold, startCardVerification } from "@/lib/server/chargeback";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 10 (owner, Oct 29): every reviewed part can be disputed, a paused test hides what doesn't work, long answers scroll, the suspended payment line, a live owed box,
// and a chargeback the platform wins.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const extra = (testId: string, cookie: string, body: Record<string, unknown>) => act(testId, "pay-extra", cookie, { seenAt: seen(), confirmed: true, payKey: randomUUID(), ...body });
const admin = async () => {
  const a = await makeUser({ name: "Admin" });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
};
const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
const pulse = (cookie: string, query: string) => pulseGET(req(`/api/pulse?${query}`, { method: "GET", cookie })).then(json);
const webhook = (type: string, object: Record<string, unknown>) =>
  webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t" }, body: JSON.stringify({ type, data: { object } }) }));
afterEach(() => setStripeForTests(null));

/** Written answers sent on a test (listed at `writtenCents`, or not listed with null). */
async function sentWork(writtenCents: string | null) {
  const s = await setup(writtenCents == null ? { writtenCents: null, questions: [] } : { writtenCents });
  const j = await joined(s.testId);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}
const dispute = (sessionId: string, cookie: string, body: Record<string, unknown>) => sact(sessionId, "dispute", cookie, { reason: "I answered every question fully", seenAt: seen(), confirmed: true, ...body });

describe("batch 10 item 1: every reviewed part can be disputed", () => {
  it("the rule: any amount, $0 included, listed or not, and a Reject; once; never the tester's own Charge or Let it go", () => {
    expect(R.canDispute(1000, 1000, false)).toEqual({ ok: true });
    expect(R.canDispute(1500, 1000, false)).toEqual({ ok: true });
    expect(R.canDispute(0, null, false)).toEqual({ ok: true });
    expect(R.canDispute(50_000, null, false)).toEqual({ ok: true });
    expect(R.canDispute(500, 1000, true)).toMatchObject({ ok: false, message: "You already disputed this payment. A part can be disputed once." });
    expect(R.canDispute(500, 1000, false, true)).toEqual({ ok: false, message: R.TESTER_CHOSE_LINE });
    expect(R.disputeLimitText(1000, "submission")).toBe("up to the listing amount");
    expect(R.disputeLimitText(null, "submission")).toBe("up to $1,000 for this piece");
    expect(R.disputeLimitText(null, "call")).toBe("up to $200 an hour for the logged minutes");
    expect(src("lib/rules.ts")).not.toContain("so the developer's amount is final");
    expect(src("app/app/sessions/[id]/page.tsx")).not.toContain("the developer&apos;s amount is final");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("limit={disputeLimitText(review.agreedCents, kind)}");
  });

  it("an unlisted written piece paid $0: the tester disputes it; the admin can raise it up to $1000 minus what was already paid (extra pay counts)", async () => {
    const { dev, tester, testId, sessionId, sub } = await sentWork(null);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "Not needed after all" })).status).toBe(200);
    expect((await extra(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "200.00", tickedCents: 20_000 })).status).toBe(200);
    const d = await dispute(sessionId, tester.cookie, { kind: "submission", id: sub.id });
    expect(d.status).toBe(200);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Ana Silva disputed a payment on “Harbor Run”" } })).toBe(1);
    const row = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(await disputeBounds(row)).toMatchObject({ unlisted: true, listing: 100_000, other: 20_000, min: 0, max: 80_000 });
    // Once only.
    expect((await dispute(sessionId, tester.cookie, { kind: "submission", id: sub.id })).body.error.message).toBe("You already disputed this payment. A part can be disputed once.");
    const a = await admin();
    await expect(decideDispute(a, row.id, { total: "800.01" })).rejects.toThrow("At most $800.00: the max of $1,000.00 for a part that isn't listed minus the $200.00 already paid for this part.");
    expect(await decideDispute(a, row.id, { total: "800.00" })).toEqual({ extraCents: 80_000 });
    // No Stripe in tests: the raise is recorded ("payments not set up") at once, as any decision outside a hold.
    expect(await db.payment.findFirstOrThrow({ where: { disputeId: row.id } })).toMatchObject({ kind: "dispute", amountCents: 80_000, status: "not_set_up" });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Your dispute on “Harbor Run” was decided" } })).toBe(1);
  });

  it("an unlisted call: the admin's max is $200/h × the logged minutes; during a hold the raise is added to what is owed", async () => {
    const s = await setup({ liveRateCents: null });
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 2 * 3_600_000), actualMinutes: 30 } });
    expect((await pay(s.dev.cookie, { kind: "call", id: call.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await dispute(j.sessionId, j.tester.cookie, { kind: "call", id: call.id })).status).toBe(200);
    const row = await db.dispute.findFirstOrThrow({ where: { callId: call.id } });
    expect(await disputeBounds(row)).toMatchObject({ unlisted: true, listing: 10_000, max: 10_000 });
    await startHold(s.dev.user.id, "unpaid");
    const a = await admin();
    await expect(decideDispute(a, row.id, { total: "100.01" })).rejects.toThrow("At most $100.00");
    expect(await decideDispute(a, row.id, { total: "100.00" })).toEqual({ extraCents: 9000 });
    expect(await db.payment.findFirstOrThrow({ where: { disputeId: row.id } })).toMatchObject({ status: "owed", amountCents: 9000 });
    expect((await owed(s.dev.user.id)).map((p) => p.amountCents)).toEqual([9000]);
  });

  it("a listed part paid the listing (or more) and a Reject can be disputed; the tester's own Charge can't", async () => {
    const full = await sentWork("10.00");
    expect((await pay(full.dev.cookie, { kind: "submission", id: full.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await dispute(full.sessionId, full.tester.cookie, { kind: "submission", id: full.sub.id })).status).toBe(200);
    // The listing's range is unchanged: a part paid the listing can only be kept.
    expect(await disputeBounds((await db.dispute.findFirstOrThrow({ where: { submissionId: full.sub.id } })))).toMatchObject({ unlisted: false, min: 1000, max: 1000 });

    const rej = await sentWork("10.00");
    expect((await pay(rej.dev.cookie, { kind: "submission", id: rej.sub.id, action: "reject", reason: "Not what I asked" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: rej.tester.user.id, text: "Your written answers on “Harbor Run” wasn't accepted" } })).toBe(1);
    expect((await dispute(rej.sessionId, rej.tester.cookie, { kind: "submission", id: rej.sub.id })).status).toBe(200);

    const ch = await sentWork("10.00");
    await db.submission.update({ where: { id: ch.sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 14 * DAY) } });
    await settle();
    expect((await sact(ch.sessionId, "choose", ch.tester.cookie, { submissionId: ch.sub.id, choice: "charge", amount: "6.00", tickedCents: 600, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await dispute(ch.sessionId, ch.tester.cookie, { kind: "submission", id: ch.sub.id })).body.error.message).toBe(R.TESTER_CHOSE_LINE);
    // The Pay box says the tester can dispute, listed or not.
    const box = src("app/app/tests/[id]/PayBox.tsx");
    expect(box).toContain("can dispute your decision once");
    expect(box).toContain("can dispute the amount once");
    expect(box).not.toContain("It can't be rejected or disputed.");
  });
});

describe("batch 10 item 2: a paused test hides what doesn't work, with a banner that says what still does", () => {
  const all = { drafts: true, charge: true, dispute: true, rate: true, leave: true, cancelCalls: true, send: true, requestCalls: true, chat: true };
  it("the banner text, built from what is available (never hold, suspended, failed or chargeback)", () => {
    expect(R.pausedForTesters(all)).toBe(
      "This test is paused right now. For now you can save drafts of your parts, charge or let go of work left unreviewed, dispute, rate, leave the test, and cancel booked calls. Sending work, requesting calls and chat come back when it resumes.",
    );
    expect(R.PAUSED_FOR_TESTERS).toBe(R.pausedForTesters(all));
    const noCharge = R.pausedForTesters({ ...all, charge: false });
    expect(noCharge).not.toContain("charge or let go");
    expect(noCharge).toContain("For now you can save drafts of your parts, dispute, rate, leave the test, and cancel booked calls.");
    expect(R.pausedForTesters({ ...all, drafts: false, charge: false, dispute: false, rate: false, cancelCalls: false })).toBe(
      "This test is paused right now. For now you can leave the test. Sending work, requesting calls and chat come back when it resumes.",
    );
    expect(R.pausedForTesters({ ...all, drafts: false, charge: false, dispute: false, cancelCalls: false, send: false, requestCalls: false })).toBe(
      "This test is paused right now. For now you can rate and leave the test. Chat comes back when it resumes.",
    );
    for (const can of [all, { ...all, chat: false }, { ...all, leave: false, send: false }]) expect(R.pausedForTesters(can)).not.toMatch(/hold|suspend|fail|chargeback/i);
  });

  it("the session page: the banner at the top; Send, the call-request tools, Join call and chat's message box hidden while paused", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain("const pausedBanner = rulesPaused ? pausedForTesters({");
    // The banner sits right under the title, above the key box and the live box.
    expect(page.indexOf('{pausedBanner && <p className="info" data-paused="">{pausedBanner}</p>}')).toBeLessThan(page.indexOf("{key && <KeyBox"));
    expect(page).toContain("<WrittenForm canSend={!rulesPaused}");
    expect(page).toContain("sendable={!rulesPaused}");
    expect(page).toContain("(canRequestCall || (pendingReqs.length > 0 && !paused))");
    expect(page).toContain("const canRequestCall = !refusal && !blockedPair && !paused;");
    expect(page).toContain("joinable: !blockedPair && !paused && callJoinable(x, now)");
    expect(page).toContain("chat={!meOff && !chatPaused ?");
    expect(src("app/app/chat/[id]/page.tsx")).toContain("closed={blocked || paused}");
    const actions = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(actions).toContain("{canSend && <button className=\"btn\" disabled={busy || length > WRITTEN_MAX_CHARS}>");
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).toContain("{canSend && sendable && uploaded.length > 0 && (");
    // Testers' dashboard rows keep the "Paused" tag.
    expect(src("app/app/page.tsx")).toContain("{c.title} {pausedTest(c.test) && <PausedTag />}");
  });

  it("the server refusals stay as a backstop", async () => {
    const { dev, sessionId, tester } = await sentWork("10.00");
    await startHold(dev.user.id, "unpaid");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["c", "d"] })).body.error.message).toBe(R.PAUSED_SEND);
    expect((await sact(sessionId, "message", tester.cookie, { body: "Hello?" })).body.error.message).toBe(R.CHAT_PAUSED);
  });

  it("a tester's session page keeps refreshing while the developer is on a hold, and a suspension or the team's pause shows live", async () => {
    const { dev, testId, sessionId, tester } = await sentWork("10.00");
    const v0 = (await pulse(tester.cookie, `session=${sessionId}`)).body.v;
    await startHold(dev.user.id, "unpaid");
    const held = await pulse(tester.cookie, `session=${sessionId}`);
    expect(held.body.restricted).toBe(false);
    expect(held.body.v).not.toBe(v0);
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date() } });
    expect((await pulse(tester.cookie, `session=${sessionId}`)).body.v).not.toBe(held.body.v);
    // The developer's own test page is still routed away while they are on hold.
    expect((await pulse(dev.cookie, `test=${testId}`)).body.restricted).toBe(true);
  });
});

describe("batch 10 item 3: long written answers scroll on the developer's side", () => {
  it("one piece's answers sit in a scroll box about 16 lines tall; the Pay box stays outside it", () => {
    const box = src("components/AnswersBox.tsx");
    expect(box).toContain("max-h-[20rem]"); // 16 lines of text-sm (1.25rem each)
    expect(box).toContain("overflow-y-auto");
    const page = src("app/app/tests/[id]/page.tsx");
    const open = page.indexOf("<AnswersBox>"), close = page.indexOf("</AnswersBox>");
    expect(open).toBeGreaterThan(0);
    // The question labels are inside; the Pay box comes after the box closes.
    expect(page.slice(open, close)).toContain("<SetView items={itemsOf(x.s!.answers, writtenQuestions(x.c))} />"); // (batch 13) each answer under its own question
    expect(page.slice(open, close)).toContain("<Formatted text={x.s!.notes} />");
    expect(page.slice(open, close)).not.toContain("<PayBox");
    expect(page.indexOf('<PayBox owes={owesNow} key={x.s!.id} kind="submission"')).toBeGreaterThan(close);
  });
});

describe("batch 10 item 4: paying what is owed while a suspension continues", () => {
  it("the payment line instead of 'running again' (sent even with email Off); 'running again' only when nothing pauses the tests", async () => {
    const { dev } = await setup();
    await startHold(dev.user.id, "unpaid");
    await db.user.update({ where: { id: dev.user.id }, data: { suspendedAt: new Date(), emailPref: "off" } });
    expect(await liftHoldIfClear(dev.user.id)).toBe(true);
    expect(R.STILL_SUSPENDED_LINE).toBe("Your payment went through. Your tests stay paused while your account is suspended.");
    expect(await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: R.STILL_SUSPENDED_LINE } })).toMatchObject({ mustEmail: true });
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Your tests are running again" } })).toBe(0);
    // Without a suspension: "Your tests are running again".
    const other = await setup();
    await startHold(other.dev.user.id, "unpaid");
    expect(await liftHoldIfClear(other.dev.user.id)).toBe(true);
    expect(await db.notification.count({ where: { userId: other.dev.user.id, text: "Your tests are running again" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: other.dev.user.id, text: R.STILL_SUSPENDED_LINE } })).toBe(0);
  });

  it("a chargeback hold cleared while suspended sends the same line", async () => {
    const { dev } = await setup();
    await startHold(dev.user.id, "chargeback");
    await db.user.update({ where: { id: dev.user.id }, data: { suspendedAt: new Date() } });
    await startCardVerification(await db.user.findUniqueOrThrow({ where: { id: dev.user.id } }));
    expect((await approveChargebackHold(dev.user.id)).lifted).toBe(true);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: R.STILL_SUSPENDED_LINE } })).toBe(1);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Your tests are running again" } })).toBe(0);
  });
});

describe("batch 10 item 5: Pay what you owe updates live and never charges twice", () => {
  async function heldWithFailed(amounts: number[]) {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await withCard(dev.user.id);
    const rows = [];
    for (const amountCents of amounts) rows.push(await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } }));
    await startHold(dev.user.id, "unpaid");
    return { dev, tester, testId, sessionId, rows };
  }

  it("the Payments page polls the owed box; its fingerprint changes when something is added or paid", async () => {
    const { dev, tester, sessionId } = await heldWithFailed([800]);
    const a = await pulse(dev.cookie, "owed=1");
    expect(a.status).toBe(200);
    expect(a.body.restricted).toBe(false); // Payments stays open during a hold
    // A tester's Charge during the hold is added to what is owed.
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "owed" } });
    const b = await pulse(dev.cookie, "owed=1");
    expect(b.body.v).not.toBe(a.body.v);
    const page = src("app/app/payments/page.tsx");
    expect(page).toContain('{dev && <AutoRefresh query="owed=1" />}');
    expect(page).toContain("if (!o.length) return review ?");
    expect(src("components/OwedBox.tsx")).toContain('e.code === "nothing_owed"');
  });

  it("a press after a change stops once (a tester's Charge reads 'Added to what you owe meanwhile'); paid in another tab, a later press is refused and nothing is charged", async () => {
    const { dev, tester, sessionId, rows } = await heldWithFailed([800]);
    let charges = 0;
    setStripeForTests({ paymentIntents: { create: async () => { charges++; return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    const press = (body: Record<string, unknown>) => owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body })).then(json);
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "owed" } });
    const stop = await press({ seenTotalCents: 800, seenIds: [rows[0].id] });
    expect(stop.body.error.code).toBe("stop_once");
    expect(stop.body.error.changes[0].text).toBe("Added to what you owe meanwhile: Ana Silva's written answers $5.00 · charged by the tester while your tests were paused. New total $13.00. Press again to pay $13.00.");
    // Tab A pays.
    const paid = await press({ seenTotalCents: 1300, seenIds: stop.body.error.ids, confirmed: true });
    expect(paid.body).toMatchObject({ paid: 2, lifted: true });
    expect(charges).toBe(2);
    // Tab B presses with the old page: refused, nothing charged.
    const again = await press({ seenTotalCents: 1300, seenIds: stop.body.error.ids, confirmed: true });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "nothing_owed", message: "There's nothing to pay: what you owed is already paid." });
    expect(charges).toBe(2);
  });

  it("two presses at the same moment charge each owed payment once", async () => {
    const { dev, rows } = await heldWithFailed([800, 300]);
    let charges = 0;
    setStripeForTests({ paymentIntents: { create: async () => { charges++; await new Promise((r) => setTimeout(r, 40)); return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    const u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    const body = { seenTotalCents: 1100, seenIds: rows.map((r) => r.id) };
    const results = await Promise.allSettled([payOwed(u, body), payOwed(u, body)]);
    expect(charges).toBe(2);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(await db.payment.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "charged" });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
  });

  it("a declined retry goes back to owed (still listed), and the hold stays", async () => {
    const { dev, rows } = await heldWithFailed([800]);
    setStripeForTests({ paymentIntents: { create: async () => { throw new Error("Your card was declined."); } } } as unknown as Stripe);
    const r = await payOwed(await db.user.findUniqueOrThrow({ where: { id: dev.user.id } }));
    expect(r).toMatchObject({ paid: 0, lifted: false });
    expect(await db.payment.findUniqueOrThrow({ where: { id: rows[0].id } })).toMatchObject({ status: "failed", settledAt: null });
    expect((await owed(dev.user.id)).map((p) => p.id)).toEqual([rows[0].id]);
  });
});

describe("batch 10 item 6: a chargeback the platform wins", () => {
  /** A paid written piece (charged on the card through the Stripe stand-in), then a chargeback on it. */
  async function chargedBack(holdCount?: number) {
    const s = await sentWork("10.00");
    await withCard(s.dev.user.id);
    const refunds: string[] = [];
    setStripeForTests({
      paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) },
      refunds: { create: async (p: { payment_intent: string }) => { refunds.push(p.payment_intent); return { id: "re_" + randomUUID() }; } },
      webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    } as unknown as Stripe);
    expect((await pay(s.dev.cookie, { kind: "submission", id: s.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: s.sub.id, status: "charged" } });
    if (holdCount) await db.user.update({ where: { id: s.dev.user.id }, data: { holdCount } });
    expect((await webhook("charge.dispute.created", { payment_intent: p.stripePaymentIntentId })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } })).holdReason).toBe("chargeback");
    return { ...s, p, refunds };
  }

  it("not paid yet: the amount leaves what is owed and the hold lifts as usual; bell and email to the developer", async () => {
    const { dev, p } = await chargedBack();
    expect((await owed(dev.user.id)).map((x) => x.id)).toEqual([p.id]);
    expect((await webhook("charge.dispute.closed", { payment_intent: p.stripePaymentIntentId, status: "won" })).status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ chargeback: "won" });
    expect(await owed(dev.user.id)).toEqual([]);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Your bank's chargeback of $10.00 was reversed in your favour." } })).toBe(1);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Your tests are running again" } })).toBe(1);
    // The same webhook again changes nothing.
    await webhook("charge.dispute.closed", { payment_intent: p.stripePaymentIntentId, status: "won" });
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Your bank's chargeback of $10.00 was reversed in your favour." } })).toBe(1);
  });

  it("already paid: that amount is refunded to their card with a receipt line", async () => {
    const { dev, p, refunds } = await chargedBack();
    expect(await payOwed(await db.user.findUniqueOrThrow({ where: { id: dev.user.id } }))).toMatchObject({ paid: 1, lifted: false });
    const repay = await db.payment.findFirstOrThrow({ where: { repaysId: p.id } });
    expect(repay).toMatchObject({ kind: "chargeback", status: "charged" });
    await webhook("charge.dispute.closed", { payment_intent: p.stripePaymentIntentId, status: "won" });
    expect(refunds).toEqual([repay.stripePaymentIntentId]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: repay.id } })).toMatchObject({ status: "refunded" });
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Refund: your bank's chargeback of $10.00 was reversed" } })).toBe(1);
    // No card check or Approve is needed any more: it lifts like a payment hold.
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
    expect(src("app/app/payments/page.tsx")).toContain("refunded (your bank's chargeback was reversed)");
  });

  it("from the 4th hold on, Approve is still needed; anything else still owed keeps the (payment) hold", async () => {
    const a = await chargedBack(4);
    await webhook("charge.dispute.closed", { payment_intent: a.p.stripePaymentIntentId, status: "won" });
    const u = await db.user.findUniqueOrThrow({ where: { id: a.dev.user.id } });
    expect(u.holdStartedAt).not.toBeNull();
    expect(u.holdReason).toBe("unpaid");

    const b = await chargedBack();
    await db.payment.create({ data: { kind: "review", contractId: b.sessionId, developerId: b.dev.user.id, testerId: b.tester.user.id, amountCents: 700, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await webhook("charge.dispute.closed", { payment_intent: b.p.stripePaymentIntentId, status: "won" });
    const v = await db.user.findUniqueOrThrow({ where: { id: b.dev.user.id } });
    expect(v.holdStartedAt).not.toBeNull();
    expect(v.holdReason).toBe("unpaid");
    expect((await owed(b.dev.user.id)).map((x) => x.amountCents)).toEqual([700]);
  });

  it("a lost or other close changes nothing", async () => {
    const { dev, p } = await chargedBack();
    await webhook("charge.dispute.closed", { payment_intent: p.stripePaymentIntentId, status: "lost" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ chargeback: "open" });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });
});
