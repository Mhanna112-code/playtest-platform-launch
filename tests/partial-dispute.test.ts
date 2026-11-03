import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import * as R from "@/lib/rules";
import { fmtDate } from "@/lib/format";
import { adminCases, chargebackOpened, chargebackWon, disputeAmountChanged, owed, owedLines, payOwed, startHold } from "@/lib/server/holds";
import { approveChargebackHold, chargebackSteps } from "@/lib/server/chargeback";
import { adminPage } from "@/lib/server/adminLists";
import { paidOutTotal, paidRows } from "@/lib/server/paymentRows";
import { chargeOwedTotal } from "@/lib/server/owedOnce";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §133) A bank can dispute PART of a card payment: Stripe's charge.dispute.created carries the disputed amount, and Stripe takes back only
// that (+ its $15 fee). The developer owes the disputed amount + one fee; the rest of the payment stays paid (testers' shares untouched). A full dispute is unchanged.

beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });

/** A Stripe stand-in: charges go through, reservations wait for capture; it records captures, cancels and refunds (with their amounts). Webhooks: the body as sent. */
function bank() {
  const pis = new Map<string, string>();
  const st = { made: [] as { id: string; amount: number; capture_method?: string; description?: string }[], captured: [] as number[], refunds: [] as { payment_intent: string; amount?: number }[] };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; capture_method?: string; description?: string }) => {
        const id = "pi_" + randomUUID();
        st.made.push({ id, ...p });
        pis.set(id, p.capture_method === "manual" ? "requires_capture" : "succeeded");
        return { id, status: pis.get(id) };
      },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "succeeded", latest_charge: id.replace(/^pi_/, "ch_") }),
      cancel: async (id: string) => { pis.set(id, "canceled"); return { id, status: "canceled" }; },
      capture: async (id: string, p: { amount_to_capture: number }) => { st.captured.push(p.amount_to_capture); pis.set(id, "succeeded"); return { id, status: "succeeded" }; },
    },
    refunds: { create: async (p: { payment_intent: string; amount?: number }) => { st.refunds.push(p); return { id: "re_" + randomUUID() }; } },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    customers: { update: async () => ({}) },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  } as unknown as Stripe);
  return st;
}

