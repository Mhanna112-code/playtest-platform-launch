import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as allPOST } from "@/app/api/payments/confirm-all/route";
import { awayAction } from "@/lib/server/confirm";
import { decideDispute } from "@/lib/server/payments";
import { newCardChecks } from "@/lib/server/owedOnce";
import { suspendAccount } from "@/lib/server/restrictions";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, addTo, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §159, later decisions) The tester leaving always stops pay presses on their own parts; a suspended developer's Pay, Pay more, Confirm with
// your bank and Confirm all are refused (checked under the developer's row lock) and the suspension cancels their own open Pay / Pay more checks (not a tester's
// waiting charge); Pay more waits while a payment on its part waits for the bank; Confirm all stops for each item's own changes; a card saved while a Pay's bank
// page completes records it paid once.

afterEach(() => setStripeForTests(null));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json);
const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
const all = (cookie: string, body: Record<string, unknown>) => allPOST(req("/api/payments/confirm-all", { cookie, body })).then(json);
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);

/** A Stripe stand-in: `ask` makes every charge wait for the bank; `approved` PaymentIntents are already approved (cancel answers "already succeeded"). */
function bank() {
  const pis = new Map<string, string>();
  const made: { id: string; amount: number }[] = [];
  const st = { pis, made, ask: false };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; off_session?: boolean }) => {
        const id = "pi_" + randomUUID();
        made.push({ id, amount: p.amount });
        if (st.ask) {
          pis.set(id, "requires_action");
          if (p.off_session) throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
          return { id, status: "requires_action", client_secret: `${id}_secret`, next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://hooks.stripe.com/3ds" } } };
        }
        pis.set(id, "succeeded");
        return { id, status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "requires_action", client_secret: `${id}_secret`, latest_charge: id.replace(/^pi_/, "ch_"), ...((pis.get(id) ?? "requires_action") === "requires_action" ? { next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://hooks.stripe.com/3ds" } } } : {}) }),
      confirm: async (id: string) => ({ id, status: pis.get(id) ?? "requires_action", client_secret: `${id}_secret`, next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://hooks.stripe.com/3ds" } } }),
      cancel: async (id: string) => {
        if (pis.get(id) === "succeeded") throw Object.assign(new Error("This PaymentIntent already succeeded."), { type: "StripeInvalidRequestError", code: "payment_intent_unexpected_state" });
        pis.set(id, "canceled");
        return { id, status: "canceled" };
      },
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    customers: { update: async () => ({}) },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
  } as unknown as Stripe);
  return st;
}

/** Ana's and Ben's written answers sent (unpaid); the developer has a card. */
async function world(ignored: string[] = []) {
  const s = await setup();
  const ana = await joined(s.testId, "Ana Silva");
  const ben = await joined(s.testId, "Ben Okafor", "he");
  for (const t of [ana, ben]) await sact(t.sessionId, "written", t.tester.cookie, { answers: ["a", "b"] });
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_dev" } });
  if (ignored.length) await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ignored } });
  const anaSub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
  const benSub = await db.submission.findFirstOrThrow({ where: { contractId: ben.sessionId } });
  await settle();
  return { ...s, ana, ben, anaSub, benSub };
}
type W = Awaited<ReturnType<typeof world>>;
const admin = async () => (await makeUser({ name: "Admin" })).user.id;
/** A tester's Charge on this part made while the developer was away, waiting for "Confirm with your bank". */
async function waitingCharge(w: W, t: { sessionId: string; tester: { user: { id: string } } }, subId: string, st: ReturnType<typeof bank>, cents = 1000) {
  await db.review.create({ data: { contractId: t.sessionId, submissionId: subId, amountCents: cents, agreedCents: 1000, payKey: "choice:" + randomUUID(), reason: "charged by the tester" } });
  const p = await db.payment.create({ data: { kind: "review", submissionId: subId, contractId: t.sessionId, developerId: w.dev.user.id, testerId: t.tester.user.id, amountCents: cents, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
  const pi = "pi_" + randomUUID();
  st.pis.set(pi, "requires_action");
  return awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
}

describe("§159: that tester leaving always stops a payment press on their parts", () => {
  it("“Testers leaving” ticked off: Ana leaves → Pay on Ana's answers stops once naming it; Pay on Ben's goes straight through", async () => {
    const w = await world(["leaving"]);
    bank();
    const loaded = seen(); await settle();
    expect((await sact(w.ana.sessionId, "leave", w.ana.tester.cookie, { confirmed: true })).status).toBe(200);
    await settle();
    const first = await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toContain("Ana Silva left the test");
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
    const ben = await pay(w.dev.cookie, { kind: "submission", id: w.benSub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(ben.status, JSON.stringify(ben.body)).toBe(200);
  });

  it("a tester removed by a suspension reads as leaving: it stops Pay on their parts too, whatever the tick", async () => {
    const w = await world(["leaving"]);
    bank();
    const loaded = seen(); await settle();
    await suspendAccount(await admin(), w.ana.tester.user.id, "spam", "tester");
    await settle();
    const first = await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(texts(first)).toContain("Ana Silva left the test");
  });
});

// (Owner, Nov 11, §386 A; replaces §368, back to §159's refusals) No money moves while suspended: the developer's payment presses are refused.
describe("§159 / §386 A: a suspended developer's payment presses are refused", () => {
  it("Pay more, Confirm with your bank and Confirm all are refused during the suspension", async () => {
    const w = await world();
    const st = bank();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true })).status).toBe(200);
    const one = await waitingCharge(w, w.ben, w.benSub.id, st);
    await suspendAccount(await admin(), w.dev.user.id, "abuse", "developer");
    const u = await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } });
    expect(u.devSuspendedAt).not.toBeNull();
    const more = await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "1.00", tickedCents: 100, seenAt: seen(), confirmed: true });
    expect(more.body.error?.message, JSON.stringify(more.body)).toBe("Your account is suspended, so your Pay more didn't go through.");
    const c = await confirm(w.dev.cookie, { paymentId: one.id, start: true, seenAt: seen() });
    expect(c.body.error?.message, JSON.stringify(c.body)).toBe("Your account is suspended, so your Confirm with your bank didn't go through.");
    const a = await all(w.dev.cookie, { seenTotalCents: 1000, seenIds: [one.id] });
    expect(a.body.error?.message, JSON.stringify(a.body)).toBe("Your account is suspended, so your Confirm all didn't go through.");
  });

  it("Pay and the suspension at the same moment: paid once, or not at all", async () => {
    for (let i = 0; i < 4; i++) {
      const w = await world();
      bank();
      const [p] = await Promise.all([
        pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true }),
        suspendAccount(await admin(), w.dev.user.id, "abuse", "developer"),
      ]);
      const rows = await db.payment.findMany({ where: { submissionId: w.anaSub.id, status: { in: ["charged", "not_set_up"] } } });
      // (A press that saw the suspension land is refused, §386 A, or stops once naming it; never twice.)
      if (p.status === 200) expect(rows).toHaveLength(1);
      else {
        expect(["stop_once", "suspended"], JSON.stringify(p.body)).toContain(p.body.error?.code);
        expect(rows).toHaveLength(0);
      }
    }
  });

  it("the suspension cancels the developer's own open Pay check (§386 A; back to §159 rule 4a); a tester's charge already confirmed at the bank is still recorded", async () => {
    const w = await world();
    const st = bank();
    st.ask = true;
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(r.body.requiresAction, JSON.stringify(r.body)).toBe(true);
    const away = await waitingCharge(w, w.ben, w.benSub.id, st);
    await suspendAccount(await admin(), w.dev.user.id, "abuse", "developer");
    const own = await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } });
    expect(own.status).not.toBe("needs_action");
    expect(["charged", "not_set_up"]).not.toContain(own.status);
    // The tester's waiting charge keeps its check: its Complete goes through and is recorded normally.
    const kept = await db.payment.findUniqueOrThrow({ where: { id: away.id } });
    expect([kept.status, !!kept.actionPi]).toEqual(["needs_confirmation", true]);
    st.pis.set(kept.actionPi!, "succeeded");
    const done = await confirm(w.dev.cookie, { paymentId: away.id });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: away.id } })).status).toBe("charged");
  });
});

