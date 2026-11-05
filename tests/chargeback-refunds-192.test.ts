import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { fmtDateTimeIn } from "@/lib/format";
import { chargebackWon, deferredForBox, disputeAmountChanged, followPendingAmount, liftHoldIfClear, owed, payOwed, startHold } from "@/lib/server/holds";
import { approveChargebackHold } from "@/lib/server/chargeback";
import { paidOutTotal } from "@/lib/server/paymentRows";
import { accountPaymentsForAdmin, developerPaid, stripeUrl } from "@/lib/server/paymentLists";
import { DevPaidList } from "@/components/PaymentLists";
import { setStripeForTests } from "@/lib/server/stripe";
import { makeUser } from "./helpers";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 4, batch 35 §192) Refunds are their own negative lines in "What you've paid" (under the payment they refund; the total is the signed sum of the lines and
// equals the old figure for the same history), and the bank changing what it took back AFTER the reversed payment was repaid is followed at once: lowered → the
// difference refunded to the card (a partial refund of the repayment's PaymentIntent), raised → the difference charged like a charge made while away; each change
// settles relative to the last followed amount; won later → what is still repaid refunded; lost later → nothing more; a retried webhook never refunds twice; a change
// during a repayment in progress settles right after it ends.

(globalThis as unknown as { React: typeof React }).React = React;
beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });

/** A Stripe stand-in: charges go through (or are declined: `decline`), reservations wait for capture; it records charges, captures and refunds (with amounts). */
function bank() {
  const pis = new Map<string, string>();
  const st = { made: [] as { id: string; amount: number; capture_method?: string; description?: string }[], refunds: [] as { payment_intent: string; amount?: number }[], decline: false };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; capture_method?: string; description?: string }) => {
        if (st.decline) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", code: "card_declined" });
        const id = "pi_" + randomUUID();
        st.made.push({ id, ...p });
        pis.set(id, p.capture_method === "manual" ? "requires_capture" : "succeeded");
        return { id, status: pis.get(id) };
      },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "succeeded", latest_charge: id.replace(/^pi_/, "ch_") }),
      cancel: async (id: string) => { pis.set(id, "canceled"); return { id, status: "canceled" }; },
      capture: async (id: string) => { pis.set(id, "succeeded"); return { id, status: "succeeded" }; },
    },
    refunds: { create: async (p: { payment_intent: string; amount?: number }) => { st.refunds.push({ payment_intent: p.payment_intent, amount: p.amount }); return { id: "re_" + randomUUID() }; } },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    customers: { update: async () => ({}) },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  } as unknown as Stripe);
  return st;
}