/** A developer (card saved) with three testers' written answers sent; testers ready for payouts. */
async function world() {
  const s = await setup();
  const t = [];
  for (const name of ["Ana Silva", "Ben Okafor", "Cid Moreau"]) {
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
const piece = (w: W, i: number) => ({ kind: "review", contractId: w.t[i].sessionId, submissionId: w.t[i].sub.id, developerId: w.dev.user.id, testerId: w.t[i].tester.user.id });
/** A Pay that went through: the tester's share sent with it. */
const paidPiece = (w: W, i: number, cents: number, pi = "pi_" + randomUUID()) =>
  db.payment.create({ data: { ...piece(w, i), amountCents: cents, feeCents: Math.round(cents / 10), testerCents: cents - Math.round(cents / 10), status: "charged", transferStatus: "sent", stripeTransferId: "tr_" + randomUUID(), stripePaymentIntentId: pi } });
const debt = (w: W, i: number, cents: number) => db.payment.create({ data: { ...piece(w, i), amountCents: cents, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
const send = (id: string, type: string, object: Record<string, unknown>) =>
  webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t" }, body: JSON.stringify({ id, type, data: { object } }) }));
/** Stripe's dispute object as its webhook sends it (the fields the app reads). */
const dispute = (pi: string, amount: number, status = "needs_response") => ({ id: "dp_" + randomUUID().slice(0, 12), object: "dispute", amount, currency: "usd", charge: pi.replace(/^pi_/, "ch_"), payment_intent: pi, reason: "fraudulent", status });
const press = (cookie: string, body: Record<string, unknown> = {}) => owedPOST(req("/api/payments/owed", { cookie, body })).then(json);
const day = (d: Date) => fmtDate(d).replace(/, \d{4}$/, "");
const mails = (pi: string) => db.outboxEmail.findMany({ where: { to: "owner@playtest.test", text: { contains: pi } }, orderBy: { createdAt: "asc" } });
const chargebackEvents = (testId: string) => db.testEvent.findMany({ where: { testId, kind: "chargeback" }, orderBy: { createdAt: "asc" } });
const admin = async () => (await makeUser({ dev: true, name: "Team Admin" })).user.id;
/** The admin's chargeback-hold row for this developer. */
async function adminRow(devId: string) {
  const page = (await adminPage("chargebacks", await admin(), null)) as { rows: { id: string; chargebacks: string[] }[] };
  return page.rows.find((r) => r.id === devId);
}
/** Clear a chargeback hold the way the developer and the team do: card verified, Pay what you owe reserves, the team approves (the reservation is captured). */
async function clear(w: W) {
  await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
  const r = await payOwed(w.dev.user, {});
  return { reserved: (r as { reservedCents?: number }).reservedCents, approved: await approveChargebackHold(w.dev.user.id) };
}

describe("§133 a full dispute is unchanged", () => {
  it("the whole payment + one fee, the same lines as before (with Stripe's amount, with none, and with more than the payment)", async () => {
    for (const amount of [1000, undefined, 1200]) {
      const w = await world();
      bank();
      const p = await paidPiece(w, 0, 1000);
      const r = await send("evt_" + randomUUID(), "charge.dispute.created", amount === undefined ? { payment_intent: p.stripePaymentIntentId } : dispute(p.stripePaymentIntentId!, amount));
      expect(r.status).toBe(200);
      expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(1000);
      expect((await owed(w.dev.user.id)).map((x) => [x.id, x.amountCents])).toEqual([[p.id, 1000 + R.CHARGEBACK_FEE_CENTS]]);
      const [line] = await owedLines(w.dev.user.id);
      expect(line.text).toBe(`Your bank reversed $10 you paid for Ana Silva's written answers on “Harbor Run” (${day(p.createdAt)}): $10 + $15 chargeback fee`);
      expect(line).not.toHaveProperty("covers");
      expect((await chargebackEvents(w.testId)).map((e) => e.text)).toEqual(["Your bank reversed your $10.00 payment for Ana Silva's written answers on “Harbor Run”"]);
      const [mail] = await mails(p.stripePaymentIntentId!);
      expect(mail.subject).toBe("Playtest: new chargeback of $10.00");
      expect(mail.text).toContain(`A developer's bank reversed a $10.00 payment (${p.stripePaymentIntentId}).`);
      expect((await adminRow(w.dev.user.id))!.chargebacks).toEqual([`Chargeback open: $10.00 · ${p.stripePaymentIntentId}`]);
      expect((await adminCases()).map((c) => c.text)).toContain("Open chargeback: $10.00");
      expect((await chargebackSteps(w.dev.user.id))!.owedCents).toBe(2500);
      // Repaid: the same repayment row as before, and the reversed payment counts once (as its repayment).
      const { reserved, approved } = await clear(w);
      expect([reserved, approved.lifted, approved.takenCents]).toEqual([2500, true, 2500]);
      const repay = await db.payment.findFirstOrThrow({ where: { repaysId: p.id } });
      expect(repay.amountCents).toBe(2500);
      const rows = await paidRows([await db.payment.findUniqueOrThrow({ where: { id: p.id } }), repay], "developer");
      expect(rows.get(repay.id)!.what).toBe("Repaid the reversed $10.00 payment for Ana Silva's written answers on “Harbor Run” ($10.00 + $15.00 chargeback fee)");
      expect(rows.get(p.id)).toMatchObject({ reversed: true, reversedCents: null });
      expect(paidOutTotal([await db.payment.findUniqueOrThrow({ where: { id: p.id } }), repay])).toBe(2500);
    }
  });

  // (Owner, Nov 3) A full chargeback on a one payment lists what it covered, like a partial one.
  it("a full dispute on Pay what you owe's one payment: one line for the whole payment, what it covered listed under it, the repayment keeps its plain label", async () => {
    const w = await world();
    bank();
    for (const [i, c] of [[0, 800], [1, 300]] as const) await debt(w, i, c);
    await startHold(w.dev.user.id, "unpaid");
    expect((await press(w.dev.cookie)).body).toMatchObject({ paid: 2, lifted: true });
    const one = await db.payment.findFirstOrThrow({ where: { developerId: w.dev.user.id, kind: "owed" } });
    expect((await send("evt_" + randomUUID(), "charge.dispute.created", dispute(one.stripePaymentIntentId!, 1100))).status).toBe(200);
    const [line] = await owedLines(w.dev.user.id);
    expect([line.id, line.amountCents, line.text]).toEqual([one.id, 1100 + R.CHARGEBACK_FEE_CENTS, "Your bank reversed a $11 payment: $11 + $15 chargeback fee"]);
    expect(line.covers?.map((c) => c.text)).toHaveLength(2);
    expect(line.covers?.map((c) => c.text).join(" | ")).toMatch(/\$8\.00.*\$3\.00|\$3\.00.*\$8\.00/);
    await clear(w);
    const repay = await db.payment.findFirstOrThrow({ where: { repaysId: one.id } });
    expect((await paidRows([repay], "developer")).get(repay.id)).toBeUndefined(); // the page's own label: "A reversed payment, paid again"
  });
});

describe("§133 part of a single payment", () => {
  it("$96 of $444.67: owed $96 + one $15 fee; the rest stays paid and the tester's share is untouched; every line says so", async () => {
    const w = await world();
    const st = bank();
    const p = await paidPiece(w, 0, 44467);
    const pi = p.stripePaymentIntentId!;
    expect((await send("evt_" + randomUUID(), "charge.dispute.created", dispute(pi, 9600))).status).toBe(200);
    const after = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ chargeback: "open", reversedCents: 9600, amountCents: 44467, status: "charged", testerCents: p.testerCents, transferStatus: "sent", stripeTransferId: p.stripeTransferId });
    expect((await owed(w.dev.user.id)).map((x) => [x.id, x.amountCents, x.reversedCents, x.paidCents])).toEqual([[p.id, 9600 + 1500, 9600, 44467]]);
    const [line] = await owedLines(w.dev.user.id);
    expect(line.text).toBe(`Your bank reversed $96 of the $444.67 you paid for Ana Silva's written answers on “Harbor Run” (${day(p.createdAt)}): $96 + $15 chargeback fee`);
    expect(line.full).toBe(line.text); // the names are short enough to need no cut
    expect(line).not.toHaveProperty("covers");
    expect((await chargebackEvents(w.testId)).map((e) => e.text)).toEqual(["Your bank reversed $96.00 of your $444.67 payment for Ana Silva's written answers on “Harbor Run”"]);
    const [mail] = await mails(pi);
    expect(mail.subject).toBe("Playtest: new chargeback of $96.00");
    expect(mail.text).toContain(`A developer's bank reversed $96.00 of a $444.67 payment (${pi}).`);
    expect((await adminRow(w.dev.user.id))!.chargebacks).toEqual([`Chargeback open: $96.00 of a $444.67 payment · ${pi}`]);
    expect((await adminCases()).map((c) => c.text)).toContain("Open chargeback: $96.00 of a $444.67 payment");
    const person = (await adminPage("u-chargebacks", await admin(), null, w.dev.user.id)) as { rows: { text: string }[] };
    expect(person.rows.filter((r) => r.text.includes("Chargeback $96.00 of a $444.67 payment (open)"))).toHaveLength(1);
    expect((await chargebackSteps(w.dev.user.id))!.owedCents).toBe(11100);
    // The reservation and the team's Approve take exactly $96 + $15; the repayment row names the payment and the part.
    const { reserved, approved } = await clear(w);
    expect([reserved, approved.lifted, approved.takenCents, st.captured]).toEqual([11100, true, 11100, [11100]]);
    expect((await db.testEvent.findFirstOrThrow({ where: { testId: w.testId, text: { startsWith: "The team resolved" } } })).text).toBe("The team resolved the bank reversal of $96.00 of your $444.67 payment");
    const repay = await db.payment.findFirstOrThrow({ where: { repaysId: p.id } });
    expect(repay).toMatchObject({ kind: "chargeback", amountCents: 11100, testerCents: 0, status: "charged" });
    const reversed = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    const rows = await paidRows([reversed, repay], "developer");
    expect(rows.get(repay.id)!.what).toBe("Repaid $96 reversed from your $444.67 payment for Ana Silva's written answers on “Harbor Run” ($96 + $15 chargeback fee)");
    expect(rows.get(p.id)).toMatchObject({ reversed: true, reversedCents: 9600 });
    // What you've paid: the reversed payment counts minus the disputed part, plus its repayment.
    expect(paidOutTotal([reversed, repay])).toBe(44467 - 9600 + 11100);
    // The tester's own Payments row: still the whole payment, never the repayment.
    expect((await db.payment.findMany({ where: { testerId: w.t[0].tester.user.id, kind: { notIn: ["chargeback", "owed", "subscription"] } } })).map((x) => [x.amountCents, x.testerCents, x.status])).toEqual([[44467, p.testerCents, "charged"]]);
  });
});

describe("§133 part of Pay what you owe's one combined payment", () => {
  it("$96 of the $444.67 one payment: one line naming the payment, what it covered listed under it (none named as the disputed one); its items stay paid", async () => {
    const w = await world();
    const st = bank();
    const debts = [await debt(w, 0, 12000), await debt(w, 1, 20467), await debt(w, 2, 12000)];
    await startHold(w.dev.user.id, "unpaid");
    expect((await press(w.dev.cookie, { over200: true })).body).toMatchObject({ paid: 3, lifted: true }); // (§150) over $200: the tick
    const one = await db.payment.findFirstOrThrow({ where: { developerId: w.dev.user.id, kind: "owed" } });
    expect(one).toMatchObject({ amountCents: 44467, status: "bundled" });
    expect((await send("evt_" + randomUUID(), "charge.dispute.created", dispute(one.stripePaymentIntentId!, 9600))).status).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: one.id } })).reversedCents).toBe(9600);
    expect((await owed(w.dev.user.id)).map((x) => [x.id, x.amountCents])).toEqual([[one.id, 11100]]);
    const [line] = await owedLines(w.dev.user.id);
    expect(line.text).toBe("Your bank reversed $96 of your $444.67 payment: $96 + $15 chargeback fee");
    expect((line as { covers?: { text: string }[] }).covers!.map((c) => c.text)).toEqual([
      "Ana Silva's written answers on “Harbor Run” $120.00", "Ben Okafor's written answers on “Harbor Run” $204.67", "Cid Moreau's written answers on “Harbor Run” $120.00",
    ]);
    // The items it paid for stay paid; each tester's share is untouched.
    for (const d of debts) expect(await db.payment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "charged", chargeback: "", coveredById: one.id });
    expect((await adminRow(w.dev.user.id))!.chargebacks).toEqual([`Chargeback open: $96.00 of a $444.67 payment · ${one.stripePaymentIntentId}`]);
    const { reserved, approved } = await clear(w);
    expect([reserved, approved.takenCents, st.captured]).toEqual([11100, 11100, [11100]]);
    const repay = await db.payment.findFirstOrThrow({ where: { repaysId: one.id } });
    expect(repay.amountCents).toBe(11100);
    const listed = [...(await db.payment.findMany({ where: { id: { in: debts.map((d) => d.id) } } })), repay];
    const rows = await paidRows(listed, "developer");
    expect(rows.get(repay.id)).toMatchObject({ what: "Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee)", testId: null });
    expect(paidOutTotal(listed, [await db.payment.findUniqueOrThrow({ where: { id: one.id } })])).toBe(44467 - 9600 + 11100);
  });
});