describe("§159: Pay more waits while a payment on its part waits for the bank", () => {
  it("a tester's Charge waiting: refused with “Confirm Ana Silva's $10.00 charge with your bank first.”; once confirmed, Pay more goes through", async () => {
    const w = await world();
    const st = bank();
    const one = await waitingCharge(w, w.ana, w.anaSub.id, st);
    const more = (extra: Record<string, unknown> = {}) => act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "5.00", tickedCents: 500, seenAt: seen(), confirmed: true, ...extra });
    const r = await more();
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, "bank_waits", "Confirm Ana Silva's $10.00 charge with your bank first."]);
    // From an old page too (no stop-once: it can't go ahead).
    const old = await more({ confirmed: false, seenAt: new Date(Date.now() - 60_000).toISOString() });
    expect(old.body.error?.code).toBe("bank_waits");
    st.pis.set(one.actionPi!, "succeeded");
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).toBe(200);
    expect((await more()).status).toBe(200);
  });

  it("the developer's own earlier Pay more whose bank check is open: “Your $5.00 payment for this part is waiting for your bank: finish or cancel it first.”", async () => {
    const w = await world();
    const st = bank();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true })).status).toBe(200);
    st.ask = true;
    const first = await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "5.00", tickedCents: 500, seenAt: seen(), confirmed: true });
    expect(first.body.requiresAction, JSON.stringify(first.body)).toBe(true);
    const second = await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "2.00", tickedCents: 200, seenAt: seen(), confirmed: true });
    expect(second.body.error?.message).toBe("Your $5.00 payment for this part is waiting for your bank: finish or cancel it first.");
  });

  it("a Pay more pressed the same moment a charge on its part is on its way to the bank never slips through", async () => {
    const w = await world();
    bank();
    await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amountCents: 1000, agreedCents: 1000, payKey: "choice:" + randomUUID(), reason: "charged by the tester" } });
    await db.payment.create({ data: { kind: "review", submissionId: w.anaSub.id, contractId: w.ana.sessionId, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "pending" } });
    const r = await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "5.00", tickedCents: 500, seenAt: seen(), confirmed: true });
    expect(r.body.error?.code).toBe("bank_waits");
  });
});

