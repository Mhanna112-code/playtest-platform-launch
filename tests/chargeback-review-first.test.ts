import React from "react";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { chargeDeferred, chargebackOpened, payOwed } from "@/lib/server/holds";
import { approveChargebackHold, chargebackSteps } from "@/lib/server/chargeback";
import { chargeOwedTotal } from "@/lib/server/owedOnce";
import { adminPage } from "@/lib/server/adminLists";
import { setStripeForTests } from "@/lib/server/stripe";
import { OwedBox } from "@/components/OwedBox";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 3) From an account's 2nd chargeback (its whole life, this one included) the team reviews it BEFORE the developer can pay; once allowed, Pay what you
// owe CHARGES everything as one payment and paying lifts the hold. And everything that waited for a lift is charged as ONE payment, chargeback repayments included.

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => setStripeForTests(null));

/** A Stripe stand-in: charges go through unless the card is in `decline` or asks the bank (`ask`); reservations wait for capture. */
function bank() {
  const st = { made: [] as { id: string; amount: number; capture_method?: string; description?: string; off_session?: boolean }[], captured: [] as number[], transfers: [] as { amount: number; destination: string; source_transaction?: string }[], decline: false, ask: false };
  const pis = new Map<string, string>();
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; capture_method?: string; description?: string; off_session?: boolean }) => {
        const id = "pi_" + randomUUID();
        st.made.push({ id, ...p });
        if (st.decline) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", code: "card_declined", raw: { payment_intent: { id, status: "requires_payment_method" } } });
        if (st.ask) {
          if (p.off_session) throw Object.assign(new Error("Your bank wants you to confirm this payment."), { type: "StripeCardError", code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret`, status: "requires_payment_method" } } });
          pis.set(id, "requires_action");
          return { id, status: "requires_action", client_secret: `${id}_secret`, next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://hooks.stripe.com/3ds" } } };
        }
        pis.set(id, p.capture_method === "manual" ? "requires_capture" : "succeeded");
        return { id, status: pis.get(id) };
      },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "succeeded", latest_charge: id.replace(/^pi_/, "ch_") }),
      confirm: async (id: string) => ({ id, status: pis.get(id) ?? "requires_action", client_secret: `${id}_secret`, next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://hooks.stripe.com/3ds" } } }),
      cancel: async (id: string) => { pis.set(id, "canceled"); return { id, status: "canceled" }; },
      capture: async (id: string, p: { amount_to_capture: number }) => { st.captured.push(p.amount_to_capture); pis.set(id, "succeeded"); return { id, status: "succeeded" }; },
    },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
    transfers: { create: async (p: { amount: number; destination: string; source_transaction?: string }) => { st.transfers.push(p); return { id: "tr_" + randomUUID() }; } },
    customers: { update: async () => ({}) },
    paymentMethods: { retrieve: async () => ({ id: "pm_saved", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }) },
  } as unknown as Stripe);
  return st;
}

/** A developer with a saved card and two testers' written answers sent (testers ready for payouts). */
async function world() {
  const s = await setup();
  const t = [];
  for (const name of ["Ana Silva", "Ben Okafor"]) {
    const j = await joined(s.testId, name);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    await db.user.update({ where: { id: j.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
    t.push({ ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) });
  }
  await settle();
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
  return { ...s, t };
}
type W = Awaited<ReturnType<typeof world>>;
const paid = (w: W, i: number, cents: number) => db.payment.create({ data: { kind: "review", contractId: w.t[i].sessionId, submissionId: w.t[i].sub.id, developerId: w.dev.user.id, testerId: w.t[i].tester.user.id, amountCents: cents, feeCents: cents / 10, testerCents: cents - cents / 10, status: "charged", transferStatus: "sent", stripePaymentIntentId: "pi_" + randomUUID() } });
const user = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
const verified = (w: W) => db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
const refused = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message?: string }) => e);
/** An earlier chargeback on this account, long resolved (its hold lifted). */
async function earlierChargeback(w: W) {
  return db.payment.create({ data: { kind: "review", contractId: w.t[1].sessionId, developerId: w.dev.user.id, testerId: w.t[1].tester.user.id, amountCents: 500, feeCents: 50, testerCents: 450, status: "charged", chargeback: "resolved", reversedCents: 500, stripePaymentIntentId: "pi_" + randomUUID() } });
}

describe("(Owner, Nov 3) from the 2nd chargeback the team reviews the account before the developer can pay", () => {
  it("the 1st chargeback keeps today's flow: verify, reserve, the team's Approve takes it", async () => {
    const w = await world();
    const st = bank();
    const p = await paid(w, 0, 1000);
    await chargebackOpened(p.stripePaymentIntentId!, null);
    expect(await chargebackSteps(w.dev.user.id)).toMatchObject({ reviewFirst: false, count: 1 });
    await verified(w);
    expect(await payOwed(w.dev.user, {})).toMatchObject({ reservedCents: 2500 });
    expect((await approveChargebackHold(w.dev.user.id)).takenCents).toBe(2500);
    expect(st.captured).toEqual([2500]);
    expect((await user(w.dev.user.id)).holdStartedAt).toBeNull();
  });

  it("the 2nd: Pay what you owe refused with the count until the team approves; then ONE charge (no reservation), and paying lifts the hold", async () => {
    const w = await world();
    const st = bank();
    await earlierChargeback(w);
    const p = await paid(w, 0, 1000);
    await chargebackOpened(p.stripePaymentIntentId!, null);
    await verified(w);
    const line = "Your account has had 2 chargebacks: the team reviews it before you can pay. You'll get an email when you can.";
    expect(R.reviewFirstLine(2)).toBe(line);
    expect(await chargebackSteps(w.dev.user.id)).toMatchObject({ reviewFirst: true, count: 2, approved: false, remaining: ["Wait for the team's review", "Pay what you owe ($25.00)"] });
    // Refused, nothing charged or reserved (an old page's press too: the body doesn't matter).
    for (const body of [{}, { seenTotalCents: 2500, seenIds: [p.id] }]) {
      const e = await refused(payOwed(w.dev.user, body));
      expect([e?.code, e?.message]).toEqual(["review_first", line]);
    }
    expect(st.made).toEqual([]);
    // The admin's row: the count and an Approve to allow paying.
    let row: { id: string; reviewFirst?: boolean; count?: number; approved?: boolean } | undefined;
    for (let cursor: string | null = null, n = 0; n < 50 && !row; n++) {
      const page = (await adminPage("chargebacks", w.dev.user.id, cursor)) as { rows: { id: string }[]; next?: string | null };
      row = page.rows.find((r) => r.id === w.dev.user.id);
      if (!page.next) break;
      cursor = page.next;
    }
    expect(row).toMatchObject({ reviewFirst: true, count: 2, approved: false });
    // The team's Approve allows paying: nothing taken, nothing lifted; the developer gets a bell and an email.
    expect(await approveChargebackHold(w.dev.user.id)).toMatchObject({ allowedToPay: true, lifted: false, takenCents: 0 });
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: R.REVIEWED_LINE } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: R.REVIEWED_LINE, mustEmail: true } })).toBe(1); // emailed (always), whatever the email setting
    expect((await refused(approveChargebackHold(w.dev.user.id)))?.code).toBe("already");
    // Paying: ONE payment, charged (not reserved); the hold lifts at once, no second approval.
    expect(await payOwed(w.dev.user, { seenTotalCents: 2500, seenIds: [p.id] })).toMatchObject({ lifted: true });
    expect(st.made.map((m) => [m.amount, m.capture_method ?? "automatic"])).toEqual([[2500, "automatic"]]);
    expect(await db.reservation.count({ where: { developerId: w.dev.user.id } })).toBe(0);
    expect((await user(w.dev.user.id)).holdStartedAt).toBeNull();
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).chargeback).toBe("resolved");
    expect(await db.payment.findFirstOrThrow({ where: { repaysId: p.id } })).toMatchObject({ status: "charged", amountCents: 2500 });
  });

  it("the card still has to be verified after the approval; a new chargeback after the approval un-approves it again (with the new count)", async () => {
    const w = await world();
    bank();
    await earlierChargeback(w);
    const p = await paid(w, 0, 1000);
    await chargebackOpened(p.stripePaymentIntentId!, null);
    await approveChargebackHold(w.dev.user.id);
    expect((await refused(payOwed(w.dev.user, {})))?.code).toBe("verify_first");
    await verified(w);
    const q = await paid(w, 1, 800);
    await chargebackOpened(q.stripePaymentIntentId!, null);
    await verified(w);
    const e = await refused(payOwed(w.dev.user, {}));
    expect([e?.code, e?.message]).toEqual(["review_first", R.reviewFirstLine(3)]);
    expect(await chargebackSteps(w.dev.user.id)).toMatchObject({ reviewFirst: true, count: 3, approved: false });
  });

  it("checked again inside the claim: a press whose approval went away meanwhile charges nothing", async () => {
    const w = await world();
    const st = bank();
    await earlierChargeback(w);
    const p = await paid(w, 0, 1000);
    await chargebackOpened(p.stripePaymentIntentId!, null);
    const u = await user(w.dev.user.id);
    const e = await refused(chargeOwedTotal(u, [{ id: p.id, amountCents: 2500, chargeback: "open" }], "press", { reviewFirst: "x" }));
    expect(e?.code).toBe("review_first");
    expect(st.made).toEqual([]);
    expect(await db.payment.count({ where: { developerId: w.dev.user.id, kind: "owed" } })).toBe(0);
  });

  it("the box: the line under it and the button disabled until the review; the pages pass it from the steps", () => {
    const line = R.reviewFirstLine(2);
    const html = renderToStaticMarkup(React.createElement(OwedBox, { onHold: true, owed: [{ id: "a", retry: true, amountCents: 2500, until: null, text: "Your bank reversed a $10 payment: $10 + $15 chargeback fee" }], reviewFirst: line }));
    expect(html).toContain(line.replace(/'/g, "&#x27;"));
    expect(html).toMatch(/<button class="btn" disabled=""[^>]*>Pay what you owe \(\$25\.00\)/);
    expect(html).not.toContain("data-verify-first");
  });
});

describe("(Owner, Nov 3) everything that waited for the lift is charged as ONE payment, chargeback repayments included", () => {
  /** On a lifted account: a reversed payment's repayment and a tester's Charge both waiting ("deferred"). */
  async function waiting(w: W) {
    const orig = await db.payment.create({ data: { kind: "review", contractId: w.t[0].sessionId, developerId: w.dev.user.id, testerId: w.t[0].tester.user.id, amountCents: 1000, feeCents: 100, testerCents: 900, status: "charged", chargeback: "resolved", reversedCents: 1000 } });
    const repay = await db.payment.create({ data: { kind: "chargeback", repaysId: orig.id, contractId: w.t[0].sessionId, developerId: w.dev.user.id, testerId: w.t[0].tester.user.id, amountCents: 2500, feeCents: 2500, testerCents: 0, transferStatus: "none", status: "deferred" } });
    const charge = await db.payment.create({ data: { kind: "review", contractId: w.t[1].sessionId, submissionId: w.t[1].sub.id, developerId: w.dev.user.id, testerId: w.t[1].tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "deferred" } });
    return { orig, repay, charge };
  }

  it("goes through: ONE PaymentIntent; the repayment stays with the platform (its own $15 fee kept), the tester's share is sent from that payment; one receipt names both", async () => {
    const w = await world();
    const st = bank();
    const x = await waiting(w);
    await chargeDeferred(w.dev.user.id);
    expect(st.made.map((m) => m.amount)).toEqual([3500]);
    const one = await db.payment.findFirstOrThrow({ where: { developerId: w.dev.user.id, kind: "owed" } });
    expect(await db.payment.findUniqueOrThrow({ where: { id: x.repay.id } })).toMatchObject({ status: "charged", coveredById: one.id, amountCents: 2500, feeCents: 2500, testerCents: 0, transferStatus: "none" });
    const c = await db.payment.findUniqueOrThrow({ where: { id: x.charge.id } });
    expect(c).toMatchObject({ status: "charged", coveredById: one.id, transferStatus: "sent" });
    expect(st.transfers.map((t) => [t.amount, t.destination])).toEqual([[c.testerCents, (await user(w.t[1].tester.user.id)).stripeAccountId]]);
    const receipts = await db.notification.findMany({ where: { userId: w.dev.user.id, text: { startsWith: "You paid " } } });
    expect(receipts.map((r) => r.text)).toHaveLength(1);
    expect(receipts[0].text).toMatch(/^You paid \$35\.00 for .*reversed.*Ben Okafor|^You paid \$35\.00 for .*Ben Okafor.*reversed/);
  });

  it("declined: the reversal is owed again (its chargeback reopens: a chargeback hold) and the tester's Charge is a debt", async () => {
    const w = await world();
    const st = bank();
    st.decline = true;
    const x = await waiting(w);
    await chargeDeferred(w.dev.user.id);
    expect(st.made.map((m) => m.amount)).toEqual([3500]);
    expect(await db.payment.findUnique({ where: { id: x.repay.id } })).toBeNull();
    expect((await db.payment.findUniqueOrThrow({ where: { id: x.orig.id } })).chargeback).toBe("open");
    expect(await db.payment.findUniqueOrThrow({ where: { id: x.charge.id } })).toMatchObject({ status: "failed", coveredById: null });
    expect((await user(w.dev.user.id)).holdReason).toBe("chargeback");
  });

  it("the card asks the bank: ONE \"Confirm with your bank\" item covering both, never a debt", async () => {
    const w = await world();
    const st = bank();
    st.ask = true;
    const x = await waiting(w);
    await chargeDeferred(w.dev.user.id);
    expect(st.made.map((m) => m.amount)).toEqual([3500]);
    const one = await db.payment.findFirstOrThrow({ where: { developerId: w.dev.user.id, kind: "owed" } });
    expect(one.status).toBe("needs_confirmation");
    for (const id of [x.repay.id, x.charge.id]) expect(await db.payment.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "deferred", coveredById: one.id });
    expect((await user(w.dev.user.id)).holdStartedAt).toBeNull();
  });

  it("a deleted developer's repayments still wait (§151); their tester charges are made", async () => {
    const w = await world();
    const st = bank();
    const x = await waiting(w);
    await db.user.update({ where: { id: w.dev.user.id }, data: { deletedAt: new Date(), holdStartedAt: new Date(), holdReason: "unpaid" } });
    await chargeDeferred(w.dev.user.id);
    expect(st.made.map((m) => m.amount)).toEqual([1000]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: x.repay.id } })).status).toBe("deferred");
  });
});
