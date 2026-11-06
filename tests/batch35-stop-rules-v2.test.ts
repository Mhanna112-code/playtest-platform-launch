import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as allPOST } from "@/app/api/payments/confirm-all/route";
import { CANCELLED_WHY, cancelledLine } from "@/lib/bankNotice";
import { checkPiOf } from "@/lib/bankConfirm";
import { decideDispute } from "@/lib/server/payments";
import { chargebackOpened, chargebackWon, declinedPayment, disputeAmountChanged, owedLines, payOwed, startHold } from "@/lib/server/holds";
import { approveChargebackHold } from "@/lib/server/chargeback";
import { awayAction } from "@/lib/server/confirm";
import { OWED_REVIEW_AGAIN, OWED_WON_MEANWHILE, releaseOwed } from "@/lib/server/owedOnce";
import { SETTLE_MS } from "@/lib/server/bankPeek";
import { alwaysStops, callLengthLine, callProblemLine, logEvent, pressContracts, type Press } from "@/lib/server/live";
import { fmtDateTime } from "@/lib/server/dateFormat";
import { setStripeForTests } from "@/lib/server/stripe";
import { PAYMENT_RULES, TERMS_VERSION, WHAT_CHANGED } from "@/lib/termsOfUse";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 4, batch 35 §171) The new stop rules and the payment fixes:
// A1 same part always stops (a payment on it, a Charge on it, a call's problem report and its length becoming final), forced;
// A2 a dispute by a tester (or the team's decision on it) stops every press about that tester once (End early, call presses), and the tester's own presses;
// A3 the blue notice inside an open bank window lists everything about the payment's tester whatever the Alerts ticks (Confirm all: each covered charge's tester);
// B4 a single Confirm window whose check Confirm all took over (or a new check replaced, or another check paid) says it was cancelled;
// B5 a hold start cancels an open Pay more check too; B6 Pay what you owe while chargebacks change underneath it; C the Terms.

const TAB = "tab-" + randomUUID();
const devs: string[] = [];
beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });
afterAll(async () => {
  await db.payment.updateMany({ where: { developerId: { in: devs }, status: { notIn: ["charged", "bundled", "not_set_up", "refunded"] } }, data: { status: "cancelled", actionPi: null, actionBy: null, coveredById: null } });
  await db.reservation.updateMany({ where: { developerId: { in: devs } }, data: { status: "cancelled" } });
  await db.user.updateMany({ where: { id: { in: devs } }, data: { holdStartedAt: null, holdReason: "" } });
});

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json);
type Res = { status: number; body: { error?: { code?: string; message?: string; now?: string; changes?: { text: string; forced?: boolean }[] } } & Record<string, unknown> };
const lines = (r: Res) => r.body.error?.changes ?? [];
const texts = (r: Res) => lines(r).map((c) => c.text);
const peek = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, headers: { "x-tab": TAB }, body: { ...body, peek: true } })).then(json);
const refused = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message?: string; data?: Record<string, unknown> }) => e);

/**
 * A Stripe stand-in that remembers each PaymentIntent. `ask`: on-session presses wait for the bank (requires_action), off-session ones need the developer;
 * otherwise charges go through and reservations wait for capture. Cancel answers "succeeded" for a check the bank already approved (as Stripe's retrieve would).
 */
function bank() {
  const pis = new Map<string, string>();
  const st = { pis, ask: false, made: [] as { id: string; amount: number }[], cancelled: [] as string[], refunds: [] as { payment_intent: string; amount: number }[] };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; capture_method?: string; off_session?: boolean }) => {
        const id = "pi_" + randomUUID();
        st.made.push({ id, amount: p.amount });
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
        st.cancelled.push(id);
        pis.set(id, "canceled");
        return { id, status: "canceled" };
      },
      capture: async (id: string) => { pis.set(id, "succeeded"); return { id, status: "succeeded" }; },
    },
    refunds: { create: async (p: { payment_intent: string; amount: number }) => { st.refunds.push(p); return { id: "re_" + randomUUID() }; } },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    customers: { update: async () => ({}) },
  } as unknown as Stripe);
  return st;
}

/** Ana's written answers paid $4.00 (so she can dispute) and her recording sent; Ben's written answers sent. Ticks: `ignored`. */
async function world(ignored: string[] = [], over: Record<string, unknown> = {}) {
  const s = await setup({ recordingCents: "10.00", ...over });
  devs.push(s.dev.user.id);
  const ana = await joined(s.testId, "Ana Silva");
  const ben = await joined(s.testId, "Ben Okafor", "he");
  for (const t of [ana, ben]) await sact(t.sessionId, "written", t.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const anaSub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId, kind: "written" } });
  const benSub = await db.submission.findFirstOrThrow({ where: { contractId: ben.sessionId } });
  const anaRec = await db.submission.create({ data: { contractId: ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
  const st = bank();
  expect((await pay(s.dev.cookie, { kind: "submission", id: anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen() })).status).toBe(200);
  await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ignored } });
  await settle();
  return { ...s, st, ana, ben, anaSub, benSub, anaRec };
}
type W = Awaited<ReturnType<typeof world>>;
const dispute = (w: W) => sact(w.ana.sessionId, "dispute", w.ana.tester.cookie, { kind: "submission", id: w.anaSub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true });
const payMore = (w: W, submissionId: string, seenAt: string, extra: Record<string, unknown> = {}) =>
  act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId, amount: "1.00", tickedCents: 100, seenAt, ...extra });
