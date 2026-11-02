import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { setStripeForTests } from "@/lib/server/stripe";
import { autoChargeCalls, chargeDeferred, deferredForBox, liftHoldIfClear, owed, payOwed, startHold } from "@/lib/server/holds";
import { approveChargebackHold, reserveState } from "@/lib/server/chargeback";
import { decideDispute } from "@/lib/server/payments";
import { joined, sact, seen, setup } from "./fixtures";
import { makeUser } from "./helpers";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/payments", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const DAY = 86400000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
afterEach(() => setStripeForTests(null));

function bank() {
  const state = { mode: "ok" as "ok" | "decline" | "action" };
  const made: { amount: number; off_session?: boolean; capture_method?: string }[] = [];
  const captured: number[] = [];
  setStripeForTests({
    paymentMethods: { retrieve: async () => ({ card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }) },
    paymentIntents: {
      create: async (p: { amount: number; off_session?: boolean; capture_method?: string }) => {
        made.push(p); const id = "pi_test_" + randomUUID();
        if (p.off_session && state.mode === "decline") throw Object.assign(Error("Declined"), { type: "StripeCardError" });
        if (p.off_session && state.mode === "action") return { id, status: "requires_action", client_secret: "test-secret" };
        return { id, status: p.capture_method === "manual" ? "requires_capture" : "succeeded" };
      },
      capture: async (id: string, p: { amount_to_capture: number }) => { captured.push(p.amount_to_capture); return { id, status: "succeeded" }; },
      cancel: async (id: string) => ({ id, status: "canceled" }),
      retrieve: async (id: string) => ({ id, status: "succeeded", latest_charge: "ch_test" }),
    },
    transfers: { create: async () => ({ id: "tr_test_" + randomUUID() }) },
  } as unknown as Stripe);
  return { state, made, captured };
}

async function fixture(hold: "payment" | "chargeback" | "none" = "payment") {
  const f = await setup({ recordingCents: "6.00" }); const j = await joined(f.testId, "Alex Tester", "they");
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["First answer", "Second answer"], seenAt: seen(), confirmed: true })).status).toBe(200);
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.submission.update({ where: { id: sub.id }, data: { payBy: ago(1), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
  await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: ago(1) } });
  const base = hold === "none" ? null : await db.payment.create({ data: { kind: "review", contractId: j.sessionId, developerId: f.dev.user.id, testerId: j.tester.user.id, amountCents: 500, feeCents: 100, testerCents: 400, status: hold === "chargeback" ? "charged" : "failed", ...(hold === "chargeback" ? { chargeback: "open", stripePaymentIntentId: "pi_original_" + randomUUID() } : { owedUntil: new Date() }) } });
  if (hold !== "none") await startHold(f.dev.user.id, hold === "chargeback" ? "chargeback" : "unpaid");
  return { ...f, ...j, sub, base };
}
const choose = (f: Awaited<ReturnType<typeof fixture>>, submissionId = f.sub.id) => sact(f.sessionId, "choose", f.tester.cookie, { submissionId, choice: "charge", seenAt: seen(), confirmed: true });