describe("§159: the part's Pay waits while the tester's Charge waits for the bank", () => {
  it("a Pay from a page that hadn't redrawn is refused with the line (nothing charged); after Confirm, Pay more has the room left", async () => {
    const w = await world();
    const st = bank();
    const one = await waitingCharge(w, w.ana, w.anaSub.id, st);
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "500.00", tickedCents: 50000, over200: true, seenAt: new Date(Date.now() - 60_000).toISOString() });
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, "bank_waits", "Confirm Ana Silva's $10.00 charge with your bank first."]);
    expect(st.made).toHaveLength(0);
    st.pis.set(one.actionPi!, "succeeded");
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).toBe(200);
    const over = await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "495.00", tickedCents: 49500, over200: true, seenAt: seen(), confirmed: true });
    expect(over.body.error?.message, JSON.stringify(over.body)).toContain("up to $490 more");
  });

  it("Pay and the tester's Charge at the same moment: at most one charges, never above the part's max", async () => {
    for (let i = 0; i < 4; i++) {
      const w = await world();
      const st = bank();
      const DAY = 86_400_000;
      await db.submission.update({ where: { id: w.anaSub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY), payBy: new Date(Date.now() - DAY) } });
      await settle();
      const [p, c] = await Promise.all([
        pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true }),
        sact(w.ana.sessionId, "choose", w.ana.tester.cookie, { submissionId: w.anaSub.id, choice: "charge", amount: "10.00", seenAt: seen(), confirmed: true }),
      ]);
      const paid = await db.payment.findMany({ where: { submissionId: w.anaSub.id, status: { in: ["charged", "not_set_up"] } } });
      expect(paid.length, JSON.stringify([p.body, c.body])).toBeLessThanOrEqual(1);
      expect(paid.reduce((a, x) => a + x.amountCents, 0)).toBeLessThanOrEqual(1000);
      expect(st.made.length).toBeLessThanOrEqual(1);
      expect([p.status, c.status].filter((x) => x === 200)).toHaveLength(1);
    }
  });
});