async function admin() {
  const a = await makeUser({ name: "Admin" });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
}

describe("§171 A1: same part always stops, whatever the Alerts ticks", () => {
  it("another payment on the part being paid (Payments ticked off) stops Pay more once, forced; a charge also forces on her other part (§193), another tester's follows the tick", async () => {
    const w = await world(["payments", "work", "disputes", "admin", "calls"]);
    const loaded = seen();
    await settle();
    // A team decision's charge on Ana's written answers went through after the page drew.
    await db.payment.create({ data: { kind: "dispute", contractId: w.ana.sessionId, submissionId: w.anaSub.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 300, feeCents: 0, testerCents: 0, status: "charged", settledAt: new Date() } });
    await settle();
    const first = await payMore(w, w.anaSub.id, loaded);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first)).toEqual([expect.objectContaining({ text: expect.stringMatching(/^Payment went through on Harbor Run: \$3\.00 to Ana Silva/), forced: true })]);
    expect((await payMore(w, w.anaSub.id, loaded, { confirmed: true, boxAt: first.body.error!.now })).status).toBe(200);
    // (Owner, Nov 4, §193; was: her recording followed the Payments tick) A decision's charge is a charge about Ana: it stops Pay on her other part once too,
    // forced. Ben's part follows the tick (off): Pay goes straight through.
    const rec = await pay(w.dev.cookie, { kind: "submission", id: w.anaRec.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(rec.body.error?.code, JSON.stringify(rec.body)).toBe("stop_once");
    expect(lines(rec)).toEqual([expect.objectContaining({ forced: true })]);
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.benSub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded })).status).toBe(200);
  });

  it("a Charge on that part (its line names the part) stops Pay on it once, forced", async () => {
    const w = await world(["payments"]);
    const loaded = seen();
    await settle();
    await db.testEvent.create({ data: { testId: w.testId, kind: "paid", text: "Ana Silva charged $10.00 for her recording", contractId: w.ana.sessionId, link: `part-${w.anaRec.id}` } });
    const first = await pay(w.dev.cookie, { kind: "submission", id: w.anaRec.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(first.body.error?.code).toBe("stop_once");
    expect(lines(first)).toEqual([{ text: "Ana Silva charged $10.00 for her recording", at: expect.anything(), alert: "payments", forced: true, sid: expect.any(String) }]);
    // Ben's part: the same line isn't about it, and Payments is ticked off.
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.benSub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded })).status).toBe(200);
  });

  it("the holds' Charge, Let it go and automatic call charge lines carry their part", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/server/holds.ts", "utf8");
    expect(src.match(/false, \{\}, c\.id, "", `part-\$\{s\.id\}`\)/g)?.length).toBe(4); // choice, let go, charge (twice)
    expect(src.match(/false, \{\}, c\.id, "", `call-\$\{x\.id\}`\)/g)?.length).toBe(6); // closed with nothing, the automatic charge, let go, charge (twice); (§311e) an unlisted call closed with nothing paid
  });

  it("a call: the tester's problem report and its length becoming final each stop Pay on that call once (Calls ticked off), forced", async () => {
    const s = await setup();
    devs.push(s.dev.user.id);
    await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ["calls", "payments", "work", "disputes", "admin"] } });
    const ana = await joined(s.testId, "Ana Silva");
    const call = await bookCall(s.testId, s.dev.cookie, ana.sessionId, ana.tester.cookie);
    const started = new Date(Date.now() - 120 * 60_000);
    await db.call.update({ where: { id: call.id }, data: { startsAt: started, measuredMinutes: 30, measuredAt: new Date(Date.now() - 60_000), endedAt: new Date(Date.now() - 60_000) } });
    await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
    bank();
    await settle();
    const loaded = seen();
    await settle();
    await db.call.update({ where: { id: call.id }, data: { noShowBy: "tester", noShowNote: "Was late.", noShowAt: new Date() } });
    const body = { kind: "call", id: call.id, amount: "15.00", tickedCents: 1500, seenAt: loaded };
    const first = await pay(s.dev.cookie, body);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first)).toEqual([expect.objectContaining({ text: callProblemLine("Ana Silva", fmtDateTime(started), "Was late."), forced: true })]);
    expect(texts(first)[0]).toMatch(/^Ana Silva reported a problem with the call on .*: Was late$/);
    // Its length became final after the page drew (a second call).
    const call2 = await bookCall(s.testId, s.dev.cookie, ana.sessionId, ana.tester.cookie, 72);
    await db.call.update({ where: { id: call2.id }, data: { startsAt: started, endedAt: new Date() } });
    await settle();
    const loaded2 = seen();
    await settle();
    await db.call.update({ where: { id: call2.id }, data: { measuredMinutes: 20, measuredAt: new Date() } });
    const r2 = await pay(s.dev.cookie, { kind: "call", id: call2.id, amount: "10.00", tickedCents: 1000, seenAt: loaded2 });
    expect(r2.body.error?.code, JSON.stringify(r2.body)).toBe("stop_once");
    expect(lines(r2)).toEqual([expect.objectContaining({ text: callLengthLine("Ana Silva", fmtDateTime(started), 20), forced: true })]);
    expect(callLengthLine("Ana Silva", "Thu, Nov 5, 3:00 PM", 20)).toBe("The length of the call with Ana Silva on Thu, Nov 5, 3:00 PM is final: 20 minutes");
    expect((await pay(s.dev.cookie, { kind: "call", id: call2.id, amount: "10.00", tickedCents: 1000, seenAt: loaded2, confirmed: true, boxAt: r2.body.error!.now })).status).toBe(200);
  });
});