describe("§113: new charges wait separately until a hold lifts", () => {
  it("a tester Charge waits (never a debt) as Payment delayed; (§125) during a hold it is listed IN Pay what you owe, paid with it", async () => {
    const st = bank(), f = await fixture();
    const result = await choose(f);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.status).toBe("deferred");
    expect((await owed(f.dev.user.id)).map((p) => p.id)).toEqual([f.base!.id]);
    expect(st.made).toHaveLength(0);
    const waiting = await deferredForBox(f.dev.user.id);
    expect(waiting).toHaveLength(1); expect(waiting[0].amountCents).toBe(1000);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: f.tester.user.id } });
    const { default: Session } = await import("@/app/app/sessions/[id]/page");
    const session = renderToStaticMarkup(await Session({ params: Promise.resolve({ id: f.sessionId }) }));
    expect(session).toContain('data-part-status="delayed">Payment delayed');
    auth.user = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    const { default: Payments } = await import("@/app/app/payments/page");
    const html = renderToStaticMarkup(await Payments({ searchParams: Promise.resolve({}) }));
    // (§125) No separate "Charged once your tests resume" list during the hold: the box lists it and its total includes it.
    expect(html).not.toContain('id="waiting-charges"');
    const box = html.match(/<div id="owed"[\s\S]*$/)?.[0] ?? "";
    expect(box).toContain(money(1000));
    expect(box).toContain(money(1500));
    expect((await owed(f.dev.user.id)).reduce((n, p) => n + p.amountCents, 0)).toBe(500);
  });

  it("(§125) Pay what you owe pays the debt AND the waiting charge as ONE payment; the hold lifts with nothing left to charge", async () => {
    const st = bank(), f = await fixture(); await choose(f);
    expect((await payOwed(f.dev.user)).lifted).toBe(true);
    expect(st.made.map((p) => p.amount)).toEqual([1500]);
    expect((await db.payment.findFirstOrThrow({ where: { submissionId: f.sub.id, kind: "review" } })).status).toBe("charged");
    expect((await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } })).holdStartedAt).toBeNull();
    expect(await owed(f.dev.user.id)).toEqual([]);
    expect(await deferredForBox(f.dev.user.id)).toEqual([]);
    await chargeDeferred(f.dev.user.id);
    expect(st.made).toHaveLength(1); // nothing left to charge after the lift
  });

  it("a chargeback reservation is not topped up by a waiting Charge; approval captures it and then charges the waiting item", async () => {
    const st = bank(), f = await fixture("chargeback");
    await db.user.update({ where: { id: f.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    expect(await payOwed(f.dev.user)).toMatchObject({ reservedCents: 2000, lifted: false });
    await choose(f);
    expect(await reserveState(f.dev.user.id)).toMatchObject({ reservedCents: 2000 });
    expect((await owed(f.dev.user.id)).reduce((n, p) => n + p.amountCents, 0)).toBe(2000);
    expect(st.made).toHaveLength(1);
    expect((await approveChargebackHold(f.dev.user.id)).lifted).toBe(true);
    expect(st.captured).toEqual([2000]);
    expect(st.made.map((p) => p.amount)).toEqual([2000, 1000]);
    expect(st.made[1].off_session).toBe(true);
    expect(await owed(f.dev.user.id)).toEqual([]);
  });

  it("(batch 35 §122) the waiting charges are made together as one payment: declined, each becomes a debt and a NEW hold starts", async () => {
    const st = bank(), f = await fixture(); await choose(f);
    const rec = await db.submission.create({ data: { contractId: f.sessionId, kind: "recording", agreedCents: 600, payBy: ago(1), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    expect((await choose(f, rec.id)).status).toBe(200);
    const old = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    st.state.mode = "decline";
    // (§125) Pay what you owe would pay them with the debt; this is the after-lift path: the hold lifted another way (the debt settled elsewhere).
    await db.payment.update({ where: { id: f.base!.id }, data: { status: "charged", settledAt: new Date() } });
    await liftHoldIfClear(f.dev.user.id);
    const current = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    expect(current.holdCount).toBe(old.holdCount + 1);
    expect(current.holdStartedAt).not.toBeNull();
    expect(st.made.map((p) => p.amount)).toEqual([1600]);
    expect((await owed(f.dev.user.id)).map((p) => p.amountCents)).toEqual([1000, 600]);
    expect((await db.payment.findFirstOrThrow({ where: { submissionId: rec.id } })).status).toBe("failed");
    expect(await db.notification.count({ where: { userId: f.dev.user.id, text: "Your tests are running again" } })).toBe(0);
  });

  it("a bank check on the lifted queue gets the existing three-day away confirmation, without a new hold", async () => {
    const st = bank(), f = await fixture(); await choose(f);
    st.state.mode = "action";
    // (§125) Pay what you owe would pay them with the debt; this is the after-lift path: the hold lifted another way (the debt settled elsewhere).
    await db.payment.update({ where: { id: f.base!.id }, data: { status: "charged", settledAt: new Date() } });
    await liftHoldIfClear(f.dev.user.id);
    // (Batch 35 §122) One payment for the waiting charges: its check is the one "Confirm with your bank" item; the charge waits under it.
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: f.sub.id, kind: "review", status: "deferred" } });
    const one = await db.payment.findUniqueOrThrow({ where: { id: p.coveredById! } });
    expect(one.status).toBe("needs_confirmation");
    expect(one.actionBy!.getTime() - Date.now()).toBeGreaterThan(3 * DAY - 5000);
    expect((await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } })).holdStartedAt).toBeNull();
  });

  it("automatic listed-call charges also wait outside the owed balance", async () => {
    const st = bank(), f = await fixture();
    const start = ago(8), end = new Date(start.getTime() + 10 * 60000);
    const slot = await db.callSlot.create({ data: { testId: f.testId, startsAt: start, minutes: 10, allowedTesterIds: [], status: "booked" } });
    const call = await db.call.create({ data: { slotId: slot.id, contractId: f.sessionId, startsAt: start, minutes: 10, rateCents: 3000, measuredMinutes: 10, measuredAt: end, measuredFrom: start, measuredTo: end, payBy: ago(1) } });
    await autoChargeCalls(new Date());
    expect((await db.payment.findFirstOrThrow({ where: { callId: call.id } })).status).toBe("deferred");
    expect((await owed(f.dev.user.id)).map((p) => p.id)).toEqual([f.base!.id]);
    expect(st.made).toHaveLength(0);
  });

  it("a team dispute raise waits without increasing what is owed", async () => {
    const st = bank(), f = await fixture();
    await db.review.create({ data: { contractId: f.sessionId, submissionId: f.sub.id, amountCents: 400, agreedCents: 1000, reason: "Partly useful", payKey: randomUUID() } });
    await db.payment.create({ data: { kind: "review", contractId: f.sessionId, submissionId: f.sub.id, developerId: f.dev.user.id, testerId: f.tester.user.id, amountCents: 400, feeCents: 80, testerCents: 320, status: "charged" } });
    const dispute = await db.dispute.create({ data: { contractId: f.sessionId, submissionId: f.sub.id, testerId: f.tester.user.id, reason: "The complete work was provided" } });
    const a = await makeUser({ name: "Admin" }); const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await decideDispute(admin, dispute.id, { total: "10.00", tickCents: 600, note: "Complete work", seenAt: seen(), confirmed: true });
    expect((await db.payment.findFirstOrThrow({ where: { disputeId: dispute.id } })).status).toBe("deferred");
    expect((await owed(f.dev.user.id)).map((p) => p.id)).toEqual([f.base!.id]);
    expect(st.made).toHaveLength(0);
  });

  it("no hold keeps the existing immediate Charge behavior", async () => {
    const st = bank(), f = await fixture("none");
    expect((await choose(f)).status).toBe(200);
    expect(st.made.map((p) => p.amount)).toEqual([1000]);
    expect((await db.payment.findFirstOrThrow({ where: { submissionId: f.sub.id } })).status).toBe("charged");
    expect(await deferredForBox(f.dev.user.id)).toEqual([]);
  });
});
