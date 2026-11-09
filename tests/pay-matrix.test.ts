import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fmtDateTimeIn } from "@/lib/format";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { decideDispute } from "@/lib/server/payments";
import { chargebackOpened, disputeAmountChanged, owed } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, addTo, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §159) The payment stop matrix: one test per rule.
// 1. The team's decision about the SAME tester always stops Pay / Pay more / Confirm once; about ANOTHER tester it follows "Decisions by the team".
// 2. The tester's sent / updated / added work on the SAME part always stops Pay / Pay more / Confirm once; work on other parts follows "Work sent".
// 3. A tester leaving follows "Testers leaving".
// 4. The tester's Charge / Let it go stop once for a developer payment on THAT part and for the team's decision on any of their disputes, whatever their Alerts;
//    a payment on their other parts follows their Alerts.
// 5. Pay what you owe stops once for a new chargeback and for the bank changing a disputed amount.

const DAY = 86_400_000;
beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json);
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
/** Charges go through; reservations wait for capture. */
const paying = () => setStripeForTests({
  paymentIntents: {
    create: async (p: { capture_method?: string }) => ({ id: "pi_" + randomUUID(), status: p.capture_method === "manual" ? "requires_capture" : "succeeded" }),
    retrieve: async (id: string) => ({ id, status: "succeeded", latest_charge: id.replace(/^pi_/, "ch_") }),
    cancel: async (id: string) => ({ id, status: "canceled" }),
  },
  transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
  customers: { update: async () => ({}) },
} as unknown as Stripe);

/**
 * Ana: written answers paid $4.00 and disputed, and a recording sent (not paid yet). Ben: written answers sent (not paid yet). The developer's Alerts ignore
 * `ignored` (by default Disputes, Decisions by the team and Work sent).
 */
async function world(ignored: string[] = ["disputes", "admin", "work"]) {
  const s = await setup({ recordingCents: "10.00" });
  const ana = await joined(s.testId, "Ana Silva");
  const ben = await joined(s.testId, "Ben Okafor", "he");
  for (const t of [ana, ben]) await sact(t.sessionId, "written", t.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const anaSub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId, kind: "written" } });
  const benSub = await db.submission.findFirstOrThrow({ where: { contractId: ben.sessionId } });
  const anaRec = await db.submission.create({ data: { contractId: ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
  paying();
  expect((await pay(s.dev.cookie, { kind: "submission", id: anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen() })).status).toBe(200);
  expect((await sact(ana.sessionId, "dispute", ana.tester.cookie, { kind: "submission", id: anaSub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
  await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ignored } });
  const a = await makeUser({ name: "Admin" });
  const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  const row = await db.dispute.findFirstOrThrow({ where: { submissionId: anaSub.id } });
  await settle();
  return { ...s, ana, ben, anaSub, benSub, anaRec, admin, row };
}
type W = Awaited<ReturnType<typeof world>>;
/** The team decides Ana's dispute ($10 in all) after the page loaded; returns the page's seen time. */
async function decidedAfterLoad(w: W) {
  const loaded = seen();
  await settle();
  await decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600 });
  await settle();
  return loaded;
}
const payRec = (w: W, seenAt: string, more: Record<string, unknown> = {}) => pay(w.dev.cookie, { kind: "submission", id: w.anaRec.id, amount: "10.00", tickedCents: 1000, seenAt, ...more });
const payBen = (w: W, seenAt: string, more: Record<string, unknown> = {}) => pay(w.dev.cookie, { kind: "submission", id: w.benSub.id, amount: "10.00", tickedCents: 1000, seenAt, ...more });
/** A charge made while away on this part, waiting for the bank (a tester's Charge that the bank wants confirmed). */
async function waiting(w: W, contractId: string, submissionId: string, testerId: string) {
  await db.review.create({ data: { contractId, submissionId, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason: "charged by the tester" } });
  return db.payment.create({ data: { kind: "review", contractId, submissionId, developerId: (await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: true } })).test.developerId, testerId, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 60_000) } });
}
const confirmStart = (cookie: string, paymentId: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body: { paymentId, start: true, ...body } })).then(json);