describe("§171 A2: a dispute by a tester, or the team's decision on it, stops every press about that tester once", () => {
  it("End early including her stops once (Disputes ticked off), forced; End early of another tester goes through", async () => {
    const w = await world(["disputes", "admin"]);
    const loaded = seen();
    await settle();
    expect((await dispute(w)).status).toBe(200);
    await settle();
    const END = "We have enough feedback from you";
    expect((await act(w.testId, "end-early", w.dev.cookie, { contractIds: [w.ben.sessionId], reason: END, seenAt: loaded })).status).toBe(200);
    const first = await act(w.testId, "end-early", w.dev.cookie, { contractIds: [w.ana.sessionId], reason: END, seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first).find((l) => /^Ana Silva disputed the pay/.test(l.text))).toMatchObject({ forced: true, alert: "disputes" });
    expect((await act(w.testId, "end-early", w.dev.cookie, { contractIds: [w.ana.sessionId], reason: END, seenAt: loaded, confirmed: true, boxAt: first.body.error!.now })).status).toBe(200);
  });

  it("the team's decision stops Pay on her other part (as §159 rule 1) and her dispute now does too; Stop (the whole test) follows the ticks", async () => {
    const w = await world(["disputes", "admin"]);
    const loaded = seen();
    await settle();
    expect((await dispute(w)).status).toBe(200);
    await settle();
    const first = await pay(w.dev.cookie, { kind: "submission", id: w.anaRec.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(first.body.error?.code).toBe("stop_once");
    expect(lines(first)).toEqual([expect.objectContaining({ text: "Ana Silva disputed the pay for her written answers", forced: true })]);
    // Ben's part: her dispute isn't about him (ticked off).
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.benSub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded })).status).toBe(200);
    const row = await db.dispute.findFirstOrThrow({ where: { submissionId: w.anaSub.id } });
    await decideDispute(await admin(), row.id, { total: "10.00", tickCents: 600 });
    await settle();
    expect((await act(w.testId, "stop", w.dev.cookie, { reason: "We have enough feedback", seenAt: loaded })).status).toBe(200);
  });

  it("which presses are about her: payment presses, End early, call requests, their answers and cancels; never the whole test's or another tester's", () => {
    const d = { kind: "dispute", text: "Ana Silva disputed the pay for her written answers", createdAt: new Date(), contractId: "c-ana" };
    const decided = { kind: "admin", text: "The team decided Ana Silva's dispute: kept the pay at $4.00", createdAt: new Date(), contractId: "c-ana" };
    const about: Press[] = [
      { acts: ["pay", "pay-more"], keys: ["sub:s1"], stopCheck: "c-ana" },
      { acts: ["end-early"], keys: ["c:c-ana", "c:c-ben"] },
      { acts: ["request-time"], keys: ["c:c-ana"] },
      { acts: ["answer-request"], keys: ["req:r1", "c:c-ana"] },
      { acts: ["cancel-call"], keys: ["call:k1", "c:c-ana"] },
    ];
    for (const p of about) for (const line of [d, decided]) expect(alwaysStops(line, p), JSON.stringify(p)).toBe(true);
    const not: Press[] = [{ acts: ["stop"], keys: ["test"] }, { acts: ["invite"], keys: ["t:u-ana"] }, { acts: ["end-early"], keys: ["c:c-ben"] }, { acts: ["pay"], keys: ["sub:s2"], stopCheck: "c-ben" }];
    for (const p of not) for (const line of [d, decided]) expect(alwaysStops(line, p), JSON.stringify(p)).toBe(false);
    expect(pressContracts({ acts: ["pay"], keys: ["sub:s1"], stopCheck: "c-ana" })).toEqual(["c-ana"]);
  });

  it("the tester (Alerts Off): the developer adding their side, then the team's decision, each stop her presses once, forced", async () => {
    const w = await world();
    expect((await dispute(w)).status).toBe(200);
    await db.user.update({ where: { id: w.ana.tester.user.id }, data: { testerAlertsOff: true } });
    await settle();
    const loaded = seen();
    await settle();
    const row = await db.dispute.findFirstOrThrow({ where: { submissionId: w.anaSub.id } });
    expect((await act(w.testId, "dispute-side", w.dev.cookie, { disputeId: row.id, text: "Answers 2 and 3 were one word each" })).status).toBe(200);
    await settle();
    const first = await sact(w.ana.sessionId, "request-time", w.ana.tester.cookie, { startsAt: new Date(Date.now() + 72 * 3_600_000).toISOString(), seenAt: loaded, loadedAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first)).toEqual([expect.objectContaining({ text: "Nora Lane added her side to your dispute about your written answers", forced: true })]);
    await settle();
    const loaded2 = seen();
    await settle();
    await decideDispute(await admin(), row.id, { total: "10.00", tickCents: 600 });
    await settle();
    const leave = await sact(w.ana.sessionId, "leave", w.ana.tester.cookie, { seenAt: loaded2 });
    expect(leave.body.error?.code, JSON.stringify(leave.body)).toBe("stop_once");
    expect(lines(leave)).toEqual([expect.objectContaining({ text: expect.stringMatching(/^The team decided your dispute with .+ about your written answers/), forced: true })]);
  });
});