/** A developer (card saved) with a tester's written answers sent; the tester ready for payouts. */
async function world() {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
  await db.user.update({ where: { id: j.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await settle();
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
  return { ...s, j, sub, devId: s.dev.user.id };
}
type W = Awaited<ReturnType<typeof world>>;
/** A Pay that went through: the tester's share sent with it. */
const paidPiece = (w: W, cents: number) => db.payment.create({ data: { kind: "review", contractId: w.j.sessionId, submissionId: w.sub.id, developerId: w.devId, testerId: w.j.tester.user.id, amountCents: cents, feeCents: Math.round(cents / 10), testerCents: cents - Math.round(cents / 10), status: "charged", transferStatus: "sent", stripeTransferId: "tr_" + randomUUID(), stripePaymentIntentId: "pi_" + randomUUID() } });
const send = (id: string, type: string, object: Record<string, unknown>) =>
  webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t" }, body: JSON.stringify({ id, type, data: { object } }) }));
const evt = () => "evt_" + randomUUID();
const dispute = (pi: string, amount: number, status = "needs_response") => ({ id: "dp_x", object: "dispute", amount, currency: "usd", charge: pi.replace(/^pi_/, "ch_"), payment_intent: pi, reason: "fraudulent", status });
const update = (pi: string, amount: number, id = evt()) => send(id, "charge.dispute.updated", dispute(pi, amount, "under_review"));
const bells = async (devId: string) => (await db.notification.findMany({ where: { userId: devId }, orderBy: { createdAt: "asc" } })).map((n) => n.text);
const notes = async (devId: string) => (await db.accountEvent.findMany({ where: { userId: devId, kind: "chargeback-amount" }, orderBy: { createdAt: "asc" } })).map((e) => e.note);
const adminMails = (pi: string) => db.outboxEmail.findMany({ where: { to: "owner@playtest.test", subject: { startsWith: "Playtest: a chargeback" }, text: { contains: pi } } });
const PIECE = "Ana Silva's written answers on “Harbor Run”";
const fmt = (d: Date) => fmtDateTimeIn(d, "UTC");
const textOf = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "");

/** A reversed $X payment (the bank took back `disputed`), repaid the way a 1st chargeback is: card verified, Pay what you owe reserves, the team approves. */
async function repaid(paidCents: number, disputed: number) {
  const w = await world();
  const st = bank();
  const p = await paidPiece(w, paidCents);
  const pi = p.stripePaymentIntentId!;
  expect((await send(evt(), "charge.dispute.created", dispute(pi, disputed))).status).toBe(200);
  await db.user.update({ where: { id: w.devId }, data: { chargebackCardVerifiedAt: new Date() } });
  expect(await payOwed(w.dev.user, {})).toMatchObject({ reservedCents: disputed + 1500 });
  expect((await approveChargebackHold(w.devId)).lifted).toBe(true);
  const repay = await db.payment.findFirstOrThrow({ where: { repaysId: p.id } });
  expect(repay).toMatchObject({ kind: "chargeback", status: "charged", amountCents: disputed + 1500 });
  return { w, st, p, pi, repay };
}

/** "What you've paid" checked: the total equals the signed sum of the lines; returns the list and its rendered text. */
async function paidList(devId: string) {
  const paid = await developerPaid(devId);
  const refunds = [...(paid.refunds?.values() ?? [])].flat();
  // The plain signed sum of the lines (each reversal not won taking off what it reversed, as before §192).
  const reversals = paid.list.filter((p) => p.chargebackAt && p.chargeback !== "won").reduce((a, p) => a + Math.min(p.reversedCents ?? p.amountCents, p.amountCents), 0);
  expect(paid.totalCents).toBe(paid.list.reduce((a, p) => a + p.amountCents, 0) - refunds.reduce((a, r) => a + r.amountCents, 0) - reversals);
  const html = renderToStaticMarkup(React.createElement(DevPaidList, { paid, fmtDateTime: fmt }));
  return { paid, refunds, html, text: textOf(html) };
}

describe("§192 refunds as their own negative lines", () => {
  it("won after it was repaid: the repayment stays positive, its refund is a minus line under it; the total equals the old figure", async () => {
    const { w, st, p, repay } = await repaid(1000, 1000);
    const before = await paidList(w.devId);
    expect(before.paid.totalCents).toBe(2500);
    expect(await chargebackWon(p.stripePaymentIntentId!)).toBe(true);
    expect(st.refunds).toEqual([{ payment_intent: repay.stripePaymentIntentId, amount: 2500 }]);
    const { paid, refunds, html, text } = await paidList(w.devId);
    const rec = await db.paymentRefund.findFirstOrThrow({ where: { paymentId: repay.id } });
    expect(rec).toMatchObject({ reason: "won", amountCents: 2500, status: "refunded" });
    expect(refunds.map((r) => [r.paymentId, r.what, r.amountCents])).toEqual([[repay.id, `Refunded: your bank's chargeback on your $10.00 Pay for ${PIECE} was reversed in your favour`, 2500]]);
    // The old figure for the same history: the refunded repayment out, the won payment counts.
    const ones = await db.payment.findMany({ where: { developerId: w.devId, kind: "owed", chargebackAt: { not: null } } });
    expect(paid.totalCents).toBe(paidOutTotal(paid.list, ones));
    expect(paid.totalCents).toBe(1000);
    // Drawn right under the repayment, inside its line; "−$25.00" and its date.
    expect(text).toContain(`Repaid the reversed $10.00 payment for ${PIECE} ($10.00 + $15.00 chargeback fee)`);
    expect(text).toContain(`Refunded: your bank's chargeback on your $10.00 Pay for ${PIECE} was reversed in your favour · −$25.00 · ${fmt(rec.createdAt)}`);
    const repayLi = html.match(new RegExp(`<li[^>]*>(?:(?!<li).)*?data-refund-of="${repay.id}"`))?.[0] ?? "";
    expect(repayLi).toContain("Repaid the reversed $10.00");
  });

  it("a refund made before §192 (only its refunded repayment records it) is a line too, with no date; the total unchanged", async () => {
    const w = await world();
    const p = await paidPiece(w, 1000);
    await db.payment.update({ where: { id: p.id }, data: { chargeback: "won", chargebackAt: new Date() } });
    const r = await db.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: w.devId, testerId: p.testerId, amountCents: 2500, feeCents: 2500, testerCents: 0, status: "refunded", stripePaymentIntentId: "pi_" + randomUUID() } });
    const { paid, refunds, text } = await paidList(w.devId);
    expect(refunds.map((x) => [x.paymentId, x.amountCents, x.createdAt])).toEqual([[r.id, 2500, null]]);
    expect(paid.totalCents).toBe(paidOutTotal(paid.list)); // 1000
    expect(text).toContain(`Refunded: your bank's chargeback on your $10.00 Pay for ${PIECE} was reversed in your favour · −$25.00`);
  });
});

