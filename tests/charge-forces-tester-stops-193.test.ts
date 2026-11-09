import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { autoChargeCalls } from "@/lib/server/holds";
import { awayAction, release } from "@/lib/server/confirm";
import { finishReviewPay } from "@/lib/server/payments";
import { alwaysStops, devChanges, logEvent, type Press } from "@/lib/server/live";
import { setStripeForTests } from "@/lib/server/stripe";
import { AUTO_CHARGED_CALL, CHARGED_BY_TESTER } from "@/lib/rules";
import { PAYMENT_RULES } from "@/lib/termsOfUse";
import { json, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 4, §193) A charge about a tester (her Charge on any part, an automatic call charge on one of her calls, the team's dispute-decision charge) stops once,
// whatever the Alerts, every press about her: Pay / Pay more / Confirm with your bank on any of her parts, End early including her, call requests with her and
// answering / withdrawing / cancelling them. Presses about the whole test and about other testers follow the Payments tick. The developer's own payments aren't
// charges. A press that could only be refused is refused at once (never a stop first).

const TAB = "tab-" + randomUUID();
const devs: string[] = [];
afterEach(() => setStripeForTests(null));
afterAll(async () => {
  await db.payment.updateMany({ where: { developerId: { in: devs }, status: { notIn: ["charged", "bundled", "not_set_up", "refunded"] } }, data: { status: "cancelled", actionPi: null, actionBy: null, coveredById: null } });
  // Leave no call of these tests due for another file's automatic-charge sweep.
  await db.call.updateMany({ where: { contract: { test: { developerId: { in: devs } } } }, data: { payBy: null } });
});

type Res = { status: number; body: { error?: { code?: string; message?: string; now?: string; changes?: { text: string; forced?: boolean; alert?: string }[] } } & Record<string, unknown> };
const lines = (r: Res) => r.body.error?.changes ?? [];
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json) as Promise<Res>;

/** Charges go through; with `ask`, on-session presses wait for the bank and off-session ones need the developer. */
function bank() {
  const pis = new Map<string, string>();
  const st = { pis, ask: false };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { capture_method?: string; off_session?: boolean }) => {
        const id = "pi_" + randomUUID();
        if (st.ask) {
          pis.set(id, "requires_action");
          if (p.off_session) throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
          return { id, status: "requires_action", client_secret: `${id}_secret`, next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://hooks.stripe.com/3ds" } } };
        }
        pis.set(id, p.capture_method === "manual" ? "requires_capture" : "succeeded");
        return { id, status: pis.get(id) };
      },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "succeeded", client_secret: `${id}_secret`, latest_charge: id.replace(/^pi_/, "ch_") }),
      cancel: async (id: string) => {
        if (pis.get(id) === "succeeded") return { id, status: "succeeded" };
        pis.set(id, "canceled");
        return { id, status: "canceled" };
      },
      capture: async (id: string) => { pis.set(id, "succeeded"); return { id, status: "succeeded" }; },
    },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    customers: { update: async () => ({}) },
  } as unknown as Stripe);
  return st;
}

/** Ana's written answers paid $4.00 (part B: Pay more on it) and her recording sent (part A: her Charge); Ben's written answers sent. Alerts ticked off: `ignored`. */
async function world(ignored: string[] = ["payments"]) {
  const s = await setup({ recordingCents: "10.00" });
  devs.push(s.dev.user.id);
  const ana = await joined(s.testId, "Ana Silva");
  const ben = await joined(s.testId, "Ben Okafor", "he");
  for (const t of [ana, ben]) await sact(t.sessionId, "written", t.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const anaSub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId, kind: "written" } });
  const benSub = await db.submission.findFirstOrThrow({ where: { contractId: ben.sessionId } });
  const anaRec = await db.submission.create({ data: { contractId: ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
  for (const t of [ana, ben]) await db.user.update({ where: { id: t.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 10), payoutsReady: true } });
  const st = bank();
  expect((await pay(s.dev.cookie, { kind: "submission", id: anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen() })).status).toBe(200);
  await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ignored } });
  await settle();
  return { ...s, st, ana, ben, anaSub, benSub, anaRec };
}
type W = Awaited<ReturnType<typeof world>>;
const CHARGE = "Ana Silva charged $10.00 for her recording";
/** The tester's Charge on her recording, as `holds.chooseOutcome` records it: the review, the payment (no press key) and the line on the part. */
async function anaCharges(w: W) {
  await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: w.anaRec.id, amountCents: 1000, agreedCents: 1000, payKey: `choice:${w.anaRec.id}`, reason: CHARGED_BY_TESTER } });
  await db.payment.create({ data: { kind: "review", contractId: w.ana.sessionId, submissionId: w.anaRec.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "charged", payKey: `choice:${w.anaRec.id}` } });
  await db.testEvent.create({ data: { testId: w.testId, kind: "paid", text: CHARGE, contractId: w.ana.sessionId, link: `part-${w.anaRec.id}` } });
}
const payMore = (w: W, seenAt: string, extra: Record<string, unknown> = {}) =>
  act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "1.00", tickedCents: 100, seenAt, ...extra }) as Promise<Res>;