describe("§171 A3: the blue notice lists everything about the payment's tester, whatever the ticks", () => {
  it("Pay's open window: her dispute and a booking about her are lines with every tick off; another tester's aren't", async () => {
    const w = await world();
    w.st.ask = true;
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.anaRec.id, amount: "10.00", tickedCents: 1000, seenAt: seen() });
    expect(r.body).toMatchObject({ requiresAction: true });
    await db.test.update({ where: { id: w.testId }, data: { ignoredAlerts: ["joins", "leaving", "work", "calls", "payments", "disputes", "admin"] } });
    await settle();
    const since = seen();
    await settle();
    await logEvent(w.testId, "dispute", "Ben Okafor disputed the pay for his written answers", w.ben.sessionId);
    await logEvent(w.testId, "booked", "Ana Silva booked a call for Thu, Nov 5, 3:00 PM", w.ana.sessionId);
    await logEvent(w.testId, "dispute", "Ana Silva disputed the pay for her written answers", w.ana.sessionId);
    const p = await peek(w.dev.cookie, { paymentId: r.body.paymentId, since });
    expect(p.body).toMatchObject({ status: "waiting", changes: ["Ana Silva booked a call for Thu, Nov 5, 3:00 PM", "Ana Silva disputed the pay for her written answers"] });
  });
});

/** Three charges made while away waiting for the bank (Ana's written answers and recording, Ben's written answers), each on its own check. */
async function waitingWorld(ignored: string[] = []) {
  const w = await world(ignored);
  w.st.ask = true;
  const items = [];
  for (const [contractId, submissionId, testerId, cents] of [[w.ana.sessionId, w.anaRec.id, w.ana.tester.user.id, 1000], [w.ben.sessionId, w.benSub.id, w.ben.tester.user.id, 1200]] as const) {
    await db.review.create({ data: { contractId, submissionId, amountCents: cents, agreedCents: cents, payKey: randomUUID(), reason: "charged by the tester" } });
    const p = await db.payment.create({ data: { kind: "review", contractId, submissionId, developerId: w.dev.user.id, testerId, amountCents: cents, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
    const pi = "pi_" + randomUUID();
    w.st.pis.set(pi, "requires_action");
    items.push(await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: `${pi}_secret` }));
  }
  await settle();
  return { ...w, items };
}
const startConfirm = (cookie: string, paymentId: string) => confirmPOST(req("/api/payments/confirm", { cookie, headers: { "x-tab": TAB }, body: { paymentId, start: true } })).then(json);
const confirmAll = (cookie: string, items: { id: string; amountCents: number }[]) => allPOST(req("/api/payments/confirm-all", { cookie, headers: { "x-tab": TAB }, body: { seenTotalCents: items.reduce((a, p) => a + p.amountCents, 0), seenIds: items.map((p) => p.id) } })).then(json);

describe("§171 item 7: Confirm with your bank on a charge made while away keeps its press-time gate (the owner is deciding)", () => {
  it("a payment line on its part with Payments ticked off doesn't stop it (A1 isn't applied there); (§205) her dispute stops it once, forced; the window's notice still lists both (A3)", async () => {
    const w = await waitingWorld(["payments", "disputes", "admin", "work", "calls"]);
    const loaded = seen();
    await settle();
    await db.testEvent.create({ data: { testId: w.testId, kind: "paid", text: "Ana Silva charged $10.00 for her recording", contractId: w.ana.sessionId, link: `part-${w.anaRec.id}` } });
    await logEvent(w.testId, "dispute", "Ana Silva disputed the pay for her written answers", w.ana.sessionId);
    const start = (extra: Record<string, unknown> = {}) => confirmPOST(req("/api/payments/confirm", { cookie: w.dev.cookie, headers: { "x-tab": TAB }, body: { paymentId: w.items[0].id, start: true, seenAt: loaded, ...extra } })).then(json) as Promise<Res>;
    // (Owner, Nov 5, §205) A dispute by that tester now forces the stop (it followed the Disputes tick before); the payment line on its part still doesn't.
    const first = await start();
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first).map((c) => [c.text, !!c.forced])).toEqual([["Ana Silva disputed the pay for her written answers", true]]);
    const r = await start({ confirmed: true, boxAt: first.body.error!.now });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = await peek(w.dev.cookie, { paymentId: w.items[0].id, pi: w.items[0].actionPi, since: loaded });
    expect(p.body.changes).toEqual(["Ana Silva charged $10.00 for her recording", "Ana Silva disputed the pay for her written answers"]);
  });
});