describe("§192 the bank lowers what it took back after the repayment", () => {
  it("$20 → $12: $8 refunded at once from the repayment's PaymentIntent; its minus line; the developer's bell; the admins' Chargebacks line, no email", async () => {
    const { w, st, p, pi, repay } = await repaid(2000, 2000);
    expect((await update(pi, 1200)).status).toBe(200);
    expect(st.refunds).toEqual([{ payment_intent: repay.stripePaymentIntentId, amount: 800 }]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(1200);
    expect(await db.paymentRefund.findFirstOrThrow({ where: { paymentId: repay.id } })).toMatchObject({ reason: "lowered", amountCents: 800, fromCents: 2000, toCents: 1200, status: "refunded", reversalId: p.id });
    expect(await bells(w.devId)).toContain(`Your bank lowered what it took back from your $20.00 payment for ${PIECE}: $8.00 refunded to your card.`);
    expect((await notes(w.devId)).at(-1)).toBe(`Stripe changed the disputed amount of the $20.00 payment (${pi}) from $20.00 to $12.00: followed after repayment: refunded $8.00.`);
    expect(await adminMails(pi)).toHaveLength(0);
    const { paid, refunds, text } = await paidList(w.devId);
    // The repayment still names what it repaid ($20 + the fee); the reversed payment shows what the bank took back now.
    expect(paid.rows.get(repay.id)!.what).toBe(`Repaid the reversed $20.00 payment for ${PIECE} ($20.00 + $15.00 chargeback fee)`);
    expect(paid.rows.get(p.id)).toMatchObject({ reversed: true, reversedCents: 1200 });
    expect(refunds.map((r) => [r.paymentId, r.what, r.amountCents])).toEqual([[repay.id, `Refunded: your bank lowered what it took back from your $20.00 Pay for ${PIECE}: $20.00 → $12.00`, 800]]);
    expect(text).toContain(`Refunded: your bank lowered what it took back from your $20.00 Pay for ${PIECE}: $20.00 → $12.00 · −$8.00`);
    // $20 paid, $12 taken back, $35 repaid, $8 refunded: $35 (the payment + the fee).
    expect(paid.totalCents).toBe(3500);
  });

  it("part of a payment ($96 of $444.67) lowered to $50, then won: two minus lines under the repayment ($46, then the $65 still repaid)", async () => {
    const { w, st, p, pi, repay } = await repaid(44467, 9600);
    await update(pi, 5000);
    await chargebackWon(pi);
    expect(st.refunds.map((r) => r.amount)).toEqual([4600, 6500]);
    const { paid, refunds } = await paidList(w.devId);
    expect(paid.rows.get(repay.id)!.what).toBe(`Repaid $96 reversed from your $444.67 payment for ${PIECE} ($96 + $15 chargeback fee)`);
    expect(refunds.map((r) => [r.what, r.amountCents])).toEqual([
      [`Refunded: your bank lowered what it took back from your $444.67 Pay for ${PIECE}: $96.00 → $50.00`, 4600],
      [`Refunded: your bank's chargeback on $50.00 of your $444.67 Pay for ${PIECE} was reversed in your favour`, 6500],
    ]);
    // Won: the whole payment counts again, everything repaid came back.
    expect(paid.totalCents).toBe(44467);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).chargeback).toBe("won");
  });

  it("a repayment inside a Pay what you owe payment: a partial refund of that one PaymentIntent, recorded on the repayment, its line inside the group", async () => {
    const w = await world();
    const st = bank();
    const p = await paidPiece(w, 2000);
    await db.payment.update({ where: { id: p.id }, data: { chargeback: "resolved", chargebackAt: new Date(), reversedCents: 2000 } });
    const onePi = "pi_" + randomUUID();
    const other = await db.payment.create({ data: { kind: "extra", contractId: w.j.sessionId, developerId: w.devId, testerId: w.j.tester.user.id, amountCents: 900, feeCents: 90, testerCents: 810, status: "charged", owedUntil: new Date(), settledAt: new Date(), stripePaymentIntentId: onePi } });
    const one = await db.payment.create({ data: { kind: "owed", developerId: w.devId, testerId: w.devId, amountCents: 4400, feeCents: 4400, testerCents: 0, status: "bundled", note: "press", stripePaymentIntentId: onePi, settledAt: new Date() } });
    const repay = await db.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: w.devId, testerId: p.testerId, amountCents: 3500, feeCents: 3500, testerCents: 0, status: "charged", stripePaymentIntentId: onePi, coveredById: one.id, settledAt: new Date() } });
    await db.payment.update({ where: { id: other.id }, data: { coveredById: one.id } });
    expect(await disputeAmountChanged(p.stripePaymentIntentId!, 1200, "under_review", "evt_one")).toBe("followed");
    expect(st.refunds).toEqual([{ payment_intent: onePi, amount: 800 }]);
    expect((await db.paymentRefund.findFirstOrThrow({ where: { reversalId: p.id } })).paymentId).toBe(repay.id);
    const { paid, html } = await paidList(w.devId);
    const group = html.match(new RegExp(`<li[^>]*data-paid-group="${one.id}"[\\s\\S]*?</details></li>`))![0];
    expect(textOf(group)).toContain(`Repaid: your $20.00 Pay for ${PIECE} that your bank reversed · $20.00 + $15.00 chargeback fee`);
    expect(textOf(group)).toContain(`Refunded: your bank lowered what it took back from your $20.00 Pay for ${PIECE}: $20.00 → $12.00 · −$8.00`);
    expect(group.indexOf(`data-paid-group-item="${repay.id}"`)).toBeLessThan(group.indexOf(`data-refund-of="${repay.id}"`));
    expect(paid.totalCents).toBe(2000 + 900 + 3500 - 1200 - 800);
  });
});