describe("§133 repayment and a won chargeback", () => {
  it("won after the repayment: exactly what was repaid ($96 + $15) is refunded, and the lines name the $96", async () => {
    const w = await world();
    const st = bank();
    const p = await paidPiece(w, 0, 44467);
    await chargebackOpened(p.stripePaymentIntentId!, 9600);
    await clear(w);
    const repay = await db.payment.findFirstOrThrow({ where: { repaysId: p.id } });
    expect((await send("evt_" + randomUUID(), "charge.dispute.closed", { ...dispute(p.stripePaymentIntentId!, 9600, "won") })).status).toBe(200);
    expect(st.refunds).toEqual([{ payment_intent: repay.stripePaymentIntentId, amount: 11100 }]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: repay.id } })).status).toBe("refunded");
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).chargeback).toBe("won");
    const texts = (await db.notification.findMany({ where: { userId: w.dev.user.id }, orderBy: { createdAt: "asc" } })).map((n) => n.text);
    expect(texts).toEqual(expect.arrayContaining(["Refund: your bank's chargeback of $96.00 was reversed", "Your bank's chargeback of $96.00 was reversed in your favour."]));
    expect(await db.testEvent.count({ where: { testId: w.testId, text: "Your bank's chargeback of $96.00 was reversed: $111.00 refunded to your card." } })).toBe(1);
    // What you've paid: the whole payment counts again; the refunded repayment doesn't.
    expect(paidOutTotal([await db.payment.findUniqueOrThrow({ where: { id: p.id } }), await db.payment.findUniqueOrThrow({ where: { id: repay.id } })])).toBe(44467);
    // A second delivery refunds nothing more.
    expect((await send("evt_" + randomUUID(), "charge.dispute.closed", { ...dispute(p.stripePaymentIntentId!, 9600, "won") })).status).toBe(200);
    expect(st.refunds).toHaveLength(1);
  });

  it("won before it was repaid: $96 + $15 leaves what's owed (nothing refunded) and the hold lifts; a repayment still waiting for the lift is dropped", async () => {
    const w = await world();
    const st = bank();
    const p = await paidPiece(w, 0, 44467);
    await chargebackOpened(p.stripePaymentIntentId!, 9600);
    expect(await chargebackWon(p.stripePaymentIntentId!)).toBe(true);
    expect(st.refunds).toEqual([]);
    expect(await owed(w.dev.user.id)).toEqual([]);
    expect((await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } })).holdStartedAt).toBeNull();
    expect(await db.testEvent.count({ where: { testId: w.testId, text: "Your bank's chargeback of $96.00 was reversed: $111.00 taken off what you owe." } })).toBe(1);

    const q = await paidPiece(w, 1, 20000);
    await chargebackOpened(q.stripePaymentIntentId!, 5000);
    await db.payment.update({ where: { id: q.id }, data: { chargeback: "resolved" } });
    const waitingRepay = await db.payment.create({ data: { kind: "chargeback", repaysId: q.id, contractId: q.contractId, developerId: w.dev.user.id, testerId: q.testerId, amountCents: 6500, feeCents: 6500, testerCents: 0, status: "deferred" } });
    expect(await chargebackWon(q.stripePaymentIntentId!)).toBe(true);
    expect(await db.payment.count({ where: { id: waitingRepay.id } })).toBe(0);
  });
});