describe("§171 B4: a single Confirm window whose check isn't the live one any more says it was cancelled", () => {
  it("Confirm all took its charge over in another tab: cancelled, moved into your Confirm all; Complete there charges nothing", async () => {
    const w = await waitingWorld();
    const one = await startConfirm(w.dev.cookie, w.items[0].id);
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    const pi = checkPiOf(one.body.clientSecret as string);
    expect(pi).toBe(w.items[0].actionPi);
    const since = seen();
    await settle();
    expect((await peek(w.dev.cookie, { paymentId: w.items[0].id, pi, since })).body).toEqual({ status: "waiting" });
    const all = await confirmAll(w.dev.cookie, w.items);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const line = "This bank check was cancelled: it was moved into your Confirm all in another tab. Pressing Complete won't charge anything.";
    expect(cancelledLine(CANCELLED_WHY.inAll)).toBe(line);
    expect((await peek(w.dev.cookie, { paymentId: w.items[0].id, pi, since })).body).toEqual({ status: "waiting", cancelled: line });
    // An older page that sends no PaymentIntent is told too (the cover is on the row).
    expect((await peek(w.dev.cookie, { paymentId: w.items[0].id, since })).body).toEqual({ status: "waiting", cancelled: line });
    expect(w.st.cancelled).toContain(pi); // Confirm all cancelled the old check at Stripe first
  });

  it("a new check replaced it, or it was paid on another check: each says so; this window's own live check says nothing", async () => {
    const w = await waitingWorld();
    const [a, b] = w.items;
    const since = seen();
    await settle();
    expect((await peek(w.dev.cookie, { paymentId: a.id, pi: a.actionPi, since })).body).toEqual({ status: "waiting" });
    await db.payment.update({ where: { id: a.id }, data: { actionPi: "pi_" + randomUUID() } });
    expect((await peek(w.dev.cookie, { paymentId: a.id, pi: a.actionPi, since })).body).toEqual({ status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.replaced) });
    await db.payment.update({ where: { id: b.id }, data: { actionPi: null, actionBy: null, status: "charged", settledAt: new Date(), stripePaymentIntentId: "pi_" + randomUUID() } });
    expect((await peek(w.dev.cookie, { paymentId: b.id, pi: b.actionPi, since })).body).toEqual({ status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.paidOther) });
    expect(checkPiOf("pi_123_secret_abc")).toBe("pi_123");
    expect(checkPiOf("s")).toBe("");
  });

  it("A3 in Confirm all's window: everything about each covered charge's tester, whatever the ticks; another tester's line follows them", async () => {
    const w = await waitingWorld(["disputes", "admin", "payments", "work", "calls"]);
    const cara = await joined(w.testId, "Cara Diaz");
    const all = await confirmAll(w.dev.cookie, w.items);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const oneId = (all.body.confirm as { paymentId: string } | undefined)?.paymentId;
    expect(oneId).toBeTruthy();
    await settle();
    const since = seen();
    await settle();
    await logEvent(w.testId, "dispute", "Cara Diaz disputed the pay for her written answers", cara.sessionId);
    await logEvent(w.testId, "dispute", "Ben Okafor disputed the pay for his written answers", w.ben.sessionId);
    await logEvent(w.testId, "admin", "The team decided Ana Silva's dispute: kept the pay at $4.00, which was already paid: nothing more was charged", w.ana.sessionId);
    const p = await peek(w.dev.cookie, { paymentId: oneId, since });
    expect(p.body.changes).toEqual(["The team decided Ana Silva's dispute: kept the pay at $4.00, which was already paid: nothing more was charged", "Ben Okafor disputed the pay for his written answers"]);
  });
});

describe("§171 B5: a hold starting cancels an open Pay more check too", () => {
  it("cancelled at Stripe; the window says the hold paused the tests; nothing is charged", async () => {
    const w = await world();
    w.st.ask = true;
    const r = await payMore(w, w.anaSub.id, seen(), { confirmed: true, boxAt: seen() });
    expect(r.body, JSON.stringify(r.body)).toMatchObject({ requiresAction: true });
    const id = r.body.paymentId as string;
    const pi = (await db.payment.findUniqueOrThrow({ where: { id } })).actionPi!;
    const since = seen();
    await settle();
    await startHold(w.dev.user.id, "unpaid");
    expect(w.st.cancelled).toContain(pi);
    expect(await db.payment.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "cancelled", actionPi: null });
    expect((await peek(w.dev.cookie, { paymentId: id, pi, since })).body).toEqual({ status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.hold) });
  });

  it("one the bank had already approved is recorded as paid once (never charged again)", async () => {
    const w = await world();
    w.st.ask = true;
    const r = await payMore(w, w.anaSub.id, seen(), { confirmed: true, boxAt: seen() });
    const id = r.body.paymentId as string;
    const pi = (await db.payment.findUniqueOrThrow({ where: { id } })).actionPi!;
    w.st.pis.set(pi, "succeeded");
    const made = w.st.made.length;
    await startHold(w.dev.user.id, "unpaid");
    expect(await db.payment.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "charged", amountCents: 100 });
    expect(w.st.made.length).toBe(made);
    expect(await db.payment.count({ where: { contractId: w.ana.sessionId, kind: "extra", status: "charged" } })).toBe(1);
  });
});