describe("§192 the bank raises what it took back after the repayment", () => {
  it("$12 → $20: $8 charged like a charge made while away; its line; the developer's bell; the admins' Chargebacks line", async () => {
    const { w, st, p, pi } = await repaid(2000, 1200);
    const n = st.made.length;
    expect((await update(pi, 2000)).status).toBe(200);
    const raise = await db.payment.findFirstOrThrow({ where: { repaysId: p.id, note: { startsWith: "raise:" } } });
    expect(raise).toMatchObject({ kind: "chargeback", amountCents: 800, status: "charged", testerCents: 0, note: "raise:1200:2000" });
    // One off-session charge for exactly $8, described as its line reads.
    expect(st.made.slice(n).map((m) => m.amount)).toEqual([800]);
    expect(st.made.at(-1)!.description).toContain(`Your bank raised what it took back from your $20.00 Pay for ${PIECE}: $12.00 → $20.00 $8.00`);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(2000);
    expect(await bells(w.devId)).toContain(`Your bank raised what it took back from your $20.00 payment for ${PIECE}: $8.00 more is charged.`);
    expect((await notes(w.devId)).at(-1)).toBe(`Stripe changed the disputed amount of the $20.00 payment (${pi}) from $12.00 to $20.00: followed after repayment: charged $8.00 more.`);
    expect(await adminMails(pi)).toHaveLength(0);
    const { paid, text } = await paidList(w.devId);
    expect(paid.rows.get(raise.id)!.group?.what ?? paid.rows.get(raise.id)!.what).toBe(`Your bank raised what it took back from your $20.00 Pay for ${PIECE}: $12.00 → $20.00`);
    expect(text).toContain(`Your bank raised what it took back from your $20.00 Pay for ${PIECE}: $12.00 → $20.00 · $8.00`);
    expect(paid.totalCents).toBe(3500);
  });

  it("during a hold it waits for the lift (named in the waiting box), then is charged", async () => {
    const { w, st, p, pi } = await repaid(2000, 1200);
    await startHold(w.devId, "unpaid");
    await update(pi, 2000);
    const raise = await db.payment.findFirstOrThrow({ where: { repaysId: p.id, note: { startsWith: "raise:" } } });
    expect(raise.status).toBe("deferred");
    expect((await deferredForBox(w.devId)).map((x) => x.what)).toContain(`the rise in what your bank took back from your $20.00 payment for ${PIECE} ($12.00 → $20.00)`);
    const n = st.made.length;
    expect(await liftHoldIfClear(w.devId)).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: raise.id } })).status).toBe("charged");
    expect(st.made.slice(n).map((m) => m.amount)).toEqual([800]);
  });

  it("declined: the usual decline handling (owed, a payment hold) and the admins are emailed", async () => {
    const { w, st, p, pi } = await repaid(2000, 1200);
    st.decline = true;
    await update(pi, 2000);
    const raise = await db.payment.findFirstOrThrow({ where: { repaysId: p.id, note: { startsWith: "raise:" } } });
    expect(raise).toMatchObject({ status: "failed" });
    expect((await db.user.findUniqueOrThrow({ where: { id: w.devId } })).holdStartedAt).not.toBeNull();
    expect((await owed(w.devId)).map((x) => [x.id, x.amountCents])).toEqual([[raise.id, 800]]);
    // The reversal itself stays repaid (no chargeback reopened).
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).chargeback).toBe("resolved");
    expect((await adminMails(pi)).map((m) => m.subject)).toEqual(["Playtest: a chargeback's raised amount couldn't be charged ($8.00)"]);
  });
});