const END = "We have enough feedback from you";

describe("§193: her Charge on part A stops every press about her once, forced, with Payments ticked off", () => {
  it("Pay more on her part B, End early including her, a call request to her: each stops once naming the Charge (forced), then goes ahead", async () => {
    const w = await world();
    const loaded = seen();
    await settle();
    await anaCharges(w);
    await settle();
    const forcedCharge = [expect.objectContaining({ text: CHARGE, forced: true, alert: "payments" })];

    const more = await payMore(w, loaded);
    expect(more.body.error?.code, JSON.stringify(more.body)).toBe("stop_once");
    expect(lines(more)).toEqual(forcedCharge);
    expect((await payMore(w, loaded, { confirmed: true, boxAt: more.body.error!.now })).status).toBe(200);

    const startsAt = new Date(Date.now() + 72 * 3_600_000);
    startsAt.setUTCSeconds(0, 0);
    // Ben: her Charge isn't about him (Payments ticked off): his request goes straight through.
    expect((await act(w.testId, "request-time", w.dev.cookie, { seenAt: loaded, contractIds: [w.ben.sessionId], startsAt: startsAt.toISOString() })).status).toBe(200);
    const req1 = await act(w.testId, "request-time", w.dev.cookie, { seenAt: loaded, contractIds: [w.ana.sessionId], startsAt: startsAt.toISOString() }) as Res;
    expect(req1.body.error?.code, JSON.stringify(req1.body)).toBe("stop_once");
    expect(lines(req1)).toEqual(forcedCharge);
    expect((await act(w.testId, "request-time", w.dev.cookie, { seenAt: loaded, contractIds: [w.ana.sessionId], startsAt: startsAt.toISOString(), confirmed: true, boxAt: req1.body.error!.now })).status).toBe(200);

    const end = await act(w.testId, "end-early", w.dev.cookie, { contractIds: [w.ana.sessionId], reason: END, seenAt: loaded }) as Res;
    expect(end.body.error?.code, JSON.stringify(end.body)).toBe("stop_once");
    expect(lines(end).find((l) => l.text === CHARGE)).toMatchObject({ forced: true });
    expect((await act(w.testId, "end-early", w.dev.cookie, { contractIds: [w.ana.sessionId], reason: END, seenAt: loaded, confirmed: true, boxAt: end.body.error!.now })).status).toBe(200);
  });

  it("answering her call request stops once, forced", async () => {
    const w = await world();
    const startsAt = new Date(Date.now() + 96 * 3_600_000);
    startsAt.setUTCSeconds(0, 0);
    expect((await sact(w.ana.sessionId, "request-time", w.ana.tester.cookie, { startsAt: startsAt.toISOString(), seenAt: seen(), confirmed: true })).status).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: w.ana.sessionId, status: "pending", fromSide: "tester" } });
    await settle();
    const loaded = seen();
    await settle();
    await anaCharges(w);
    const body = { contractId: w.ana.sessionId, requestId: q.id, action: "accept", seenAt: loaded };
    const first = await act(w.testId, "answer-request", w.dev.cookie, body) as Res;
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first)).toEqual([expect.objectContaining({ text: CHARGE, forced: true })]);
    expect((await act(w.testId, "answer-request", w.dev.cookie, { ...body, confirmed: true, boxAt: first.body.error!.now })).status).toBe(200);
  });

  it("Pay on the very part she charged is ONE refusal on the first press, never a stop", async () => {
    const w = await world();
    const loaded = seen();
    await settle();
    await anaCharges(w);
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.anaRec.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(r.body.error).toMatchObject({ code: "reviewed", message: "Ana Silva already charged $10.00 for her recording." });
  });

  it("another tester's Charge doesn't force (follows the Payments tick); Stop (the whole test) follows the tick", async () => {
    const w = await world();
    const loaded = seen();
    await settle();
    await db.testEvent.create({ data: { testId: w.testId, kind: "paid", text: "Ben Okafor charged $10.00 for his written answers", contractId: w.ben.sessionId, link: `part-${w.benSub.id}` } });
    expect((await payMore(w, loaded)).status).toBe(200);
    // Payments ticked on: Ben's Charge stops Pay more on Ana's part once, NOT forced (it can be turned off).
    await db.test.update({ where: { id: w.testId }, data: { ignoredAlerts: [] } });
    const on = await payMore(w, loaded, { amount: "1.50", tickedCents: 150 });
    expect(on.body.error?.code).toBe("stop_once");
    expect(lines(on).find((l) => /^Ben Okafor charged/.test(l.text))).not.toHaveProperty("forced");
    // Ana's Charge, Payments ticked off: Stop is about the whole test, so it goes ahead.
    await db.test.update({ where: { id: w.testId }, data: { ignoredAlerts: ["payments"] } });
    await anaCharges(w);
    expect((await act(w.testId, "stop", w.dev.cookie, { reason: "We have enough feedback", seenAt: loaded })).status).toBe(200);
  });

  it("the developer's own payments are never charges: their Pay's line in another tab is an own line, and a Pay more's payment isn't tagged", async () => {
    const w = await world();
    const since = new Date(Date.now() - 60_000);
    const all = await devChanges(w.dev.user.id, w.testId, since, TAB, db, { press: { acts: ["pay"], keys: ["sub:x"], stopCheck: w.ana.sessionId } });
    expect(all.filter((l) => l.charge)).toEqual([]);
    // A settled own Pay (press key kept) and a Pay more ("extra") going through after the page drew: Payment lines, not charges.
    const at = new Date();
    await db.payment.create({ data: { kind: "extra", contractId: w.ana.sessionId, submissionId: w.anaSub.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 100, feeCents: 0, testerCents: 0, status: "charged", settledAt: at } });
    await db.payment.create({ data: { kind: "review", contractId: w.ben.sessionId, submissionId: w.benSub.id, developerId: w.dev.user.id, testerId: w.ben.tester.user.id, amountCents: 100, feeCents: 0, testerCents: 0, status: "charged", settledAt: at, pressKey: `press:${w.dev.user.id}:${randomUUID()}` } });
    const after = await devChanges(w.dev.user.id, w.testId, since, TAB, db, { all: true });
    const paymentLines = after.filter((l) => l.kind === "payment");
    expect(paymentLines.length).toBe(2);
    expect(paymentLines.every((l) => !l.charge)).toBe(true);
  });
});