/** A developer with a saved card and two testers' written answers, for the chargeback cases (as chargeback-review-first's). */
async function cbWorld() {
  const s = await setup();
  devs.push(s.dev.user.id);
  const t: (Awaited<ReturnType<typeof joined>> & { sub: { id: string } })[] = [];
  for (const name of ["Ana Silva", "Ben Okafor"]) {
    const j = await joined(s.testId, name);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    t.push({ ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) });
  }
  await settle();
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
  const st = bank();
  const paid = (i: number, cents: number) => db.payment.create({ data: { kind: "review", contractId: t[i].sessionId, submissionId: t[i].sub.id, developerId: s.dev.user.id, testerId: t[i].tester.user.id, amountCents: cents, feeCents: cents / 10, testerCents: cents - cents / 10, status: "charged", stripePaymentIntentId: "pi_" + randomUUID() } });
  return { ...s, t, st, paid };
}
type CB = Awaited<ReturnType<typeof cbWorld>>;
/** A review-first account (an earlier chargeback, then this one), its card verified and paying approved by the team: Pay what you owe's charge open at the bank. */
async function reviewFirstOpen(w: CB) {
  await db.payment.create({ data: { kind: "review", contractId: w.t[1].sessionId, developerId: w.dev.user.id, testerId: w.t[1].tester.user.id, amountCents: 500, feeCents: 50, testerCents: 450, status: "charged", chargeback: "resolved", reversedCents: 500, stripePaymentIntentId: "pi_" + randomUUID() } });
  const p = await w.paid(0, 1000);
  await chargebackOpened(p.stripePaymentIntentId!, null);
  await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
  await approveChargebackHold(w.dev.user.id);
  w.st.ask = true;
  const r = (await payOwed(w.dev.user, {})) as { confirm: { paymentId: string; clientSecret: string }[] };
  expect(r.confirm).toHaveLength(1);
  const one = await db.payment.findUniqueOrThrow({ where: { id: r.confirm[0].paymentId } });
  expect(one).toMatchObject({ kind: "owed", status: "needs_action", amountCents: 2500 });
  await settle();
  return { reversed: p, one, since: seen() };
}