describe("§159: Confirm all stops for each item's own changes", () => {
  it("the team's decision about one item's tester (Decisions ticked off) stops it once naming it and the item; the second press goes ahead", async () => {
    const w = await world(["disputes", "admin"]);
    const st = bank();
    // Ana's answers paid $4.00 and disputed; her later recording charged while away; Ben's answers charged while away.
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(w.ana.sessionId, "dispute", w.ana.tester.cookie, { kind: "submission", id: w.anaSub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
    const rec = await db.submission.create({ data: { contractId: w.ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    const a = await waitingCharge(w, w.ana, rec.id, st);
    const b = await waitingCharge(w, w.ben, w.benSub.id, st);
    await settle();
    const loaded = seen(); await settle();
    const ad = await db.user.update({ where: { id: await admin() }, data: { isAdmin: true } });
    await decideDispute(ad, (await db.dispute.findFirstOrThrow({ where: { submissionId: w.anaSub.id } })).id, { total: "4.00", tickCents: 0 });
    await settle();
    const body = { seenTotalCents: 2000, seenIds: [a.id, b.id], seenAt: loaded };
    // (Owner, Nov 11, §380 C) Confirm all no longer stops for the team's decision (D05): it goes ahead at once.
    void texts;
    const first = await all(w.dev.cookie, body);
    expect(first.body.error?.code, JSON.stringify(first.body)).not.toBe("stop_once");
  });

  it("an ignored type about another tester's item doesn't stop it (Ben adds to his answers, “Work sent” ticked off, Ben's item is a different part)", async () => {
    const w = await world(["work"]);
    const st = bank();
    const rec = await db.submission.create({ data: { contractId: w.ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    const benRec = await db.submission.create({ data: { contractId: w.ben.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    const a = await waitingCharge(w, w.ana, rec.id, st);
    const b = await waitingCharge(w, w.ben, benRec.id, st);
    await settle();
    const loaded = seen(); await settle();
    expect((await addTo(w.ben.sessionId, w.ben.tester.cookie, { text: "one more thing", confirmed: true })).status).toBe(200);
    const r = await all(w.dev.cookie, { seenTotalCents: 2000, seenIds: [a.id, b.id], seenAt: loaded });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});

describe("§159 R10: a new card saved while a Pay's bank page completes", () => {
  it("(a) Complete first: the save's cancel finds it already paid → recorded paid once; the page's finish never reads “cancelled”", async () => {
    const w = await world();
    const st = bank();
    st.ask = true;
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true });
    const p = await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } });
    st.pis.set(p.actionPi!, "succeeded"); // Complete at the bank
    await newCardChecks(w.dev.user.id);
    expect(await db.payment.count({ where: { submissionId: w.anaSub.id, status: "charged" } })).toBe(1);
    // The page's own finish: it went through, never "cancelled". (Owner, Nov 5, §210) The window sends its own check (`pi`): this press paid, so it reads as
    // paid (it read §157's "You already confirmed this payment."). A finish without the window's check (a leave beacon) keeps the plain line.
    const fin = await confirm(w.dev.cookie, { paymentId: p.id, pi: p.actionPi });
    expect(fin.body).toMatchObject({ done: true, paid: true, status: "charged", amountCents: 1000 });
    expect((await confirm(w.dev.cookie, { paymentId: p.id })).body.error?.message).toBe("You already confirmed this payment.");
    expect(await db.payment.count({ where: { submissionId: w.anaSub.id, status: "charged" } })).toBe(1);
    expect(st.made).toHaveLength(1);
  });

  it("(b) the save first: cancelled at Stripe; Complete then fails “This payment was cancelled: nothing was charged.”; payable again", async () => {
    const w = await world();
    const st = bank();
    st.ask = true;
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true });
    await newCardChecks(w.dev.user.id);
    const fin = await confirm(w.dev.cookie, { paymentId: r.body.paymentId });
    expect(fin.body.error?.message).toBe("This payment was cancelled: nothing was charged.");
    st.ask = false;
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true })).status).toBe(200);
  });
});

describe("§159: Dispute when a payment since the page loaded left nothing to dispute", () => {
  it("one refusal naming the Pay more (never a stop-once whose second press is refused)", async () => {
    const w = await world();
    bank();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const loaded = seen(); await settle();
    const more = await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "496.00", tickedCents: 49600, over200: true, seenAt: seen(), confirmed: true });
    expect(more.status, JSON.stringify(more.body)).toBe(200);
    const r = await sact(w.ana.sessionId, "dispute", w.ana.tester.cookie, { kind: "submission", id: w.anaSub.id, reason: "I answered every question fully", seenAt: loaded, loadedAt: loaded });
    expect([r.status, r.body.error?.code]).toEqual([409, "no_dispute"]);
    expect(r.body.error.message).toMatch(/^Nora Lane paid \$496\.00 more meanwhile \(.+\): this part is now paid the most it can be \(\$500\.00\), so there's nothing to dispute\.$/);
  });

  it("Dispute and Pay more to the max at the same moment: decided in one place (either the dispute is made, or one refusal; never a stop-once)", async () => {
    for (let i = 0; i < 3; i++) {
      const w = await world();
      bank();
      expect((await pay(w.dev.cookie, { kind: "submission", id: w.anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen(), confirmed: true })).status).toBe(200);
      await settle();
      const loaded = seen(); await settle();
      const [m, d] = await Promise.all([
        act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "496.00", tickedCents: 49600, over200: true, seenAt: seen(), confirmed: true }),
        sact(w.ana.sessionId, "dispute", w.ana.tester.cookie, { kind: "submission", id: w.anaSub.id, reason: "I answered every question fully", seenAt: loaded, loadedAt: loaded }),
      ]);
      expect(d.body.error?.code, JSON.stringify([m.body, d.body])).not.toBe("stop_once");
      if (d.status !== 200) expect(d.body.error?.code).toBe("no_dispute");
    }
  });
});