describe("§193: an automatic call charge and the team's decision charge do the same", () => {
  it("an automatic call charge on her call stops Pay more on her written answers once, forced (Payments ticked off); Ben's Pay goes ahead", async () => {
    const w = await world();
    const call = await bookCall(w.testId, w.dev.cookie, w.ana.sessionId, w.ana.tester.cookie, 48);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 8 * 86_400_000), actualMinutes: 30, payBy: new Date(Date.now() - 60_000) } });
    await settle();
    const loaded = seen();
    await settle();
    await autoChargeCalls(new Date());
    const ev = await db.testEvent.findFirstOrThrow({ where: { testId: w.testId, kind: "paid", link: `call-${call.id}` } });
    expect(ev.text).toMatch(/^Ana Silva's call on .* was charged automatically: \$15\.00$/);
    const first = await payMore(w, loaded);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first)).toEqual([expect.objectContaining({ text: ev.text, forced: true })]);
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.benSub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded })).status).toBe(200);
  });

  it("the team's decision charge (its payment line) stops End early including her once, forced, with Payments and Decisions ticked off", async () => {
    const w = await world(["payments", "admin", "disputes"]);
    const loaded = seen();
    await settle();
    // The decision's charge on her written answers waited (the test was paused) and went through after the page drew.
    await db.payment.create({ data: { kind: "dispute", contractId: w.ana.sessionId, submissionId: w.anaSub.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 300, feeCents: 0, testerCents: 0, status: "charged", settledAt: new Date() } });
    await settle();
    expect((await act(w.testId, "end-early", w.dev.cookie, { contractIds: [w.ben.sessionId], reason: END, seenAt: loaded })).status).toBe(200);
    const first = await act(w.testId, "end-early", w.dev.cookie, { contractIds: [w.ana.sessionId], reason: END, seenAt: loaded }) as Res;
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first).find((l) => /^Payment went through on Harbor Run: \$3\.00 to Ana Silva for the dispute decision/.test(l.text))).toMatchObject({ forced: true });
  });

  it("which presses a charge is about: hers (payment presses, End early, call requests, answers, withdrawals, cancels); never the whole test's or another tester's", () => {
    const at = new Date();
    const charges = [
      { kind: "paid", text: CHARGE, createdAt: at, contractId: "c-ana", piece: "rec", charge: true },
      { kind: "paid", text: "Ana Silva's call on Tue, Oct 27, 8:00 AM was charged automatically: $15.00", createdAt: at, contractId: "c-ana", piece: "k1", charge: true },
      { kind: "payment", text: "Payment went through on Harbor Run: $3.00 to Ana Silva for the dispute decision", createdAt: at, contractId: "c-ana", piece: "s1", charge: true },
    ];
    const about: Press[] = [
      { acts: ["pay", "pay-more"], keys: ["sub:s2"], stopCheck: "c-ana" },
      { acts: ["end-early"], keys: ["c:c-ana", "c:c-ben"] },
      { acts: ["request-time"], keys: ["c:c-ana"] },
      { acts: ["answer-request"], keys: ["req:r1", "c:c-ana"] },
      { acts: ["cancel-call"], keys: ["call:k2", "c:c-ana"] },
    ];
    for (const p of about) for (const line of charges) expect(alwaysStops(line, p), JSON.stringify([p, line.text])).toBe(true);
    const not: Press[] = [{ acts: ["stop"], keys: ["test"] }, { acts: ["edit"], keys: ["*"] }, { acts: ["end-early"], keys: ["c:c-ben"] }, { acts: ["pay"], keys: ["sub:b1"], stopCheck: "c-ben" }];
    for (const p of not) for (const line of charges) expect(alwaysStops(line, p), JSON.stringify([p, line.text])).toBe(false);
    // A paid line that isn't a charge (the call closed with nothing to pay, a Let it go) follows the ticks off its own part.
    expect(alwaysStops({ kind: "paid", text: "Ana Silva's call on Tue, Oct 27, 8:00 AM closed with nothing to pay", createdAt: at, contractId: "c-ana", piece: "k1" }, about[0])).toBe(false);
    // Confirm with your bank on a waiting charge (`awayCharge`): her charge on another part forces; the line of the charge it confirms, or of a part Confirm all
    // covers, doesn't; another tester's doesn't.
    const away: Press = { acts: ["pay", "pay-more"], keys: ["call:k1"], stopCheck: "c-ana", awayCharge: true };
    expect(alwaysStops(charges[0], away)).toBe(true);
    expect(alwaysStops(charges[1], away)).toBe(false);
    expect(alwaysStops(charges[0], { ...away, confirms: ["k1", "rec"] })).toBe(false);
    expect(alwaysStops({ ...charges[0], contractId: "c-ben" }, away)).toBe(false);
    // (Owner, Nov 5) A dispute by that tester forces it too (it followed the Disputes tick before); another tester's dispute doesn't.
    const dispute = { kind: "dispute", text: "Ana Silva disputed the pay for her written answers", createdAt: at, contractId: "c-ana" };
    expect(alwaysStops(dispute, away)).toBe(true);
    expect(alwaysStops({ ...dispute, contractId: "c-ben" }, away)).toBe(false);
    // (Owner, Nov 9, §340) That tester leaving no longer forces Confirm with your bank / Confirm all: it follows the "Testers leaving" tick. Pay still forces it.
    const left = { kind: "left", text: "Ana Silva left the test", createdAt: at, contractId: "c-ana" };
    expect(alwaysStops(left, away)).toBe(false);
    expect(alwaysStops(left, { ...away, confirms: ["k1"] })).toBe(false);
    expect(alwaysStops(left, { ...away, awayCharge: undefined })).toBe(true);
  });
});