describe("§133 a second delivery changes nothing", () => {
  it("the same event twice, and the same dispute under another event id (another amount too): one chargeback, one fee, one hold, one email", async () => {
    const w = await world();
    bank();
    const p = await paidPiece(w, 0, 44467);
    const id = "evt_" + randomUUID();
    const d = dispute(p.stripePaymentIntentId!, 9600);
    expect((await send(id, "charge.dispute.created", d)).status).toBe(200);
    expect(await (await send(id, "charge.dispute.created", d)).json()).toMatchObject({ duplicate: true });
    expect((await send("evt_" + randomUUID(), "charge.dispute.created", { ...d, amount: 20000 })).status).toBe(200);
    expect(await Promise.all([chargebackOpened(p.stripePaymentIntentId!, 9600), chargebackOpened(p.stripePaymentIntentId!, 9600)])).toEqual([false, false]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(9600);
    expect((await owed(w.dev.user.id)).map((x) => x.amountCents)).toEqual([11100]);
    const dev = await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } });
    expect([dev.holdReason, dev.holdCount]).toEqual(["chargeback", 1]);
    expect(await mails(p.stripePaymentIntentId!)).toHaveLength(1);
    expect(await chargebackEvents(w.testId)).toHaveLength(1);
  });

  it("two deliveries at the same moment open it once", async () => {
    const w = await world();
    bank();
    const p = await paidPiece(w, 0, 44467);
    const r = await Promise.all([chargebackOpened(p.stripePaymentIntentId!, 9600), chargebackOpened(p.stripePaymentIntentId!, 9600)]);
    expect(r.sort()).toEqual([false, true]);
    expect((await owed(w.dev.user.id)).map((x) => x.amountCents)).toEqual([11100]);
  });
});