describe("§192 several changes, then won or lost", () => {
  async function sequence() {
    const r = await repaid(2000, 2000);
    const n = r.st.made.length;
    await update(r.pi, 1200); // refund $8
    await update(r.pi, 1600); // charge $4
    await update(r.pi, 1000); // refund $6
    return { ...r, n };
  }

  it("$20 → $12 → $16 → $10: each settles against the last followed amount (refund $8, charge $4, refund $6)", async () => {
    const { w, st, p, repay, n } = await sequence();
    expect(st.refunds).toEqual([{ payment_intent: repay.stripePaymentIntentId, amount: 800 }, { payment_intent: repay.stripePaymentIntentId, amount: 600 }]);
    expect(st.made.slice(n).map((m) => m.amount)).toEqual([400]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(1000);
    const { paid, refunds } = await paidList(w.devId);
    expect(refunds.map((r) => [r.what, r.amountCents])).toEqual([
      [`Refunded: your bank lowered what it took back from your $20.00 Pay for ${PIECE}: $20.00 → $12.00`, 800],
      [`Refunded: your bank lowered what it took back from your $20.00 Pay for ${PIECE}: $16.00 → $10.00`, 600],
    ]);
    // Still repaid for it: $35 - $8 - $6 + $4 = $25 ($10 + the fee); the total is always the payment + the fee.
    expect(paid.totalCents).toBe(3500);
    expect((await notes(w.devId)).slice(-3)).toEqual([
      `Stripe changed the disputed amount of the $20.00 payment (${p.stripePaymentIntentId}) from $20.00 to $12.00: followed after repayment: refunded $8.00.`,
      `Stripe changed the disputed amount of the $20.00 payment (${p.stripePaymentIntentId}) from $12.00 to $16.00: followed after repayment: charged $4.00 more.`,
      `Stripe changed the disputed amount of the $20.00 payment (${p.stripePaymentIntentId}) from $16.00 to $10.00: followed after repayment: refunded $6.00.`,
    ]);
  });

  it("then won: what is still repaid is refunded ($21 of the repayment, the $4 charge), each its own minus line; the total equals the old figure", async () => {
    const { w, st, p, repay } = await sequence();
    const raise = await db.payment.findFirstOrThrow({ where: { repaysId: p.id, note: { startsWith: "raise:" } } });
    expect(await chargebackWon(p.stripePaymentIntentId!)).toBe(true);
    expect(st.refunds.slice(2)).toEqual([{ payment_intent: repay.stripePaymentIntentId, amount: 2100 }, { payment_intent: raise.stripePaymentIntentId, amount: 400 }]);
    const { paid, refunds } = await paidList(w.devId);
    expect(refunds.filter((r) => r.paymentId === raise.id).map((r) => [r.what, r.amountCents])).toEqual([[`Refunded: your bank's chargeback on $10.00 of your $20.00 Pay for ${PIECE} was reversed in your favour`, 400]]);
    expect(refunds.reduce((a, r) => a + r.amountCents, 0)).toBe(3500 + 400);
    expect(paid.totalCents).toBe(2000);
    const ones = await db.payment.findMany({ where: { developerId: w.devId, kind: "owed", chargebackAt: { not: null } } });
    expect(paid.totalCents).toBe(paidOutTotal(paid.list, ones));
    // The bell names the whole refund once.
    expect(await bells(w.devId)).toContain("Refund: your bank's chargeback of $10.00 was reversed");
    // A later change after the win isn't followed.
    expect(await disputeAmountChanged(p.stripePaymentIntentId!, 500, "won")).toBe("logged");
    expect(st.refunds).toHaveLength(4);
  });

  it("then lost: nothing more (settled at the last followed amount)", async () => {
    const { w, st, p, n } = await sequence();
    const before = await paidList(w.devId);
    expect((await send(evt(), "charge.dispute.closed", dispute(p.stripePaymentIntentId!, 1000, "lost"))).status).toBe(200);
    expect(await disputeAmountChanged(p.stripePaymentIntentId!, 1000, "lost")).toBe("same");
    expect(await disputeAmountChanged(p.stripePaymentIntentId!, 1400, "lost")).toBe("logged");
    expect(st.refunds).toHaveLength(2);
    expect(st.made.slice(n)).toHaveLength(1);
    expect((await paidList(w.devId)).paid.totalCents).toBe(before.paid.totalCents);
  });
});

describe("§192 never twice, and a repayment in progress", () => {
  it("a retried webhook (the same event, delivered again or forgotten and retried) never refunds twice", async () => {
    const { w, st, pi } = await repaid(2000, 2000);
    const id = evt();
    expect((await update(pi, 1200, id)).status).toBe(200);
    expect(await (await update(pi, 1200, id)).json()).toMatchObject({ duplicate: true });
    // Forgotten (as a failed delivery is) and retried: the amount is already followed.
    await db.stripeEvent.deleteMany({ where: { id } });
    expect((await update(pi, 1200, id)).status).toBe(200);
    expect(await disputeAmountChanged(pi, 1200, "under_review", id)).toBe("same");
    // Two deliveries at the same moment settle it once.
    await Promise.all([disputeAmountChanged(pi, 900, "under_review", "evt_a"), disputeAmountChanged(pi, 900, "under_review", "evt_b")]);
    expect(st.refunds.map((r) => r.amount)).toEqual([800, 300]);
    expect(await db.paymentRefund.count({ where: { developerId: w.devId } })).toBe(2);
  });

  it("raised while Pay what you owe's reservation holds it: it waits, then is settled right after the team's Approve takes the repayment", async () => {
    const w = await world();
    const st = bank();
    const p = await paidPiece(w, 2000);
    const pi = p.stripePaymentIntentId!;
    await send(evt(), "charge.dispute.created", dispute(pi, 1200));
    await db.user.update({ where: { id: w.devId }, data: { chargebackCardVerifiedAt: new Date() } });
    expect(await payOwed(w.dev.user, {})).toMatchObject({ reservedCents: 2700 });
    expect((await update(pi, 2000)).status).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(1200);
    expect((await notes(w.devId)).at(-1)).toBe(`Stripe changed the disputed amount of the $20.00 payment (${pi}) from $12.00 to $20.00: waiting, because it's reserved on the developer's card; followed once that ends.`);
    expect(await adminMails(pi)).toHaveLength(0);
    const n = st.made.length;
    expect((await approveChargebackHold(w.devId)).takenCents).toBe(2700);
    // The repayment ($12 + the fee) went through; the $8 raise right after (the hold lifted with the Approve).
    const raise = await db.payment.findFirstOrThrow({ where: { repaysId: p.id, note: { startsWith: "raise:" } } });
    expect(raise).toMatchObject({ amountCents: 800, status: "charged" });
    expect(st.made.slice(n).map((m) => m.amount)).toEqual([800]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(2000);
    expect((await notes(w.devId)).at(-1)).toBe(`Stripe changed the disputed amount of the $20.00 payment (${pi}) from $12.00 to $20.00: followed after repayment: charged $8.00 more.`);
    expect((await paidList(w.devId)).paid.totalCents).toBe(3500);
  });

  it("a reservation that ends without the repayment: the waiting change is followed in what is owed", async () => {
    const w = await world();
    bank();
    const p = await paidPiece(w, 2000);
    const pi = p.stripePaymentIntentId!;
    await send(evt(), "charge.dispute.created", dispute(pi, 1200));
    await db.user.update({ where: { id: w.devId }, data: { chargebackCardVerifiedAt: new Date() } });
    await payOwed(w.dev.user, {});
    await update(pi, 1600);
    await db.reservation.updateMany({ where: { developerId: w.devId }, data: { status: "expired", endedAt: new Date() } });
    expect(await followPendingAmount(p.id)).toBe("followed");
    expect((await owed(w.devId)).map((x) => x.amountCents)).toEqual([1600 + 1500]);
    expect(await followPendingAmount(p.id)).toBeNull();
  });

  it("the team's copy of What you've paid matches the developer's, with a Stripe link on each refund line", async () => {
    const { w, pi, repay } = await repaid(2000, 2000);
    await update(pi, 1200);
    const adm = await makeUser({ dev: true, name: "Team Admin" });
    const admin = await db.user.update({ where: { id: adm.user.id }, data: { isAdmin: true } });
    const theirs = (await accountPaymentsForAdmin(admin, w.devId))!;
    const prev = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    let team: string;
    try { team = renderToStaticMarkup(React.createElement(DevPaidList, { paid: theirs.developer!, fmtDateTime: fmt, stripeUrl })); } finally { process.env.STRIPE_SECRET_KEY = prev; }
    const own = (await paidList(w.devId)).html;
    expect(team.replace(/ · <a href="https:\/\/dashboard\.stripe\.com\/[^"]*" target="_blank" rel="noreferrer" data-stripe-link="">Stripe<\/a>/g, "")).toBe(own);
    const at = team.indexOf(`data-refund-of="${repay.id}"`);
    const refundRow = team.slice(at, team.indexOf("</a>", at));
    expect(refundRow).toContain(`href="https://dashboard.stripe.com/test/payments/${repay.stripePaymentIntentId}"`);
  });
});