describe("§159 rule 1: the team's decision — same tester always stops, another tester follows Alerts", () => {
  it("Pay on the SAME tester's other part (Decisions by the team ticked off): stops once naming the decision; the second press pays", async () => {
    const w = await world();
    const loaded = await decidedAfterLoad(w);
    const first = await payRec(w, loaded);
    expect([first.status, first.body.error?.code]).toEqual([409, "stop_once"]);
    expect(texts(first)).toEqual([expect.stringMatching(/^The team decided Ana Silva's dispute/)]);
    const second = await payRec(w, loaded, { confirmed: true, boxAt: first.body.error.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
  });

  it("Pay on ANOTHER tester's part: ticked off → straight through; ticked on → stops once", async () => {
    const off = await world();
    const loaded = await decidedAfterLoad(off);
    const r = await payBen(off, loaded);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const on = await world(["disputes", "work"]);
    const loaded2 = await decidedAfterLoad(on);
    const first = await payBen(on, loaded2);
    expect(first.body.error?.code).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/^The team decided Ana Silva's dispute/)]);
  });

  it("Pay more on the same tester's part stops once for the decision (ticked off); on another tester's part it doesn't", async () => {
    const w = await world();
    expect((await payRec(w, seen(), { amount: "5.00", tickedCents: 500, reason: "Only half of it was useful" })).status).toBe(200);
    expect((await payBen(w, seen(), { amount: "5.00", tickedCents: 500, reason: "Only half of it was useful" })).status).toBe(200);
    const loaded = await decidedAfterLoad(w);
    const more = (contractId: string, submissionId: string, extra: Record<string, unknown> = {}) => act(w.testId, "pay-extra", w.dev.cookie, { contractId, submissionId, amount: "1.00", tickedCents: 100, seenAt: loaded, ...extra });
    const first = await more(w.ana.sessionId, w.anaRec.id);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/^The team decided Ana Silva's dispute/)]);
    expect((await more(w.ana.sessionId, w.anaRec.id, { confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
    expect((await more(w.ben.sessionId, w.benSub.id)).status).toBe(200);
  });

  it("Confirm with your bank on a waiting charge: the same tester's decision stops it once (ticked off); another tester's doesn't", async () => {
    const w = await world();
    const anaWait = await waiting(w, w.ana.sessionId, w.anaRec.id, w.ana.tester.user.id);
    const benWait = await waiting(w, w.ben.sessionId, w.benSub.id, w.ben.tester.user.id);
    setStripeForTests(null);
    await settle();
    const loaded = await decidedAfterLoad(w);
    const first = await confirmStart(w.dev.cookie, anaWait.id, { seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/^The team decided Ana Silva's dispute/)]);
    expect((await confirmStart(w.dev.cookie, anaWait.id, { seenAt: loaded, confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
    const ben = await confirmStart(w.dev.cookie, benWait.id, { seenAt: loaded });
    expect(ben.status, JSON.stringify(ben.body)).toBe(200);
  });
});

describe("§159 rule 2: the tester adding to that part stops Pay once if unseen", () => {
  it("Ana adds to her written answers after the page loaded: Pay on them stops once naming it, then pays", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    await settle();
    const loaded = seen(); await settle();
    expect((await addTo(sessionId, tester.cookie, { text: "one more thing", confirmed: true })).status).toBe(200);
    paying();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const body = { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded };
    const first = await pay(dev.cookie, body);
    expect(texts(first)).toEqual([expect.stringMatching(/^Ana Silva added to her answer to “/)]);
    expect((await pay(dev.cookie, { ...body, confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
  });
});

describe("§159 rule 2: work on every part follows \"Work sent\"", () => {
  /** Ana's written answers and recording sent; "Work sent" ticked off (or not). */
  async function workWorld(off: boolean) {
    const { dev, testId } = await setup({ recordingCents: "10.00" });
    const { tester, sessionId } = await joined(testId, "Ana Silva");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    if (off) await db.test.update({ where: { id: testId }, data: { ignoredAlerts: ["work"] } });
    paying();
    await settle();
    return { dev, testId, tester, sessionId, sub, rec };
  }

  it("\"Work sent\" ticked off: an addition to the part being paid allows Pay", async () => {
    const w = await workWorld(true);
    const loaded = seen(); await settle();
    expect((await addTo(w.sessionId, w.tester.cookie, { text: "one more thing", confirmed: true })).status).toBe(200);
    const body = { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded };
    const first = await pay(w.dev.cookie, body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
  });

  it("an addition to her OTHER part follows the tick: off → Pay goes through; on → stops once", async () => {
    for (const off of [true, false]) {
      const w = await workWorld(off);
      const loaded = seen(); await settle();
      // Ana adds to her written answers; Nora pays the recording.
      expect((await addTo(w.sessionId, w.tester.cookie, { text: "one more thing", confirmed: true })).status).toBe(200);
      const r = await pay(w.dev.cookie, { kind: "submission", id: w.rec.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
      if (off) expect(r.status, JSON.stringify(r.body)).toBe(200);
      else expect(texts(r)).toEqual([expect.stringMatching(/^Ana Silva added to her answer to “/)]);
    }
  });

  it("Pay more and Confirm with your bank on the part: an update sent after the Pay follows \"Work sent\" ticked off", async () => {
    const w = await workWorld(true);
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).status).toBe(200);
    const waitRow = await db.payment.create({ data: { kind: "review", contractId: w.sessionId, submissionId: w.rec.id, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 60_000) } });
    await db.review.create({ data: { contractId: w.sessionId, submissionId: w.rec.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason: "charged by the tester" } });
    await settle();
    const loaded = seen(); await settle();
    expect((await addTo(w.sessionId, w.tester.cookie, { text: "more", confirmed: true })).status).toBe(200);
    const more = await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, seenAt: loaded });
    expect(more.status, JSON.stringify(more.body)).toBe(200);
    // Confirm on the recording's waiting charge: the written answers' update is another part → follows the tick (off): no stop.
    setStripeForTests(null);
    const c = await confirmStart(w.dev.cookie, waitRow.id, { seenAt: loaded });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
  });
});

describe("§159 rule 3: a tester leaving follows Alerts' \"Testers leaving\"", () => {
  it("ticked on → Pay on another tester stops once naming it; ticked off → straight through", async () => {
    for (const ignored of [[], ["leaving"]]) {
      const w = await world(ignored);
      const loaded = seen(); await settle();
      expect((await sact(w.ana.sessionId, "leave", w.ana.tester.cookie, { confirmed: true })).status).toBe(200);
      await settle();
      const r = await payBen(w, loaded);
      if (ignored.length) expect(r.status, JSON.stringify(r.body)).toBe(200);
      else {
        expect(r.body.error?.code).toBe("stop_once");
        expect(texts(r)).toContain("Ana Silva left the test");
      }
    }
  });
});

describe("§159 rule 4: Charge / Let it go — a payment on that part and the team's decision always stop once; other parts follow the tester's Alerts", () => {
  /** Ana (Alerts `off`) with two parts open for her choice: written answers and a recording; plus a booked call part. */
  async function choiceWorld(off: boolean) {
    const s = await setup({ recordingCents: "10.00" });
    const ana = await joined(s.testId, "Ana Silva");
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    const open = { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY), payBy: new Date(Date.now() - DAY) };
    const written = await db.submission.update({ where: { id: (await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } })).id }, data: open });
    const rec = await db.submission.create({ data: { contractId: ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date(), devMarks: [], ...open } });
    await db.user.update({ where: { id: ana.tester.user.id }, data: { testerAlertsOff: off } });
    paying();
    await settle();
    return { ...s, ana, written, rec };
  }
  const choose = (w: Awaited<ReturnType<typeof choiceWorld>>, choice: "charge" | "letgo", body: Record<string, unknown>) =>
    sact(w.ana.sessionId, "choose", w.ana.tester.cookie, { submissionId: w.written.id, choice, ...(choice === "charge" ? { amount: "10.00" } : {}), ...body });

  it("a developer Pay on her OTHER part follows her Alerts: Off → straight through; On → stops once naming it", async () => {
    for (const off of [true, false]) {
      for (const choice of ["charge", "letgo"] as const) {
        const w = await choiceWorld(off);
        const loaded = seen(); await settle();
        expect((await pay(w.dev.cookie, { kind: "submission", id: w.rec.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true })).status).toBe(200);
        await settle();
        const first = await choose(w, choice, { seenAt: loaded, loadedAt: loaded });
        if (off) { expect(first.status, `${choice} ${JSON.stringify(first.body)}`).toBe(200); continue; }
        expect(first.body.error?.code, `${choice} ${JSON.stringify(first.body)}`).toBe("stop_once");
        expect(texts(first)).toEqual(["Nora Lane paid $10.00 for your recording"]);
        const second = await choose(w, choice, { seenAt: loaded, confirmed: true, boxAt: seen() });
        expect(second.status, JSON.stringify(second.body)).toBe(200);
      }
    }
  });

  it("a developer payment on the SAME part, Alerts Off: it left nothing to charge, so the existing refusal names it", async () => {
    const w = await choiceWorld(true);
    const loaded = seen(); await settle();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await choose(w, "charge", { seenAt: loaded, loadedAt: loaded });
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, "done", "Nora Lane paid $10.00 for this meanwhile: you can dispute it if you think it should be more."]); // (batch 35 §163) one final refusal, with the way to more
  });

  it("only dispute changes force tester presses with Alerts Off; developer payments follow Alerts", async () => {
    const { disputeChange } = await import("@/lib/server/testerGate");
    const at = new Date();
    expect(disputeChange({ kind: "paid", text: "Nora Lane paid you $1.00 more for your written answers", createdAt: at, piece: "sub1" })).toBe(false);
    expect(disputeChange({ kind: "paid", text: "Nora Lane paid $15.00 for your live call", createdAt: at, piece: "call1" })).toBe(false);
    expect(disputeChange({ kind: "paid", text: "Nora Lane paid $10.00 for your recording", createdAt: at, piece: "sub2" })).toBe(false);
    expect(disputeChange({ kind: "admin", text: "The team decided your dispute about your recording: the pay stays at $4.00", createdAt: at, piece: "sub2" })).toBe(true);
    expect(disputeChange({ kind: "paid", text: "Nora Lane paid $5.00 for your written answers on Sky Lab", createdAt: at })).toBe(false);
  });

  it("an automatic call charge on her call part (another part) follows her Alerts: On → stops Charge once naming it; Off → doesn't", async () => {
    for (const off of [false, true]) {
      const w = await choiceWorld(off);
      const slot = await db.callSlot.create({ data: { testId: w.testId, startsAt: new Date(Date.now() - 9 * DAY), minutes: 30, status: "taken" } });
      const call = await db.call.create({ data: { contractId: w.ana.sessionId, slotId: slot.id, startsAt: slot.startsAt, minutes: 30, status: "booked", endedAt: new Date(Date.now() - 9 * DAY + 1_800_000) } });
      const loaded = seen(); await settle();
      await db.review.create({ data: { contractId: w.ana.sessionId, callId: call.id, amountCents: 1500, payKey: randomUUID(), auto: true } });
      await settle();
      const first = await choose(w, "charge", { seenAt: loaded, loadedAt: loaded });
      if (off) { expect(first.status, JSON.stringify(first.body)).toBe(200); continue; }
      expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
      expect(texts(first)).toEqual([`Nora Lane paid $15.00 for your live call on ${fmtDateTimeIn(slot.startsAt, "UTC")}`]); // (§177) which call
    }
  });

  it("the team's decision on her dispute about ANOTHER part stops Charge and Let it go once with Alerts Off", async () => {
    for (const choice of ["charge", "letgo"] as const) {
      const w = await choiceWorld(true);
      expect((await pay(w.dev.cookie, { kind: "submission", id: w.rec.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen(), confirmed: true })).status).toBe(200);
      expect((await sact(w.ana.sessionId, "dispute", w.ana.tester.cookie, { kind: "submission", id: w.rec.id, reason: "I recorded the whole session", seenAt: seen(), confirmed: true })).status).toBe(200);
      const a = await makeUser({ name: "Admin" });
      const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
      await settle();
      const loaded = seen(); await settle();
      await decideDispute(admin, (await db.dispute.findFirstOrThrow({ where: { submissionId: w.rec.id } })).id, { total: "4.00", tickCents: 0 });
      await settle();
      const first = await choose(w, choice, { seenAt: loaded, loadedAt: loaded });
      expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
      expect(texts(first)).toEqual([expect.stringMatching(/^The team decided your dispute with .+ about your recording/)]);
      expect((await choose(w, choice, { seenAt: loaded, confirmed: true, boxAt: seen() })).status).toBe(200);
    }
  });

  it("with Alerts Off, a change that isn't about what she's owed still doesn't stop (a call request from the developer)", async () => {
    const w = await choiceWorld(true);
    const loaded = seen(); await settle();
    const startsAt = new Date(Date.now() + 2 * DAY); startsAt.setUTCSeconds(0, 0);
    expect((await act(w.testId, "request-time", w.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [w.ana.sessionId], startsAt: startsAt.toISOString() })).status).toBe(200);
    await settle();
    const r = await choose(w, "letgo", { seenAt: loaded, loadedAt: loaded });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});

describe("§159 rule 5: Pay what you owe stops once for chargeback changes", () => {
  it("a new chargeback, then the bank changing the disputed amount: each stops once with the new total; the press after reserves", async () => {
    const s = await setup();
    const ana = await joined(s.testId, "Ana Silva");
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
    paying();
    const pi = "pi_" + randomUUID();
    const p = await db.payment.create({ data: { kind: "review", contractId: ana.sessionId, submissionId: sub.id, developerId: s.dev.user.id, testerId: ana.tester.user.id, amountCents: 1000, feeCents: 100, testerCents: 900, status: "charged", transferStatus: "sent", stripeTransferId: "tr_" + randomUUID(), stripePaymentIntentId: pi } });
    const press = (body: Record<string, unknown>) => owedPOST(req("/api/payments/owed", { cookie: s.dev.cookie, body })).then(json);
    // The page showed nothing owed yet; a chargeback arrives.
    await chargebackOpened(pi, 600);
    await db.user.update({ where: { id: s.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    const first = await press({ seenTotalCents: 0, seenIds: [] });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)[0]).toMatch(/^Added to what you owe meanwhile: Your bank reversed \$6 /);
    // (Owner, Nov 5, §206) Each change its own bullet; the new total with the press-again line is the last one, keyed so the next stop replaces it.
    expect(texts(first)).toHaveLength(2);
    expect(texts(first)[1]).toMatch(/^New total \$21\.00\. Press again to reserve \$21\.00 /);
    expect(first.body.error.changes.at(-1).key).toBe("owed-total");
    expect(first.body.error.totalCents).toBe(2100);
    // The bank changes the disputed amount before the second press: it stops once more on the new total.
    expect(await disputeAmountChanged(pi, 800)).toBe("followed");
    const second = await press({ seenTotalCents: first.body.error.totalCents, seenIds: first.body.error.ids, confirmed: true });
    expect(second.body.error?.code, JSON.stringify(second.body)).toBe("stop_once");
    expect(texts(second)[0]).toMatch(/^Your bank changed the amount it took back .*= \$23\.00\)/); // (A3) the stop names the bank's change
    // (§206) An amount change alone ends with the new total too (it read only the press-again line before).
    expect(texts(second)).toHaveLength(2);
    expect(texts(second)[1]).toMatch(/^New total \$23\.00\. Press again to reserve \$23\.00 /);
    const third = await press({ seenTotalCents: second.body.error.totalCents, seenIds: second.body.error.ids, confirmed: true });
    expect(third.body, JSON.stringify(third.body)).toMatchObject({ reservedCents: 2300 });
    expect((await owed(s.dev.user.id)).map((x) => x.id)).toEqual([p.id]);
  });
});