describe("§133 Stripe changes the disputed amount (charge.dispute.updated)", () => {
  it("open and not repaid: followed (owed, the line, the steps); an older page's press stops once on the new total; the same amount again changes nothing", async () => {
    const w = await world();
    bank();
    const p = await paidPiece(w, 0, 44467);
    const pi = p.stripePaymentIntentId!;
    await send("evt_" + randomUUID(), "charge.dispute.created", dispute(pi, 9600));
    expect((await send("evt_" + randomUUID(), "charge.dispute.updated", dispute(pi, 12000))).status).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(12000);
    expect((await owed(w.dev.user.id)).map((x) => x.amountCents)).toEqual([13500]);
    expect((await owedLines(w.dev.user.id))[0].text).toBe(`Your bank reversed $120 of the $444.67 you paid for Ana Silva's written answers on “Harbor Run” (${day(p.createdAt)}): $120 + $15 chargeback fee`);
    expect((await chargebackSteps(w.dev.user.id))!.owedCents).toBe(13500);
    const ev = await db.accountEvent.findMany({ where: { userId: w.dev.user.id, kind: "chargeback-amount" } });
    expect(ev.map((e) => e.note)).toEqual([`Stripe changed the disputed amount of the $444.67 payment (${pi}) from $96.00 to $120.00: followed (the developer now owes $120.00 + $15.00 chargeback fee).`]);
    const person = (await adminPage("u-chargebacks", await admin(), null, w.dev.user.id)) as { rows: { text: string }[] };
    expect(person.rows.some((r) => r.text.endsWith(ev[0].note))).toBe(true);
    expect(await mails(pi)).toHaveLength(1); // only the chargeback's own email
    // A page that showed $111.00 stops once on the new total (nothing reserved).
    const r = await press(w.dev.cookie, { seenTotalCents: 11100, seenIds: [p.id] });
    expect([r.status, r.body.error.code]).toEqual([409, "stop_once"]);
    expect(r.body.error.changes[0].text).toBe(`What you owe changed: now $135.00. ${R.pressAgainLine(13500, { cardVerified: false })}`);
    expect(await disputeAmountChanged(pi, 12000)).toBe("same");
    expect(await db.accountEvent.count({ where: { userId: w.dev.user.id, kind: "chargeback-amount" } })).toBe(1);
    // Followed down as well.
    expect(await disputeAmountChanged(pi, 5000, "under_review")).toBe("followed");
    expect((await owed(w.dev.user.id)).map((x) => x.amountCents)).toEqual([6500]);
  });

  it("reserved, resolved, won or decided: nothing changes, it's logged for the admins (their email and the developer's Chargebacks box)", async () => {
    const w = await world();
    bank();
    const p = await paidPiece(w, 0, 44467);
    const pi = p.stripePaymentIntentId!;
    await chargebackOpened(pi, 9600);
    // Decided at Stripe (lost) while still open here.
    expect(await disputeAmountChanged(pi, 12000, "lost")).toBe("logged");
    // Reserved on the card by Pay what you owe.
    await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    expect(await payOwed(w.dev.user, {})).toMatchObject({ reservedCents: 11100 });
    expect((await send("evt_" + randomUUID(), "charge.dispute.updated", dispute(pi, 5000))).status).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(9600);
    // The team's Approve took $96 + $15: resolved, so a later change isn't followed either.
    expect((await approveChargebackHold(w.dev.user.id)).takenCents).toBe(11100);
    expect(await disputeAmountChanged(pi, 5000)).toBe("logged");
    await chargebackWon(pi);
    expect(await disputeAmountChanged(pi, 4000, "won")).toBe("logged");
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reversedCents).toBe(9600);
    const notes = (await db.accountEvent.findMany({ where: { userId: w.dev.user.id, kind: "chargeback-amount" }, orderBy: { createdAt: "asc" } })).map((e) => e.note);
    expect(notes).toEqual([
      `Stripe changed the disputed amount of the $444.67 payment (${pi}) from $96.00 to $120.00: not followed, because the dispute is already decided (lost). Check it in Stripe.`,
      `Stripe changed the disputed amount of the $444.67 payment (${pi}) from $96.00 to $50.00: not followed, because it's reserved on the developer's card. Check it in Stripe.`,
      `Stripe changed the disputed amount of the $444.67 payment (${pi}) from $96.00 to $50.00: not followed, because the team already resolved it. Check it in Stripe.`,
      `Stripe changed the disputed amount of the $444.67 payment (${pi}) from $96.00 to $40.00: not followed, because the chargeback was already won. Check it in Stripe.`,
    ]);
    const changed = (await mails(pi)).filter((m) => m.subject.startsWith("Playtest: a chargeback's amount changed"));
    expect(changed.map((m) => m.subject)).toEqual(["Playtest: a chargeback's amount changed ($96.00 to $120.00)", "Playtest: a chargeback's amount changed ($96.00 to $50.00)", "Playtest: a chargeback's amount changed ($96.00 to $50.00)", "Playtest: a chargeback's amount changed ($96.00 to $40.00)"]);
  });

  it("an update for a dispute not recorded yet is left for Stripe's retry", async () => {
    const w = await world();
    bank();
    const p = await paidPiece(w, 0, 44467);
    const id = "evt_" + randomUUID();
    expect((await send(id, "charge.dispute.updated", dispute(p.stripePaymentIntentId!, 9600))).status).toBe(503);
    expect(await db.stripeEvent.count({ where: { id } })).toBe(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).chargeback).toBe("");
  });

  it("an amount that changed after the total was read is never charged at the old amount (the one payment's claim refuses it)", async () => {
    const w = await world();
    const st = bank();
    const p = await paidPiece(w, 0, 44467);
    await chargebackOpened(p.stripePaymentIntentId!, 9600);
    const u = await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } });
    const stale = (await owed(u.id)).map((x) => ({ id: x.id, amountCents: x.amountCents, chargeback: x.chargeback }));
    await db.payment.update({ where: { id: p.id }, data: { reversedCents: 12000 } });
    expect(await chargeOwedTotal(u, stale, "press")).toEqual({ result: "skipped" });
    expect(st.made).toEqual([]);
    const fresh = (await owed(u.id)).map((x) => ({ id: x.id, amountCents: x.amountCents, chargeback: x.chargeback }));
    expect(await chargeOwedTotal(u, fresh, "press")).toMatchObject({ result: "paid", cents: 13500 });
    expect(st.made.map((m) => m.amount)).toEqual([13500]);
    expect((await db.payment.findFirstOrThrow({ where: { repaysId: p.id } })).amountCents).toBe(13500);
  });
});