describe("§171 B6: Pay what you owe while chargebacks change underneath it", () => {
  it("(a) a new chargeback during an approved review-first payment: cancelled at Stripe, nothing charged; the window says the team reviews again", async () => {
    const w = await cbWorld();
    const { one, since } = await reviewFirstOpen(w);
    await settle();
    const p2 = await w.paid(1, 800);
    await chargebackOpened(p2.stripePaymentIntentId!, null);
    expect(w.st.cancelled).toContain(one.actionPi);
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: "cancelled", actionPi: null, failure: OWED_REVIEW_AGAIN });
    expect(await db.payment.count({ where: { coveredById: one.id } })).toBe(0); // what it covered is owed again
    const line = "This bank check was cancelled: a new chargeback arrived, so the team reviews your account again before you can pay. Pressing Complete won't charge anything.";
    expect((await peek(w.dev.cookie, { paymentId: one.id, since })).body).toEqual({ status: "waiting", cancelled: line });
    expect((await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } })).chargebackApprovedAt).toBeNull();
  });

  it("(a) the bank had already approved it: recorded as paid once, never charged again", async () => {
    const w = await cbWorld();
    const { one } = await reviewFirstOpen(w);
    w.st.pis.set(one.actionPi!, "succeeded");
    const made = w.st.made.length;
    const p2 = await w.paid(1, 800);
    await chargebackOpened(p2.stripePaymentIntentId!, null);
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: "bundled" });
    expect(await db.payment.count({ where: { kind: "chargeback", repaysId: { not: null }, developerId: w.dev.user.id, status: "charged" } })).toBe(1);
    expect(w.st.made.length).toBe(made);
  });

  it("(b) a chargeback it covers is won while the window is open: cancelled at Stripe; the window says what you owe changed", async () => {
    const w = await cbWorld();
    const { reversed, one, since } = await reviewFirstOpen(w);
    expect(await chargebackWon(reversed.stripePaymentIntentId!)).toBe(true);
    expect(w.st.cancelled).toContain(one.actionPi);
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: "cancelled", failure: OWED_WON_MEANWHILE });
    const line = "This bank check was cancelled: your bank decided a chargeback in your favour, so what you owe changed. Pressing Complete won't charge anything.";
    expect((await peek(w.dev.cookie, { paymentId: one.id, since })).body).toEqual({ status: "waiting", cancelled: line });
    expect(w.st.refunds).toEqual([]);
  });

  it("(b) won after the bank had already approved it: recorded paid once, and what it paid for that chargeback is refunded (the Terms' refund rule)", async () => {
    const w = await cbWorld();
    const { reversed, one } = await reviewFirstOpen(w);
    w.st.pis.set(one.actionPi!, "succeeded");
    expect(await chargebackWon(reversed.stripePaymentIntentId!)).toBe(true);
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: "bundled" });
    expect(w.st.refunds).toEqual([{ payment_intent: one.actionPi, amount: 2500 }]);
    expect(await db.payment.findFirstOrThrow({ where: { repaysId: reversed.id } })).toMatchObject({ status: "refunded", amountCents: 2500 });
  });

  it("(b) a chargeback hold's reservation open at the bank when its chargeback is won: cancelled; the window says so", async () => {
    const w = await cbWorld();
    const p = await w.paid(0, 1000);
    await chargebackOpened(p.stripePaymentIntentId!, null);
    await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    w.st.ask = true;
    const r = (await payOwed(w.dev.user, {})) as { confirm: { paymentId: string }[] };
    const res = await db.reservation.findUniqueOrThrow({ where: { id: r.confirm[0].paymentId } });
    expect(res.status).toBe("needs_action");
    await settle();
    const since = seen();
    await chargebackWon(p.stripePaymentIntentId!);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("cancelled");
    expect(w.st.cancelled).toContain(res.stripePaymentIntentId);
    expect((await peek(w.dev.cookie, { paymentId: res.id, since })).body).toEqual({ status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.won) });
  });

  it("(c) several changes at once: the first press lists EVERY change with its amount and the new total; the second pays it", async () => {
    const w = await cbWorld();
    // Three chargebacks (review-first): one resolved long ago, a whole $10.00 one and part ($12.00) of a $20.00 one; the team allowed paying.
    await db.payment.create({ data: { kind: "review", contractId: w.t[1].sessionId, developerId: w.dev.user.id, testerId: w.t[1].tester.user.id, amountCents: 500, feeCents: 50, testerCents: 450, status: "charged", chargeback: "resolved", reversedCents: 500, stripePaymentIntentId: "pi_" + randomUUID() } });
    const p1 = await w.paid(0, 1000);
    const p2 = await w.paid(1, 2000);
    await chargebackOpened(p1.stripePaymentIntentId!, null);
    await chargebackOpened(p2.stripePaymentIntentId!, 1200);
    await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    await approveChargebackHold(w.dev.user.id);
    // What the page showed: $25.00 + $27.00.
    const shown = (await owedLines(w.dev.user.id)).filter((l) => l.retry);
    const page = { seenTotalCents: shown.reduce((a, l) => a + l.amountCents, 0), seenIds: shown.map((l) => l.id), seenAmounts: Object.fromEntries(shown.map((l) => [l.id, l.amountCents])) };
    expect(page.seenTotalCents).toBe(5200);
    // Meanwhile: the $10.00 one is won, the bank raised the other to $20.00, and a $9.00 payment was declined.
    await chargebackWon(p1.stripePaymentIntentId!);
    expect(await disputeAmountChanged(p2.stripePaymentIntentId!, 2000)).toBe("followed");
    const failed = await db.payment.create({ data: { kind: "review", contractId: w.t[0].sessionId, submissionId: w.t[0].sub.id, developerId: w.dev.user.id, testerId: w.t[0].tester.user.id, amountCents: 900, feeCents: 0, testerCents: 0, status: "charged" } });
    await declinedPayment(w.dev.user.id, failed.id, 900, "Ana Silva's written answers");
    const e = await refused(payOwed(w.dev.user, page));
    expect(e?.code).toBe("stop_once");
    // (Owner, Nov 5, §206) Each change its own bullet, in order (added or failed, won, the bank's change), then the new total with the press-again line, keyed.
    const changes = e!.data!.changes as { text: string; key?: string }[];
    expect(changes.map((c) => c.text)).toEqual([
      expect.stringMatching(/^Another payment failed meanwhile: Ana Silva's written answers on “Harbor Run” \$9\.00/),
      expect.stringMatching(/^Your bank's chargeback of \$10\.00 on your \$10\.00 payment for .+ was reversed in your favour: \$25\.00 taken off$/), // (§247) names the payment
      expect.stringMatching(/^Your bank changed the amount it took back from your \$20\.00 payment for Ben Okafor's written answers on “Harbor Run”: \$12\.00 → \$20\.00 \(now \$20\.00 \+ \$15\.00 fee = \$35\.00\)/),
      "New total $44.00. Press again to pay $44.00.",
    ]);
    expect(changes.map((c) => c.key ?? null)).toEqual([null, null, null, "owed-total"]);
    expect(e!.data!.totalCents).toBe(4400);
    const bullets = (e!.data!.lines as { retry: boolean; amountCents: number }[]).filter((l) => l.retry);
    expect(bullets.reduce((a, l) => a + l.amountCents, 0)).toBe(4400);
    // The second press, from the stop's values, pays the new total.
    const again = { seenTotalCents: 4400, seenIds: e!.data!.ids, seenAmounts: Object.fromEntries(bullets.map((l) => [(l as unknown as { id: string }).id, l.amountCents])) };
    const before = w.st.made.length;
    const r = (await payOwed(w.dev.user, again)) as { paid: number };
    expect(r.paid).toBeGreaterThan(0);
    expect(w.st.made.slice(before).map((m) => m.amount)).toEqual([4400]);
  });
});

describe("§207 (Nov 4 recordings R1c, R10b): a check cancelled underneath its open window keeps the window open with its notice", () => {
  const wonLine = "This bank check was cancelled: your bank decided a chargeback in your favour, so what you owe changed. Pressing Complete won't charge anything.";
  const later = (ms: number, f: () => Promise<unknown>) => new Promise((done, fail) => setTimeout(() => f().then(done, fail), ms));

  it("a peek landing after Stripe cancelled it but before the app let go of it waits for the app, then says why (it answered \"done\" and the window closed)", async () => {
    const w = await cbWorld();
    const { reversed, one, since } = await reviewFirstOpen(w);
    // The chargeback won: chargebackWon cancels the check at Stripe first; the peek reads Stripe in that moment.
    w.st.pis.set(one.actionPi!, "canceled");
    const [answer] = await Promise.all([peek(w.dev.cookie, { paymentId: one.id, since, pi: one.actionPi }), later(300, () => chargebackWon(reversed.stripePaymentIntentId!))]);
    expect(answer.body).toEqual({ status: "waiting", cancelled: wonLine });
  });

  it("a peek landing after the app let go of it but before it was marked cancelled (Pay what you owe's release) waits too", async () => {
    const w = await cbWorld();
    const { one, since } = await reviewFirstOpen(w);
    w.st.pis.set(one.actionPi!, "canceled");
    await db.payment.update({ where: { id: one.id }, data: { actionPi: null, actionBy: null } }); // claimed (cancelOpenOwed / Cancel this check)
    const [answer] = await Promise.all([
      peek(w.dev.cookie, { paymentId: one.id, since }),
      later(300, async () => { await releaseOwed(one.id); await db.payment.update({ where: { id: one.id }, data: { failure: OWED_WON_MEANWHILE } }); }),
    ]);
    expect(answer.body).toEqual({ status: "waiting", cancelled: wonLine });
    // Ended by Cancel this check in another tab (no reason kept): ended elsewhere, the window still open.
    const w2 = await cbWorld();
    const o2 = await reviewFirstOpen(w2);
    await db.payment.update({ where: { id: o2.one.id }, data: { actionPi: null, actionBy: null } });
    const [a2] = await Promise.all([peek(w2.dev.cookie, { paymentId: o2.one.id, since: o2.since }), later(200, () => releaseOwed(o2.one.id))]);
    expect(a2.body).toEqual({ status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.elsewhere) });
  });

  it("cancelled at Stripe and never let go of in the app: after the wait the window still stays open (Complete charges nothing); went through: done as before", async () => {
    const w = await cbWorld();
    const { one, since } = await reviewFirstOpen(w);
    w.st.pis.set(one.actionPi!, "canceled");
    const t0 = Date.now();
    expect((await peek(w.dev.cookie, { paymentId: one.id, since })).body).toEqual({ status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.elsewhere) });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(SETTLE_MS - 50);
    w.st.pis.set(one.actionPi!, "succeeded");
    expect((await peek(w.dev.cookie, { paymentId: one.id, since })).body).toEqual({ status: "done" });
    // A page from before §160 (no `since`): Stripe's answer, as before.
    w.st.pis.set(one.actionPi!, "canceled");
    expect((await peek(w.dev.cookie, { paymentId: one.id })).body).toEqual({ status: "done" });
  });

  it("the same for a Pay whose check a hold start cancels: Stripe first, then the row", async () => {
    const w = await world();
    w.st.ask = true;
    const r = await payMore(w, w.anaSub.id, seen(), { confirmed: true, boxAt: seen() });
    const id = r.body.paymentId as string;
    const pi = (await db.payment.findUniqueOrThrow({ where: { id } })).actionPi!;
    await settle();
    const since = seen();
    w.st.pis.set(pi, "canceled");
    const [answer] = await Promise.all([peek(w.dev.cookie, { paymentId: id, since, pi }), later(300, () => startHold(w.dev.user.id, "unpaid"))]);
    expect(answer.body).toEqual({ status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.hold) });
  });
});