describe("§193: Confirm with your bank on a charge made while away", () => {
  it("her Charge on another part stops it once, forced (Payments ticked off); the line of the charge it confirms and Ben's Charge don't", async () => {
    const w = await world();
    const call = await bookCall(w.testId, w.dev.cookie, w.ana.sessionId, w.ana.tester.cookie, 48);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 8 * 86_400_000), actualMinutes: 30 } });
    await db.review.create({ data: { contractId: w.ana.sessionId, callId: call.id, amountCents: 1500, agreedCents: 1500, payKey: `autocall:${call.id}`, reason: AUTO_CHARGED_CALL, auto: true } });
    const p = await db.payment.create({ data: { kind: "call", contractId: w.ana.sessionId, callId: call.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 1500, feeCents: 0, testerCents: 0, status: "needs_confirmation", payKey: `autocall:${call.id}` } });
    const pi = "pi_" + randomUUID();
    w.st.pis.set(pi, "requires_action");
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: `${pi}_secret` });
    await settle();
    const loaded = seen();
    await settle();
    // The waiting charge's own line (after the dashboard's first load) and Ben's Charge (Payments ticked off): neither is in the box. Her Charge on her
    // recording: the one forced line.
    await logEvent(w.testId, "paid", "Ana Silva's call on Tue, Oct 27, 8:00 AM was charged automatically: $15.00, waiting for your bank to confirm it", w.ana.sessionId, `call-${call.id}`);
    await logEvent(w.testId, "paid", "Ben Okafor charged $10.00 for his written answers", w.ben.sessionId, `part-${w.benSub.id}`);
    await anaCharges(w);
    const start = (extra: Record<string, unknown> = {}) => confirmPOST(req("/api/payments/confirm", { cookie: w.dev.cookie, headers: { "x-tab": TAB }, body: { paymentId: p.id, start: true, seenAt: loaded, ...extra } })).then(json) as Promise<Res>;
    const first = await start();
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first)).toEqual([expect.objectContaining({ text: CHARGE, forced: true })]);
    expect((await start({ confirmed: true, boxAt: first.body.error!.now })).status).toBe(200);
  });
});