describe("§133 the line helpers", () => {
  it("whole and partial wording", () => {
    const paidFor = { name: "Marc Hanna", part: "written answers", test: "chargechargecharge", date: "Nov 3" };
    expect(R.chargebackOwedLine(9600, undefined, false, 44467)).toBe("Your bank reversed $96 of your $444.67 payment: $96 + $15 chargeback fee");
    expect(R.chargebackOwedLine(9600, paidFor, false, 44467)).toBe("Your bank reversed $96 of the $444.67 you paid for Marc Hanna's written answers on “chargecharge…” (Nov 3): $96 + $15 chargeback fee");
    expect(R.chargebackOwedLine(9600, paidFor, true, 44467)).toBe("Your bank reversed $96 of the $444.67 you paid for Marc Hanna's written answers on “chargechargecharge” (Nov 3): $96 + $15 chargeback fee");
    expect(R.chargebackOwedLine(44467, undefined, false, 44467)).toBe("Your bank reversed a $444.67 payment: $444.67 + $15 chargeback fee");
    expect(R.chargebackOwedLine(1000)).toBe("Your bank reversed a $10 payment: $10 + $15 chargeback fee");
    expect(R.repaidReversedLine({ amountCents: 44467, reversedCents: 9600 }, " payment", null)).toBe("Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee)");
    expect(R.repaidReversedLine({ amountCents: 3900, reversedCents: 2000 }, " Pay more", "Marc Hanna's written answers on “chargecharge…”")).toBe("Repaid $20 reversed from your $39 Pay more for Marc Hanna's written answers on “chargecharge…” ($20 + $15 chargeback fee)");
    expect(R.repaidReversedLine({ amountCents: 3900, reversedCents: null }, " Pay more", "Marc Hanna's written answers on “chargecharge…”")).toBe("Repaid the reversed $39.00 Pay more for Marc Hanna's written answers on “chargecharge…” ($39.00 + $15.00 chargeback fee)");
    expect(R.repaidReversedLine({ amountCents: 3900, reversedCents: 3900 }, " payment", null)).toBeNull();
    expect([R.reversedOf({ amountCents: 1000, reversedCents: null }), R.reversedOf({ amountCents: 1000, reversedCents: 1200 }), R.reversedOf({ amountCents: 1000, reversedCents: 0 }), R.reversedOf({ amountCents: 1000, reversedCents: 400 })]).toEqual([1000, 1000, 1000, 400]);
    expect([R.disputedCentsOf(9600), R.disputedCentsOf("9600"), R.disputedCentsOf(-1), R.disputedCentsOf(1.5), R.disputedCentsOf(undefined)]).toEqual([9600, null, null, null, null]);
    expect([R.reversedWords({ amountCents: 1000, reversedCents: 1000 }), R.reversedWords({ amountCents: 44467, reversedCents: 9600 }), R.reversedWords({ amountCents: 44467, reversedCents: 9600 }, "a")]).toEqual(["your $10.00 payment", "$96.00 of your $444.67 payment", "$96.00 of a $444.67 payment"]);
  });
});