describe("§171 C: the Terms of Use", () => {
  it("“Changes while you pay” sits under Paying for work; Charge and Let it go only before any payment; the 2nd chargeback's review; no new version", () => {
    const heads = PAYMENT_RULES.map((r) => r.heading);
    expect(heads.indexOf("Changes while you pay")).toBe(heads.indexOf("Paying for work") + 1);
    const c = PAYMENT_RULES.find((r) => r.heading === "Changes while you pay")!;
    expect(c.text).toMatch(/^Pay, Pay more, Confirm with your bank and Confirm all check what changed since your page last showed it\./);
    expect(c.text).toContain("anything on the part you're paying (work sent or added to it, a dispute on it, another payment on it), a dispute by that tester or the team's decision on one");
    expect(c.text).toContain("changes show in a blue notice in the bank's box (everything about that tester, whatever your Alerts)");
    expect(c.example).toBe("You open Pay $20 for Nina's recording; Nina adds to that recording before you press: the press stops and lists her addition; press again to pay.");
    expect(PAYMENT_RULES.find((r) => r.heading === "Unreviewed work: Charge or Let it go")!.text).toContain("Charge and Let it go are offered only while the developer hasn't paid anything on that part; once they have, Dispute is the way to ask for more.");
    expect(PAYMENT_RULES.find((r) => r.heading === "Bank checks, declines, holds")!.text).toContain("From an account's 2nd chargeback");
    expect(TERMS_VERSION).toBe(2);
    expect(WHAT_CHANGED).toHaveLength(1);
  });
});