describe("§193 check (no change): an automatic call charge waits while the developer's own Pay on that call is at the bank", () => {
  async function callAtBank(w: W, hours: number) {
    const call = await bookCall(w.testId, w.dev.cookie, w.ana.sessionId, w.ana.tester.cookie, hours);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 8 * 86_400_000), actualMinutes: 30, payBy: new Date(Date.now() - 60_000) } });
    w.st.ask = true;
    const r = await pay(w.dev.cookie, { kind: "call", id: call.id, amount: "5.00", tickedCents: 500, reason: "Shorter than booked", seenAt: seen(), confirmed: true });
    expect(r.body, JSON.stringify(r.body)).toMatchObject({ requiresAction: true });
    w.st.ask = false;
    const own = await db.payment.findFirstOrThrow({ where: { callId: call.id, status: "needs_action" } });
    return { call, own };
  }
  const autoRows = (callId: string) => db.payment.count({ where: { callId, payKey: `autocall:${callId}` } });

  it("skipped while at the bank, and for good once that Pay completes", async () => {
    const w = await world();
    const { call, own } = await callAtBank(w, 48);
    await autoChargeCalls(new Date());
    expect(await autoRows(call.id)).toBe(0);
    expect(await db.review.findUnique({ where: { callId: call.id } })).toBeNull();
    await finishReviewPay(own.id, { status: "charged", stripePaymentIntentId: own.actionPi });
    await autoChargeCalls(new Date());
    expect(await autoRows(call.id)).toBe(0);
    expect(await db.review.findUniqueOrThrow({ where: { callId: call.id } })).toMatchObject({ amountCents: 500, auto: false });
  });

  it("charged on the next sweep when that Pay is cancelled", async () => {
    const w = await world();
    const { call, own } = await callAtBank(w, 50);
    await autoChargeCalls(new Date());
    expect(await autoRows(call.id)).toBe(0);
    await release(own.id);
    expect((await db.payment.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("cancelled");
    await autoChargeCalls(new Date());
    expect(await autoRows(call.id)).toBe(1);
    expect(await db.review.findUniqueOrThrow({ where: { callId: call.id } })).toMatchObject({ amountCents: 1500, reason: AUTO_CHARGED_CALL, auto: true });
  });
});

describe("§193 Terms", () => {
  it("Changes while you pay says a charge about a tester stops every press about them", () => {
    const text = PAYMENT_RULES.find((r) => r.heading === "Changes while you pay")!.text;
    expect(text).toContain("a charge for that tester forces a stop on the developer’s payment, End early, and call buttons for that tester, even with Alerts off.");
    expect(text).toContain("Charges include the tester’s Charge, automatic call charges, and charges from team decisions.");
    expect(text).toContain("Those events follow Alerts on whole-test buttons and buttons for other testers.");
  });
});