describe("§159: Pay what you owe already done in another tab names it", () => {
  it("paid in tab 1 → tab 2's old page: “You already paid what you owe ($8.00) in another tab at …”, nothing new at Stripe", async () => {
    const w = await world();
    const st = bank();
    const { startHold } = await import("@/lib/server/holds");
    const debt = await db.payment.create({ data: { kind: "review", contractId: w.ana.sessionId, submissionId: w.anaSub.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(w.dev.user.id, "unpaid");
    const owedPress = (body: Record<string, unknown>) => import("@/app/api/payments/owed/route").then((m) => m.POST(req("/api/payments/owed", { cookie: w.dev.cookie, body }))).then(json);
    const one = await owedPress({ seenTotalCents: 800, seenIds: [debt.id] });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    const n = st.made.length;
    const two = await owedPress({ seenTotalCents: 800, seenIds: [debt.id] });
    expect(two.status).toBe(409);
    expect(two.body.error.message).toMatch(/^You already paid what you owe \(\$8\.00\) in another tab at \d{1,2}:\d{2} [AP]M\.$/);
    expect(st.made.length).toBe(n);
  });
});

describe("§159 R4: Confirm with your bank in two tabs at the same moment", () => {
  it("the check is started once at Stripe (one confirm), both tabs get the same bank page; processing is never read as “nothing was charged”", async () => {
    const w = await world();
    const st = bank();
    const one = await waitingCharge(w, w.ana, w.anaSub.id, st);
    st.pis.set(one.actionPi!, "requires_payment_method");
    let confirms = 0;
    const s = (await import("@/lib/server/stripe")).getStripe() as unknown as { paymentIntents: { confirm: (id: string) => Promise<unknown> } };
    const orig = s.paymentIntents.confirm;
    s.paymentIntents.confirm = async (id: string) => { confirms++; await new Promise((r) => setTimeout(r, 150)); st.pis.set(id, "requires_action"); return orig(id); };
    const [a, b] = await Promise.all([confirm(w.dev.cookie, { paymentId: one.id, start: true }), confirm(w.dev.cookie, { paymentId: one.id, start: true })]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([200, 200]);
    expect(confirms).toBe(1);
    expect(a.body.checkUrl).toBe(b.body.checkUrl);
    // Complete: Stripe says "processing" first, then "succeeded": the finish waits and records it paid once.
    st.pis.set(one.actionPi!, "processing");
    setTimeout(() => st.pis.set(one.actionPi!, "succeeded"), 1500);
    const fin = await confirm(w.dev.cookie, { paymentId: one.id });
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: one.id } })).status).toBe("charged");
  });
});
